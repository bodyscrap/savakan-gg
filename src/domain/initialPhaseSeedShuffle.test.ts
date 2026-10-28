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

  it("places higher skill tiers in stronger seed positions", () => {
    const event = eventFixture();
    expect(buildInitialPhaseSeedMapping(event, () => 0.999, false, new Map([
      ["entrant-1", 1],
      ["entrant-2", 5],
    ]))).toEqual([
      { seedId: "seed-1", seedNum: 2 },
      { seedId: "seed-2", seedNum: 1 },
      { seedId: "placeholder", seedNum: 3 },
    ]);
  });

  it("randomizes entrants within the same skill tier", () => {
    expect(buildInitialPhaseSeedMapping(eventFixture(), () => 0, false, new Map([
      ["entrant-1", 3],
      ["entrant-2", 3],
    ]))).toEqual([
      { seedId: "seed-1", seedNum: 2 },
      { seedId: "seed-2", seedNum: 1 },
      { seedId: "placeholder", seedNum: 3 },
    ]);
  });

  it("tracks destination pools when local pools reuse seed numbers", () => {
    const event = eventFixture();
    const [firstGroup] = event.phaseGroups ?? [];
    event.phaseGroups = [
      {
        ...firstGroup,
        phaseGroupId: "pool-a",
        seeds: [
          { seedId: "a1", seedNum: 1, entrantId: "entrant-a1", entrantName: "A1" },
          { seedId: "a2", seedNum: 2, entrantId: "entrant-a2", entrantName: "A2" },
        ],
      },
      {
        ...firstGroup,
        phaseGroupId: "pool-b",
        seeds: [
          { seedId: "b1", seedNum: 1, entrantId: "entrant-b1", entrantName: "B1" },
          { seedId: "b2", seedNum: 2, entrantId: "entrant-b2", entrantName: "B2" },
        ],
      },
    ];

    expect(buildInitialPhaseSeedMapping(event, () => 0, true)).toEqual([
      { seedId: "a1", seedNum: 2, phaseGroupId: "pool-b" },
      { seedId: "a2", seedNum: 1, phaseGroupId: "pool-a" },
      { seedId: "b1", seedNum: 1, phaseGroupId: "pool-b" },
      { seedId: "b2", seedNum: 2, phaseGroupId: "pool-a" },
    ]);
  });

  it("only allows shuffling before any set has progressed", () => {
    expect(canShuffleInitialPhaseSeeds(eventFixture())).toBe(true);
    const started = eventFixture();
    started.sets[0].state = 2;
    expect(canShuffleInitialPhaseSeeds(started)).toBe(false);
  });

  it("allows automatic local byes without changing start.gg eligibility", () => {
    const event = eventFixture();
    event.sets.push({ ...event.sets[0], setId: "bye", isBye: true, state: 3, winnerId: "entrant-1" });
    expect(canShuffleInitialPhaseSeeds(event)).toBe(false);
    expect(canShuffleInitialPhaseSeeds(event, true)).toBe(true);
    event.sets[0].state = 2;
    expect(canShuffleInitialPhaseSeeds(event, true)).toBe(true);
    event.sets[0].slots = [{ entrantId: "entrant-1", entrantName: "One", seedId: "seed-1", seedNum: 1, score: 0 }];
    expect(canShuffleInitialPhaseSeeds(event, true)).toBe(false);
    event.sets[0].state = 3;
    event.sets[0].winnerId = "entrant-1";
    expect(canShuffleInitialPhaseSeeds(event, true)).toBe(false);
  });
});
