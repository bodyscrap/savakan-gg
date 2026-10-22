import { afterEach, describe, expect, it, vi } from "vitest";
import { fitOverlayText } from "./overlayRenderer.js";

function measuredText(width, height, padding = 0) {
  const element = { style: {}, clientHeight: height };
  const segments = () => Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(content.textContent));
  const fontSize = () => parseFloat(element.style.fontSize);
  const capacity = () => Math.max(1, Math.floor(width / (fontSize() / 2)));
  const content = {
    style: {}, textContent: "",
    get clientWidth() { return width; },
    get scrollWidth() {
      return this.style.whiteSpace === "pre-wrap" ? width : Math.max(0, ...this.textContent.split("\n").map(
        (line) => Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(line)).length * fontSize() / 2,
      ));
    },
    get offsetHeight() {
      const lines = this.style.whiteSpace === "pre-wrap"
        ? this.textContent.split("\n").reduce((count, line) => count + Math.max(1, Math.ceil(
          Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(line)).length / capacity(),
        )), 0)
        : this.textContent.split("\n").length;
      return segments().length ? lines * fontSize() : 0;
    },
  };
  element.firstElementChild = content;
  vi.stubGlobal("getComputedStyle", () => ({ paddingTop: `${padding}px`, paddingBottom: `${padding}px` }));
  return element;
}

const component = { fontSize: 20, wrapText: true, shrinkText: false };

afterEach(() => vi.unstubAllGlobals());

describe("overlay text fitting with measured dimensions", () => {
  it("wraps at the original font size before attempting to shrink", () => {
    const element = measuredText(100, 40);
    fitOverlayText(element, { ...component, shrinkText: true }, "a".repeat(15));
    expect(element.style.fontSize).toBe("20px");
    expect(element.firstElementChild.textContent).toBe("a".repeat(15));
  });

  it("shrinks wrapped text only enough to fit both dimensions", () => {
    const element = measuredText(100, 40);
    fitOverlayText(element, { ...component, shrinkText: true }, "a".repeat(30));
    expect(parseFloat(element.style.fontSize)).toBeCloseTo(40.5 / 3, 2);
    expect(element.firstElementChild.textContent).toBe("a".repeat(30));
    expect(element.firstElementChild.offsetHeight).toBeLessThanOrEqual(40.5);
  });

  it("fits unwrapped text without going below 50 percent", () => {
    const element = measuredText(100, 40);
    fitOverlayText(element, { ...component, wrapText: false, shrinkText: true }, "a".repeat(20));
    expect(element.style.fontSize).toBe("10px");
    expect(element.firstElementChild.textContent).toBe("a".repeat(20));
    fitOverlayText(element, { ...component, wrapText: false, shrinkText: true }, "a".repeat(30));
    expect(element.style.fontSize).toBe("10px");
    expect(element.firstElementChild.textContent).toBe(`${"a".repeat(19)}…`);
  });

  it("ellipsizes without changing font size when both options are off", () => {
    const element = measuredText(100, 40);
    fitOverlayText(element, { ...component, wrapText: false }, "a".repeat(20));
    expect(element.style.fontSize).toBe("20px");
    expect(element.firstElementChild.textContent).toBe(`${"a".repeat(9)}…`);
  });

  it("accounts for height and vertical padding when ellipsizing wrapped text", () => {
    const element = measuredText(100, 44, 2);
    fitOverlayText(element, component, "a".repeat(30));
    expect(element.firstElementChild.textContent).toBe(`${"a".repeat(19)}…`);
    expect(element.firstElementChild.offsetHeight).toBe(40);
  });

  it("never splits grapheme clusters at the ellipsis", () => {
    const element = measuredText(80, 40);
    const family = "👨‍👩‍👧‍👦";
    fitOverlayText(element, { ...component, wrapText: false }, family.repeat(20));
    expect(element.firstElementChild.textContent).toBe(`${family.repeat(7)}…`);
  });

  it("restores the complete text and original size when content becomes shorter", () => {
    const element = measuredText(100, 40);
    const shrink = { ...component, wrapText: false, shrinkText: true };
    fitOverlayText(element, shrink, "a".repeat(30));
    fitOverlayText(element, shrink, "Short");
    expect(element.style.fontSize).toBe("20px");
    expect(element.firstElementChild.textContent).toBe("Short");
  });

  it("keeps the minimum at one pixel and clears text if even the marker cannot fit", () => {
    const element = measuredText(1, 0);
    fitOverlayText(element, { ...component, fontSize: 1, shrinkText: true }, "text");
    expect(element.style.fontSize).toBe("1px");
    expect(element.firstElementChild.textContent).toBe("");
  });
});
