import { afterEach, describe, expect, it, vi } from "vitest";
import {
  normalizeBracketZoomLevel,
  normalizeMobileInputPollingMs,
  writeStoredBooleanPreference,
} from "./useAppPreferences";

describe("application preference normalization", () => {
  it("clamps mobile polling interval to its supported range", () => {
    expect(normalizeMobileInputPollingMs("100")).toBe(500);
    expect(normalizeMobileInputPollingMs("1250.9")).toBe(1250);
    expect(normalizeMobileInputPollingMs("20000")).toBe(10000);
    expect(normalizeMobileInputPollingMs("invalid", 2000)).toBe(2000);
  });

  it("selects the nearest supported bracket zoom level", () => {
    expect(normalizeBracketZoomLevel("0.67")).toBe(0.7);
    expect(normalizeBracketZoomLevel(0.42)).toBe(0.5);
    expect(normalizeBracketZoomLevel("invalid")).toBe(1);
  });

  it("writes boolean preferences synchronously", () => {
    const setItem = vi.fn();
    vi.stubGlobal("window", { localStorage: { setItem } });

    writeStoredBooleanPreference("call-lock", true);

    expect(setItem).toHaveBeenCalledWith("call-lock", "true");
    vi.unstubAllGlobals();
  });
});

afterEach(() => vi.unstubAllGlobals());
