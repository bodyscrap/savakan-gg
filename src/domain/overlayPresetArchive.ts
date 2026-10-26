import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from "fflate";
import { parseOverlayLayouts, MAX_IMAGE_BYTES, MAX_LAYOUT_BYTES, type OverlayLayouts } from "./overlayLayout";
import { t } from "../i18n";

const MANIFEST_PATH = "manifest.json";
const ARCHIVE_FORMAT = "savakan-gg-overlay-presets";

type ArchiveManifest = {
  format: typeof ARCHIVE_FORMAT;
  version: 1;
  layouts: OverlayLayouts;
  images: { presetIndex: number; componentIndex: number; path: string }[];
};

function imageDataBytes(value: string): { extension: string; bytes: Uint8Array } {
  const match = /^data:image\/(png|jpeg|gif|webp);base64,([A-Za-z0-9+/]+={0,2})$/u.exec(value);
  if (!match) throw new Error(t("オーバーレイプリセットの形式が不正です。"));
  const binary = atob(match[2]);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) {
    throw new Error(t("画像は4MB以下のPNG・JPEG・GIF・WebPを選択してください。"));
  }
  return { extension: match[1] === "jpeg" ? "jpg" : match[1], bytes };
}

function bytesToBase64(bytes: Uint8Array): string {
  const pieces: string[] = [];
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    pieces.push(String.fromCharCode(...bytes.subarray(offset, offset + chunkSize)));
  }
  return btoa(pieces.join(""));
}

export function createOverlayPresetArchive(value: unknown): Uint8Array {
  const layouts = parseOverlayLayouts(value);
  const archiveFiles: Zippable = {};
  const images: ArchiveManifest["images"] = [];
  const archiveLayouts: OverlayLayouts = {
    ...layouts,
    presets: layouts.presets.map((preset, presetIndex) => ({
      ...preset,
      components: preset.components.map((component, componentIndex) => {
        if (!component.image) return component;
        const { extension, bytes } = imageDataBytes(component.image);
        const path = `images/image-${presetIndex}-${componentIndex}.${extension}`;
        archiveFiles[path] = bytes;
        images.push({ presetIndex, componentIndex, path });
        return { ...component, image: "" };
      }),
    })),
  };
  const manifest: ArchiveManifest = {
    format: ARCHIVE_FORMAT,
    version: 1,
    layouts: archiveLayouts,
    images,
  };
  archiveFiles[MANIFEST_PATH] = strToU8(JSON.stringify(manifest));
  const archive = zipSync(archiveFiles, { level: 6 });
  if (archive.length > MAX_LAYOUT_BYTES) {
    throw new Error(t("プリセットファイルは32MB以下にしてください。"));
  }
  return archive;
}

export function overlayPresetArchiveBase64(archive: Uint8Array): string {
  return bytesToBase64(archive);
}

export function parseOverlayPresetArchive(data: Uint8Array): OverlayLayouts {
  if (data.length > MAX_LAYOUT_BYTES) {
    throw new Error(t("プリセットファイルは32MB以下にしてください。"));
  }
  const extractedNames = new Set<string>();
  let expandedBytes = 0;
  const archive = unzipSync(data, {
    filter: (file) => {
      if (file.name !== MANIFEST_PATH && !/^images\/image-\d+-\d+\.(png|jpg|gif|webp)$/u.test(file.name)) {
        throw new Error(t("圧縮プリセットの内容が不正です。"));
      }
      if (extractedNames.has(file.name) || file.originalSize < 0
        || file.originalSize > MAX_LAYOUT_BYTES - expandedBytes) {
        throw new Error(t("プリセットファイルは32MB以下にしてください。"));
      }
      if (file.compression !== 0 && file.compression !== 8) {
        throw new Error(t("圧縮プリセットの形式に対応していません。"));
      }
      extractedNames.add(file.name);
      expandedBytes += file.originalSize;
      return true;
    },
  });
  const manifestData = archive[MANIFEST_PATH];
  if (!manifestData) throw new Error(t("圧縮プリセットの内容が不正です。"));
  const parsed = JSON.parse(strFromU8(manifestData)) as Partial<ArchiveManifest>;
  if (parsed.format !== ARCHIVE_FORMAT || parsed.version !== 1 || !Array.isArray(parsed.images)) {
    throw new Error(t("圧縮プリセットの内容が不正です。"));
  }
  const layouts = parseOverlayLayouts(parsed.layouts);
  const referencedImages = new Set<string>();
  for (const image of parsed.images) {
    if (!Number.isInteger(image.presetIndex) || !Number.isInteger(image.componentIndex)
      || image.presetIndex < 0 || image.componentIndex < 0
      || !/^images\/image-\d+-\d+\.(png|jpg|gif|webp)$/u.test(image.path)
      || referencedImages.has(image.path)) {
      throw new Error(t("圧縮プリセットの内容が不正です。"));
    }
    const component = layouts.presets[image.presetIndex]?.components[image.componentIndex];
    const bytes = archive[image.path];
    if (!component || component.image !== "" || !bytes || bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) {
      throw new Error(t("圧縮プリセットの内容が不正です。"));
    }
    const extension = image.path.slice(image.path.lastIndexOf(".") + 1);
    const mimeType = extension === "jpg" ? "jpeg" : extension;
    component.image = `data:image/${mimeType};base64,${bytesToBase64(bytes)}`;
    referencedImages.add(image.path);
  }
  if (Object.keys(archive).some((path) => path !== MANIFEST_PATH && !referencedImages.has(path))) {
    throw new Error(t("圧縮プリセットの内容が不正です。"));
  }
  return parseOverlayLayouts(layouts);
}
