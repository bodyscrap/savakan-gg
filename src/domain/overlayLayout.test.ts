import { describe, expect, it } from "vitest";
import {
  builtInOverlayPreset, copyOverlayPreset, isOverlayImage, MAX_IMAGE_BYTES, MAX_LAYOUT_BYTES, mergeOverlayLayouts, newOverlayComponent, newOverlayPreset,
  overlayPreviewTransform, overlayResolutionAtAspect, overlayColorParts, overlayColorWithAlpha, overlayColorHsv, overlayColorFromHsv, overlayComponentSelection, overlayComponentDropIndex, overlayComponentBounds, overlayComponentsIntersecting, matchOverlayComponentSizes, centerOverlayComponents, moveOverlayComponents, overlayImageDimensions, fitOverlayImageToCanvas, overlayNumberSources, overlayItemSources, overlaySources, parseOverlayLayouts, parseOverlayLayoutsFile, parseOverlayTestItems, type OverlayLayouts,
} from "./overlayLayout";
import { formatOverlayClock, resolveOverlayBackground, resolveOverlayText, resolveOverlayVerticalAlign, resolveOverlayTextOverflow } from "./overlayRenderer.js";

function layouts(): OverlayLayouts {
  const preset = newOverlayPreset();
  return { version: 1, activePresetId: preset.id, presets: [preset] };
}
const state = {
  active: true, fullyStopped: false, redPlayerName: "Player <A>", bluePlayerName: "選手B",
  redSetWins: 123, blueSetWins: 0, roundText: "Phase / Pool A / Set X\nGF Reset",
  eventName: "Event", eventAlias: "大会",
};

describe("overlay preview viewport", () => {
  it.each([
    { width: 3840, height: 2160 },
    { width: 1080, height: 1920 },
    { width: 16384, height: 16384 },
  ])("fits the complete canvas inside both viewport dimensions %s", (canvas) => {
    const viewport = { width: 800, height: 360 };
    const view = overlayPreviewTransform(canvas, viewport, 1, { x: 0, y: 0 });
    expect(view.x).toBeGreaterThanOrEqual(0);
    expect(view.y).toBeGreaterThanOrEqual(0);
    expect(view.x + canvas.width * view.scale).toBeLessThanOrEqual(viewport.width);
    expect(view.y + canvas.height * view.scale).toBeLessThanOrEqual(viewport.height);
    expect((canvas.width * view.scale) / (canvas.height * view.scale)).toBeCloseTo(canvas.width / canvas.height);
  });
  it("zooms around the center and pans in viewport pixels without changing layout data", () => {
    const canvas = newOverlayPreset();
    const original = structuredClone(canvas);
    const viewport = { width: 800, height: 450 };
    const fitted = overlayPreviewTransform(canvas, viewport, 1, { x: 0, y: 0 });
    const zoomed = overlayPreviewTransform(canvas, viewport, 2, { x: 40, y: -30 });
    expect(zoomed.scale).toBe(fitted.scale * 2);
    expect(zoomed.x + canvas.width * zoomed.scale / 2).toBe(viewport.width / 2 + 40);
    expect(zoomed.y + canvas.height * zoomed.scale / 2).toBe(viewport.height / 2 - 30);
    expect(canvas).toEqual(original);
  });
  it("refits when either viewport dimension becomes smaller", () => {
    const canvas = { width: 1920, height: 1080 };
    for (const viewport of [{ width: 300, height: 600 }, { width: 1000, height: 180 }]) {
      const view = overlayPreviewTransform(canvas, viewport, 1, { x: 0, y: 0 });
      expect(canvas.width * view.scale).toBeLessThanOrEqual(viewport.width);
      expect(canvas.height * view.scale).toBeLessThanOrEqual(viewport.height);
      expect(view.x + canvas.width * view.scale / 2).toBeCloseTo(viewport.width / 2);
      expect(view.y + canvas.height * view.scale / 2).toBeCloseTo(viewport.height / 2);
    }
  });
});

describe("overlay component default alpha", () => {
  it.each(["text", "number", "item", "image", "clock"] as const)("defaults %s foreground and background alpha to 255", (kind) => {
    const component = newOverlayComponent(kind);
    expect(overlayColorParts(component.color).alpha).toBe(255);
    expect(overlayColorParts(component.background)).toEqual({ rgb: "#000000", alpha: 255 });
  });
  it("defaults newly created preset components to opaque colors", () => {
    for (const component of newOverlayPreset().components) {
      expect(overlayColorParts(component.color).alpha).toBe(255);
      expect(overlayColorParts(component.background).alpha).toBe(255);
    }
  });
  it("preserves transparent default-layout text layers and saved alpha values", () => {
    const builtIn = builtInOverlayPreset();
    for (const source of ["setName", "roundName"]) {
      expect(builtIn.components.find((component) => component.source === source)?.background).toBe("transparent");
    }
    const value = layouts();
    value.presets[0].components = [{ ...newOverlayComponent("text"), color: "#ffffff80", background: "transparent" }];
    expect(parseOverlayLayoutsFile(JSON.stringify(value))).toEqual(value);
    expect(copyOverlayPreset(value.presets[0]).components[0]).toMatchObject({ color: "#ffffff80", background: "transparent" });
  });
});

describe("overlay vertical text alignment", () => {
  it.each(["text", "number", "item", "clock"] as const)("defaults new %s components to horizontal and vertical centering", (kind) => {
    const component = newOverlayComponent(kind);
    expect(component.align).toBe("center");
    expect(component.verticalAlign).toBe("center");
    expect(resolveOverlayVerticalAlign(component)).toBe("center");
  });
  it("centers new preset components while retaining default-layout positions", () => {
    for (const component of newOverlayPreset().components) {
      expect(component).toMatchObject({ align: "center", verticalAlign: "center" });
    }
    for (const component of builtInOverlayPreset().components) {
      expect(resolveOverlayVerticalAlign(component)).toBe(
        component.frame === "plate" || component.frame === "eventAlias" ? "center" : "top",
      );
    }
    const value = layouts();
    value.presets[0].components[0].align = "left";
    value.presets[0].components[0].verticalAlign = undefined;
    const restored = parseOverlayLayoutsFile(JSON.stringify(value));
    expect(restored.presets[0].components[0].align).toBe("left");
    expect(resolveOverlayVerticalAlign(restored.presets[0].components[0])).toBe("top");
  });
  it("preserves legacy block and decorated defaults", () => {
    expect(resolveOverlayVerticalAlign({})).toBe("top");
    expect(resolveOverlayVerticalAlign({ frame: "setMain" })).toBe("top");
    expect(resolveOverlayVerticalAlign({ frame: "setSub" })).toBe("top");
    expect(resolveOverlayVerticalAlign({ frame: "plate" })).toBe("center");
    expect(resolveOverlayVerticalAlign({ frame: "eventAlias" })).toBe("center");
  });
  it.each(["top", "center", "bottom"] as const)("persists and copies explicit %s alignment for all text types", (verticalAlign) => {
    for (const kind of ["text", "number", "item", "clock"] as const) {
      const value = layouts();
      value.presets[0].components = [{ ...newOverlayComponent(kind), verticalAlign }];
      expect(parseOverlayLayoutsFile(JSON.stringify(value))).toEqual(value);
      expect(copyOverlayPreset(value.presets[0]).components[0].verticalAlign).toBe(verticalAlign);
      expect(mergeOverlayLayouts(layouts(), value).presets[1].components[0].verticalAlign).toBe(verticalAlign);
      for (const frame of [undefined, "plate", "setMain", "setSub", "eventAlias", "glass"] as const) {
        expect(resolveOverlayVerticalAlign({ verticalAlign, frame })).toBe(verticalAlign);
      }
    }
  });
  it.each(["left", "", null, 0, true])("rejects invalid vertical alignment %j", (verticalAlign) => {
    const value = layouts();
    Object.assign(value.presets[0].components[0], { verticalAlign });
    expect(() => parseOverlayLayouts(value)).toThrow();
  });
});

