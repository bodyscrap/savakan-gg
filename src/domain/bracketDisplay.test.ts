import { describe, expect, it } from "vitest";
import {
  buildBracketSections,
  buildRoundColumns,
  buildSetDisplayCodeById,
  getBracketVerticalLayoutScale,
  scaleBracketSectionsForZoom,
  buildTbdSourceLabelBySlotKey,
  formatAlphabetSequence,
  formatScoreValue,
  getDisplaySlotsForSet,
  normalizeSourceText,
  pickPairSourceIds,
  resolveSelectedPhasePoolGroup,
  resolveEntrantDisplayName,
  resolveTbdSourceLabel,
  selectPhaseScopedPoolGroups,
} from "./bracketDisplay";
import { buildPositionedRoundColumns } from "./bracketLayout";
import type { BracketSectionForView, PhasePoolGroup } from "./bracketDisplay";
import type { SetSnapshot } from "./bracketProgression";

describe("bracket source labels", () => {
  it("uses a non-empty alias only when alias display is enabled", () => {
    expect(resolveEntrantDisplayName("Player", "Alias", true)).toBe("Alias");
    expect(resolveEntrantDisplayName("Player", "Alias", false)).toBe("Player");
    expect(resolveEntrantDisplayName("Player", "", true)).toBe("Player");
    expect(resolveEntrantDisplayName("Player", "  ", true)).toBe("Player");
    expect(resolveEntrantDisplayName("Player", " Alias ", true)).toBe("Alias");
  });

  it("formats bracket scores without unnecessary decimal places", () => {
    expect(formatScoreValue(2)).toBe("2");
    expect(formatScoreValue(1.5)).toBe("1.5");
  });

  it("formats alphabetic set labels beyond Z", () => {
    expect(formatAlphabetSequence(0)).toBe("A");
    expect(formatAlphabetSequence(25)).toBe("Z");
    expect(formatAlphabetSequence(26)).toBe("AA");
  });

  it("assigns display codes in bracket order and reserves a GF Reset code", () => {
    const set = (setId: string, fullRoundText: string, identifier?: string) => ({
      setId,
      fullRoundText,
      identifier,
    } as unknown as SetSnapshot);
    const sections = [{
      key: "winners",
      title: "Winners",
      setCount: 2,
      columns: [{
        key: "winners-final",
        title: "Final",
        positionedSets: [
          { set: set("gf", "Grand Final"), y: 10 },
          { set: set("w1", "Round 1"), y: 30 },
        ],
        height: 100,
        hidden: false,
      }],
    }, {
      key: "losers",
      title: "Losers",
      setCount: 1,
      columns: [{
        key: "losers-final",
        title: "Round 1",
        positionedSets: [{ set: set("l1", "Losers Round 1"), y: 10 }],
        height: 100,
        hidden: false,
      }],
    }] as unknown as BracketSectionForView[];

    expect([...buildSetDisplayCodeById(sections)]).toEqual([
      ["gf", "A"],
      ["w1", "B"],
      ["l1", "D"],
    ]);
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

  it("builds winner and loser source labels from adjacent bracket columns", () => {
    const set = (setId: string, fullRoundText = "Round 1") => ({
      setId,
      fullRoundText,
    } as unknown as SetSnapshot);
    const labels = buildTbdSourceLabelBySlotKey([
      {
        key: "winners",
        title: "Winners",
        setCount: 3,
        columns: [
          { key: "winners-1", title: "Round 1", round: 1, seq: 1, sets: [set("w1"), set("w2")] },
          { key: "winners-2", title: "Final", round: 2, seq: 2, sets: [set("w3", "Winners Final")] },
        ],
      },
      {
        key: "losers",
        title: "Losers",
        setCount: 1,
        columns: [
          { key: "losers-1", title: "Round 1", round: -1, seq: 1, sets: [set("l1")] },
        ],
      },
    ], new Map([["w1", "A"], ["w2", "B"], ["w3", "C"]]));

    expect(labels.get("w3:0")).toBe("winner of A");
    expect(labels.get("w3:1")).toBe("winner of B");
    expect(labels.get("l1:0")).toBe("loser of A");
    expect(labels.get("l1:1")).toBe("loser of B");
  });

  it("resolves a TBD slot to the named winner of its source set", () => {
    const sourceSet = {
      setId: "source",
      winnerId: "entrant-a",
      slots: [
        { entrantId: "entrant-a", entrantName: "Alpha" },
        { entrantId: "entrant-b", entrantName: "Bravo" },
      ],
    } as unknown as SetSnapshot;
    const targetSet = {
      setId: "target",
      entrant1Source: { typeId: "source", resolvedSetId: "source", condition: "winner" },
      slots: [{ entrantId: null, entrantName: "TBD" }],
    } as unknown as SetSnapshot;

    expect(resolveTbdSourceLabel(
      targetSet,
      0,
      targetSet.slots[0],
      { eventId: "event", name: "Event", sets: [sourceSet, targetSet] },
      new Map([ ["source", "A"] ]),
      new Map(),
    )).toBe("Alpha");
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

describe("double-elimination bracket lane order", () => {
  it("keeps a 31-player bracket's 16 first-round sets in numeric ID order", () => {
    const firstRoundSets = Array.from({ length: 16 }, (_, index) => ({
      setId: String(index + 1),
      fullRoundText: "Winners Round 1",
      round: 1,
      slots: [],
    } as unknown as SetSnapshot));
    const columns = buildPositionedRoundColumns(
      buildRoundColumns(firstRoundSets),
      "winners",
    );

    expect(columns[0]?.positionedSets.map(({ set }) => set.setId)).toEqual(
      Array.from({ length: 16 }, (_, index) => String(index + 1)),
    );
    expect(columns[0]?.positionedSets.map(({ y }) => y)).toEqual(
      Array.from({ length: 16 }, (_, index) => 10 + index * 106),
    );
  });

  it("hides BYE sets and positions the fullest visible round in each bracket", () => {
    const createSet = (
      setId: string,
      round: number,
      isBye = false,
    ): SetSnapshot => ({
      setId,
      fullRoundText: round < 0 ? `Losers Round ${Math.abs(round)}` : `Winners Round ${round}`,
      round,
      phaseName: "Bracket",
      phaseGroupName: "A",
      phaseOrder: 1,
      phaseGroupDisplayIdentifier: "A",
      isBye,
      state: 1,
      winnerId: null,
      entrant1Source: null,
      entrant2Source: null,
      slots: [],
    });
    const sets = [
      ...Array.from({ length: 16 }, (_, index) => createSet(`w1-${index}`, 1, index !== 0)),
      ...Array.from({ length: 8 }, (_, index) => createSet(`w2-${index}`, 2)),
      ...Array.from({ length: 8 }, (_, index) => createSet(`l1-${index}`, -1, index === 0)),
      ...Array.from({ length: 8 }, (_, index) => createSet(`l2-${index}`, -2)),
    ];
    const group: PhasePoolGroup = {
      key: "bracket-a",
      phaseGroupId: "phase-group-a",
      phaseName: "Bracket",
      phaseGroupName: "A",
      bracketType: "DOUBLE_ELIMINATION",
      phaseOrder: 1,
      phaseGroupDisplayIdentifier: "A",
      progressionsOut: [],
      seedMap: null,
      seedOrder: [],
      seeds: [],
      sets,
      columns: [],
    };

    const sections = buildBracketSections(group);
    const winners = sections.find((section) => section.key === "winners");
    const losers = sections.find((section) => section.key === "losers");
    expect(winners?.columns.map((column) => column.sets.length)).toEqual([1, 8]);
    expect(losers?.columns.map((column) => column.sets.length)).toEqual([8, 7]);

    for (const section of [winners, losers]) {
      const columns = buildPositionedRoundColumns(section!.columns, section!.key);
      const fullestColumn = columns.reduce((fullest, column) => (
        column.positionedSets.length > fullest.positionedSets.length ? column : fullest
      ));
      expect(fullestColumn.round).toBe(section!.key === "winners" ? 2 : -2);
      expect(fullestColumn.positionedSets.map(({ y }) => y)).toEqual(
        Array.from({ length: fullestColumn.positionedSets.length }, (_, index) => 10 + index * 106),
      );
      for (const column of columns) {
        const positions = column.positionedSets.map(({ y }) => y).sort((left, right) => left - right);
        expect(positions.every(
          (position, index) => index === 0 || position - positions[index - 1] >= 106,
        )).toBe(true);
      }
      expect(columns.flatMap((column) => column.positionedSets).some(
        ({ set }) => set.isBye,
      )).toBe(false);
    }
  });

  it("uses Losers Round 2 as the anchor when it ties for the maximum set count", () => {
    const sets = [
      ...Array.from({ length: 8 }, (_, index) => ({
        setId: `l1-${index}`,
        fullRoundText: "Losers Round 1",
        round: -1,
        isBye: false,
        slots: [],
      } as unknown as SetSnapshot)),
      ...Array.from({ length: 8 }, (_, index) => ({
        setId: `l2-${index}`,
        fullRoundText: "Losers Round 2",
        round: -2,
        isBye: false,
        slots: [],
      } as unknown as SetSnapshot)),
    ];

    const columns = buildPositionedRoundColumns(buildRoundColumns(sets), "losers");
    const roundTwo = columns.find((column) => column.round === -2);

    expect(roundTwo?.positionedSets.map(({ y }) => y)).toEqual(
      Array.from({ length: 8 }, (_, index) => 10 + index * 106),
    );
  });

  it("anchors on the fullest Losers round without reversing source progression", () => {
    const createSet = (
      setId: string,
      round: number,
      sourceSetIds: string[] = [],
    ): SetSnapshot => ({
      setId,
      fullRoundText: `Losers Round ${Math.abs(round)}`,
      round,
      phaseName: "Bracket",
      phaseGroupName: "A",
      phaseOrder: 1,
      phaseGroupDisplayIdentifier: "A",
      state: 1,
      winnerId: null,
      entrant1Source: sourceSetIds[0]
        ? {
          typeId: sourceSetIds[0],
          resolvedSetId: sourceSetIds[0],
          condition: "winner",
          conditionString: null,
        }
        : null,
      entrant2Source: sourceSetIds[1]
        ? {
          typeId: sourceSetIds[1],
          resolvedSetId: sourceSetIds[1],
          condition: "winner",
          conditionString: null,
        }
        : null,
      slots: [],
    });
    const columns = buildPositionedRoundColumns(
      buildRoundColumns([
        createSet("AV-source-1", -1),
        createSet("AV-source-2", -1),
        createSet("round-two-1", -2, ["AV-source-1"]),
        createSet("round-two-2", -2),
        createSet("round-two-3", -2, ["AV-source-2"]),
        createSet("round-three-final", -3, ["round-two-1", "round-two-3"]),
      ]),
      "losers",
    );
    const roundOne = columns.find((column) => column.round === -1);
    const roundTwo = columns.find((column) => column.round === -2);
    const roundThree = columns.find((column) => column.round === -3);
    const yFor = (column: typeof columns[number] | undefined, setId: string) => (
      column?.positionedSets.find(({ set }) => set.setId === setId)?.y
    );

    expect(columns.map((column) => column.round)).toEqual([-3, -2, -1]);
    expect(roundTwo?.positionedSets.map(({ y }) => y)).toEqual([10, 116, 222]);
    expect(yFor(roundOne, "AV-source-1")).toBe(yFor(roundTwo, "round-two-1"));
    expect(yFor(roundOne, "AV-source-2")).toBe(yFor(roundTwo, "round-two-3"));
    expect(yFor(roundThree, "round-three-final")).toBe(116);
  });
});

describe("phase and pool selection", () => {
  const groups = [
    { key: "phase-a-pool-1", phaseName: "Phase A" },
    { key: "phase-b-pool-1", phaseName: "Phase B" },
    { key: "phase-a-pool-2", phaseName: "Phase A" },
  ] as PhasePoolGroup[];

  it("uses the first group phase when no phase is selected and returns no groups for an unknown phase", () => {
    expect(selectPhaseScopedPoolGroups(groups, "").map((group) => group.key)).toEqual([
      "phase-a-pool-1",
      "phase-a-pool-2",
    ]);
    expect(selectPhaseScopedPoolGroups(groups, "Unknown")).toEqual([]);
    expect(selectPhaseScopedPoolGroups([], "")).toEqual([]);
  });

  it("uses the first phase group when the selected pool key is empty or stale", () => {
    const phaseGroups = selectPhaseScopedPoolGroups(groups, "Phase A");
    expect(resolveSelectedPhasePoolGroup(phaseGroups, "")).toBe(phaseGroups[0]);
    expect(resolveSelectedPhasePoolGroup(phaseGroups, "stale-key")).toBe(phaseGroups[0]);
    expect(resolveSelectedPhasePoolGroup(phaseGroups, "phase-a-pool-2")).toBe(phaseGroups[1]);
    expect(resolveSelectedPhasePoolGroup([], "phase-a-pool-1")).toBeNull();
  });
});

describe("bracket zoom layout", () => {
  it("uses the existing vertical scale thresholds", () => {
    expect(getBracketVerticalLayoutScale(0.9)).toBe(1);
    expect(getBracketVerticalLayoutScale(0.89)).toBe(0.72);
    expect(getBracketVerticalLayoutScale(0.6)).toBe(0.72);
    expect(getBracketVerticalLayoutScale(0.59)).toBe(0.58);
  });

  it("scales column height and set positions without mutating sections", () => {
    const sections: BracketSectionForView[] = [{
      key: "winners",
      title: "Winners",
      setCount: 1,
      columns: [{
        key: "round-1",
        title: "Round 1",
        round: 1,
        positionedSets: [{ set: { setId: "set-1" } as SetSnapshot, y: 20 }],
        height: 100,
        hidden: false,
      }],
    }];

    const scaled = scaleBracketSectionsForZoom(sections, 0.5);

    expect(scaled[0].columns[0]).toMatchObject({
      height: 50,
      positionedSets: [{ y: 10 }],
    });
    expect(sections[0].columns[0]).toMatchObject({
      height: 100,
      positionedSets: [{ y: 20 }],
    });
  });
});