import { describe, expect, it } from "vitest";
import type { PhaseGroupSeedSnapshot, RoundRobinStanding, SetSnapshot } from "./bracketProgression";
import {
  buildRoundRobinOriginAxisOrder,
  buildRoundRobinSeedIndexes,
  buildRoundRobinMatrixRows,
  buildRoundRobinProgressionSeeds,
  createRoundRobinSourceSlotResolver,
  findRoundRobinPhaseGroupSeed,
  indexRoundRobinSeedSlotsById,
  resolveRoundRobinOriginOrder,
  roundRobinPairKey,
  roundRobinPlaceholderId,
  type RoundRobinBoardData,
  buildRoundRobinSeedColumns,
} from "./roundRobinMatrixDisplay";

function makeSet(): SetSnapshot {
  return {
    setId: "set-a-b",
    fullRoundText: "Pool Round 1",
    round: 1,
    identifier: "1",
    winnerId: "a",
    slots: [
      { entrantId: "a", entrantName: "Alpha", seedId: null, seedNum: null, score: 2 },
      { entrantId: "b", entrantName: "Bravo", seedId: null, seedNum: null, score: 1 },
    ],
  } as unknown as SetSnapshot;
}

function makeStanding(entrantId: string, wins: number, losses: number): RoundRobinStanding {
  return {
    entrantId,
    entrantName: entrantId,
    isPlaceholder: false,
    wins,
    losses,
    gameWins: wins === 1 ? 2 : 1,
    gameLosses: losses === 1 ? 2 : 1,
    h2hPoints: 0,
    qualified: false,
  };
}

function makeBoardData(): RoundRobinBoardData {
  const set = makeSet();
  return {
    entrants: ["a", "b"],
    entrantNames: new Map([["a", "Alpha"], ["b", "Bravo"]]),
    entrantIdsByColumnKey: new Map([["a", "a"], ["b", "b"]]),
    entrantSeedIds: new Map(),
    entrantSeedNumbers: new Map(),
    sourceDiagnostics: [],
    setsByPair: new Map([[roundRobinPairKey("a", "b"), set]]),
    candidateSetCount: 1,
    twoSlotSetCount: 1,
    resolvedSetCount: 1,
    registeredSetCount: 1,
    unresolvedSetIds: [],
    unresolvedSetReasons: [],
    standings: [makeStanding("a", 1, 0), makeStanding("b", 0, 1)],
    qualifyingCount: 1,
    tieBreakRules: [],
  };
}

describe("buildRoundRobinMatrixRows", () => {
  it("builds diagonal cells, match results, and row summaries from board data", () => {
    const rows = buildRoundRobinMatrixRows({
      boardData: makeBoardData(),
      pendingResultBySetId: new Map(),
      interimScoreDraftsBySetId: {},
      obsOverlayState: null,
      setDisplayCodeById: new Map([["set-a-b", "A1"]]),
    });

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      entrantName: "Alpha",
      setSummary: "1-0",
      gameSummary: "2-1",
    });
    expect(rows[0].cells[0]).toEqual({ key: "a", kind: "diagonal" });
    expect(rows[0].cells[1]).toMatchObject({
      kind: "match",
      match: {
        className: expect.stringContaining("round-robin-match-win"),
        setLabel: "Set A1",
        rowGameScore: "2",
        columnGameScore: "1",
      },
    });
    expect(rows[1].cells[0]).toMatchObject({
      kind: "match",
      match: { className: expect.stringContaining("round-robin-match-loss") },
    });
  });
});