describe("overlay text overflow settings", () => {
  it.each(["text", "number", "item"] as const)("defaults new %s components to wrapping without shrinking", (kind) => {
    const component = newOverlayComponent(kind);
    expect(component).toMatchObject({ wrapText: true, shrinkText: false });
    expect(resolveOverlayTextOverflow(component)).toEqual({ wrap: true, shrink: false });
  });
  it("does not add overflow settings to clocks or images", () => {
    for (const kind of ["clock", "image"] as const) {
      expect(newOverlayComponent(kind).wrapText).toBeUndefined();
      expect(newOverlayComponent(kind).shrinkText).toBeUndefined();
    }
  });
  it("preserves missing legacy settings and resolves the previous wrapping behavior", () => {
    const value = layouts();
    for (const frame of [undefined, "plate", "setMain", "setSub", "eventAlias", "glass"] as const) {
      value.presets[0].components = [{
        ...newOverlayComponent("text"), wrapText: undefined, shrinkText: undefined, frame,
      }];
      const restored = parseOverlayLayoutsFile(JSON.stringify(value)).presets[0].components[0];
      expect(resolveOverlayTextOverflow(restored)).toEqual({ wrap: !frame || frame === "glass", shrink: false });
      expect(resolveOverlayTextOverflow({ ...restored, source: "roundText" })).toEqual({ wrap: true, shrink: false });
    }
    const names = builtInOverlayPreset().components.filter(c => c.source === "redPlayerName" || c.source === "bluePlayerName");
    for (const component of names) expect(resolveOverlayTextOverflow(component)).toEqual({ wrap: false, shrink: true });
  });
  it("round trips all flag combinations through saving, import, duplication and merge", () => {
    for (const wrapText of [false, true]) {
      for (const shrinkText of [false, true]) {
        for (const kind of ["text", "number", "item"] as const) {
          const value = layouts();
          value.presets[0].components = [{ ...newOverlayComponent(kind), wrapText, shrinkText }];
          expect(parseOverlayLayoutsFile(JSON.stringify(value))).toEqual(value);
          expect(copyOverlayPreset(value.presets[0]).components[0]).toMatchObject({ wrapText, shrinkText });
          expect(mergeOverlayLayouts(layouts(), value).presets[1].components[0]).toMatchObject({ wrapText, shrinkText });
          expect(resolveOverlayTextOverflow(value.presets[0].components[0])).toEqual({ wrap: wrapText, shrink: shrinkText });
        }
      }
    }
  });
  it.each([null, 0, 1, "", "true", [], {}])("rejects nonboolean overflow settings %j", (invalid) => {
    for (const field of ["wrapText", "shrinkText"]) {
      const value = layouts();
      Object.assign(value.presets[0].components[0], { [field]: invalid });
      expect(() => parseOverlayLayouts(value)).toThrow();
    }
  });
});

describe("clock overlay components", () => {
  it("defaults to a local date and time with text styling", () => {
    const component = newOverlayComponent("clock");
    expect(component).toMatchObject({
      kind: "clock", source: "clock", clockFormat: "YYYY-MM-DD HH:mm:ss",
      fontSize: 48, color: "#ffffff", background: "#000000", align: "center", verticalAlign: "center",
    });
    const now = new Date(2026, 0, 4, 0, 5, 9);
    expect(resolveOverlayText(component, state, now)).toBe("2026-01-04 00:05:09");
    expect(resolveOverlayText(component, { ...state, active: false }, now)).toBe("2026-01-04 00:05:09");
  });
  it("supports padding, 12-hour time, Japanese and English weekdays and escaped literals", () => {
    const now = new Date(2026, 0, 4, 0, 5, 9);
    expect(formatOverlayClock("YYYY YY M MM D DD H HH h hh m mm s ss A a d ddd dddd", now))
      .toBe("2026 26 1 01 4 04 0 00 12 12 5 05 9 09 AM am 日 Sun Sunday");
    expect(Array.from({ length: 7 }, (_, day) => formatOverlayClock("d", new Date(2026, 0, 4 + day))))
      .toEqual(["日", "月", "火", "水", "木", "金", "土"]);
    expect(formatOverlayClock("[YYYY-MM-DD] YYYY年M月D日\n[<b>time</b>] HH:mm:ss", now))
      .toBe("YYYY-MM-DD 2026年1月4日\n<b>time</b> 00:05:09");
    expect(formatOverlayClock("HH H hh h A a", new Date(2026, 9, 22, 12))).toBe("12 12 12 12 PM pm");
    expect(formatOverlayClock("hh:mm:ss A", new Date(2026, 9, 22, 23, 59, 59))).toBe("11:59:59 PM");
    expect(formatOverlayClock("YYYY-MM-DD", new Date(2028, 1, 29))).toBe("2028-02-29");
    expect(formatOverlayClock("[Sun] dddd", now)).toBe("Sun Sunday");
  });
  it("persists the clock format through save, import, copy and merge", () => {
    const value = layouts();
    value.presets[0].components = [{ ...newOverlayComponent("clock"), clockFormat: "YYYY年MM月DD日\nHH:mm:ss" }];
    expect(parseOverlayLayoutsFile(JSON.stringify(value))).toEqual(value);
    expect(copyOverlayPreset(value.presets[0]).components[0]).toMatchObject({
      kind: "clock", source: "clock", clockFormat: "YYYY年MM月DD日\nHH:mm:ss",
    });
    expect(mergeOverlayLayouts(layouts(), value).presets[1].components[0].clockFormat)
      .toBe(value.presets[0].components[0].clockFormat);
  });
  it.each([
    { clockFormat: undefined }, { clockFormat: null }, { clockFormat: 3 }, { clockFormat: "" },
    { clockFormat: "a".repeat(257) }, { clockFormat: "😀".repeat(129) },
    { source: "text" }, { source: "redItems" }, { source: "redSetWins" }, { kind: "text" }, { kind: "image" },
  ])("rejects invalid clock properties %j", (patch) => {
    const value = layouts();
    value.presets[0].components = [newOverlayComponent("clock")];
    Object.assign(value.presets[0].components[0], patch);
    expect(() => parseOverlayLayouts(value)).toThrow();
  });
});

describe("item overlay components", () => {
  it("parses three dummy categories using whitespace without reordering or deduplicating", () => {
    expect(parseOverlayTestItems(["  Beta Alpha Beta  ", "　選択A　選択B\t選択C\n選択D", ""])).toEqual([
      ["Beta", "Alpha", "Beta"], ["選択A", "選択B", "選択C", "選択D"], [],
    ]);
    expect(parseOverlayTestItems(["", " \t ", "　"])).toEqual([[], [], []]);
  });
  const itemState = {
    ...state,
    redItems: [["B", "A", "B"], ["Red 2"], ["<b>Red 3</b>", "&"]],
    blueItems: [["Blue 1"], [], ["Blue 3"]],
  };
  it("creates text-styled components with explicit category and delimiter defaults", () => {
    expect(newOverlayComponent("item")).toMatchObject({
      kind: "item", source: "redItems", itemCategory: 1, delimiter: " / ",
      fontFamily: "sans-serif", fontSize: 48,
    });
  });
  it.each(overlayItemSources)("renders all categories for %s in selection order", (source) => {
    for (const itemCategory of [1, 2, 3] as const) {
      const component = { ...newOverlayComponent("item"), source, itemCategory };
      expect(resolveOverlayText(component, itemState)).toBe(itemState[source][itemCategory - 1].join(" / "));
      expect(resolveOverlayText(component, { ...itemState, active: false })).toBe("");
    }
  });
  it.each(["", "\n", "<script>&", "、"])("preserves delimiter %j and repeated selections", (delimiter) => {
    const component = { ...newOverlayComponent("item"), delimiter };
    expect(resolveOverlayText(component, itemState)).toBe(["B", "A", "B"].join(delimiter));
    expect(resolveOverlayText(component, state)).toBe("");
    expect(resolveOverlayText(component, { ...itemState, redItems: [[], [], []] })).toBe("");
    expect(resolveOverlayText(component, { ...itemState, redItems: [["Changed"], [], []] })).toBe("Changed");
  });
  it("round trips, imports and scales item properties without modifying their content", () => {
    const value = layouts();
    const component = { ...newOverlayComponent("item"), source: "blueItems" as const, itemCategory: 3 as const, delimiter: "\n<&>" };
    value.presets[0].components = [component];
    expect(parseOverlayLayoutsFile(JSON.stringify(value))).toEqual(value);
    const imported = mergeOverlayLayouts(layouts(), value);
    expect(imported.presets[imported.presets.length - 1].components[0]).toMatchObject({ ...component, id: expect.any(String) });
    const copied = copyOverlayPreset(value.presets[0], { width: 1280, height: 720 });
    expect(copied.components[0]).toMatchObject({ kind: "item", source: "blueItems", itemCategory: 3, delimiter: "\n<&>" });
  });
  it.each([
    { source: "text" }, { source: "redPlayerName" }, { source: "redSetWins" },
    { itemCategory: undefined }, { itemCategory: 0 }, { itemCategory: 4 }, { itemCategory: 1.5 },
    { delimiter: undefined }, { delimiter: 3 }, { delimiter: "a".repeat(257) },
    { kind: "text" }, { kind: "number" }, { kind: "image" },
  ])("rejects inconsistent item settings %j", (patch) => {
    const value = layouts();
    value.presets[0].components = [newOverlayComponent("item")];
    Object.assign(value.presets[0].components[0], patch);
    expect(() => parseOverlayLayouts(value)).toThrow();
  });
});

