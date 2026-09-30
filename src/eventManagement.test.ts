import { describe, expect, it } from "vitest";
import {
  buildCategoryUsageList,
  buildConfiguredCategorySlots,
  resolveMatchSideAssignment,
  resolveRandomMatchSideAssignment,
  resolveSideDecisionMethod,
  resolveSidesByDecisionMethod,
  resolveSwappedMatchSideAssignment,
} from "./eventManagement";

describe("event side decision", () => {
  it("swaps draft-first sides with saved-side and positional fallbacks", () => {
    expect(resolveSwappedMatchSideAssignment("", "", "1P", "2P")).toEqual({
      upperSide: "2P",
      lowerSide: "1P",
    });
    expect(resolveSwappedMatchSideAssignment("2P", "", "1P", "")).toEqual({
      upperSide: "2P",
      lowerSide: "2P",
    });
    expect(resolveSwappedMatchSideAssignment("", "", "", "")).toEqual({
      upperSide: "2P",
      lowerSide: "1P",
    });
  });

  it("creates complementary randomized sides at the existing half-way threshold", () => {
    expect(resolveRandomMatchSideAssignment(0.49)).toEqual({ upperSide: "1P", lowerSide: "2P" });
    expect(resolveRandomMatchSideAssignment(0.5)).toEqual({ upperSide: "2P", lowerSide: "1P" });
  });

  it("resolves a coherent pair from upper and lower candidates", () => {
    expect(resolveMatchSideAssignment("2P", "1P")).toEqual({ upperSide: "2P", lowerSide: "1P" });
    expect(resolveMatchSideAssignment("", "2P")).toEqual({ upperSide: "1P", lowerSide: "2P" });
    expect(resolveMatchSideAssignment("1P", "")).toEqual({ upperSide: "1P", lowerSide: "2P" });
    expect(resolveMatchSideAssignment("", "")).toBeNull();
  });

  it("normalizes unsupported methods to upper 1P", () => {
    expect(resolveSideDecisionMethod("unknown")).toBe("upper_1p");
    expect(resolveSideDecisionMethod("upper_2p")).toBe("upper_2p");
    expect(resolveSideDecisionMethod("random")).toBe("random");
  });

  it("assigns opposite sides for fixed methods", () => {
    expect(resolveSidesByDecisionMethod("set-1", "upper_1p")).toEqual({
      upperSide: "1P",
      lowerSide: "2P",
    });
    expect(resolveSidesByDecisionMethod("set-1", "upper_2p")).toEqual({
      upperSide: "2P",
      lowerSide: "1P",
    });
  });

  it("keeps random assignment stable per set", () => {
    const first = resolveSidesByDecisionMethod("set-random", "random");
    const second = resolveSidesByDecisionMethod("set-random", "random");

    expect(first).toEqual(second);
    expect(first.lowerSide).not.toBe(first.upperSide);
  });
});

describe("category usage", () => {
  it("builds enabled category slots and normalizes limits", () => {
    const list = { id: "list-a", name: "Main", categoryName: "Character", items: ["A"] };
    const slots = buildConfiguredCategorySlots({
      sideDecisionMethod: "upper_1p",
      itemListIds: ["list-a", "missing", "  "],
      categoryMinCounts: [-2, 1, 1],
      categoryMaxCounts: [0, 0, 0],
      categoryAllowDuplicates: [true, false, true],
    }, (listId) => listId === list.id ? list : null);

    expect(slots).toEqual([{
      slotIndex: 0,
      list,
      minCount: 0,
      maxCount: 0,
      allowDuplicates: true,
    }]);
  });

  it("counts each selected item once per entrant and calculates usage rates", () => {
    const result = buildCategoryUsageList([{
      slotIndex: 1,
      list: {
        categoryName: "Main",
        name: "Characters",
        items: [" Alpha ", "Bravo", "Unused", ""],
      },
    }], [
      { characterNames: ["Alpha", " Alpha ", "Bravo", "Other"] },
      { characterNames: ["Alpha"] },
    ]);

    expect(result).toEqual([{
      slotIndex: 1,
      categoryName: "Main",
      listName: "Characters",
      entries: [
        { itemName: "Alpha", count: 2, rate: 100 },
        { itemName: "Bravo", count: 1, rate: 50 },
      ],
    }]);
  });
});