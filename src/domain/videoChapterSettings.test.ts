import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultVideoChapterSettings, loadVideoChapterSettings, saveVideoChapterSettings } from "./videoChapterSettings";

describe("video chapter settings persistence", () => {
  const storage = new Map<string, string>();
  beforeEach(() => {
    storage.clear();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => { storage.set(key, value); },
      },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("restores every setting and keeps incomplete time input as entered", () => {
    const settings = {
      openingText: "大会開始",
      referenceVideoTime: "1:2:",
      referenceSetId: "set-b",
      selectedCategorySlots: [0, 2],
      showResults: true,
    };
    saveVideoChapterSettings("tournament/test", "event", settings);
    expect(loadVideoChapterSettings("tournament/test", "event")).toEqual(settings);
    expect(storage.size).toBe(1);
  });

  it("isolates events and tournaments and normalizes the tournament prefix", () => {
    const settings = { ...defaultVideoChapterSettings(), openingText: "Saved" };
    saveVideoChapterSettings("tournament/test", "event-a", settings);
    expect(loadVideoChapterSettings("test", "event-a")).toEqual(settings);
    expect(loadVideoChapterSettings("test", "event-b")).toEqual(defaultVideoChapterSettings());
    expect(loadVideoChapterSettings("other", "event-a")).toEqual(defaultVideoChapterSettings());
  });

  it("persists clearing the reference without changing display preferences", () => {
    const settings = { ...defaultVideoChapterSettings(), showResults: true, selectedCategorySlots: [1] };
    saveVideoChapterSettings("test", "event", { ...settings, referenceSetId: "set", referenceVideoTime: "0:30" });
    saveVideoChapterSettings("test", "event", settings);
    expect(loadVideoChapterSettings("test", "event")).toEqual(settings);
  });

  it("reports malformed saved settings without replacing them", () => {
    saveVideoChapterSettings("test", "event", defaultVideoChapterSettings());
    const key = [...storage.keys()][0];
    storage.set(key, '{"showResults":"true"}');
    expect(() => loadVideoChapterSettings("test", "event")).toThrow("形式が不正");
    expect(storage.get(key)).toBe('{"showResults":"true"}');
    storage.set(key, "{");
    expect(() => loadVideoChapterSettings("test", "event")).toThrow();
  });

  it("surfaces storage failures", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => { throw new Error("read denied"); },
        setItem: () => { throw new Error("write denied"); },
      },
    });
    expect(() => loadVideoChapterSettings("test", "event")).toThrow("read denied");
    expect(() => saveVideoChapterSettings("test", "event", defaultVideoChapterSettings())).toThrow("write denied");
  });
});