describe("overlay component row ordering", () => {
  it("maps every above/below drop to back-to-front storage without changing unrelated rows", () => {
    const components = ["a", "b", "c", "d"].map((id) => ({ ...newOverlayComponent("text", id), id }));
    const original = structuredClone(components);
    for (const source of components) {
      for (const target of components) {
        for (const position of ["above", "below"] as const) {
          const index = overlayComponentDropIndex(components, source.id, target.id, position);
          const actual = [...components];
          actual.splice(index, 0, actual.splice(actual.findIndex((item) => item.id === source.id), 1)[0]);
          const displayed = components.map((item) => item.id).reverse();
          if (source.id !== target.id) {
            displayed.splice(displayed.indexOf(source.id), 1);
            displayed.splice(displayed.indexOf(target.id) + (position === "below" ? 1 : 0), 0, source.id);
          }
          expect(actual.map((item) => item.id).reverse()).toEqual(displayed);
          expect(actual.find((item) => item.id === source.id)).toEqual(source);
        }
      }
    }
    expect(components).toEqual(original);
  });
  it("reports missing source and target rows rather than producing an invalid index", () => {
    const components = [{ id: "a" }];
    expect(() => overlayComponentDropIndex(components, "missing", "a", "above")).toThrow();
    expect(() => overlayComponentDropIndex(components, "a", "missing", "below")).toThrow();
    expect(() => overlayComponentDropIndex([], "a", "b", "above")).toThrow();
    expect(overlayComponentDropIndex(components, "a", "a", "below")).toBe(0);
  });
});

describe("overlay selection adjustments", () => {
  it("matches width and height to the first selection, preserving positions, content and font sizes", () => {
    const components = [
      { ...newOverlayComponent("number"), x: 300, y: 200, width: 101, height: 53, fontSize: 21 },
      { ...newOverlayComponent("text"), x: 20, y: 30, width: 400, height: 100, fontSize: 48 },
      { ...newOverlayComponent("image"), x: 800, y: 500, width: 80, height: 60, visible: false },
    ];
    const original = structuredClone(components);
    expect(matchOverlayComponentSizes(components))
      .toEqual(components.map((item) => ({ ...item, width: 101, height: 53 })));
    expect(matchOverlayComponentSizes([...components].reverse()))
      .toEqual([...components].reverse().map((item) => ({ ...item, width: 80, height: 60 })));
    expect(components).toEqual(original);
    expect(matchOverlayComponentSizes([components[0]])).toEqual([components[0]]);
    expect(matchOverlayComponentSizes([])).toEqual([]);
  });
  it.each([
    ["horizontal", 300, 0],
    ["vertical", 0, 180],
    ["both", 300, 180],
  ] as const)("centers the complete selection in %s mode with one common translation", (mode, dx, dy) => {
    const components = [
      { ...newOverlayComponent("text"), x: 10, y: 20, width: 100, height: 60 },
      { ...newOverlayComponent("image"), x: 310, y: 100, width: 80, height: 120, visible: false },
    ];
    const original = structuredClone(components);
    const moved = centerOverlayComponents(components, { width: 1000, height: 600 }, mode);
    expect(moved).toEqual(components.map((item) => ({ ...item, x: item.x + dx, y: item.y + dy })));
    expect(centerOverlayComponents([...components].reverse(), { width: 1000, height: 600 }, mode))
      .toEqual([...moved].reverse());
    expect(components).toEqual(original);
  });
  it.each([
    [1000, 600, 100, 60], [1001, 601, 100, 60],
    [1000, 600, 101, 61], [1001, 601, 101, 61],
  ])("keeps integer coordinates within half a pixel of the center (%s,%s,%s,%s)", (width, height, w, h) => {
    const components = [
      { ...newOverlayComponent("text"), x: 10, y: 20, width: w, height: h },
      { ...newOverlayComponent("number"), x: 150, y: 100, width: w, height: h },
    ];
    const moved = centerOverlayComponents(components, { width, height }, "both");
    const bounds = overlayComponentBounds(moved)!;
    expect(Math.abs(bounds.x + bounds.width / 2 - width / 2)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(bounds.y + bounds.height / 2 - height / 2)).toBeLessThanOrEqual(0.5);
    expect(moved.every((item) => Number.isInteger(item.x) && Number.isInteger(item.y))).toBe(true);
    expect(moved[1].x - moved[0].x).toBe(140);
    expect(moved[1].y - moved[0].y).toBe(80);
    expect(centerOverlayComponents(moved, { width, height }, "both")).toEqual(moved);
  });
  it("handles a single selection and preserves existing fractional offsets", () => {
    const component = { ...newOverlayComponent("text"), x: 0, y: 0, width: 101, height: 61 };
    expect(centerOverlayComponents([component], { width: 1000, height: 600 }, "both")[0])
      .toMatchObject({ x: 450, y: 270 });
    const fractional = [
      { ...component, x: 10.25, y: 20.5 },
      { ...component, x: 210.75, y: 120.25 },
    ];
    const moved = centerOverlayComponents(fractional, { width: 1000, height: 600 }, "both");
    expect(Number.isInteger(moved[0].x - fractional[0].x)).toBe(true);
    expect(Number.isInteger(moved[0].y - fractional[0].y)).toBe(true);
    expect(moved[1].x - moved[0].x).toBe(200.5);
    expect(moved[1].y - moved[0].y).toBe(99.75);
    expect(centerOverlayComponents([], { width: 1000, height: 600 }, "both")).toEqual([]);
  });
  it("rejects impossible centering atomically instead of clamping or partially moving the selection", () => {
    const components = [
      { ...newOverlayComponent("text"), x: 0, y: 0, width: 100, height: 100 },
      { ...newOverlayComponent("image"), x: 1800, y: 1000, width: 200, height: 200 },
    ];
    const original = structuredClone(components);
    for (const mode of ["horizontal", "vertical", "both"] as const) {
      expect(() => centerOverlayComponents(components, { width: 1000, height: 600 }, mode)).toThrow("0〜16384");
    }
    expect(components).toEqual(original);
    const tall = { ...components[0], height: 1200 };
    expect(centerOverlayComponents([tall], { width: 1000, height: 600 }, "horizontal")[0])
      .toMatchObject({ x: 450, y: 0, height: 1200 });
  });
  it("validates canvas resolution and resulting coordinates", () => {
    const component = newOverlayComponent("text");
    expect(() => centerOverlayComponents([component], { width: 0, height: 600 }, "both")).toThrow();
    expect(() => centerOverlayComponents([component], { width: 1000.5, height: 600 }, "both")).toThrow();
    expect(() => centerOverlayComponents([{ ...component, x: NaN }], { width: 1000, height: 600 }, "both")).toThrow();
  });
});

