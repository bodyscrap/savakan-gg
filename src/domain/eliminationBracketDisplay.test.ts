import { describe, expect, it } from "vitest";
import type { PositionedRoundColumn } from "./bracketLayout";
import type { SetSnapshot } from "./bracketProgression";
import { buildEliminationBracketSections } from "./eliminationBracketDisplay";

const set: SetSnapshot = {
  setId: "set-1",
  fullRoundText: "Final",
  round: 1,
  phaseName: "Top 8",
  phaseGroupName: "A",
  phaseOrder: 1,
  phaseGroupDisplayIdentifier: "A",
  state: 3,
  winnerId: "a",
  entrant1Source: null,
  entrant2Source: null,
  slots: [
    { entrantId: "a", entrantName: "Alpha", seedId: null, seedNum: null, score: 2 },
    { entrantId: null, entrantName: "TBD", seedId: null, seedNum: null, score: null },
  ],
};

const column: PositionedRoundColumn = {
  key: "round-1",
  title: "Final",
  round: 1,
  positionedSets: [{ set, y: 24 }],
  height: 120,
  hidden: false,
};

describe("buildEliminationBracketSections", () => {
  it("projects positioned sets into card views with pending scores and labels", () => {
    const sections = buildEliminationBracketSections({
      sections: [{ key: "top-8", title: "Top 8", setCount: 1, columns: [column] }],
      resolvedEventSetsById: new Map(),
      pendingResultBySetId: new Map(),
      interimScoreDraftsBySetId: { "set-1": { a: "2" } },
      activeOverlay: { active: true, currentSetId: "set-1" },
      entrantMeta: [{ entrantId: "a", aliasName: "Alias Alpha" }],
      useAliasName: true,
      setDisplayCodeById: new Map([["set-1", "A1"]]),
      getTbdSourceLabel: (_set, index) => index === 1 ? "Loser of A1" : null,
      getSideLabel: (_setId, _entrantId, options) => options.fallbackBySlotIndex === 0 ? "1P" : "2P",
      getScoresForSet: () => ({ scores: { a: "2" }, isDq: false, winnerId: "a" }),
      formatScoreValue: String,
      isDqScoreValue: (value) => value === -1,
    });

    expect(sections[0]).toMatchObject({
      key: "top-8",
      columns: [{
        height: 120,
        cards: [{
          positionY: 24,
          displayCode: "A1",
          resultStatus: "inprogress",
          resultStatusLabel: "途中",
          isLiveOverlaySet: true,
          slots: [
            { sideLabel: "1P", entrantName: "Alias Alpha", gameWins: "2", scoreClass: "win" },
            { sideLabel: "2P", entrantName: "Loser of A1" },
          ],
        }],
      }],
    });
  });

  it("shows a Winners-side loser before a Losers-side winner in merge sets", () => {
    const mergeSet: SetSnapshot = {
      ...set,
      setId: "merge-set",
      entrant1Source: {
        typeId: "losers-source",
        condition: "winner",
        conditionString: null,
      },
      entrant2Source: {
        typeId: "winners-source",
        condition: "loser",
        conditionString: null,
      },
      slots: [
        { entrantId: "losers-winner", entrantName: "Losers winner", seedId: null, seedNum: null, score: null },
        { entrantId: "winners-loser", entrantName: "Winners loser", seedId: null, seedNum: null, score: null },
      ],
    };
    const mergeColumn: PositionedRoundColumn = {
      ...column,
      positionedSets: [{ set: mergeSet, y: 24 }],
    };
    const sections = buildEliminationBracketSections({
      sections: [{ key: "losers", title: "Losers", setCount: 1, columns: [mergeColumn] }],
      resolvedEventSetsById: new Map(),
      pendingResultBySetId: new Map(),
      interimScoreDraftsBySetId: {},
      activeOverlay: null,
      entrantMeta: [],
      useAliasName: false,
      setDisplayCodeById: new Map(),
      getTbdSourceLabel: () => null,
      getSideLabel: (_setId, entrantId) => entrantId === "winners-loser" ? "1P" : "2P",
      getScoresForSet: () => ({ scores: {}, isDq: false, winnerId: null }),
      formatScoreValue: String,
      isDqScoreValue: (value) => value === -1,
    });

    expect(sections[0]?.columns[0]?.cards[0]?.slots.map(({ entrantName }) => entrantName)).toEqual([
      "Winners loser",
      "Losers winner",
    ]);
  });
});
