import { describe, expect, it } from "vitest";
import {
  resolveSelectedPhaseName,
  resolveSelectedPhasePoolKey,
} from "./usePhasePoolSelection";
import type { PhasePoolGroup } from "../domain/bracketDisplay";

describe("phase and pool selection", () => {
  it("keeps a valid phase, falls back to the first phase, or clears an empty list", () => {
    expect(resolveSelectedPhaseName(["Pools", "Finals"], "Finals")).toBe("Finals");
    expect(resolveSelectedPhaseName(["Pools", "Finals"], "Missing")).toBe("Pools");
    expect(resolveSelectedPhaseName([], "Pools")).toBe("");
  });

  it("keeps a valid pool key, falls back to the first key, or clears an empty list", () => {
    const groups = [
      { key: "id:pool-a", phaseName: "phase", phaseGroupName: "pool-a" },
      { key: "id:pool-b", phaseName: "phase", phaseGroupName: "pool-b" },
    ] as PhasePoolGroup[];
    expect(resolveSelectedPhasePoolKey(groups, "id:pool-b")).toBe("id:pool-b");
    expect(resolveSelectedPhasePoolKey(groups, "phase::pool-b")).toBe("id:pool-b");
    expect(resolveSelectedPhasePoolKey(groups, "missing")).toBe("id:pool-a");
    expect(resolveSelectedPhasePoolKey([], "phase::pool-a")).toBe("");
  });
});