describe("overlay component multi-selection", () => {
  it("replaces, adds and toggles selection while preserving its primary component", () => {
    const original = ["a"];
    expect(overlayComponentSelection(original, "b", "add")).toEqual(["a", "b"]);
    expect(original).toEqual(["a"]);
    expect(overlayComponentSelection(["a", "b"], "b", "add")).toEqual(["a", "b"]);
    expect(overlayComponentSelection(["a", "b", "c"], "b", "toggle")).toEqual(["a", "c"]);
    expect(overlayComponentSelection(["a", "b", "c"], "a", "toggle")).toEqual(["b", "c"]);
    expect(overlayComponentSelection(["a", "b"], "c", "toggle")).toEqual(["a", "b", "c"]);
    expect(overlayComponentSelection(["a", "b", "c"], "b", "primary")).toEqual(["b", "a", "c"]);
    expect(overlayComponentSelection(["a"], "b", "primary")).toEqual(["a"]);
    expect(overlayComponentSelection(["a", "b"], "c", "replace")).toEqual(["c"]);
    expect(overlayComponentSelection(["a", "b"], "", "toggle")).toEqual([]);
  });
  it("computes the minimum rectangle around every selected component", () => {
    const components = [
      { x: 10, y: 50, width: 100, height: 20 },
      { x: 200, y: 5, width: 30, height: 40 },
      { x: 20, y: 30, width: 5, height: 5 },
    ];
    expect(overlayComponentBounds(components)).toEqual({ x: 10, y: 5, width: 220, height: 65 });
    expect(overlayComponentBounds([components[0]])).toEqual(components[0]);
    expect(overlayComponentBounds([])).toBeNull();
  });
  it("returns rectangle-intersecting components in the provided display order", () => {
    const components = [
      { id: "front", x: 40, y: 40, width: 20, height: 20 },
      { id: "middle", x: 20, y: 20, width: 30, height: 30 },
      { id: "back", x: 0, y: 0, width: 10, height: 10 },
    ];
    expect(overlayComponentsIntersecting(components, { x: 25, y: 25, width: 20, height: 20 }))
      .toEqual(["front", "middle"]);
    expect(overlayComponentsIntersecting(components, { x: 10, y: 10, width: 10, height: 10 })).toEqual([]);
    expect(overlayComponentsIntersecting(components, { x: 45, y: 45, width: -10, height: -10 }))
      .toEqual(["front", "middle"]);
  });
  it.each([
    [30.4, 40.6, 30, 41],
    [-500, -500, -20, -30],
    [5000, 5000, 1519, 679],
  ])("moves all selected anchors by one common rounded and clamped delta: %s,%s", (dx, dy, expectedX, expectedY) => {
    const components = [
      { ...newOverlayComponent("text"), x: 20, y: 30 },
      { ...newOverlayComponent("image"), x: 400, y: 400, visible: false },
    ];
    const original = structuredClone(components);
    const moved = moveOverlayComponents(components, dx, dy, { width: 1920, height: 1080 });
    expect(moved).toEqual(components.map((item) => ({ ...item, x: item.x + expectedX, y: item.y + expectedY })));
    expect(moved[1].x - moved[0].x).toBe(380);
    expect(moved[1].y - moved[0].y).toBe(370);
    expect(components).toEqual(original);
  });
  it("keeps fractional offsets and does not snap already-outside anchors on a zero movement", () => {
    const components = [
      { ...newOverlayComponent("text"), x: 10.25, y: 20.5 },
      { ...newOverlayComponent("number"), x: 2100.75, y: 1200.5 },
    ];
    const stationary = moveOverlayComponents(components, 0, 0, { width: 1920, height: 1080 });
    expect(stationary[1].x).toBe(components[1].x);
    expect(stationary[1].y).toBe(components[1].y);
    const moved = moveOverlayComponents(components, -5, -10, { width: 1920, height: 1080 });
    expect(moved[1].x - moved[0].x).toBe(2090.5);
    expect(moved[1].y - moved[0].y).toBe(1180);
  });
  it("preserves single-component dragging and handles an empty selection", () => {
    const component = { ...newOverlayComponent("text"), x: 10.25, y: 20.5 };
    expect(moveOverlayComponents([component], 5.2, 6.2, { width: 1920, height: 1080 })[0])
      .toMatchObject({ x: 15, y: 27 });
    expect(moveOverlayComponents([], 10, 20, { width: 1920, height: 1080 })).toEqual([]);
  });
  it.each([NaN, Infinity, -Infinity])("rejects invalid movement deltas: %s", (value) => {
    expect(() => moveOverlayComponents([newOverlayComponent("text")], value, 0, { width: 1920, height: 1080 })).toThrow();
    expect(() => moveOverlayComponents([newOverlayComponent("text")], 0, value, { width: 1920, height: 1080 })).toThrow();
  });
});