describe("buildRoundRobinSeedColumns", () => {
  it("builds fixed column labels, entrant mappings, and initial standings", () => {
    const seeds = [
      { seedId: "seed-1", seedNum: 1, entrantId: null, entrantName: null, placeholderName: null },
      { seedId: "seed-2", seedNum: 2, entrantId: "player-2", entrantName: " Player Two ", placeholderName: null },
      { seedId: "seed-3", seedNum: 3, entrantId: "player-2", entrantName: "Later Name", placeholderName: null },
    ] as PhaseGroupSeedSnapshot[];
    const seedSlot = {
      entrantId: null,
      entrantName: "TBD",
      seedId: "seed-1",
      seedNum: 1,
      seedPlaceholderName: "Advancer TBD",
      score: null,
    } as SetSnapshot["slots"][number];

    const columns = buildRoundRobinSeedColumns(seeds, new Map([["seed-1", seedSlot]]));

    expect(columns.fixedEntrants).toEqual(["seed:seed-1", "seed:seed-2", "seed:seed-3"]);
    expect(columns.entrantNames.get("seed:seed-1")).toBe("Advancer TBD");
    expect(columns.entrantNames.get("seed:seed-2")).toBe("Player Two");
    expect(columns.entrantIdsByColumnKey.get("seed:seed-1")).toBeNull();
    expect(columns.entrantSeedIds.get("player-2")).toBe("seed-3");
    expect(columns.entrantSeedNumbers.get("player-2")).toBe(3);
    expect(columns.standingByEntrantId.size).toBe(1);
    expect(columns.standingByEntrantId.get("player-2")).toMatchObject({
      entrantName: "Player Two",
      wins: 0,
      losses: 0,
      isPlaceholder: false,
    });
  });
});

describe("roundRobinPlaceholderId", () => {
  it("uses seed, source, and placeholder identity in priority order", () => {
    const slot = {
      entrantId: null,
      entrantName: "TBD",
      seedId: "seed-7",
      seedPlaceholderName: "Seed placeholder",
    } as SetSnapshot["slots"][number];
    const source = {
      typeId: "set-3",
      condition: " WINNER ",
      conditionString: null,
      placeholderName: "Source placeholder",
    };

    expect(roundRobinPlaceholderId(slot, source)).toBe("placeholder:seed-7");
    expect(roundRobinPlaceholderId({ ...slot, seedId: null }, source)).toBe("placeholder:set-3:winner");
    expect(roundRobinPlaceholderId({ ...slot, seedId: null }, null)).toBe("placeholder:Seed placeholder");
    expect(roundRobinPlaceholderId({ ...slot, seedId: null, seedPlaceholderName: null }, null))
      .toBe("placeholder:TBD");
  });
});

describe("resolveRoundRobinOriginOrder", () => {
  it("uses matching phase group and placement and selects the earliest origin order", () => {
    const phaseGroups = [
      {
        phaseOrder: 1,
        displayIdentifier: "A",
        progressionsOut: [
          { originPlacement: 2, originOrder: 5 },
          { originPlacement: 2, originOrder: 3 },
          { originPlacement: 1, originOrder: 1 },
        ],
      },
      {
        phaseOrder: 1,
        displayIdentifier: "B",
        progressionsOut: [{ originPlacement: 2, originOrder: 0 }],
      },
    ] as unknown as import("./bracketDisplay").PhaseGroupSnapshot[];

    expect(resolveRoundRobinOriginOrder(phaseGroups, 1, " A ", 2)).toBe(3);
    expect(resolveRoundRobinOriginOrder(phaseGroups, 1, "B", 2)).toBe(0);
    expect(resolveRoundRobinOriginOrder(phaseGroups, 2, "A", 2)).toBeNull();
    expect(resolveRoundRobinOriginOrder(phaseGroups, 1, "A", null)).toBeNull();
  });
});

