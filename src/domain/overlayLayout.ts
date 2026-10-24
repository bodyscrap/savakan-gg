import { t } from "../i18n";

export const overlayTextSources = [
  "redPlayerName", "bluePlayerName",
  "roundText", "setName", "roundName", "eventName", "eventAlias", "text",
] as const;
export const overlayNumberSources = ["redSetWins", "blueSetWins", "number"] as const;
export const overlayItemSources = ["redItems", "blueItems"] as const;
export const overlaySources = [...overlayTextSources, ...overlayNumberSources, ...overlayItemSources, "clock"] as const;
export type OverlaySource = typeof overlaySources[number];
export const overlaySourceLabels: Record<OverlaySource, string> = {
  text: "固定テキスト", number: "固定数値", redPlayerName: "1P プレイヤー名", bluePlayerName: "2P プレイヤー名",
  redSetWins: "1P 取得ゲーム数", blueSetWins: "2P 取得ゲーム数", roundText: "セット・ラウンド情報",
  setName: "Phase / Pool / Set名", roundName: "ラウンド名", eventName: "イベント名", eventAlias: "イベントエイリアス",
  redItems: "1P 選択アイテム", blueItems: "2P 選択アイテム",
  clock: "現在の日時",
};
export type OverlayComponent = {
  id: string;
  name: string;
  kind: "text" | "number" | "image" | "item" | "clock";
  source: OverlaySource;
  text: string;
  image: string;
  imageFileName?: string;
  numberValue?: number;
  itemCategory?: 1 | 2 | 3;
  delimiter?: string;
  clockFormat?: string;
  wrapText?: boolean;
  shrinkText?: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  fontFamily: string;
  fontSize: number;
  color: string;
  background: string;
  align: "left" | "center" | "right";
  verticalAlign?: "top" | "center" | "bottom";
  bold: boolean;
  visible: boolean;
  frame?: "plate" | "setMain" | "setSub" | "eventAlias" | "glass";
};
export const overlayKindLabels: Record<OverlayComponent["kind"], string> = {
  text: "テキスト", number: "数値", image: "画像", item: "アイテム", clock: "時計",
};
export type OverlayPreset = {
  id: string;
  name: string;
  width: number;
  height: number;
  components: OverlayComponent[];
};
export type OverlayLayouts = {
  version: 1;
  activePresetId: string | null;
  presets: OverlayPreset[];
};
export const MAX_LAYOUT_BYTES = 32 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
export type OverlayTestItemInputs = [string, string, string];

export function parseOverlayTestItems(values: OverlayTestItemInputs): string[][] {
  return values.map((value) => value.split(/\s+/u).filter((item) => item !== ""));
}

function validateOverlayResolution(width: number, height: number): void {
  if (!Number.isInteger(width) || width < 1 || width > 16384
    || !Number.isInteger(height) || height < 1 || height > 16384) {
    throw new Error(t("解像度の幅・高さは1〜16384の整数で指定してください。"));
  }
}

export function overlayColorParts(value: string): { rgb: string; alpha: number } {
  if (value !== "transparent" && !/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(value)) {
    throw new Error(t("色の形式が不正です。"));
  }
  const hex = value === "transparent" ? "#00000000" : value.toLowerCase();
  const alpha = hex.length === 9 ? parseInt(hex.slice(7), 16) : 255;
  return { rgb: hex.slice(0, 7), alpha };
}

export function overlayColorWithAlpha(value: string, alpha: number): string {
  if (!Number.isInteger(alpha) || alpha < 0 || alpha > 255) {
    throw new Error(t("Alpha値は0〜255の整数で指定してください。"));
  }
  const { rgb } = overlayColorParts(value);
  return alpha === 255 ? rgb : `${rgb}${alpha.toString(16).padStart(2, "0")}`;
}

export type OverlayHsv = { h: number; s: number; v: number };

