import { afterEach, describe, expect, it, vi } from "vitest";
import { fitOverlayText, renderOverlayPreset, resolveOverlayFramePadding } from "./overlayRenderer.js";

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

function mockElement(tagName) {
  const attributes = new Map();
  const children = [];
  const element = {
    tagName, children, dataset: {}, style: {
      removeProperty(name) {
        delete this[name.replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase())];
      },
    },
    clientWidth: 100, clientHeight: 100, scrollWidth: 0, offsetHeight: 0,
    complete: true, naturalWidth: 100, naturalHeight: 100,
    get firstElementChild() { return children[0] ?? null; },
    getAttribute(name) { return attributes.get(name) ?? null; },
    setAttribute(name, value) { attributes.set(name, String(value)); },
    removeAttribute(name) { attributes.delete(name); },
    addEventListener() {},
    append(child) {
      child.remove?.();
      children.push(child);
      child.parentElement = this;
    },
    remove() {
      if (!this.parentElement) return;
      const siblings = this.parentElement.children;
      const index = siblings.indexOf(this);
      if (index >= 0) siblings.splice(index, 1);
      this.parentElement = null;
    },
    replaceChildren(...next) {
      for (const child of children) child.parentElement = null;
      children.splice(0, children.length, ...next);
      for (const child of next) child.parentElement = this;
    },
    querySelector(selector) {
      return selector === ":scope > img[data-overlay-frame-image]"
        ? children.find((child) => child.tagName === "IMG" && child.dataset.overlayFrameImage === "true") ?? null
        : null;
    },
  };
  Object.defineProperty(element, "src", {
    get() { return attributes.get("src") ?? ""; },
    set(value) { attributes.set("src", String(value)); },
  });
  return element;
}

afterEach(() => vi.unstubAllGlobals());