describe("indexRoundRobinSeedSlotsById", () => {
  it("prefers the first slot with origin metadata for duplicate seed ids", () => {
    const slot = (
      seedId: string | null,
      seedOriginPlacement: number | null,
      seedOriginPhaseGroupDisplayIdentifier: string | null,
    ) => ({
      entrantId: null,
      entrantName: "TBD",
      seedId,
      seedNum: null,
      seedOriginPlacement,
      seedOriginPhaseGroupDisplayIdentifier,
      score: null,
    });
    const firstOriginSlot = slot("seed-1", 2, "Pool A");
    const index = indexRoundRobinSeedSlotsById([
      makeSet(),
      {
        ...makeSet(),
        setId: "set-without-origin",
        slots: [slot("seed-1", null, null), slot(null, 1, "Pool A")],
      } as SetSnapshot,
      {
        ...makeSet(),
        setId: "set-with-origin",
        slots: [firstOriginSlot],
      } as SetSnapshot,
      {
        ...makeSet(),
        setId: "later-origin",
        slots: [slot("seed-1", 1, "Pool B")],
      } as SetSnapshot,
    ]);

    expect(index.get("seed-1")).toBe(firstOriginSlot);
    expect(index.has("null")).toBe(false);
  });
});

describe("buildRoundRobinSeedIndexes", () => {
  it("builds lookup maps and orders seeded phase-group entries", () => {
    const seeds = [
      { seedId: "seed-2", seedNum: 2, entrantId: "player-2", entrantName: "Two" },
      { seedId: "seed-open", seedNum: null, entrantId: null, entrantName: null },
      { seedId: "seed-1", seedNum: 1, originPlacement: 3, entrantId: "player-1", entrantName: "One" },
      { seedId: "seed-2-later", seedNum: 4, entrantId: "player-2", entrantName: "Two later" },
      { seedId: "", seedNum: 0, originPlacement: 0, entrantId: "ignored", entrantName: "Ignored" },
    ] as PhaseGroupSeedSnapshot[];

    const indexes = buildRoundRobinSeedIndexes(seeds);

    expect(indexes.orderedSeeds.map((seed) => seed.seedId)).toEqual([
      "seed-1",
      "seed-2",
      "seed-2-later",
      "seed-open",
    ]);
    expect(indexes.byNum.get(2)?.seedId).toBe("seed-2");
    expect(indexes.byOriginPlacement.get(3)?.seedId).toBe("seed-1");
    expect(indexes.seedIdByEntrantId.get("player-2")).toBe("seed-2-later");
    expect(indexes.byId.get("seed-2")?.entrantName).toBe("Two");
  });

  it("resolves a slot seed ID before its numeric seed fallback", () => {
    const idSeed = { seedId: "seed-id", seedNum: 4, entrantId: "from-id" } as PhaseGroupSeedSnapshot;
    const numberSeed = { seedId: "seed-number", seedNum: 2, entrantId: "from-number" } as PhaseGroupSeedSnapshot;
    const indexes = buildRoundRobinSeedIndexes([idSeed, numberSeed]);

    expect(findRoundRobinPhaseGroupSeed(
      { entrantId: null, entrantName: "TBD", seedId: "seed-id", seedNum: 2, score: null },
      null,
      indexes,
    )).toBe(idSeed);
  });

  it("uses source placement when slot and source seed numbers do not resolve", () => {
    const placementSeed = {
      seedId: "seed-placement",
      seedNum: null,
      originPlacement: 3,
      entrantId: "from-placement",
    } as PhaseGroupSeedSnapshot;

    expect(findRoundRobinPhaseGroupSeed(
      { entrantId: null, entrantName: "TBD", seedId: null, seedNum: null, score: null },
      { sourceType: "seed", typeId: "unknown", condition: null, conditionString: null, placement: 3 },
      buildRoundRobinSeedIndexes([placementSeed]),
    )).toBe(placementSeed);
  });
});

