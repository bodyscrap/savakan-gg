import { describe, expect, it } from "vitest";
import type { EventSnapshot } from "./bracketDisplay";
import { buildInitialPhaseSeedMapping, canShuffleInitialPhaseSeeds } from "./initialPhaseSeedShuffle";

function eventFixture(): EventSnapshot {
  return {
    eventId: "event",
    name: "Event",
    phases: [{ phaseId: "phase-1", name: "Pools", phaseOrder: 1 }],
    phaseGroups: [{
      phaseGroupId: "group-1",
      phaseId: "phase-1",
      phaseOrder: 1,
      phaseName: "Pools",
      displayIdentifier: "A",
      bracketType: "ROUND_ROBIN",
      seeds: [
        { seedId: "seed-1", seedNum: 1, entrantId: "entrant-1", entrantName: "One" },
        { seedId: "seed-2", seedNum: 2, entrantId: "entrant-2", entrantName: "Two" },
        { seedId: "placeholder", seedNum: 3, entrantId: null, entrantName: null },
      ],
    }],
    sets: [{
      setId: "set",
      fullRoundText: "Round 1",
      round: 1,
      phaseName: "Pools",
      phaseGroupName: "A",
      phaseOrder: 1,
      phaseGroupDisplayIdentifier: "A",
      state: 1,
      winnerId: null,
      entrant1Source: null,
      entrant2Source: null,
      slots: [],
    }],
  };
}

describe("initial phase seed shuffle", () => {
  it("shuffles player seeds while preserving placeholder positions and seed numbers", () => {
    const mapping = buildInitialPhaseSeedMapping(eventFixture(), () => 0);
    expect(mapping).toEqual([
      { seedId: "seed-1", seedNum: 2 },
      { seedId: "seed-2", seedNum: 1 },
      { seedId: "placeholder", seedNum: 3 },
    ]);
  });

  it("only allows shuffling before any set has progressed", () => {
    expect(canShuffleInitialPhaseSeeds(eventFixture())).toBe(true);
    const started = eventFixture();
    started.sets[0].state = 2;
    expect(canShuffleInitialPhaseSeeds(started)).toBe(false);
  });
});
