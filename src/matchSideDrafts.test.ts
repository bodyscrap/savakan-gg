import { describe, expect, it } from "vitest";
import { buildMatchSideDrafts, resolveMatchSideDraftSavePlan } from "./matchSideDrafts";
import type { SetSnapshot } from "./bracketProgression";

describe("match side drafts", () => {
  it("initializes drafts from saved sides and ignores empty slots", () => {
    const set = {
      setId: "set-1",
      slots: [
        { entrantId: "player-a" },
        { entrantId: null },
        { entrantId: "player-b" },
      ],
    } as unknown as SetSnapshot;

    expect(buildMatchSideDrafts(set, (setId, entrantId) => {
      expect(setId).toBe("set-1");
      return entrantId === "player-a" ? "1P" : "";
    })).toEqual({
      "player-a": "1P",
      "player-b": "",
    });
  });

  it("resolves complementary save sides from drafts, saved values, and fallbacks", () => {
    const set = {
      setId: "set-1",
      slots: [{ entrantId: "player-a" }, { entrantId: "player-b" }],
    } as unknown as SetSnapshot;

    expect(resolveMatchSideDraftSavePlan(
      set,
      { "player-a": "2P" },
      () => "",
      (_setId, entrantId) => entrantId === "player-a" ? "1P" : "",
    )).toEqual({
      upperEntrantId: "player-a",
      sideOverrides: { "player-a": "2P", "player-b": "1P" },
      sidesChanged: true,
    });
  });

  it("skips save plans for non-ready sets or when no side can be resolved", () => {
    const readySet = {
      setId: "set-1",
      slots: [{ entrantId: "player-a" }, { entrantId: "player-b" }],
    } as unknown as SetSnapshot;
    const incompleteSet = {
      ...readySet,
      slots: [{ entrantId: "player-a" }, { entrantId: null }],
    } as unknown as SetSnapshot;

    expect(resolveMatchSideDraftSavePlan(incompleteSet, {}, () => "", () => "1P")).toBeNull();
    expect(resolveMatchSideDraftSavePlan(readySet, {}, () => "", () => "")).toBeNull();
  });
});