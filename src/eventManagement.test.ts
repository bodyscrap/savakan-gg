import { describe, expect, it } from "vitest";
import {
  resolveSideDecisionMethod,
  resolveSidesByDecisionMethod,
} from "./eventManagement";

describe("event side decision", () => {
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