describe("overlay text fitting with measured dimensions", () => {
  it.each([
    { frame: "plate", fontSize: 54, padding: "10px 14px" },
    { frame: "plate", fontSize: 36, padding: `${10 * 36 / 54}px ${14 * 36 / 54}px` },
    { frame: "eventAlias", fontSize: 28, padding: "7px 14px" },
    { frame: "eventAlias", fontSize: 19, padding: `${7 * 19 / 28}px ${14 * 19 / 28}px` },
  ])("scales built-in frame padding with copied font sizes %s", ({ frame, fontSize, padding }) => {
    const actual = resolveOverlayFramePadding({ frame, fontSize }).split(" ").map(parseFloat);
    const expected = padding.split(" ").map(parseFloat);
    expect(actual[0]).toBeCloseTo(expected[0], 5);
    expect(actual[1]).toBeCloseTo(expected[1], 5);
  });

  it("keeps scaled score and event-alias text visible after copying to a smaller canvas", () => {
    const scorePadding = parseFloat(resolveOverlayFramePadding({ frame: "plate", fontSize: 36 }));
    const score = measuredText(100, 51, scorePadding);
    fitOverlayText(score, { fontSize: 36, frame: "plate", source: "redSetWins", wrapText: false }, "2");
    expect(score.firstElementChild.textContent).toBe("2");

    const aliasPadding = parseFloat(resolveOverlayFramePadding({ frame: "eventAlias", fontSize: 19 }));
    const alias = measuredText(600, 31, aliasPadding);
    fitOverlayText(alias, { fontSize: 19, frame: "eventAlias", source: "eventAlias", wrapText: false }, "Tournament alias");
    expect(alias.firstElementChild.textContent).toBe("Tournament alias");
  });

  it("wraps at the original font size before attempting to shrink", () => {
    const element = measuredText(100, 40);
    fitOverlayText(element, { ...component, shrinkText: true }, "a".repeat(15));
    expect(element.style.fontSize).toBe("20px");
    expect(element.firstElementChild.textContent).toBe("a".repeat(15));
  });

  describe("overlay image rendering", () => {
    it.each([
      { preserveAspectRatio: true, objectFit: "contain", opacity: 1 },
      { preserveAspectRatio: true, imageAlpha: 0, objectFit: "contain", opacity: 0 },
      { preserveAspectRatio: false, imageAlpha: 128, objectFit: "fill", opacity: 128 / 255 },
      { preserveAspectRatio: true, imageAlpha: 255, objectFit: "contain", opacity: 1 },
      { preserveAspectRatio: true, flipHorizontal: true, objectFit: "contain", opacity: 1 },
    ])("uses the image sizing and opacity settings %s", (options) => {
      const element = {
        tagName: "IMG",
        style: {},
        dataset: {},
        getAttribute: () => null,
        removeAttribute: vi.fn(),
      };
      const stage = {
        style: {},
        children: [],
        append(child) { this.children.push(child); },
        replaceChildren() { this.children = []; },
      };
      vi.stubGlobal("document", {
        createElement: () => element,
        fonts: {
          ready: Promise.resolve(),
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        },
      });

      const dispose = renderOverlayPreset(stage, {
        width: 1920,
        height: 1080,
        components: [{
          kind: "image", id: "image", visible: true, image: "data:image/png;base64,YQ==",
          background: "#ff0000", color: "#ffffff", fontFamily: "sans-serif", fontSize: 48,
          bold: true, align: "center", source: "text", ...options,
          x: 0, y: 0, width: 400, height: 100,
        }],
      }, {});

      expect(element.style).toMatchObject({
        objectFit: options.objectFit,
        opacity: options.opacity,
        transform: options.flipHorizontal ? "scaleX(-1)" : "none",
        background: "transparent",
        padding: "0",
        border: "none",
      });
      dispose();
    });
  });

  it("renders image decoration behind text with the selected sizing and opacity", () => {
    const stage = {
      style: {},
      children: [],
      append(child) { this.children.push(child); },
      replaceChildren() { this.children = []; },
    };
    const image = "data:image/png;base64,YQ==";
    vi.stubGlobal("document", {
      createElement(tagName) {
        return mockElement(tagName.toUpperCase());
      },
      fonts: {
        ready: Promise.resolve(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    });
    vi.stubGlobal("setInterval", vi.fn(() => 1));
    vi.stubGlobal("clearInterval", vi.fn());

    const dispose = renderOverlayPreset(stage, {
      width: 100,
      height: 100,
      components: [{
        kind: "clock", id: "clock", name: "Clock", source: "clock", clockFormat: "HH:mm",
        frame: "image", image, imageAlpha: 128, preserveAspectRatio: false, flipHorizontal: true,
        textOutlineWidth: 2.5, textOutlineColor: "#123456",
        visible: true, text: "", x: 0, y: 0, width: 100, height: 40,
        fontFamily: "sans-serif", fontSize: 20, color: "#ffffff", background: "#123456",
        align: "center", bold: false,
      }],
    }, {});

    const [element] = stage.children;
    expect(element.children.map((child) => child.tagName)).toEqual(["SPAN", "IMG"]);
    expect(element.children[0].style).toMatchObject({ position: "relative", zIndex: "1", pointerEvents: "none" });
    expect(element.style.pointerEvents).toBe("none");
    expect(element.children[0].style.pointerEvents).toBe("none");
    expect(element.style.webkitTextStroke).toBe("2.5px #123456");
    expect(element.children[1]).toMatchObject({
      src: image,
      alt: "",
      draggable: false,
    });
    expect(element.children[1].style).toMatchObject({
      objectFit: "fill",
      opacity: 128 / 255,
      transform: "scaleX(-1)",
      zIndex: "0",
      pointerEvents: "none",
    });
    dispose();
  });

  it.each([
    {
      animationSettings: { imageAnimationValueSource: "redPlayerName" }, kind: "text", source: "redPlayerName",
      stateKey: "redPlayerName", first: "Player A", updates: [
        { value: "Player B", restart: true }, { value: "Player C", restart: true },
      ],
    },
    {
      animationSettings: { imageAnimationValueSource: "redSetWins" }, kind: "number", source: "redSetWins",
      stateKey: "redSetWins", first: 1, updates: [
        { value: 2, restart: true }, { value: 3, restart: true },
      ],
    },
  ])("restarts animated images for repeated selected triggers", ({ animationSettings, kind, source, stateKey, first, updates }) => {
    const stage = {
      style: {},
      children: [],
      append(child) {
        this.children = this.children.filter((item) => item !== child);
        this.children.push(child);
      },
      replaceChildren() { this.children = []; },
    };
    const image = "data:image/gif;base64,YQ==";
    vi.stubGlobal("document", {
      createElement(tagName) { return mockElement(tagName.toUpperCase()); },
      fonts: {
        ready: Promise.resolve(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    });
    vi.stubGlobal("getComputedStyle", () => ({ paddingTop: "0px", paddingBottom: "0px" }));
    vi.stubGlobal("setInterval", vi.fn(() => 1));
    vi.stubGlobal("clearInterval", vi.fn());
    const preset = {
      id: "preset", width: 100, height: 100,
      components: [
        {
          kind: "image", id: "animated", source: "text", image, visible: true, ...animationSettings,
          x: 0, y: 0, width: 50, height: 50, fontFamily: "sans-serif", fontSize: 20,
          color: "#ffffff", background: "#000000", align: "center", bold: false,
        },
        {
          kind, id: "watched", source, text: "", numberValue: first, visible: true,
          x: 0, y: 0, width: 50, height: 50, fontFamily: "sans-serif", fontSize: 20,
          color: "#ffffff", background: "#000000", align: "center", bold: false,
        },
      ],
    };
    const firstState = {
      active: true, fullyStopped: false, redPlayerName: first, bluePlayerName: "",
      redSetWins: first, blueSetWins: 0, roundText: "", eventName: "", eventAlias: "",
    };
    const firstDispose = renderOverlayPreset(stage, preset, firstState);
    const renderedImage = stage.children.find((element) => element.dataset.componentId === "animated");
    firstDispose();
    expect(renderedImage.dataset.overlaySource).toBe(image);
    let previousPlaybackUrl = image;
    for (const { value, restart } of updates) {
      const dispose = renderOverlayPreset(stage, preset, { ...firstState, [stateKey]: value });
      if (restart) {
        expect(renderedImage.src).toMatch(/^blob:/);
        expect(renderedImage.src).not.toBe(previousPlaybackUrl);
        previousPlaybackUrl = renderedImage.src;
      } else {
        expect(renderedImage.src).toBe(previousPlaybackUrl);
      }
      dispose();
    }
  });

  it("does not use a text component's content appearance as a display trigger", () => {
    const stage = {
      style: {},
      children: [],
      append(child) {
        this.children = this.children.filter((item) => item !== child);
        this.children.push(child);
      },
      replaceChildren() { this.children = []; },
    };
    const image = "data:image/gif;base64,YQ==";
    vi.stubGlobal("document", {
      createElement(tagName) { return mockElement(tagName.toUpperCase()); },
      fonts: {
        ready: Promise.resolve(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    });
    vi.stubGlobal("getComputedStyle", () => ({ paddingTop: "0px", paddingBottom: "0px" }));
    const preset = {
      id: "preset", width: 100, height: 100,
      components: [{
        kind: "text", id: "animated-text", source: "redPlayerName", text: "",
        frame: "image", image, visible: true, imageAnimationOnDisplay: true,
        x: 0, y: 0, width: 100, height: 50, fontFamily: "sans-serif", fontSize: 20,
        color: "#ffffff", background: "#000000", align: "center", bold: false,
      }],
    };
    const state = {
      active: true, fullyStopped: false, currentSetId: "__test__",
      redPlayerName: "", bluePlayerName: "", redSetWins: 0, blueSetWins: 0,
      roundText: "", eventName: "", eventAlias: "",
    };
    renderOverlayPreset(stage, preset, state);
    const text = stage.children[0];
    const background = text.querySelector(":scope > img[data-overlay-frame-image]");
    const firstPlaybackUrl = background.src;
    expect(firstPlaybackUrl).toMatch(/^blob:/);

    renderOverlayPreset(stage, preset, { ...state, redPlayerName: "Player" });
    expect(background.src).toBe(firstPlaybackUrl);

    renderOverlayPreset(stage, preset, { ...state, redPlayerName: "Player B" });
    expect(background.src).toBe(firstPlaybackUrl);
    renderOverlayPreset(stage, preset, { ...state, redPlayerName: "" });
    renderOverlayPreset(stage, preset, { ...state, redPlayerName: "Player C" });
    expect(background.src).toBe(firstPlaybackUrl);
  });

  it("suppresses preview trigger playback until the animation test request", () => {
    const stage = {
      style: {},
      children: [],
      append(child) {
        if (child.parentElement) {
          const siblings = child.parentElement.children;
          const index = siblings.indexOf(child);
          if (index >= 0) siblings.splice(index, 1);
        }
        child.parentElement = this;
        this.children.push(child);
      },
      replaceChildren() { this.children = []; },
    };
    const image = "data:image/gif;base64,YQ==";
    vi.stubGlobal("document", {
      createElement(tagName) { return mockElement(tagName.toUpperCase()); },
      fonts: {
        ready: Promise.resolve(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    });
    const preset = {
      id: "preset", width: 100, height: 100,
      components: [{
        kind: "image", id: "animated", source: "text", image, visible: false,
        imageAnimationValueSource: "redSetWins",
        x: 0, y: 0, width: 50, height: 50, fontFamily: "sans-serif", fontSize: 20,
        color: "#ffffff", background: "#000000", align: "center", bold: false,
      }],
    };
    const state = {
      active: true, fullyStopped: false, currentSetId: "__test__",
      redPlayerName: "", bluePlayerName: "", redSetWins: 1, blueSetWins: 0,
      roundText: "", eventName: "", eventAlias: "", suppressAnimationTriggers: true,
      visibilityOverrides: {}, visibilityShowRevisions: {},
      animationTestRequest: { presetId: "preset", componentId: "", revision: 0, playing: false },
    };
    renderOverlayPreset(stage, preset, state);
    renderOverlayPreset(stage, preset, {
      ...state, redSetWins: 2, visibilityOverrides: { animated: true },
    });
    const imageElement = stage.children[0];
    expect(imageElement.src).toBe(image);

    renderOverlayPreset(stage, preset, {
      ...state,
      redSetWins: 3,
      visibilityOverrides: { animated: true },
      animationTestRequest: { presetId: "preset", componentId: "animated", revision: 1, playing: true },
    });
    const firstTestPlaybackUrl = imageElement.src;
    expect(firstTestPlaybackUrl).toMatch(/^blob:/);

    renderOverlayPreset(stage, preset, {
      ...state,
      redSetWins: 4,
      visibilityOverrides: { animated: true },
      animationTestRequest: { presetId: "preset", componentId: "animated", revision: 1, playing: true },
    });
    expect(imageElement.src).toBe(firstTestPlaybackUrl);
  });

  it("freezes the current animation frame when the animation test stops", () => {
    const stage = {
      style: {},
      children: [],
      append(child) {
        child.parentElement = this;
        this.children.push(child);
      },
      replaceChildren() { this.children = []; },
    };
    const image = "data:image/gif;base64,YQ==";
    const drawImage = vi.fn();
    vi.stubGlobal("document", {
      createElement(tagName) {
        if (tagName === "canvas") return {
          getContext: () => ({ drawImage }),
          toDataURL: () => "data:image/png;base64,still",
        };
        return mockElement(tagName.toUpperCase());
      },
      fonts: {
        ready: Promise.resolve(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    });
    const preset = {
      id: "preset", width: 100, height: 100,
      components: [{
        kind: "image", id: "animated", source: "text", image, visible: true,
        x: 0, y: 0, width: 50, height: 50, fontFamily: "sans-serif", fontSize: 20,
        color: "#ffffff", background: "#000000", align: "center", bold: false,
      }],
    };
    const state = {
      active: true, fullyStopped: false, currentSetId: "__test__",
      redPlayerName: "", bluePlayerName: "", redSetWins: 1, blueSetWins: 0,
      roundText: "", eventName: "", eventAlias: "", suppressAnimationTriggers: true,
      visibilityOverrides: {}, visibilityShowRevisions: {},
      animationTestRequest: { presetId: "preset", componentId: "animated", revision: 0, playing: false },
    };
    renderOverlayPreset(stage, preset, state);
    const imageElement = stage.children[0];
    renderOverlayPreset(stage, preset, {
      ...state,
      animationTestRequest: { presetId: "preset", componentId: "animated", revision: 1, playing: true },
    });
    expect(imageElement.src).toMatch(/^blob:/);

    renderOverlayPreset(stage, preset, {
      ...state,
      animationTestRequest: { presetId: "preset", componentId: "animated", revision: 2, playing: false },
    });
    expect(drawImage).toHaveBeenCalledWith(imageElement, 0, 0, 100, 100);
    expect(imageElement.src).toBe("data:image/png;base64,still");
    expect(imageElement.dataset.overlayPlaybackUrl).toBeUndefined();
  });

  it("starts visible display-triggered images and keeps other animated images at their first frame", async () => {
    const stage = {
      style: {},
      children: [],
      append(child) {
        child.parentElement = this;
        this.children.push(child);
      },
      replaceChildren() { this.children = []; },
    };
    const image = "data:image/gif;base64,R0lGODlh";
    const drawImage = vi.fn();
    const decodedFrame = { displayWidth: 100, displayHeight: 100, close: vi.fn() };
    class TestImageDecoder {
      tracks = { ready: Promise.resolve() };
      decode = vi.fn(async ({ frameIndex }) => {
        expect(frameIndex).toBe(0);
        return { image: decodedFrame };
      });
      close = vi.fn();
    }
    vi.stubGlobal("document", {
      createElement(tagName) {
        if (tagName === "canvas") return {
          getContext: () => ({ drawImage }),
          toDataURL: () => "data:image/png;base64,first-frame",
        };
        return mockElement(tagName.toUpperCase());
      },
      fonts: {
        ready: Promise.resolve(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    });
    vi.stubGlobal("ImageDecoder", TestImageDecoder);
    const preset = {
      id: "preset", width: 100, height: 100,
      components: [
        {
          kind: "image", id: "without-display-trigger", source: "text", image, visible: true,
          x: 0, y: 0, width: 50, height: 50, fontFamily: "sans-serif", fontSize: 20,
          color: "#ffffff", background: "#000000", align: "center", bold: false,
        },
        {
          kind: "image", id: "value-triggered", source: "text", image, visible: true,
          imageAnimationValueSource: "redSetWins",
          x: 50, y: 0, width: 50, height: 50, fontFamily: "sans-serif", fontSize: 20,
          color: "#ffffff", background: "#000000", align: "center", bold: false,
        },
        {
          kind: "image", id: "display-triggered", source: "text", image, visible: true,
          imageAnimationOnDisplay: true,
          x: 0, y: 50, width: 50, height: 50, fontFamily: "sans-serif", fontSize: 20,
          color: "#ffffff", background: "#000000", align: "center", bold: false,
        },
      ],
    };
    const state = {
      active: true, fullyStopped: false, currentSetId: "__test__",
      redPlayerName: "", bluePlayerName: "", redSetWins: 1, blueSetWins: 0,
      roundText: "", eventName: "", eventAlias: "", visibilityOverrides: {},
      visibilityShowRevisions: {},
    };
    renderOverlayPreset(stage, preset, state);
    const unrelatedImage = stage.children.find((element) => element.dataset.componentId === "without-display-trigger");
    const triggeredImage = stage.children.find((element) => element.dataset.componentId === "value-triggered");
    const displayTriggeredImage = stage.children.find((element) => element.dataset.componentId === "display-triggered");
    await vi.waitFor(() => {
      expect(unrelatedImage.src).toBe("data:image/png;base64,first-frame");
      expect(triggeredImage.src).toBe("data:image/png;base64,first-frame");
    });
    expect(unrelatedImage.src).toBe("data:image/png;base64,first-frame");
    expect(triggeredImage.src).toBe("data:image/png;base64,first-frame");
    expect(drawImage).toHaveBeenCalledWith(decodedFrame, 0, 0, 100, 100);
    expect(displayTriggeredImage.src).toMatch(/^blob:/);

    renderOverlayPreset(stage, preset, { ...state, redSetWins: 2 });
    expect(unrelatedImage.src).toBe("data:image/png;base64,first-frame");
    expect(triggeredImage.src).toMatch(/^blob:/);
    expect(displayTriggeredImage.src).toMatch(/^blob:/);
  });

  it("preserves the actual first frame when freezing a GIF without ImageDecoder support", async () => {
    const stage = {
      style: {},
      children: [],
      append(child) {
        child.parentElement = this;
        this.children.push(child);
      },
      replaceChildren() { this.children = []; },
    };
    const header = [..."GIF89a"].map((character) => character.charCodeAt(0));
    const screen = [1, 0, 1, 0, 0x80, 0, 0];
    const palette = [0, 0, 0, 255, 255, 255];
    const controlExtension = [0x21, 0xf9, 4, 0, 0, 0, 0, 0];
    const frame = [0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 0x44, 0x01, 0];
    const animatedGif = Uint8Array.from([
      ...header, ...screen, ...palette, ...controlExtension, ...frame, ...frame, 0x3b,
    ]);
    const firstFrameGif = Uint8Array.from([
      ...header, ...screen, ...palette, ...controlExtension, ...frame, 0x3b,
    ]);
    const toDataUrl = (bytes) => `data:image/gif;base64,${btoa(String.fromCharCode(...bytes))}`;
    const image = toDataUrl(animatedGif);
    const expectedFirstFrame = toDataUrl(firstFrameGif);
    vi.stubGlobal("ImageDecoder", undefined);
    vi.stubGlobal("document", {
      createElement(tagName) { return mockElement(tagName.toUpperCase()); },
      fonts: {
        ready: Promise.resolve(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    });
    const preset = {
      id: "preset", width: 100, height: 100,
      components: [{
        kind: "image", id: "static-gif", source: "text", image, visible: true,
        x: 0, y: 0, width: 100, height: 100, fontFamily: "sans-serif", fontSize: 20,
        color: "#ffffff", background: "#000000", align: "center", bold: false,
      }],
    };
    renderOverlayPreset(stage, preset, {
      active: true, fullyStopped: false, currentSetId: "__test__",
      redPlayerName: "", bluePlayerName: "", redSetWins: 0, blueSetWins: 0,
      roundText: "", eventName: "", eventAlias: "",
    });
    const renderedImage = stage.children[0];
    await vi.waitFor(() => expect(renderedImage.src).toBe(expectedFirstFrame));
    expect(renderedImage.dataset.overlaySource).toBe(image);
  });

  it("does not restart an animated image when a different information source changes", () => {
    const stage = {
      style: {},
      children: [],
      append(child) {
        this.children = this.children.filter((item) => item !== child);
        this.children.push(child);
      },
      replaceChildren() { this.children = []; },
    };
    const image = "data:image/gif;base64,YQ==";
    vi.stubGlobal("document", {
      createElement(tagName) { return mockElement(tagName.toUpperCase()); },
      fonts: {
        ready: Promise.resolve(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    });
    vi.stubGlobal("setInterval", vi.fn(() => 1));
    vi.stubGlobal("clearInterval", vi.fn());
    const preset = {
      id: "preset", width: 100, height: 100,
      components: [{
        kind: "image", id: "animated", source: "text", image, visible: true,
        imageAnimationValueSource: "redPlayerName",
        x: 0, y: 0, width: 50, height: 50, fontFamily: "sans-serif", fontSize: 20,
        color: "#ffffff", background: "#000000", align: "center", bold: false,
      }],
    };
    const first = {
      active: true, fullyStopped: false, redPlayerName: "Player A", bluePlayerName: "",
      redSetWins: 1, blueSetWins: 0, roundText: "", eventName: "", eventAlias: "",
    };
    const dispose = renderOverlayPreset(stage, preset, first);
    const renderedImage = stage.children[0];
    const removeAttribute = vi.spyOn(renderedImage, "removeAttribute");
    dispose();
    const nextDispose = renderOverlayPreset(stage, preset, { ...first, redSetWins: 2 });

    expect(removeAttribute).not.toHaveBeenCalled();
    nextDispose();
  });

  it("does not treat the initial test score as a score change or restart it on another component toggle", () => {
    const stage = {
      style: {},
      children: [],
      append(child) {
        if (child.parentElement) {
          const siblings = child.parentElement.children;
          const index = siblings.indexOf(child);
          if (index >= 0) siblings.splice(index, 1);
        }
        child.parentElement = this;
        this.children.push(child);
      },
      replaceChildren() { this.children = []; },
    };
    const image = "data:image/gif;base64,YQ==";
    vi.stubGlobal("document", {
      createElement(tagName) { return mockElement(tagName.toUpperCase()); },
      fonts: {
        ready: Promise.resolve(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    });
    vi.stubGlobal("getComputedStyle", () => ({ paddingTop: "0px", paddingBottom: "0px" }));
    const preset = {
      id: "preset", width: 100, height: 100,
      components: [
        {
          kind: "image", id: "logo", source: "text", image, visible: false,
          imageAnimationOnDisplay: true,
          x: 0, y: 0, width: 50, height: 50, fontFamily: "sans-serif", fontSize: 20,
          color: "#ffffff", background: "#000000", align: "center", bold: false,
        },
        {
          kind: "number", id: "score", source: "redSetWins", text: "", frame: "image", image,
          visible: true, imageAnimationValueSource: "redSetWins",
          x: 50, y: 0, width: 50, height: 50, fontFamily: "sans-serif", fontSize: 20,
          color: "#ffffff", background: "#000000", align: "center", bold: false,
        },
      ],
    };
    const inactive = {
      active: true, fullyStopped: false, redPlayerName: "", bluePlayerName: "",
      redSetWins: 1, blueSetWins: 0, roundText: "", eventName: "", eventAlias: "",
      currentSetId: "__test__", animationSessionRevision: 10,
      visibilityOverrides: {}, visibilityShowRevisions: {},
    };
    renderOverlayPreset(stage, preset, inactive);
    const score = stage.children.find((element) => element.dataset.componentId === "score");
    const scoreBackground = score.querySelector(":scope > img[data-overlay-frame-image]");

    renderOverlayPreset(stage, preset, {
      ...inactive, animationSessionRevision: 11, redSetWins: 2,
      visibilityOverrides: { logo: true }, visibilityShowRevisions: { logo: 1 },
    });
    const logo = stage.children.find((element) => element.dataset.componentId === "logo");
    expect(logo.src).toBe(image);
    expect(scoreBackground.src).toBe(image);

    renderOverlayPreset(stage, preset, {
      ...inactive, animationSessionRevision: 11, redSetWins: 3,
      visibilityOverrides: { logo: true }, visibilityShowRevisions: { logo: 1 },
    });
    expect(logo.src).toBe(image);
    const scorePlaybackUrl = scoreBackground.src;
    expect(scorePlaybackUrl).toMatch(/^blob:/);
    expect(logo.src).not.toBe(scorePlaybackUrl);

    renderOverlayPreset(stage, preset, {
      ...inactive, animationSessionRevision: 11, redSetWins: 3,
      visibilityOverrides: { logo: false }, visibilityShowRevisions: { logo: 1 },
    });
    renderOverlayPreset(stage, preset, {
      ...inactive, animationSessionRevision: 11, redSetWins: 3,
      visibilityOverrides: { logo: true }, visibilityShowRevisions: { logo: 2 },
    });
    expect(stage.children.find((element) => element.dataset.componentId === "logo").src).toMatch(/^blob:/);
    expect(scoreBackground.src).toBe(scorePlaybackUrl);
  });

  it("restarts display-triggered animations when a preset-hidden component is toggled on", () => {
    const stage = {
      style: {},
      children: [],
      append(child) {
        if (child.parentElement) {
          const siblings = child.parentElement.children;
          const index = siblings.indexOf(child);
          if (index >= 0) siblings.splice(index, 1);
        }
        child.parentElement = this;
        this.children.push(child);
      },
      replaceChildren() { this.children = []; },
    };
    const image = "data:image/gif;base64,YQ==";
    vi.stubGlobal("document", {
      createElement(tagName) {
        const element = mockElement(tagName.toUpperCase());
        return element;
      },
      fonts: {
        ready: Promise.resolve(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    });
    vi.stubGlobal("setInterval", vi.fn(() => 1));
    vi.stubGlobal("clearInterval", vi.fn());
    const preset = {
      id: "preset", width: 100, height: 100,
      components: [
        {
          kind: "image", id: "animated", source: "text", image, visible: false,
          imageAnimationOnDisplay: true,
          x: 0, y: 0, width: 50, height: 50, fontFamily: "sans-serif", fontSize: 20,
          color: "#ffffff", background: "#000000", align: "center", bold: false,
        },
        {
          kind: "image", id: "other-animated", source: "text", image, visible: true,
          imageAnimationOnDisplay: true,
          x: 50, y: 0, width: 50, height: 50, fontFamily: "sans-serif", fontSize: 20,
          color: "#ffffff", background: "#000000", align: "center", bold: false,
        },
      ],
    };
    const state = {
      active: true, fullyStopped: false, redPlayerName: "", bluePlayerName: "",
      redSetWins: 0, blueSetWins: 0, roundText: "", eventName: "", eventAlias: "",
      visibilityOverrides: {}, visibilityShowRevisions: {},
    };
    renderOverlayPreset(stage, preset, state);
    expect(stage.children).toHaveLength(1);
    const otherImage = stage.children[0];
    const otherPlaybackUrl = otherImage.src;
    expect(otherImage.dataset.componentId).toBe("other-animated");
    renderOverlayPreset(stage, preset, {
      ...state, visibilityOverrides: { animated: true }, visibilityShowRevisions: { animated: 1 },
    });
    expect(stage.children).toHaveLength(2);
    const playbackUrls = [stage.children.find((element) => element.dataset.componentId === "animated").src];
    expect(otherImage.src).toBe(otherPlaybackUrl);
    for (let cycle = 0; cycle < 2; cycle++) {
      const revision = cycle + 1;
      renderOverlayPreset(stage, preset, {
        ...state, visibilityOverrides: { animated: false }, visibilityShowRevisions: { animated: revision },
      });
      expect(stage.children).toHaveLength(1);
      renderOverlayPreset(stage, preset, {
        ...state, visibilityOverrides: { animated: true }, visibilityShowRevisions: { animated: revision + 1 },
      });
      playbackUrls.push(stage.children.find((element) => element.dataset.componentId === "animated").src);
      expect(otherImage.src).toBe(otherPlaybackUrl);
    }
    const lastPlaybackUrl = stage.children.find((element) => element.dataset.componentId === "animated").src;
    renderOverlayPreset(stage, preset, {
      ...state, visibilityOverrides: { animated: true }, visibilityShowRevisions: { animated: 4 },
    });
    const finalPlaybackUrl = stage.children.find((element) => element.dataset.componentId === "animated").src;
    playbackUrls.push(finalPlaybackUrl);
    expect(playbackUrls.every((url) => url.startsWith("blob:"))).toBe(true);
    expect(finalPlaybackUrl).not.toBe(lastPlaybackUrl);
    expect(otherImage.src).toBe(otherPlaybackUrl);
    expect(new Set(playbackUrls).size).toBe(4);
    expect(preset.components[0].visible).toBe(false);
    renderOverlayPreset(stage, preset, {
      ...state, visibilityOverrides: { animated: false }, visibilityShowRevisions: { animated: 4 },
    });
  });

  it("keeps animation playback URLs alive until the image is hidden", () => {
    const stage = {
      style: {},
      children: [],
      append(child) {
        if (child.parentElement) {
          const siblings = child.parentElement.children;
          const index = siblings.indexOf(child);
          if (index >= 0) siblings.splice(index, 1);
        }
        child.parentElement = this;
        this.children.push(child);
      },
      replaceChildren() { this.children = []; },
    };
    const image = `data:image/gif;base64,${btoa(String.fromCharCode(
      71, 73, 70, 56, 57, 97, 1, 0, 1, 0, 0, 0, 0,
      0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 0x44, 1, 0,
      0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 0x44, 1, 0, 0x3b,
    ))}`;
    const playbackUrl = "blob:overlay-animation";
    const createObjectURL = vi.fn(() => playbackUrl);
    const revokeObjectURL = vi.fn();
    const addEventListener = vi.fn();
    let imageElement;
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
    vi.stubGlobal("document", {
      createElement(tagName) {
        if (tagName === "IMG") {
          imageElement = mockElement("IMG");
          imageElement.addEventListener = addEventListener;
          return imageElement;
        }
        return mockElement(tagName.toUpperCase());
      },
      fonts: {
        ready: Promise.resolve(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    });
    const preset = {
      id: "preset", width: 100, height: 100,
      components: [{
        kind: "image", id: "animated", source: "text", image, visible: false,
        imageAnimationOnDisplay: true,
        x: 0, y: 0, width: 50, height: 50, fontFamily: "sans-serif", fontSize: 20,
        color: "#ffffff", background: "#000000", align: "center", bold: false,
      }],
    };
    const state = {
      active: true, fullyStopped: false, redPlayerName: "", bluePlayerName: "",
      redSetWins: 0, blueSetWins: 0, roundText: "", eventName: "", eventAlias: "",
      visibilityOverrides: {}, visibilityShowRevisions: {},
    };

    renderOverlayPreset(stage, preset, state);
    renderOverlayPreset(stage, preset, {
      ...state, visibilityOverrides: { animated: true }, visibilityShowRevisions: { animated: 1 },
    });
    const loadListener = addEventListener.mock.calls.find(([type]) => type === "load")?.[1];
    loadListener?.();
    expect(imageElement.src).toBe(playbackUrl);
    expect(revokeObjectURL).not.toHaveBeenCalled();

    renderOverlayPreset(stage, preset, {
      ...state, visibilityOverrides: { animated: false }, visibilityShowRevisions: { animated: 1 },
    });
    expect(revokeObjectURL).toHaveBeenCalledWith(playbackUrl);
  });

  it("does not cascade another text component's content appearance to display-triggered animations", () => {
    const stage = {
      style: {},
      children: [],
      append(child) {
        if (child.parentElement) {
          const siblings = child.parentElement.children;
          const index = siblings.indexOf(child);
          if (index >= 0) siblings.splice(index, 1);
        }
        child.parentElement = this;
        this.children.push(child);
      },
      replaceChildren() { this.children = []; },
    };
    const image = "data:image/gif;base64,YQ==";
    vi.stubGlobal("document", {
      createElement(tagName) { return mockElement(tagName.toUpperCase()); },
      fonts: {
        ready: Promise.resolve(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    });
    vi.stubGlobal("getComputedStyle", () => ({ paddingTop: "0px", paddingBottom: "0px" }));
    const preset = {
      id: "preset", width: 100, height: 100,
      components: [
        {
          kind: "image", id: "animated", source: "text", image, visible: true,
          imageAnimationOnDisplay: true,
          x: 0, y: 0, width: 50, height: 50, fontFamily: "sans-serif", fontSize: 20,
          color: "#ffffff", background: "#000000", align: "center", bold: false,
        },
        {
          kind: "image", id: "other", source: "text", image, visible: true,
          imageAnimationOnDisplay: true,
          x: 50, y: 0, width: 50, height: 50, fontFamily: "sans-serif", fontSize: 20,
          color: "#ffffff", background: "#000000", align: "center", bold: false,
        },
        {
          kind: "text", id: "watched", source: "redPlayerName", text: "", visible: true,
          x: 0, y: 50, width: 100, height: 50, fontFamily: "sans-serif", fontSize: 20,
          color: "#ffffff", background: "#000000", align: "center", bold: false,
        },
      ],
    };
    const state = {
      active: true, fullyStopped: false, redPlayerName: "", bluePlayerName: "",
      redSetWins: 0, blueSetWins: 0, roundText: "", eventName: "", eventAlias: "",
      visibilityShowRevisions: {},
    };
    renderOverlayPreset(stage, preset, state);
    const animated = stage.children.find((element) => element.dataset.componentId === "animated");
    const other = stage.children.find((element) => element.dataset.componentId === "other");
    const animatedUrl = animated.src;
    const otherUrl = other.src;
    expect(animatedUrl).toMatch(/^blob:/);
    expect(otherUrl).toMatch(/^blob:/);

    renderOverlayPreset(stage, preset, { ...state, redPlayerName: "Player" });

    expect(animated.src).toBe(animatedUrl);
    expect(other.src).toBe(otherUrl);
  });

  it("uses only each component's off-to-on visibility transition for the display trigger", () => {
    const stage = {
      style: {},
      children: [],
      append(child) {
        if (child.parentElement) {
          const siblings = child.parentElement.children;
          const index = siblings.indexOf(child);
          if (index >= 0) siblings.splice(index, 1);
        }
        child.parentElement = this;
        this.children.push(child);
      },
      replaceChildren() { this.children = []; },
    };
    const image = "data:image/gif;base64,YQ==";
    vi.stubGlobal("document", {
      createElement(tagName) { return mockElement(tagName.toUpperCase()); },
      fonts: {
        ready: Promise.resolve(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    });
    const preset = {
      id: "preset", width: 100, height: 100,
      components: [
        {
          kind: "image", id: "display-trigger", source: "text", image, visible: false,
          imageAnimationOnDisplay: true,
          x: 0, y: 0, width: 50, height: 50, fontFamily: "sans-serif", fontSize: 20,
          color: "#ffffff", background: "#000000", align: "center", bold: false,
        },
        {
          kind: "image", id: "no-display-trigger", source: "text", image, visible: false,
          x: 50, y: 0, width: 50, height: 50, fontFamily: "sans-serif", fontSize: 20,
          color: "#ffffff", background: "#000000", align: "center", bold: false,
        },
      ],
    };
    const state = {
      active: false, fullyStopped: true, redPlayerName: "", bluePlayerName: "",
      redSetWins: 0, blueSetWins: 0, roundText: "", eventName: "", eventAlias: "",
      visibilityOverrides: {}, visibilityShowRevisions: {},
    };
    renderOverlayPreset(stage, preset, state);
    renderOverlayPreset(stage, preset, { ...state, active: true, fullyStopped: false });
    expect(stage.children.find((element) => element.dataset.componentId === "display-trigger")).toBeUndefined();

    renderOverlayPreset(stage, preset, {
      ...state, active: true, fullyStopped: false,
      visibilityOverrides: { "display-trigger": false },
    });
    expect(stage.children.find((element) => element.dataset.componentId === "display-trigger")).toBeUndefined();
    renderOverlayPreset(stage, preset, {
      ...state, active: true, fullyStopped: false,
      visibilityOverrides: { "display-trigger": false, "no-display-trigger": true },
      visibilityShowRevisions: { "no-display-trigger": 1 },
    });
    const unrelatedImage = stage.children.find((element) => element.dataset.componentId === "no-display-trigger");
    expect(unrelatedImage.src).toBe(image);

    renderOverlayPreset(stage, preset, {
      ...state, active: true, fullyStopped: false,
      visibilityOverrides: { "display-trigger": true, "no-display-trigger": true },
      visibilityShowRevisions: { "display-trigger": 1, "no-display-trigger": 1 },
    });
    const shownDisplayTriggeredImage = stage.children.find((element) => element.dataset.componentId === "display-trigger");
    expect(shownDisplayTriggeredImage.src).toMatch(/^blob:/);
    expect(unrelatedImage.src).toBe(image);

    const playbackUrl = shownDisplayTriggeredImage.src;
    renderOverlayPreset(stage, preset, {
      ...state, active: true, fullyStopped: false,
      visibilityOverrides: { "display-trigger": false, "no-display-trigger": true },
      visibilityShowRevisions: { "display-trigger": 1, "no-display-trigger": 1 },
    });
    expect(shownDisplayTriggeredImage.src).toBe(playbackUrl);
    expect(unrelatedImage.src).toBe(image);
  });

  it("does not forward a display-triggered restart to another component using the same image", () => {
    const stage = {
      style: {},
      children: [],
      append(child) {
        if (child.parentElement) {
          const siblings = child.parentElement.children;
          const index = siblings.indexOf(child);
          if (index >= 0) siblings.splice(index, 1);
        }
        child.parentElement = this;
        this.children.push(child);
      },
      replaceChildren() { this.children = []; },
    };
    const image = "data:image/gif;base64,YQ==";
    vi.stubGlobal("document", {
      createElement(tagName) { return mockElement(tagName.toUpperCase()); },
      fonts: {
        ready: Promise.resolve(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    });
    vi.stubGlobal("getComputedStyle", () => ({ paddingTop: "0px", paddingBottom: "0px" }));
    const preset = {
      id: "preset", width: 100, height: 100,
      components: [
        {
          kind: "image", id: "visibility-triggered", source: "text", image, visible: false,
          imageAnimationOnDisplay: true,
          x: 0, y: 0, width: 50, height: 50, fontFamily: "sans-serif", fontSize: 20,
          color: "#ffffff", background: "#000000", align: "center", bold: false,
        },
        {
          kind: "text", id: "score-triggered", source: "redPlayerName", text: "", image,
          frame: "image", visible: true, imageAnimationValueSource: "redSetWins",
          x: 50, y: 0, width: 50, height: 50, fontFamily: "sans-serif", fontSize: 20,
          color: "#ffffff", background: "#000000", align: "center", bold: false,
        },
      ],
    };
    const state = {
      active: true, fullyStopped: false, currentSetId: "__test__",
      redPlayerName: "Player", bluePlayerName: "", redSetWins: 1, blueSetWins: 0,
      roundText: "", eventName: "", eventAlias: "",
      visibilityOverrides: {}, visibilityShowRevisions: {},
    };
    renderOverlayPreset(stage, preset, state);
    const scoreBackground = stage.children.find((element) => element.dataset.componentId === "score-triggered")
      .querySelector(":scope > img[data-overlay-frame-image]");
    const initialScoreImageSource = scoreBackground.src;

    renderOverlayPreset(stage, preset, {
      ...state,
      redSetWins: 2,
      visibilityOverrides: { "visibility-triggered": true },
      visibilityShowRevisions: { "visibility-triggered": 1 },
    });
    const visibilityImage = stage.children.find((element) => element.dataset.componentId === "visibility-triggered");
    expect(visibilityImage.src).toMatch(/^blob:/);
    expect(scoreBackground.src).toBe(initialScoreImageSource);

    renderOverlayPreset(stage, preset, {
      ...state,
      redSetWins: 2,
      visibilityOverrides: { "visibility-triggered": false },
      visibilityShowRevisions: { "visibility-triggered": 1 },
    });
    renderOverlayPreset(stage, preset, {
      ...state,
      redSetWins: 2,
      visibilityOverrides: { "visibility-triggered": true },
      visibilityShowRevisions: { "visibility-triggered": 2 },
    });
    expect(visibilityImage.src).toMatch(/^blob:/);
    expect(scoreBackground.src).toBe(initialScoreImageSource);
  });

  it("does not use text appearance as an image display transition", () => {
    const stage = {
      style: {},
      children: [],
      append(child) {
        if (child.parentElement) {
          const siblings = child.parentElement.children;
          const index = child.parentElement.children.indexOf(child);
          if (index >= 0) child.parentElement.children.splice(index, 1);
        }
        child.parentElement = this;
        this.children.push(child);
      },
      replaceChildren() { this.children = []; },
    };
    const image = "data:image/gif;base64,YQ==";
    vi.stubGlobal("document", {
      createElement(tagName) { return mockElement(tagName.toUpperCase()); },
      fonts: {
        ready: Promise.resolve(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    });
    vi.stubGlobal("getComputedStyle", () => ({ paddingTop: "0px", paddingBottom: "0px" }));
    const preset = {
      id: "preset", width: 100, height: 100,
      components: [{
        kind: "text", id: "text", source: "redPlayerName", text: "", visible: true, frame: "image", image,
        imageAnimationOnDisplay: true,
        x: 0, y: 0, width: 100, height: 50, fontFamily: "sans-serif", fontSize: 20,
        color: "#ffffff", background: "#000000", align: "center", bold: false,
      }],
    };
    const state = {
      active: true, fullyStopped: false, redPlayerName: "", bluePlayerName: "",
      redSetWins: 0, blueSetWins: 0, roundText: "", eventName: "", eventAlias: "",
      visibilityOverrides: {}, visibilityShowRevisions: {},
    };
    renderOverlayPreset(stage, preset, state);
    const background = stage.children[0].querySelector(":scope > img[data-overlay-frame-image]");
    const playbackUrl = background.src;
    expect(playbackUrl).toMatch(/^blob:/);
    renderOverlayPreset(stage, preset, { ...state, redPlayerName: "Player" });
    expect(background.src).toBe(playbackUrl);
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
