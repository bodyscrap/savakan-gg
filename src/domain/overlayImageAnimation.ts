import { t } from "../i18n";
import { MAX_IMAGE_BYTES } from "./overlayLayout";

export type OverlayImageAnimation = {
  animated: boolean;
  looping: boolean;
};

type EncodedImage = {
  prefix: string;
  mime: string;
  bytes: Uint8Array;
};

type GifInfo = {
  frameCount: number;
  insertionOffset: number;
  loopRanges: Array<[number, number]>;
};

type ImageAnimationInfo = OverlayImageAnimation & {
  loopOffset?: number;
  crcOffset?: number;
  crcStart?: number;
};

const emptyAnimation: OverlayImageAnimation = { animated: false, looping: false };
const gifLoopExtension = Uint8Array.from([
  0x21, 0xff, 0x0b,
  ...Array.from("NETSCAPE2.0", (character) => character.charCodeAt(0)),
  0x03, 0x01, 0x00, 0x00, 0x00,
]);

function decodeImage(dataUrl: string): EncodedImage | null {
  const match = /^data:(image\/(?:gif|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/i.exec(dataUrl);
  if (!match) return null;
  const binary = atob(match[2]);
  return {
    prefix: dataUrl.slice(0, dataUrl.indexOf(",") + 1),
    mime: match[1].toLowerCase(),
    bytes: Uint8Array.from(binary, (character) => character.charCodeAt(0)),
  };
}

function encodeImage(image: EncodedImage, bytes: Uint8Array): string {
  if (bytes.length > MAX_IMAGE_BYTES) {
    throw new Error(t("画像は4MB以下のPNG・JPEG・GIF・WebPを選択してください。"));
  }
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return `${image.prefix}${btoa(binary)}`;
}

function skipGifSubBlocks(bytes: Uint8Array, start: number): number | null {
  let offset = start;
  while (offset < bytes.length) {
    const length = bytes[offset++];
    if (length === 0) return offset;
    offset += length;
    if (offset > bytes.length) return null;
  }
  return null;
}

function inspectGif(bytes: Uint8Array): (OverlayImageAnimation & GifInfo) | null {
  if (bytes.length < 13 || String.fromCharCode(...bytes.subarray(0, 3)) !== "GIF") return null;
  let offset = 13;
  const screenPacked = bytes[10];
  if (screenPacked & 0x80) offset += 3 * (1 << ((screenPacked & 0x07) + 1));
  const insertionOffset = offset;
  const loopRanges: Array<[number, number]> = [];
  let frameCount = 0;
  let looping = false;

  while (offset < bytes.length) {
    const blockStart = offset;
    const marker = bytes[offset++];
    if (marker === 0x3b) break;
    if (marker === 0x21) {
      if (offset >= bytes.length) return null;
      const label = bytes[offset++];
      if (label === 0xff) {
        if (offset >= bytes.length) return null;
        const applicationLength = bytes[offset++];
        if (offset + applicationLength > bytes.length) return null;
        const application = String.fromCharCode(...bytes.subarray(offset, offset + applicationLength));
        offset += applicationLength;
        const dataStart = offset;
        const end = skipGifSubBlocks(bytes, offset);
        if (end === null) return null;
        if (application === "NETSCAPE2.0" || application === "ANIMEXTS1.0") {
          loopRanges.push([blockStart, end]);
          if (bytes[dataStart] === 3 && bytes[dataStart + 1] === 1) looping = true;
        }
        offset = end;
      } else {
        const end = skipGifSubBlocks(bytes, offset);
        if (end === null) return null;
        offset = end;
      }
      continue;
    }
    if (marker !== 0x2c || offset + 9 > bytes.length) return null;
    frameCount += 1;
    const imagePacked = bytes[offset + 8];
    offset += 9;
    if (imagePacked & 0x80) offset += 3 * (1 << ((imagePacked & 0x07) + 1));
    if (offset >= bytes.length) return null;
    offset += 1;
    const end = skipGifSubBlocks(bytes, offset);
    if (end === null) return null;
    offset = end;
  }

  const animated = frameCount > 1;
  return { animated, looping: animated && looping, frameCount, insertionOffset, loopRanges };
}

function readUint32(bytes: Uint8Array, offset: number, littleEndian: boolean): number {
  return littleEndian
    ? (bytes[offset] | bytes[offset + 1] << 8 | bytes[offset + 2] << 16 | bytes[offset + 3] << 24) >>> 0
    : (bytes[offset] << 24 | bytes[offset + 1] << 16 | bytes[offset + 2] << 8 | bytes[offset + 3]) >>> 0;
}

function writeUint32(bytes: Uint8Array, offset: number, value: number, littleEndian: boolean): void {
  for (let index = 0; index < 4; index += 1) {
    bytes[offset + (littleEndian ? index : 3 - index)] = value >>> (index * 8) & 0xff;
  }
}

function pngCrc32(bytes: Uint8Array, start: number, end: number): number {
  let crc = 0xffffffff;
  for (let offset = start; offset < end; offset += 1) {
    crc ^= bytes[offset];
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function inspectApng(bytes: Uint8Array): ImageAnimationInfo | null {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length < 8 || signature.some((byte, index) => bytes[index] !== byte)) return null;
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = readUint32(bytes, offset, false);
    const dataOffset = offset + 8;
    const crcOffset = dataOffset + length;
    if (crcOffset + 4 > bytes.length) return null;
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (type === "acTL" && length >= 8) {
      const frameCount = readUint32(bytes, dataOffset, false);
      const playCount = readUint32(bytes, dataOffset + 4, false);
      return {
        animated: frameCount > 1,
        looping: playCount !== 1,
        loopOffset: dataOffset + 4,
        crcOffset,
        crcStart: offset + 4,
      };
    }
    offset = crcOffset + 4;
  }
  return emptyAnimation;
}

function inspectWebp(bytes: Uint8Array): ImageAnimationInfo | null {
  if (bytes.length < 12 || String.fromCharCode(...bytes.subarray(0, 4)) !== "RIFF"
    || String.fromCharCode(...bytes.subarray(8, 12)) !== "WEBP") return null;
  const riffEnd = readUint32(bytes, 4, true) + 8;
  if (riffEnd > bytes.length) return null;
  let offset = 12;
  let frameCount = 0;
  let loopOffset: number | undefined;
  let loopCount = 1;
  while (offset + 8 <= riffEnd) {
    const type = String.fromCharCode(...bytes.subarray(offset, offset + 4));
    const length = readUint32(bytes, offset + 4, true);
    const dataOffset = offset + 8;
    const end = dataOffset + length;
    if (end > riffEnd) return null;
    if (type === "ANMF") frameCount += 1;
    if (type === "ANIM" && length >= 6) {
      loopOffset = dataOffset + 4;
      loopCount = bytes[loopOffset] | bytes[loopOffset + 1] << 8;
    }
    offset = end + (length & 1);
  }
  return { animated: frameCount > 1 && loopOffset !== undefined, looping: loopCount !== 1, loopOffset };
}

function inspectImage(image: EncodedImage): ImageAnimationInfo | null {
  if (image.mime === "image/gif") {
    const info = inspectGif(image.bytes);
    return info ? { animated: info.animated, looping: info.looping } : null;
  }
  if (image.mime === "image/png") return inspectApng(image.bytes);
  if (image.mime === "image/webp") return inspectWebp(image.bytes);
  return null;
}

export function inspectOverlayImageAnimation(dataUrl: string): OverlayImageAnimation {
  const image = decodeImage(dataUrl);
  const info = image ? inspectImage(image) : null;
  return info ? { animated: info.animated, looping: info.looping } : emptyAnimation;
}

export function setOverlayImageLooping(dataUrl: string, looping: boolean): string {
  const image = decodeImage(dataUrl);
  if (!image) return dataUrl;

  if (image.mime === "image/gif") {
    const info = inspectGif(image.bytes);
    if (!info?.animated) return dataUrl;
    const removedBytes = info.loopRanges.reduce((total, [start, end]) => total + end - start, 0);
    const next = new Uint8Array(image.bytes.length - removedBytes + (looping ? gifLoopExtension.length : 0));
    let sourceOffset = 0;
    let targetOffset = 0;
    for (const [start, end] of info.loopRanges) {
      next.set(image.bytes.subarray(sourceOffset, start), targetOffset);
      targetOffset += start - sourceOffset;
      sourceOffset = end;
    }
    next.set(image.bytes.subarray(sourceOffset), targetOffset);
    targetOffset += image.bytes.length - sourceOffset;
    const insertionOffset = info.insertionOffset
      - info.loopRanges.filter(([, end]) => end <= info.insertionOffset)
        .reduce((total, [start, end]) => total + end - start, 0);
    if (looping) {
      next.copyWithin(insertionOffset + gifLoopExtension.length, insertionOffset, targetOffset);
      next.set(gifLoopExtension, insertionOffset);
    }
    return encodeImage(image, next);
  }

  const info = inspectImage(image);
  if (!info?.animated) return dataUrl;
  const next = image.bytes.slice();
  const loopValue = looping ? 0 : 1;
  if (image.mime === "image/png" && "loopOffset" in info && info.loopOffset !== undefined
    && info.crcOffset !== undefined && info.crcStart !== undefined) {
    writeUint32(next, info.loopOffset, loopValue, false);
    writeUint32(next, info.crcOffset, pngCrc32(next, info.crcStart, info.crcOffset), false);
  } else if (image.mime === "image/webp" && "loopOffset" in info && info.loopOffset !== undefined) {
    next[info.loopOffset] = loopValue & 0xff;
    next[info.loopOffset + 1] = loopValue >>> 8;
  }
  return encodeImage(image, next);
}
