import { describe, expect, it } from "vitest";
import type { LocalSetResultMeta } from "./useTournamentWorkspace";
import type { SetSnapshot } from "./bracketProgression";
import {
  applyScoreDraftWithOpponentDefault,
  buildDraftStateFromPending,
  buildScoreDraftsFromResult,
  buildSlotScoresForSave,
  isDqScoreCsvText,
  parseDraftScoreValue,
  parseScoreCsvText,
  resolveWinnerIdFromDrafts,
  toIntegerScore,
} from "./setResultDrafts";

function createSet(slots = [
  { entrantId: "red", entrantName: "Red", seedId: null, seedNum: null, score: null },
  { entrantId: "blue", entrantName: "Blue", seedId: null, seedNum: null, score: null },
]): SetSnapshot {
  return {
    setId: "set-1",
    fullRoundText: "Round 1",
    round: 1,
    phaseName: "Main",
    phaseGroupName: "Pool A",
    phaseOrder: 1,
    phaseGroupDisplayIdentifier: "A",
    state: 2,
    winnerId: null,
    entrant1Source: null,
    entrant2Source: null,
    slots,
  };
}

function createResult(overrides: Partial<LocalSetResultMeta> = {}): LocalSetResultMeta {
  return {
    eventId: "event-1",
    eventName: "Event",
    setId: "set-1",
    winnerId: "red",
    scoreCsv: "2-0",
    recordedAt: "2026-09-30T00:00:00Z",
    ...overrides,
  };
}

describe("score parsing", () => {
  it("accepts integer drafts and the DQ marker only", () => {
    expect(parseDraftScoreValue(" 3 ")).toBe(3);
    expect(parseDraftScoreValue("-")).toBe(-1);
    expect(parseDraftScoreValue("")).toBeNull();
    expect(parseDraftScoreValue("1.5")).toBeNull();
    expect(parseDraftScoreValue("Infinity")).toBeNull();
  });

  it("parses legacy score strings and identifies DQ strings", () => {
    expect(parseScoreCsvText(" 3 - 1 ")).toEqual({ winnerWins: 3, loserWins: 1 });
    expect(parseScoreCsvText("3-1-0")).toBeNull();
    expect(parseScoreCsvText("2-NaN")).toBeNull();
    expect(isDqScoreCsvText(" DQ ")).toBe(true);
    expect(isDqScoreCsvText("2-DQ")).toBe(true);
    expect(isDqScoreCsvText("DQ-2")).toBe(false);
  });

  it("accepts near-integer snapshot scores but rejects fractional scores", () => {
    expect(toIntegerScore(2.0000001)).toBe(2);
    expect(toIntegerScore(2.01)).toBeNull();
    expect(toIntegerScore(null)).toBeNull();
  });
});

describe("result drafts", () => {
  it("resolves the higher score and leaves ties or incomplete scores unresolved", () => {
    const set = createSet();
    expect(resolveWinnerIdFromDrafts(set, { red: "2", blue: "1" })).toBe("red");
    expect(resolveWinnerIdFromDrafts(set, { red: "2", blue: "2" })).toBe("");
    expect(resolveWinnerIdFromDrafts(set, { red: "2" })).toBe("");
  });

  it("resolves DQ to the non-DQ entrant", () => {
    expect(resolveWinnerIdFromDrafts(createSet(), { red: "-", blue: "0" })).toBe("blue");
  });

  it("restores legacy score, DQ, and direct-win drafts", () => {
    const set = createSet();
    expect(buildScoreDraftsFromResult(set, createResult())).toEqual({ red: "2", blue: "0" });
    expect(buildScoreDraftsFromResult(set, createResult({ scoreCsv: "DQ", winnerId: "blue" })))
      .toEqual({ red: "-1", blue: "0" });
    expect(buildDraftStateFromPending(set, createResult({ directWin: true }))).toEqual({
      winnerId: "red",
      scoreDrafts: { red: "W", blue: "L" },
      directWin: true,
    });
  });

  it("uses slot scores when available and defaults one empty opponent score to zero", () => {
    const set = createSet();
    expect(buildScoreDraftsFromResult(set, createResult({
      slotScores: [{ entrantId: "red", score: 3 }, { entrantId: "blue", score: 1 }],
    }))).toEqual({ red: "3", blue: "1" });
    expect(buildSlotScoresForSave(set, { red: "3", blue: "" })).toEqual([
      { entrantId: "red", score: 3 },
      { entrantId: "blue", score: 0 },
    ]);
  });

  it("rejects incomplete results that cannot be safely defaulted", () => {
    expect(() => buildSlotScoresForSave(createSet(), { red: "", blue: "" }))
      .toThrow("スコアが未入力です: Red");
    expect(() => buildSlotScoresForSave(createSet([
      { entrantId: "red", entrantName: "Red", seedId: null, seedNum: null, score: null },
    ]), { red: "1" })).toThrow("結果入力には少なくとも2人のプレイヤーが必要です。");
  });

  it("defaults the opponent only after a valid score and does not mutate the current draft", () => {
    const current = { red: "", blue: "" };
    expect(applyScoreDraftWithOpponentDefault(createSet(), current, "red", "2"))
      .toEqual({ red: "2", blue: "0" });
    expect(applyScoreDraftWithOpponentDefault(createSet(), current, "red", "-")).toEqual({ red: "-", blue: "" });
    expect(current).toEqual({ red: "", blue: "" });
  });
});