import { describe, expect, it } from "vitest";
import {
  buildCategoryUsageList,
  resolveMatchSideAssignment,
  resolveSideDecisionMethod,
  resolveSidesByDecisionMethod,
} from "./eventManagement";

describe("event side decision", () => {
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