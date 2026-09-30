import { describe, expect, it } from "vitest";
import {
  formatAlphabetSequence,
  normalizeSourceText,
  pickPairSourceIds,
} from "./bracketDisplay";

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
});