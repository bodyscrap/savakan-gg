import { describe, expect, it } from "vitest";
import {
  buildSetDisplayCodeById,
  buildTbdSourceLabelBySlotKey,
  formatAlphabetSequence,
  getDisplaySlotsForSet,
  normalizeSourceText,
  pickPairSourceIds,
  resolveSelectedPhasePoolGroup,
  resolveTbdSourceLabel,
  selectPhaseScopedPoolGroups,
} from "./bracketDisplay";
import type { BracketSectionForView, PhasePoolGroup } from "./bracketDisplay";
import type { SetSnapshot } from "./bracketProgression";

describe("bracket source labels", () => {
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