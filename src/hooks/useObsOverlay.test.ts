import { describe, expect, it } from "vitest";
import {
  abbreviateOverlayRoundText,
  buildOverlaySetRoundText,
  isOverlayActiveForSet,
  resolveOverlaySidesForSet,
  scoreToOverlayGameWins,
} from "./useObsOverlay";
import type { SetSnapshot } from "../domain/bracketProgression";

describe("overlay display formatting", () => {
  it("treats only an active non-test set as live", () => {
    expect(isOverlayActiveForSet({ active: true, currentSetId: "set-1" }, "set-1")).toBe(true);
    expect(isOverlayActiveForSet({ active: true, currentSetId: "set-2" }, "set-1")).toBe(false);
    expect(isOverlayActiveForSet({ active: true, currentSetId: "__test__" }, "__test__")).toBe(false);
    expect(isOverlayActiveForSet({ active: false, currentSetId: "set-1" }, "set-1")).toBe(false);
    expect(isOverlayActiveForSet(null, "set-1")).toBe(false);
  });

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

  it("builds a set round label with display-code and empty-value fallbacks", () => {
    const set = {
      fullRoundText: "Grand Finals Reset",
      phaseName: " Main phase ",
      phaseGroupDisplayIdentifier: "A",
      identifier: "",
    } as unknown as SetSnapshot;
    expect(buildOverlaySetRoundText(set, "W-Final")).toBe("Main phase / Pool A / Set W-Final\nGF Reset");

    expect(buildOverlaySetRoundText({
      fullRoundText: "Round 1",
      phaseName: null,
      phaseGroupDisplayIdentifier: null,
      identifier: null,
    }, undefined)).toBe("- / Pool - / Set -\nRound 1");
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
      redEntrantId: "player-b",
      blueEntrantId: "player-a",
      redSetWins: 0,
      blueSetWins: 1,
    });
  });
});