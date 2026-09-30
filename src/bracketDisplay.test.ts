import { describe, expect, it } from "vitest";
import {
  formatAlphabetSequence,
  getDisplaySlotsForSet,
  normalizeSourceText,
  pickPairSourceIds,
} from "./bracketDisplay";
import type { SetSnapshot } from "./bracketProgression";

describe("bracket source labels", () => {
  it("formats alphabetic set labels beyond Z", () => {
    expect(formatAlphabetSequence(0)).toBe("A");
    expect(formatAlphabetSequence(25)).toBe("Z");
    expect(formatAlphabetSequence(26)).toBe("AA");
  });

  it("selects source sets for paired rounds", () => {
    expect(pickPairSourceIds(["a", "b", "c", "d"], 2, 1)).toEqual(["c", "d"]);
    expect(pickPairSourceIds(["only"], 4, 3)).toEqual(["only"]);
    expect(pickPairSourceIds([], 2, 0)).toEqual([]);
  });

  it("formats winner and loser source text", () => {
    expect(normalizeSourceText("winners", "A")).toBe("winner of A");
    expect(normalizeSourceText("losers", "B")).toBe("loser of B");
  });

  it("sorts display slots by draft side before saved side", () => {
    const set = {
      setId: "set-1",
      slots: [
        { entrantId: "player-a", entrantName: "Player A" },
        { entrantId: "player-b", entrantName: "Player B" },
      ],
    } as unknown as SetSnapshot;
    const savedSides = new Map([
      ["player-a", "1P"],
      ["player-b", "1P"],
    ]);

    const result = getDisplaySlotsForSet(set, {
      displayBySide: true,
      sideDrafts: { "player-a": "2P" },
      getSideLabel: (_setId, entrantId) => savedSides.get(entrantId ?? "") ?? "-",
    });

    expect(result.map(({ slot }) => slot.entrantId)).toEqual(["player-b", "player-a"]);
  });
});