describe("overlay colors and transparency", () => {
  it.each([
    [0, "#ff0000"], [60, "#ffff00"], [120, "#00ff00"], [180, "#00ffff"],
    [240, "#0000ff"], [300, "#ff00ff"], [360, "#ff0000"],
  ])("converts hue %s to %s and retains alpha", (h, rgb) => {
    expect(overlayColorFromHsv({ h, s: 100, v: 100 }, 255)).toBe(rgb);
    expect(overlayColorParts(overlayColorFromHsv({ h, s: 100, v: 100 }, 128))).toEqual({ rgb, alpha: 128 });
    expect(overlayColorParts(overlayColorFromHsv({ h, s: 100, v: 100 }, 0))).toEqual({ rgb, alpha: 0 });
  });
  it("round trips RGB samples exactly without losing color at zero alpha", () => {
    for (let r = 0; r <= 255; r += 17) {
      for (let g = 0; g <= 255; g += 17) {
        for (let b = 0; b <= 255; b += 17) {
          const rgb = `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
          expect(overlayColorFromHsv(overlayColorHsv(rgb), 255)).toBe(rgb);
          expect(overlayColorFromHsv(overlayColorHsv(`${rgb}00`), 0)).toBe(`${rgb}00`);
        }
      }
    }
    expect(overlayColorHsv("transparent")).toEqual({ h: 0, s: 0, v: 0 });
    expect(overlayColorHsv("#808080").s).toBe(0);
    expect(overlayColorFromHsv({ h: 240, s: 0, v: 100 }, 255)).toBe("#ffffff");
    expect(overlayColorFromHsv({ h: 120, s: 100, v: 0 }, 255)).toBe("#000000");
  });
  it.each([
    { h: -1, s: 100, v: 100 }, { h: 361, s: 100, v: 100 }, { h: NaN, s: 100, v: 100 },
    { h: 0, s: -1, v: 100 }, { h: 0, s: 101, v: 100 }, { h: 0, s: Infinity, v: 100 },
    { h: 0, s: 100, v: -1 }, { h: 0, s: 100, v: 101 }, { h: 0, s: 100, v: NaN },
  ])("rejects invalid HSV values %j", (hsv) => {
    expect(() => overlayColorFromHsv(hsv, 255)).toThrow();
  });
  it.each([
    ["#aabbCC", { rgb: "#aabbcc", alpha: 255 }],
    ["#AABBCC80", { rgb: "#aabbcc", alpha: 128 }],
    ["#11223300", { rgb: "#112233", alpha: 0 }],
    ["transparent", { rgb: "#000000", alpha: 0 }],
  ] as const)("decodes the selected color and transparency: %s", (value, expected) => {
    expect(overlayColorParts(value)).toEqual(expected);
  });
  it("round trips all 256 alpha values exactly without losing the selected RGB color", () => {
    for (let alpha = 0; alpha <= 255; alpha++) {
      const color = overlayColorWithAlpha("#123456", alpha);
      expect(overlayColorParts(color)).toEqual({ rgb: "#123456", alpha });
      const value = layouts();
      value.presets[0].components[0].color = color;
      value.presets[0].components[0].background = color;
      expect(parseOverlayLayoutsFile(JSON.stringify(value))).toEqual(value);
      expect(copyOverlayPreset(value.presets[0]).components[0]).toMatchObject({ color, background: color });
    }
    expect(overlayColorWithAlpha("#12345680", 255)).toBe("#123456");
    expect(overlayColorWithAlpha("#12345680", 0)).toBe("#12345600");
    expect(overlayColorWithAlpha("transparent", 128)).toBe("#00000080");
  });
  it.each(["red", "#123", "#12345", "#1234567", "#123456789", "#gggggg80", "TRANSPARENT", "url(https://example.com)"])("rejects invalid colors: %s", (color) => {
    expect(() => overlayColorParts(color)).toThrow();
    const value = layouts();
    value.presets[0].components[0].color = color;
    expect(() => parseOverlayLayouts(value)).toThrow();
    value.presets[0].components[0].color = "#ffffff";
    value.presets[0].components[0].background = color;
    expect(() => parseOverlayLayouts(value)).toThrow();
  });
  it.each([-1, 256, 1.5, NaN, Infinity])("rejects invalid alpha: %s", (alpha) => {
    expect(() => overlayColorWithAlpha("#123456", alpha)).toThrow();
  });
  it("preserves legacy decorated backgrounds and scales their gradient opacity", () => {
    expect(resolveOverlayBackground({ background: "#991b1b", frame: "plate" }))
      .toBe("linear-gradient(180deg, rgba(185,28,28,0.86), rgba(127,29,29,0.84))");
    const alpha = 128 / 255;
    expect(resolveOverlayBackground({ background: "#991b1b80", frame: "plate" }))
      .toBe(`linear-gradient(180deg, rgba(185,28,28,${0.86 * alpha}), rgba(127,29,29,${0.84 * alpha}))`);
    expect(resolveOverlayBackground({ background: "#991b1b00", frame: "plate" }))
      .toBe("linear-gradient(180deg, rgba(185,28,28,0), rgba(127,29,29,0))");
    expect(resolveOverlayBackground({ background: "#000000", frame: "eventAlias" })).toBe("rgba(0,0,0,0.88)");
    expect(resolveOverlayBackground({ background: "#00000080", frame: "eventAlias" })).toBe(`rgba(0,0,0,${0.88 * alpha})`);
    expect(resolveOverlayBackground({ background: "#12345680" })).toBe("#12345680");
    expect(resolveOverlayBackground({ background: "transparent", frame: "plate" })).toBe("transparent");
  });
});

describe("glass overlay decoration", () => {
  it.each(["text", "number", "item", "clock"] as const)("persists and copies glass styling for %s without changing text properties", (kind) => {
    const value = layouts();
    value.presets[0].components = [{
      ...newOverlayComponent(kind), frame: "glass", color: "#aabbcc80", background: "#12345680",
      align: "right", verticalAlign: "bottom",
    }];
    expect(parseOverlayLayoutsFile(JSON.stringify(value))).toEqual(value);
    const { id: _id, ...expected } = value.presets[0].components[0];
    expect(copyOverlayPreset(value.presets[0]).components[0]).toMatchObject(expected);
    expect(mergeOverlayLayouts(layouts(), value).presets[1].components[0]).toMatchObject(expected);
  });
  it("uses the selected background tint and scales opacity for every alpha value", () => {
    for (let alpha = 0; alpha <= 255; alpha++) {
      expect(resolveOverlayBackground({ frame: "glass", background: overlayColorWithAlpha("#123456", alpha) }))
        .toBe(`linear-gradient(135deg, rgba(18,52,86,${0.62 * (alpha / 255)}), rgba(18,52,86,${0.36 * (alpha / 255)}))`);
    }
    expect(resolveOverlayBackground({ frame: "glass", background: "transparent" })).toBe("transparent");
    expect(resolveOverlayVerticalAlign({ frame: "glass" })).toBe("top");
  });
});

describe("image overlay decoration", () => {
  it("persists and copies background image settings on text components", () => {
    const value = layouts();
    value.presets[0].components = [{
      ...newOverlayComponent("text"), frame: "image", image: "data:image/png;base64,YQ==",
      imageFileName: "background.png", preserveAspectRatio: false, imageAlpha: 128, flipHorizontal: true,
      imageAnimationOnDisplay: true, imageAnimationValueSource: "redPlayerName",
    }];
    expect(parseOverlayLayoutsFile(JSON.stringify(value))).toEqual(value);
    const imageSettings = {
      frame: "image", image: "data:image/png;base64,YQ==", imageFileName: "background.png",
      preserveAspectRatio: false, imageAlpha: 128, flipHorizontal: true,
      imageAnimationOnDisplay: true, imageAnimationValueSource: "redPlayerName",
    };
    expect(copyOverlayPreset(value.presets[0]).components[0]).toMatchObject(imageSettings);
    expect(mergeOverlayLayouts(layouts(), value).presets[1].components[0]).toMatchObject(imageSettings);
  });
  it("wraps text by default when using an image frame", () => {
    expect(resolveOverlayTextOverflow({ frame: "image", source: "redPlayerName" })).toEqual({ wrap: true, shrink: false });
  });
  it("discards legacy broad text and number animation triggers", () => {
    const value = layouts();
    const image = newOverlayComponent("image");
    Object.assign(image, {
      image: "data:image/png;base64,YQ==",
      imageAnimationOnTextChange: true,
      imageAnimationOnNumberChange: true,
    });
    value.presets[0].components = [image];
    const restored = parseOverlayLayoutsFile(JSON.stringify(value));
    expect(restored.presets[0].components[0]).not.toHaveProperty("imageAnimationOnTextChange");
    expect(restored.presets[0].components[0]).not.toHaveProperty("imageAnimationOnNumberChange");
  });
  it("clears a saved animation trigger for a removed event name source", () => {
    const value = layouts();
    const image = newOverlayComponent("image");
    Object.assign(image, {
      image: "data:image/png;base64,YQ==",
      imageAnimationValueSource: "eventName",
    });
    value.presets[0].components = [image];
    const restored = parseOverlayLayoutsFile(JSON.stringify(value));
    expect(restored.presets[0].components[0]).not.toHaveProperty("imageAnimationValueSource");
  });
});

describe("linked overlay resolution", () => {
  it.each([
    ["width", 1280, 1280, 720],
    ["height", 1440, 2560, 1440],
    ["width", 1365, 1365, 768],
    ["height", 719, 1278, 719],
    ["width", 1, 1, 1],
    ["height", 1, 2, 1],
    ["width", 16384, 16384, 9216],
    ["height", 16384, 16384, 9216],
  ] as const)("links %s=%s to %s x %s using the original ratio", (dimension, value, width, height) => {
    expect(overlayResolutionAtAspect({ width: 1920, height: 1080 }, dimension, value)).toEqual({ width, height });
  });
  it("uses the original ratio after repeated integer rounding in either field", () => {
    const original = { width: 1920, height: 1080 };
    expect(overlayResolutionAtAspect(original, "width", 1)).toEqual({ width: 1, height: 1 });
    expect(overlayResolutionAtAspect(original, "height", 719)).toEqual({ width: 1278, height: 719 });
    expect(overlayResolutionAtAspect(original, "width", 1920)).toEqual(original);
    expect(original).toEqual({ width: 1920, height: 1080 });
  });
  it.each([
    [{ width: 1080, height: 1920 }, "width", 16384, { width: 9216, height: 16384 }],
    [{ width: 1, height: 16384 }, "width", 1280, { width: 1, height: 16384 }],
    [{ width: 16384, height: 1 }, "height", 720, { width: 16384, height: 1 }],
    [{ width: 1000, height: 1000 }, "height", 600, { width: 600, height: 600 }],
  ] as const)("preserves portrait, square, and extreme ratios within the limits: %s", (original, dimension, value, expected) => {
    expect(overlayResolutionAtAspect(original, dimension, value)).toEqual(expected);
  });
  it.each([0, -1, 1.5, 16385, NaN, Infinity])("rejects an invalid dimension: %s", (value) => {
    expect(() => overlayResolutionAtAspect({ width: 1920, height: 1080 }, "width", value)).toThrow();
    expect(() => overlayResolutionAtAspect({ width: value, height: 1080 }, "height", 720)).toThrow();
  });
});

describe("overlay preset scaling", () => {
  it.each([
    [{ width: 3840, height: 2160 }, { x: 200, y: 200, width: 800, height: 400, fontSize: 100 }],
    [{ width: 960, height: 540 }, { x: 50, y: 50, width: 200, height: 100, fontSize: 25 }],
    [{ width: 1000, height: 1000 }, { x: 52, y: 271, width: 208, height: 104, fontSize: 26 }],
    [{ width: 2000, height: 500 }, { x: 602, y: 46, width: 185, height: 93, fontSize: 23 }],
  ])("scales uniformly and centers the layout at %s", (resolution, expected) => {
    const original = newOverlayPreset();
    original.components = [
      { ...newOverlayComponent("text", "Title"), x: 100, y: 100, width: 400, height: 200, fontSize: 50 },
      { ...newOverlayComponent("number"), numberValue: -12.5, visible: false },
      { ...newOverlayComponent("image"), image: "data:image/png;base64,YQ==", imageFileName: "logo.png" },
    ];
    original.visibilityControlIds = [original.components[0].id];
    const before = structuredClone(original);
    const copy = copyOverlayPreset(original, resolution);
    expect(copy).toMatchObject(resolution);
    expect(copy.id).not.toBe(original.id);
    expect(copy.visibilityControlIds).toEqual([copy.components[0].id]);
    expect(copy.components[0]).toMatchObject(expected);
    copy.components.forEach(({ id, x, y, width, height, fontSize, ...metadata }, index) => {
      const { id: oldId, x: _x, y: _y, width: _width, height: _height, fontSize: _fontSize, ...originalMetadata } = original.components[index];
      expect(id).not.toBe(oldId);
      expect(metadata).toEqual(originalMetadata);
      expect([x, y, width, height, fontSize].every(Number.isInteger)).toBe(true);
    });
    expect(original).toEqual(before);
    expect(parseOverlayLayoutsFile(JSON.stringify({ version: 1, activePresetId: copy.id, presets: [copy] })).presets[0]).toEqual(copy);
  });
  it.each([
    { width: 1, height: 1 }, { width: 16384, height: 16384 },
    { width: 1, height: 16384 }, { width: 16384, height: 1 },
  ])("keeps integer geometry and fonts valid at extreme resolutions: %s", (resolution) => {
    const original = newOverlayPreset();
    original.components.push({ ...newOverlayComponent("text"), x: 16384, y: 16384, width: 16384, height: 16384, fontSize: 1000 });
    const copy = copyOverlayPreset(original, resolution);
    for (const component of copy.components) {
      expect([component.x, component.y, component.width, component.height, component.fontSize].every(Number.isInteger)).toBe(true);
      expect(component.width).toBeGreaterThanOrEqual(1);
      expect(component.height).toBeGreaterThanOrEqual(1);
      expect(component.fontSize).toBeGreaterThanOrEqual(1);
      expect(component.fontSize).toBeLessThanOrEqual(1000);
    }
    expect(() => parseOverlayLayouts({ version: 1, activePresetId: null, presets: [copy] })).not.toThrow();
  });
  it("preserves intentional canvas overflow rather than cropping components", () => {
    const original = newOverlayPreset();
    original.components = [{ ...newOverlayComponent("text"), x: 1900, width: 200 }];
    expect(copyOverlayPreset(original, { width: 960, height: 540 }).components[0]).toMatchObject({ x: 950, width: 100 });
  });
  it.each([0, -1, 1.5, 16385, NaN, Infinity])("rejects an invalid target resolution: %s", (value) => {
    expect(() => copyOverlayPreset(undefined, { width: value, height: 1080 })).toThrow();
    expect(() => copyOverlayPreset(undefined, { width: 1920, height: value })).toThrow();
  });
});

describe("overlay layout format", () => {
  it("migrates legacy text scores without changing names, geometry, or styles", () => {
    const value = layouts();
    const scores = value.presets[0].components.filter((item) => item.source === "redSetWins" || item.source === "blueSetWins");
    scores.forEach((item) => { item.kind = "text"; });
    const restored = parseOverlayLayouts(value).presets[0].components;
    for (const original of scores) {
      const migrated = restored.find((item) => item.id === original.id)!;
      expect(migrated).toEqual({ ...original, kind: "number" });
      expect(resolveOverlayText(migrated, state)).toBe(resolveOverlayText(original, state));
    }
    expect(parseOverlayLayouts(parseOverlayLayouts(value))).toEqual(parseOverlayLayouts(value));
  });
  it.each([0, -12.5, 123, 1e100])("preserves fixed numeric values through save, import, and copy: %s", (numberValue) => {
    const value = layouts();
    value.presets[0].components = [{ ...newOverlayComponent("number"), numberValue }];
    const restored = parseOverlayLayoutsFile(JSON.stringify(value));
    expect(restored).toEqual(value);
    expect(copyOverlayPreset(restored.presets[0]).components[0].numberValue).toBe(numberValue);
    expect(mergeOverlayLayouts(value, restored).presets[1].components[0].numberValue).toBe(numberValue);
    expect(resolveOverlayText(restored.presets[0].components[0], { ...state, active: false })).toBe(String(numberValue));
  });
  it.each([
    { source: "text" }, { source: "redPlayerName" }, { numberValue: null },
    { numberValue: "12" }, { numberValue: undefined }, { numberValue: NaN }, { numberValue: Infinity },
  ])("rejects invalid numeric components %s", (patch) => {
    const value = layouts();
    value.presets[0].components = [newOverlayComponent("number")];
    Object.assign(value.presets[0].components[0], patch);
    expect(() => parseOverlayLayouts(value)).toThrow();
  });
  it("preserves image filenames when saving, importing, and duplicating presets", () => {
    const value = layouts();
    value.presets[0].components = [{
      ...newOverlayComponent("image"), image: "data:image/png;base64,YQ==", imageFileName: "配信ロゴ.png",
    }];
    const restored = parseOverlayLayoutsFile(JSON.stringify(value));
    expect(restored).toEqual(value);
    expect(copyOverlayPreset(restored.presets[0]).components[0].imageFileName).toBe("配信ロゴ.png");
    expect(mergeOverlayLayouts(value, restored).presets[1].components[0].imageFileName).toBe("配信ロゴ.png");
  });
  it("defaults images to a locked aspect ratio and full opacity", () => {
    expect(newOverlayComponent("image")).toMatchObject({ preserveAspectRatio: true, imageAlpha: 255, flipHorizontal: false });
  });
  it("resizes images from either dimension while keeping their aspect ratio", () => {
    expect(overlayImageDimensions(320, 100, 16 / 9, "width")).toEqual({ width: 320, height: 180 });
    expect(overlayImageDimensions(100, 180, 16 / 9, "height")).toEqual({ width: 320, height: 180 });
    expect(overlayImageDimensions(0, 180, 16 / 9, "height")).toEqual({ width: 320, height: 180 });
    expect(() => overlayImageDimensions(320, 100, 0, "width")).toThrow();
  });
  it("fits locked images within the canvas and centers them", () => {
    expect(fitOverlayImageToCanvas({ width: 1920, height: 1080 }, 1, true))
      .toEqual({ x: 420, y: 0, width: 1080, height: 1080 });
    expect(fitOverlayImageToCanvas({ width: 1920, height: 1080 }, 16 / 9, true))
      .toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
    expect(fitOverlayImageToCanvas({ width: 1920, height: 1080 }, 16 / 9, false))
      .toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
  });
  it("persists image sizing options and accepts legacy images without them", () => {
    const value = layouts();
    const image = {
      ...newOverlayComponent("image"), image: "data:image/png;base64,YQ==",
      imageAspectRatio: 16 / 9, preserveAspectRatio: false, imageAlpha: 65,
    };
    value.presets[0].components = [image];
    expect(parseOverlayLayoutsFile(JSON.stringify(value))).toEqual(value);
    const legacy = structuredClone(value);
    delete legacy.presets[0].components[0].imageAspectRatio;
    delete legacy.presets[0].components[0].preserveAspectRatio;
    delete legacy.presets[0].components[0].imageAlpha;
    expect(parseOverlayLayouts(legacy).presets[0].components[0]).toMatchObject({
      kind: "image", width: 400, height: 100,
    });
    expect(parseOverlayLayouts(legacy).presets[0].components[0].imageAlpha).toBe(255);
  });
  it("converts earlier image opacity settings into alpha values", () => {
    const value = layouts();
    const image = { ...newOverlayComponent("image"), image: "data:image/png;base64,YQ==" };
    const legacyImage = { ...image, imageOpacity: 65 };
    delete legacyImage.imageAlpha;
    value.presets[0].components = [legacyImage];
    expect(parseOverlayLayouts(value).presets[0].components[0].imageAlpha).toBe(166);
  });
  it.each([
    { imageAspectRatio: 0 }, { imageAspectRatio: Infinity },
    { preserveAspectRatio: "yes" }, { imageAlpha: -1 },
    { imageAlpha: 256 }, { imageAlpha: 1.5 },
  ])("rejects invalid image sizing options %s", (patch) => {
    const value = layouts();
    value.presets[0].components = [newOverlayComponent("image")];
    Object.assign(value.presets[0].components[0], patch);
    expect(() => parseOverlayLayouts(value)).toThrow();
  });
  it("accepts legacy images without filenames and the exact filename length limit", () => {
    const value = layouts();
    value.presets[0].components = [newOverlayComponent("image")];
    expect(parseOverlayLayouts(value).presets[0].components[0].imageFileName).toBeUndefined();
    value.presets[0].components[0].imageFileName = "a".repeat(1024);
    expect(parseOverlayLayouts(value)).toEqual(value);
  });
  it("keeps identification names separate from rendered text and preserves them in exports", () => {
    const component = newOverlayComponent("text", "  配信用プレイヤー名  ");
    expect(component.name).toBe("配信用プレイヤー名");
    component.source = "redPlayerName";
    expect(resolveOverlayText(component, state)).toBe(state.redPlayerName);
    const value = layouts();
    value.presets[0].components = [component, newOverlayComponent("image", "スポンサー画像")];
    const restored = parseOverlayLayoutsFile(JSON.stringify(value));
    expect(restored.presets[0].components.map((item) => item.name)).toEqual(["配信用プレイヤー名", "スポンサー画像"]);
    expect(mergeOverlayLayouts(value, restored).presets[1].components[0].name).toBe(component.name);
  });
  it("migrates legacy components without names while preserving their display data", () => {
    const preset = newOverlayPreset();
    preset.components.push(newOverlayComponent("image"));
    preset.components.push({ ...newOverlayComponent("text"), text: "" });
    const legacy = {
      version: 1, activePresetId: preset.id,
      presets: [{ ...preset, components: preset.components.map(({ name: _name, ...component }) => component) }],
    };
    const restored = parseOverlayLayouts(legacy).presets[0].components;
    expect(restored[0].name).toBe("1P プレイヤー名");
    expect(restored[restored.length - 2].name).toBe("画像");
    expect(restored[restored.length - 1].name).toBe("固定テキスト");
    expect(restored.map(({ name: _name, ...component }) => component)).toEqual(legacy.presets[0].components);
  });
  it.each(["", "   ", "a".repeat(257)])("rejects invalid component names when creating", (name) => {
    expect(() => newOverlayComponent("text", name)).toThrow();
  });
  it("accepts a component name of exactly 256 characters", () => {
    expect(newOverlayComponent("image", "a".repeat(256)).name).toHaveLength(256);
  });
  it("copies the built-in layout into independent editable presets with its decorations", () => {
    const original = builtInOverlayPreset();
    const first = copyOverlayPreset();
    const second = copyOverlayPreset();
    expect(first.width).toBe(1920);
    expect(first.height).toBe(1080);
    expect(first.components.map((component) => component.source)).toEqual([
      "redPlayerName", "redSetWins", "text", "setName", "roundName", "blueSetWins", "bluePlayerName", "eventAlias",
    ]);
    expect(first.components.every((component) => component.frame !== undefined)).toBe(true);
    expect(first.id).not.toBe(second.id);
    expect(first.components[0].id).not.toBe(second.components[0].id);
    expect(first.components.map(({ id: _id, ...component }) => component))
      .toEqual(original.components.map(({ id: _id, ...component }) => ({
        ...component, x: Math.round(component.x), y: Math.round(component.y),
        width: Math.round(component.width), height: Math.round(component.height), fontSize: Math.round(component.fontSize),
      })));
    expect(parseOverlayLayoutsFile(JSON.stringify({ version: 1, activePresetId: first.id, presets: [first] })).presets[0]).toEqual(first);
    expect(first.components[0]).toMatchObject({ x: 60, y: 6, height: 83, fontSize: 56, background: "#991b1b" });
    expect(first.components[first.components.length - 1]).toMatchObject({ x: 640, width: 640, frame: "eventAlias" });
  });
  it("copies a custom preset without changing its resolution or sharing components", () => {
    const original = newOverlayPreset({ width: 1280, height: 720 });
    const copy = copyOverlayPreset(original);
    expect(copy).toMatchObject({ width: 1280, height: 720 });
    expect(copy.id).not.toBe(original.id);
    expect(copy.components[0].id).not.toBe(original.components[0].id);
    copy.components[0].x += 10;
    expect(original.components[0].x).toBe(40);
  });
  it("round trips all display sources and embedded images", () => {
    const value = layouts();
    value.presets[0].components = overlaySources.map((source) => ({
      ...newOverlayComponent(overlayNumberSources.some((item) => item === source) ? "number"
        : overlayItemSources.some((item) => item === source) ? "item" : source === "clock" ? "clock" : "text"), source,
    }));
    value.presets[0].components.push({ ...newOverlayComponent("image"), image: "data:image/png;base64,YQ==" });
    expect(parseOverlayLayoutsFile(JSON.stringify(value))).toEqual(value);
  });
  it("defaults missing display animation triggers to off", () => {
    const component = newOverlayComponent("image");
    expect(component.imageAnimationOnDisplay).toBe(false);
    delete component.imageAnimationOnDisplay;
    const value = layouts();
    value.presets[0].components = [component];
    expect(parseOverlayLayoutsFile(JSON.stringify(value)).presets[0].components[0].imageAnimationOnDisplay).toBe(false);
  });
  it("creates independent component and preset identities", () => {
    expect(newOverlayPreset().id).not.toBe(newOverlayPreset().id);
    const preset = newOverlayPreset();
    expect(new Set(preset.components.map((item) => item.id)).size).toBe(preset.components.length);
  });
  it.each([
    { width: 1280, height: 720 }, { width: 1080, height: 1920 },
    { width: 1, height: 1 }, { width: 16384, height: 16384 },
  ])("creates a preset at the specified resolution %s", (resolution) => {
    const preset = newOverlayPreset(resolution);
    expect({ width: preset.width, height: preset.height }).toEqual(resolution);
    expect(() => parseOverlayLayouts({ version: 1, activePresetId: null, presets: [preset] })).not.toThrow();
    for (const component of preset.components) {
      expect(component.x).toBeGreaterThanOrEqual(0);
      expect(component.y).toBeGreaterThanOrEqual(0);
      expect(component.x + component.width).toBeLessThanOrEqual(preset.width);
      expect(component.y + component.height).toBeLessThanOrEqual(preset.height);
    }
  });
  it.each([0, -1, 16385, 1.5, NaN, Infinity])("rejects invalid resolution %s when creating a preset", (value) => {
    expect(() => newOverlayPreset({ width: value, height: 1080 })).toThrow();
    expect(() => newOverlayPreset({ width: 1920, height: value })).toThrow();
  });
  it("accepts a 32MB file and rejects one byte more", () => {
    const document = { version: 1, activePresetId: null, presets: [] };
    const text = JSON.stringify(document).padEnd(MAX_LAYOUT_BYTES, " ");
    expect(parseOverlayLayoutsFile(text)).toEqual(document);
    expect(() => parseOverlayLayoutsFile(`${text} `)).toThrow();
  });
  it("imports copies without overwriting existing presets or the selection", () => {
    const value = layouts(), imported = mergeOverlayLayouts(value, value);
    expect(imported.activePresetId).toBe(value.activePresetId);
    expect(imported.presets[0]).toEqual(value.presets[0]);
    expect(imported.presets[1].id).not.toBe(value.presets[0].id);
    expect(imported.presets[1].components[0].id).not.toBe(value.presets[0].components[0].id);
  });
  it.each([0, -1, 16385, 1.5, NaN, Infinity])("rejects invalid canvas width %s", (width) => {
    const value = layouts(); value.presets[0].width = width;
    expect(() => parseOverlayLayouts(value)).toThrow();
  });
  it("accepts the exact resolution limits", () => {
    const value = layouts(); value.presets[0].width = 1; value.presets[0].height = 16384;
    expect(parseOverlayLayouts(value)).toEqual(value);
  });
  it.each([
    { version: 2 }, { activePresetId: "missing" }, { presets: null },
  ])("rejects invalid document metadata %s", (patch) => {
    expect(() => parseOverlayLayouts({ ...layouts(), ...patch })).toThrow();
  });
  it("rejects duplicate preset and component IDs", () => {
    const value = layouts(); value.presets.push(value.presets[0]);
    expect(() => parseOverlayLayouts(value)).toThrow();
    value.presets.pop(); value.presets[0].components.push(value.presets[0].components[0]);
    expect(() => parseOverlayLayouts(value)).toThrow();
  });
  it("validates and preserves up to six display-toggle component IDs", () => {
    const value = layouts();
    const componentId = value.presets[0].components[0].id;
    value.presets[0].visibilityControlIds = [componentId, ""];
    expect(parseOverlayLayouts(value).presets[0].visibilityControlIds).toEqual([componentId, ""]);
    const hiddenSelection = structuredClone(value);
    hiddenSelection.presets[0].components[0].visible = false;
    expect(parseOverlayLayouts(hiddenSelection).presets[0].visibilityControlIds).toEqual([componentId, ""]);
    const copied = copyOverlayPreset(value.presets[0]);
    expect(copied.visibilityControlIds).toEqual([copied.components[0].id, ""]);
    const imported = mergeOverlayLayouts(layouts(), value).presets[1];
    expect(imported.visibilityControlIds).toEqual([imported.components[0].id, ""]);
    for (const ids of [
      ["missing"],
      [componentId, componentId],
      Array.from({ length: 7 }, (_, index) => `missing-${index}`),
    ]) {
      const invalid = structuredClone(value);
      invalid.presets[0].visibilityControlIds = ids;
      expect(() => parseOverlayLayouts(invalid)).toThrow();
    }
  });
  it("preserves six default-preset visibility slots and stable built-in IDs", () => {
    const value = layouts();
    const components = builtInOverlayPreset().components;
    const ids = components.map((component) => component.id);
    expect(ids).toEqual([
      "builtin-redPlayerName", "builtin-redSetWins", "builtin-text", "builtin-setName",
      "builtin-roundName", "builtin-blueSetWins", "builtin-bluePlayerName", "builtin-eventAlias",
    ]);
    value.defaultVisibilityControlIds = [ids[0], "", ids[7], "", "", ""];
    expect(parseOverlayLayouts(value).defaultVisibilityControlIds).toEqual(value.defaultVisibilityControlIds);
    for (const selected of [
      ["missing"],
      [ids[0], ids[0]],
      Array.from({ length: 7 }, (_, index) => ids[index % ids.length]),
    ]) {
      const invalid = structuredClone(value);
      invalid.defaultVisibilityControlIds = selected;
      expect(() => parseOverlayLayouts(invalid)).toThrow();
    }
  });
  it("preserves optional text outline settings and rejects invalid values", () => {
    const value = layouts();
    Object.assign(value.presets[0].components[0], { textOutlineWidth: 2.5, textOutlineColor: "#12345680" });
    expect(parseOverlayLayouts(value)).toEqual(value);
    for (const patch of [
      { textOutlineWidth: -1 },
      { textOutlineWidth: 0.25 },
      { textOutlineWidth: 16.1 },
      { textOutlineColor: "red" },
    ]) {
      const invalid = structuredClone(value);
      Object.assign(invalid.presets[0].components[0], patch);
      expect(() => parseOverlayLayouts(invalid)).toThrow();
    }
  });
  it.each([
    { source: "__proto__" }, { kind: "html" }, { x: -1 }, { width: 0 }, { fontSize: 1001 },
    { align: "justify" }, { color: "red" }, { background: "url(https://example.com)" },
    { visible: "true" }, { image: "data:image/svg+xml;base64,YQ==" }, { fontFamily: "a".repeat(257) },
    { frame: "unknown" }, { name: "" }, { name: " " }, { name: "a".repeat(257) }, { name: null }, { name: 42 },
    { imageFileName: null }, { imageFileName: 42 }, { imageFileName: "a".repeat(1025) },
  ])("rejects invalid component fields %s", (patch) => {
    const value = layouts();
    Object.assign(value.presets[0].components[0], patch);
    expect(() => parseOverlayLayouts(value)).toThrow();
  });
  it("enforces preset and component count limits", () => {
    const value = layouts();
    value.presets = Array.from({ length: 64 }, newOverlayPreset);
    value.activePresetId = null;
    value.presets[0].components = Array.from({ length: 128 }, () => newOverlayComponent("text"));
    expect(() => parseOverlayLayouts(value)).not.toThrow();
    value.presets[0].components.push(newOverlayComponent("text"));
    expect(() => parseOverlayLayouts(value)).toThrow();
    value.presets[0].components = [];
    value.presets.push(newOverlayPreset());
    expect(() => parseOverlayLayouts(value)).toThrow();
  });
  it("limits image payloads and disallows external URLs", () => {
    expect(isOverlayImage("https://example.com/a.png")).toBe(false);
    expect(isOverlayImage("data:image/png;base64,Y=Q")).toBe(false);
    expect(isOverlayImage("data:image/png;base64,YQ")).toBe(false);
    const exact = `data:image/png;base64,${"a".repeat(Math.floor(MAX_IMAGE_BYTES / 3) * 4)}YQ==`;
    expect(isOverlayImage(exact)).toBe(true);
    expect(isOverlayImage(exact.replace(/YQ==$/, "YWE="))).toBe(false);
    expect(isOverlayImage(`data:image/png;base64,${"a".repeat(Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 64)}`)).toBe(false);
    for (const mime of ["png", "jpeg", "gif", "webp"]) {
      expect(isOverlayImage(`data:image/${mime};base64,YQ==`)).toBe(true);
    }
  });
});

describe("overlay content bindings", () => {
  it("keeps names and scores intact and splits set and round information", () => {
    const component = newOverlayComponent("text");
    expect(resolveOverlayText({ ...component, source: "redPlayerName" }, state)).toBe("Player <A>");
    expect(resolveOverlayText({ ...component, source: "bluePlayerName" }, state)).toBe("選手B");
    expect(resolveOverlayText({ ...component, source: "redSetWins" }, state)).toBe("123");
    expect(resolveOverlayText({ ...component, source: "blueSetWins" }, state)).toBe("0");
    expect(resolveOverlayText({ ...component, source: "setName" }, state)).toBe("Phase / Pool A / Set X");
    expect(resolveOverlayText({ ...component, source: "roundName" }, state)).toBe("GF Reset");
  });
  it("clears live fields when stopped but preserves static text and alias", () => {
    const component = newOverlayComponent("text"), stopped = { ...state, active: false };
    expect(resolveOverlayText({ ...component, source: "redSetWins" }, stopped)).toBe("");
    expect(resolveOverlayText({ ...component, source: "eventAlias" }, stopped)).toBe("大会");
    expect(resolveOverlayText({ ...component, source: "text", text: "<b>Title</b>" }, stopped)).toBe("<b>Title</b>");
  });
});