export function overlayColorHsv(value: string): OverlayHsv {
  const { rgb } = overlayColorParts(value);
  const [r, g, b] = [1, 3, 5].map((start) => parseInt(rgb.slice(start, start + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const hue = delta === 0 ? 0 : max === r ? (g - b) / delta
    : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return { h: (hue * 60 + 360) % 360, s: max === 0 ? 0 : delta / max * 100, v: max * 100 };
}

export function overlayColorFromHsv({ h, s, v }: OverlayHsv, alpha: number): string {
  if (!Number.isFinite(h) || h < 0 || h > 360 || !Number.isFinite(s) || s < 0 || s > 100
    || !Number.isFinite(v) || v < 0 || v > 100) {
    throw new Error(t("色相・彩度・明度の値が不正です。"));
  }
  const saturation = s / 100;
  const brightness = v / 100;
  const channel = (offset: number) => {
    const k = (offset + h / 60) % 6;
    return Math.round((brightness - brightness * saturation * Math.max(0, Math.min(k, 4 - k, 1))) * 255)
      .toString(16).padStart(2, "0");
  };
  return overlayColorWithAlpha(`#${channel(5)}${channel(3)}${channel(1)}`, alpha);
}

export function overlayResolutionAtAspect(
  original: Pick<OverlayPreset, "width" | "height">,
  dimension: "width" | "height",
  value: number,
): Pick<OverlayPreset, "width" | "height"> {
  validateOverlayResolution(original.width, original.height);
  validateOverlayResolution(value, value);
  const ratio = original.width / original.height;
  const maximum = Math.min(16384, Math.floor(dimension === "width" ? 16384 * ratio : 16384 / ratio));
  const size = Math.min(value, maximum);
  return dimension === "width"
    ? { width: size, height: Math.max(1, Math.min(16384, Math.round(size / ratio))) }
    : { width: Math.max(1, Math.min(16384, Math.round(size * ratio))), height: size };
}

export function overlayPreviewTransform(
  canvas: Pick<OverlayPreset, "width" | "height">,
  viewport: { width: number; height: number },
  zoom: number,
  pan: { x: number; y: number },
): { scale: number; x: number; y: number } {
  const scale = Math.min(viewport.width / canvas.width, viewport.height / canvas.height) * zoom;
  return {
    scale,
    x: (viewport.width - canvas.width * scale) / 2 + pan.x,
    y: (viewport.height - canvas.height * scale) / 2 + pan.y,
  };
}

export function overlayComponentSelection(
  selected: readonly string[],
  id: string,
  mode: "replace" | "add" | "toggle" | "primary",
): string[] {
  if (!id) return [];
  if (mode === "replace") return [id];
  if (mode === "add") return selected.includes(id) ? [...selected] : [...selected, id];
  if (mode === "primary") return selected.includes(id) ? [id, ...selected.filter((item) => item !== id)] : [...selected];
  return selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id];
}

export function overlayComponentDropIndex(
  components: readonly Pick<OverlayComponent, "id">[],
  id: string,
  targetId: string,
  position: "above" | "below",
): number {
  const index = components.findIndex((item) => item.id === id);
  if (index < 0 || !components.some((item) => item.id === targetId)) {
    throw new Error(t("並べ替えるコンポーネントが見つかりません。"));
  }
  if (id === targetId) return index;
  const target = components.filter((item) => item.id !== id).findIndex((item) => item.id === targetId);
  // Stored order is back-to-front; a row above its target is inserted after it.
  return target + (position === "above" ? 1 : 0);
}

export function overlayComponentBounds(
  components: readonly Pick<OverlayComponent, "x" | "y" | "width" | "height">[],
): Pick<OverlayComponent, "x" | "y" | "width" | "height"> | null {
  if (components.length === 0) return null;
  const x = Math.min(...components.map((item) => item.x));
  const y = Math.min(...components.map((item) => item.y));
  return {
    x, y,
    width: Math.max(...components.map((item) => item.x + item.width)) - x,
    height: Math.max(...components.map((item) => item.y + item.height)) - y,
  };
}

export function overlayComponentsIntersecting(
  components: readonly Pick<OverlayComponent, "id" | "x" | "y" | "width" | "height">[],
  bounds: Pick<OverlayComponent, "x" | "y" | "width" | "height">,
): string[] {
  const left = Math.min(bounds.x, bounds.x + bounds.width);
  const top = Math.min(bounds.y, bounds.y + bounds.height);
  const right = Math.max(bounds.x, bounds.x + bounds.width);
  const bottom = Math.max(bounds.y, bounds.y + bounds.height);
  if (left === right || top === bottom) return [];
  return components
    .filter((item) => item.x < right && item.x + item.width > left
      && item.y < bottom && item.y + item.height > top)
    .map((item) => item.id);
}

export type OverlayCentering = "horizontal" | "vertical" | "both";

export function matchOverlayComponentSizes(components: readonly OverlayComponent[]): OverlayComponent[] {
  const first = components[0];
  if (!first) return [];
  return components.map((item) => ({ ...item, width: first.width, height: first.height }));
}

export function centerOverlayComponents(
  components: readonly OverlayComponent[],
  canvas: Pick<OverlayPreset, "width" | "height">,
  mode: OverlayCentering,
): OverlayComponent[] {
  validateOverlayResolution(canvas.width, canvas.height);
  const bounds = overlayComponentBounds(components);
  if (!bounds) return [];
  const dx = mode === "vertical" ? 0 : Math.round((canvas.width - bounds.width) / 2 - bounds.x);
  const dy = mode === "horizontal" ? 0 : Math.round((canvas.height - bounds.height) / 2 - bounds.y);
  const moved = components.map((item) => ({ ...item, x: item.x + dx, y: item.y + dy }));
  if (moved.some((item) => !numberIn(item.x, 0, 16384) || !numberIn(item.y, 0, 16384))) {
    throw new Error(t("センタリング後の座標が0〜16384の範囲を超えるため移動できません。"));
  }
  return moved;
}

export function moveOverlayComponents(
  components: readonly OverlayComponent[],
  dx: number,
  dy: number,
  canvas: Pick<OverlayPreset, "width" | "height">,
): OverlayComponent[] {
  validateOverlayResolution(canvas.width, canvas.height);
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) throw new Error(t("コンポーネントの移動量が不正です。"));
  const first = components[0];
  if (!first) return [];
  const minX = Math.min(...components.map((item) => item.x));
  const minY = Math.min(...components.map((item) => item.y));
  const maxX = Math.max(...components.map((item) => item.x));
  const maxY = Math.max(...components.map((item) => item.y));
  // Clamp one shared delta so edge constraints cannot change the group's relative positions.
  const x = Math.max(-minX, Math.min(Math.max(canvas.width - 1, maxX) - maxX, dx === 0 ? 0 : Math.round(first.x + dx) - first.x));
  const y = Math.max(-minY, Math.min(Math.max(canvas.height - 1, maxY) - maxY, dy === 0 ? 0 : Math.round(first.y + dy) - first.y));
  return components.map((item) => ({ ...item, x: item.x + x, y: item.y + y }));
}

export function newOverlayComponent(
  kind: OverlayComponent["kind"],
  name = t(overlayKindLabels[kind]),
): OverlayComponent {
  const trimmedName = name.trim();
  if (!trimmedName || trimmedName.length > 256) {
    throw new Error(t("コンポーネント名は1〜256文字で指定してください。"));
  }
  return {
    id: crypto.randomUUID(), name: trimmedName, kind, source: kind === "clock" ? "clock" : kind === "item" ? "redItems" : kind === "number" ? "number" : "text",
    text: t("テキスト"), image: "", ...(kind === "number" ? { numberValue: 0 } : {}),
    ...(kind === "item" ? { itemCategory: 1 as const, delimiter: " / " } : {}),
    ...(kind === "clock" ? { clockFormat: "YYYY-MM-DD HH:mm:ss" } : {}),
    ...(kind === "text" || kind === "number" || kind === "item" ? { wrapText: true, shrinkText: false } : {}),
    x: 0, y: 0, width: 400, height: 100, fontFamily: "sans-serif", fontSize: 48,
    color: "#ffffff", background: "#000000", align: "center", verticalAlign: "center", bold: true, visible: true,
  };
}

export function newOverlayPreset(
  resolution: Pick<OverlayPreset, "width" | "height"> = { width: 1920, height: 1080 },
): OverlayPreset {
  const { width, height } = resolution;
  validateOverlayResolution(width, height);
  const scaleX = width / 1920;
  const scaleY = height / 1080;
  const sources: OverlaySource[] = ["redPlayerName", "redSetWins", "roundText", "blueSetWins", "bluePlayerName", "eventAlias"];
  return {
    id: crypto.randomUUID(), name: t("新しいプリセット"), width, height,
    components: sources.map((source, index) => {
      const componentWidth = Math.max(1, [460, 100, 520, 100, 480, 640][index] * scaleX);
      const componentHeight = Math.max(1, (index === 5 ? 60 : 100) * scaleY);
      return {
        ...newOverlayComponent(overlayNumberSources.some((item) => item === source) ? "number" : "text", t(overlaySourceLabels[source])), source,
        x: Math.min(width - componentWidth, [60, 540, 700, 1260, 1380, 640][index] * scaleX),
        y: Math.min(height - componentHeight, (index === 5 ? 1000 : 10) * scaleY),
        width: componentWidth, height: componentHeight,
        fontSize: Math.max(1, (source === "roundText" || source === "eventAlias" ? 28 : 48) * Math.min(scaleX, scaleY)),
        background: index < 2 ? "#991b1b" : index < 3 ? "#374151" : index < 5 ? "#1e40af" : "#000000",
      };
    }),
  };
}

export function copyOverlayPreset(
  preset?: OverlayPreset,
  resolution?: Pick<OverlayPreset, "width" | "height">,
): OverlayPreset {
  const original = preset ?? builtInOverlayPreset();
  const { width, height } = resolution ?? original;
  validateOverlayResolution(width, height);
  const scale = Math.min(width / original.width, height / original.height);
  const offsetX = (width - original.width * scale) / 2;
  const offsetY = (height - original.height * scale) / 2;
  return {
    ...original,
    id: crypto.randomUUID(),
    name: `${original.name.slice(0, 240)} (${t("複製")})`,
    width, height,
    components: original.components.map((component) => {
      const x = Math.max(0, Math.min(16384, Math.round(component.x * scale + offsetX)));
      const y = Math.max(0, Math.min(16384, Math.round(component.y * scale + offsetY)));
      return {
        ...component, id: crypto.randomUUID(), x, y,
        width: Math.max(1, Math.min(16384, Math.round(component.width * scale))),
        height: Math.max(1, Math.min(16384, Math.round(component.height * scale))),
        fontSize: Math.max(1, Math.min(1000, Math.round(component.fontSize * scale))),
      };
    }),
  };
}

export function builtInOverlayPreset(): OverlayPreset {
  const fontFamily = '"BIZ UDPGothic", "Yu Gothic UI", "Yu Gothic", "Meiryo UI", "Meiryo", "Noto Sans CJK JP", "Noto Sans JP", sans-serif';
  const weights = [2.22, 0.48, 1.30, 0.48, 2.22];
  const widths = weights.map((weight) => (1800 - 16 * 4) * weight / 6.7);
  const positions = widths.map((_, index) => 60 + widths.slice(0, index).reduce((total, width) => total + width, 0) + index * 16);
  const text = (source: OverlaySource, patch: Partial<OverlayComponent>): OverlayComponent => ({
    ...newOverlayComponent(overlayNumberSources.some((item) => item === source) ? "number" : "text",
      source === "text" ? t("セット情報の背景") : t(overlaySourceLabels[source])),
    source, text: "", fontFamily, frame: "plate", background: "transparent", verticalAlign: undefined,
    wrapText: false, shrinkText: source === "redPlayerName" || source === "bluePlayerName", ...patch,
  });
  const centerX = positions[2];
  return {
    id: crypto.randomUUID(), name: t("デフォルト"), width: 1920, height: 1080,
    components: [
      text("redPlayerName", { x: positions[0], y: 6, width: widths[0], height: 83, fontSize: 56, background: "#991b1b" }),
      text("redSetWins", { x: positions[1], y: 6, width: widths[1], height: 83, fontSize: 54, background: "#991b1b" }),
      text("text", { x: centerX, y: 6, width: widths[2], height: 94.6, background: "#374151" }),
      text("setName", { x: centerX + 16, y: 18, width: widths[2] - 32, height: 35.2, fontSize: 32, frame: "setMain" }),
      text("roundName", { x: centerX + 16, y: 59.2, width: widths[2] - 32, height: 29.4, fontSize: 28, frame: "setSub" }),
      text("blueSetWins", { x: positions[3], y: 6, width: widths[3], height: 83, fontSize: 54, background: "#1e40af" }),
      text("bluePlayerName", { x: positions[4], y: 6, width: widths[4], height: 83, fontSize: 56, background: "#1e40af" }),
      text("eventAlias", { x: 640, y: 1019.2, width: 640, height: 48.8, fontSize: 28, background: "#000000", frame: "eventAlias" }),
    ],
  };
}

export function isOverlayImage(value: string): boolean {
  if (value === "") return true;
  if (value.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 64) return false;
  const match = /^data:image\/(?:png|jpeg|gif|webp);base64,([A-Za-z0-9+/]+)(={0,2})$/.exec(value);
  if (!match) return false;
  const length = match[1].length + match[2].length;
  return length % 4 === 0 && length / 4 * 3 - match[2].length <= MAX_IMAGE_BYTES;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function numberIn(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}
function stringIn(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length <= max;
}
type StoredOverlayComponent = Omit<OverlayComponent, "name"> & { name?: string };

function legacyComponentName(component: StoredOverlayComponent): string {
  if (component.kind === "image") return t("画像");
  if (component.source === "text") return component.text.trim().slice(0, 256) || t("固定テキスト");
  return t(overlaySourceLabels[component.source]);
}

function validComponent(value: unknown): value is StoredOverlayComponent {
  return record(value)
    && stringIn(value.id, 128) && value.id.length > 0
    && (value.name === undefined || stringIn(value.name, 256) && value.name.trim().length > 0)
    && (value.kind === "text" || value.kind === "number" || value.kind === "image" || value.kind === "item" || value.kind === "clock")
    && overlaySources.some((source) => source === value.source)
    && (value.kind === "clock"
      ? value.source === "clock" && stringIn(value.clockFormat, 256) && value.clockFormat.length > 0
      : value.source !== "clock")
    && (value.clockFormat === undefined || stringIn(value.clockFormat, 256) && value.clockFormat.length > 0)
    && (value.wrapText === undefined || typeof value.wrapText === "boolean")
    && (value.shrinkText === undefined || typeof value.shrinkText === "boolean")
    && (value.kind === "item"
      ? overlayItemSources.some((source) => source === value.source)
        && (value.itemCategory === 1 || value.itemCategory === 2 || value.itemCategory === 3)
        && stringIn(value.delimiter, 256)
      : !overlayItemSources.some((source) => source === value.source))
    && (value.itemCategory === undefined || value.itemCategory === 1 || value.itemCategory === 2 || value.itemCategory === 3)
    && (value.delimiter === undefined || stringIn(value.delimiter, 256))
    && (value.kind !== "number" || overlayNumberSources.some((source) => source === value.source))
    && (value.source !== "number" || value.kind === "number" && typeof value.numberValue === "number")
    && (value.numberValue === undefined || typeof value.numberValue === "number" && Number.isFinite(value.numberValue))
    && stringIn(value.text, 10000) && typeof value.image === "string" && isOverlayImage(value.image)
    && (value.imageFileName === undefined || stringIn(value.imageFileName, 1024))
    && numberIn(value.x, 0, 16384) && numberIn(value.y, 0, 16384)
    && numberIn(value.width, 1, 16384) && numberIn(value.height, 1, 16384)
    && stringIn(value.fontFamily, 256) && numberIn(value.fontSize, 1, 1000)
    && typeof value.color === "string" && /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(value.color)
    && typeof value.background === "string" && (value.background === "transparent" || /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(value.background))
    && (value.align === "left" || value.align === "center" || value.align === "right")
    && (value.verticalAlign === undefined || value.verticalAlign === "top"
      || value.verticalAlign === "center" || value.verticalAlign === "bottom")
    && (value.frame === undefined || value.frame === "plate" || value.frame === "setMain"
      || value.frame === "setSub" || value.frame === "eventAlias" || value.frame === "glass")
    && typeof value.bold === "boolean" && typeof value.visible === "boolean";
}

export function parseOverlayLayouts(value: unknown): OverlayLayouts {
  if (!record(value) || value.version !== 1
    || !(value.activePresetId === null || typeof value.activePresetId === "string")
    || !Array.isArray(value.presets) || value.presets.length > 64) {
    throw new Error(t("オーバーレイプリセットの形式が不正です。"));
  }
  const ids = new Set<string>();
  const presets: OverlayPreset[] = [];
  for (const preset of value.presets) {
    if (!record(preset) || !stringIn(preset.id, 128) || !preset.id || ids.has(preset.id)
      || !stringIn(preset.name, 256) || !preset.name.trim()
      || !numberIn(preset.width, 1, 16384) || !Number.isInteger(preset.width)
      || !numberIn(preset.height, 1, 16384) || !Number.isInteger(preset.height)
      || !Array.isArray(preset.components) || preset.components.length > 128
      || !preset.components.every(validComponent)
      || new Set(preset.components.map((component) => component.id)).size !== preset.components.length) {
      throw new Error(t("オーバーレイプリセットの形式が不正です。"));
    }
    ids.add(preset.id);
    presets.push({
      id: preset.id, name: preset.name, width: preset.width, height: preset.height,
      components: preset.components.map((component) => ({
        ...component, name: component.name ?? legacyComponentName(component),
        kind: component.kind === "text" && (component.source === "redSetWins" || component.source === "blueSetWins")
          ? "number" : component.kind,
      })),
    });
  }
  if (value.activePresetId !== null && !ids.has(value.activePresetId)) {
    throw new Error(t("オーバーレイプリセットの形式が不正です。"));
  }
  return { version: 1, activePresetId: value.activePresetId, presets };
}

export function parseOverlayLayoutsFile(text: string): OverlayLayouts {
  if (new TextEncoder().encode(text).length > MAX_LAYOUT_BYTES) {
    throw new Error(t("プリセットファイルは32MB以下にしてください。"));
  }
  return parseOverlayLayouts(JSON.parse(text));
}

export function mergeOverlayLayouts(current: OverlayLayouts, imported: OverlayLayouts): OverlayLayouts {
  return parseOverlayLayouts({
    ...current,
    presets: [...current.presets, ...imported.presets.map((preset) => ({
      ...preset, id: crypto.randomUUID(),
      components: preset.components.map((component) => ({ ...component, id: crypto.randomUUID() })),
    }))],
  });
}
