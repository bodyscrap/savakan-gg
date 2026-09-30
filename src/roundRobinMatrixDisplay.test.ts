import { describe, expect, it } from "vitest";
import type { RoundRobinStanding, SetSnapshot } from "./bracketProgression";
import {
  buildRoundRobinMatrixRows,
  roundRobinPairKey,
  roundRobinPlaceholderId,
  type RoundRobinBoardData,
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