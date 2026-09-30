import { describe, expect, it } from "vitest";
import { abbreviateOverlayRoundText, scoreToOverlayGameWins } from "./useObsOverlay";

describe("overlay display formatting", () => {
  it("normalizes overlay game wins", () => {
    expect(scoreToOverlayGameWins(null)).toBe(0);
    expect(scoreToOverlayGameWins(-1)).toBe(0);
    expect(scoreToOverlayGameWins(2.8)).toBe(2);
  });

  it("shortens grand final round labels", () => {
    expect(abbreviateOverlayRoundText("Grand Finals Reset")).toBe("GF Reset");
    expect(abbreviateOverlayRoundText("Grand Finals - Round 2")).toBe("GF - Round 2");
    expect(abbreviateOverlayRoundText("  Round 3  ")).toBe("Round 3");
  });
});