describe("buildRoundRobinProgressionSeeds", () => {
  it("creates placeholder entrant metadata and keeps the first occurrence of a seed", () => {
    const sets = [
      {
        ...makeSet(),
        setId: "first-source",
        winnerProgressionSeedId: "shared-seed",
        winnerProgressionSeedPlaceholderName: "  Winner placeholder  ",
        winnerProgressionOriginPhaseGroupDisplayIdentifier: "Pool A",
        winnerProgressionOriginPhaseOrder: 1,
        winnerProgressionOriginPlacement: 2,
        loserProgressionSeedId: "loser-seed",
      },
      {
        ...makeSet(),
        setId: "later-source",
        winnerProgressionSeedId: "shared-seed",
        winnerProgressionSeedPlaceholderName: "Later name",
      },
      {
        ...makeSet(),
        setId: "fallback-source",
        winnerProgressionSeedId: "fallback-seed",
      },
    ];

    const seedsById = buildRoundRobinProgressionSeeds(sets);

    expect(seedsById.get("shared-seed")).toEqual({
      entrantId: "placeholder:shared-seed",
      entrantName: "Winner placeholder",
      isPlaceholder: true,
      seedId: "shared-seed",
      originPlacement: 2,
      originDisplayIdentifier: "Pool A",
    });
    expect(seedsById.get("fallback-seed")?.entrantName).toBe("fallback-seed");
    expect(seedsById.get("loser-seed")?.entrantId).toBe("placeholder:loser-seed");
  });
});

describe("createRoundRobinSourceSlotResolver", () => {
  it("resolves a winner through a nested source and retains origin metadata", () => {
    const sourceSet: SetSnapshot = {
      ...makeSet(),
      setId: "source-set",
      winnerId: "winner",
      slots: [
        {
          entrantId: "winner",
          entrantName: "Winner",
          seedId: "winner-seed",
          seedNum: 1,
          seedOriginPlacement: 2,
          seedOriginPhaseGroupDisplayIdentifier: "Pool A",
          score: null,
        },
        { entrantId: "loser", entrantName: "Loser", seedId: null, seedNum: null, score: null },
      ],
    };
    const intermediateSet: SetSnapshot = {
      ...makeSet(),
      setId: "intermediate-set",
      isIntermediate: true,
      entrant1Source: { sourceType: "set", typeId: "source-set", condition: "winner", conditionString: null },
      entrant2Source: null,
    };
    const seedIndexes = buildRoundRobinSeedIndexes([]);
    const resolveSourceSlot = createRoundRobinSourceSlotResolver({
      setById: new Map([[sourceSet.setId, sourceSet], [intermediateSet.setId, intermediateSet]]),
      phaseGroupSeedById: seedIndexes.byId,
      phaseGroupSeedByNum: seedIndexes.byNum,
      phaseGroupSeedByOriginPlacement: seedIndexes.byOriginPlacement,
      seedSlotById: new Map(),
      progressionSeedById: new Map(),
      resolveOriginOrder: (_phaseOrder, displayIdentifier, placement) =>
        displayIdentifier === "Pool A" && placement === 2 ? 5 : null,
    });

    expect(resolveSourceSlot(
      {
        sourceType: "set",
        typeId: "intermediate-set",
        condition: null,
        conditionString: null,
      },
      new Set(),
    )).toMatchObject({
      entrantId: "winner",
      entrantName: "Winner",
      originPlacement: 2,
      originDisplayIdentifier: "Pool A",
      originOrder: 5,
    });
  });
});

describe("buildRoundRobinOriginAxisOrder", () => {
  it("snake-seeds placements across sorted origin groups", () => {
    const placements = new Map([
      ["first-a", 1],
      ["first-b", 1],
      ["second-a", 2],
      ["second-b", 2],
    ]);
    const groups = new Map([
      ["first-a", "A"],
      ["first-b", "B"],
      ["second-a", "A"],
      ["second-b", "B"],
    ]);

    expect(buildRoundRobinOriginAxisOrder(placements, groups, ["B", "A"])).toEqual(new Map([
      ["first-a", 0],
      ["first-b", 1],
      ["second-a", 3],
      ["second-b", 2],
    ]));
  });

  it("places entrants with no matching origin group after known groups", () => {
    expect(buildRoundRobinOriginAxisOrder(
      new Map([["a", 1], ["b", 2]]),
      new Map([["a", "A"]]),
      ["A"],
    )).toEqual(new Map([["a", 0], ["b", 4]]));
  });
});