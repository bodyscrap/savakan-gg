import { describe, expect, it } from "vitest";
import {
  abbreviateOverlayRoundText,
  resolveOverlaySidesForSet,
  scoreToOverlayGameWins,
} from "./useObsOverlay";
import type { SetSnapshot } from "./bracketProgression";

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

  it("maps player sides and scores to overlay colors", () => {
    const set = {
      setId: "set-1",
      slots: [
        { entrantId: "player-a", entrantName: "Player A", score: 1 },
        { entrantId: "player-b", entrantName: "Player B", score: 0 },
      ],
    } as unknown as SetSnapshot;

    expect(resolveOverlaySidesForSet(set, {
      getSavedSide: (_setId, entrantId) => entrantId === "player-a" ? "2P" : "1P",
    })).toEqual({
      redPlayerName: "Player B",
      bluePlayerName: "Player A",
      redSetWins: 0,
      blueSetWins: 1,
    });
  });
});