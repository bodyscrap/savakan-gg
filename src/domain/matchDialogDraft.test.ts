import { describe, expect, it } from "vitest";
import {
  buildMatchDialogPlayers,
  buildInitialMatchDialogDraft,
  resolveExistingMatchDialogDraft,
  resolveWorkspaceMatchDraftState,
} from "./matchDialogDraft";
import type { TournamentWorkspace } from "./tournamentWorkspaceRepository";
import type { SetSnapshot } from "./bracketProgression";

describe("match dialog draft selection", () => {
  const forced = { winnerId: "forced", scoreDrafts: { forced: "W" }, directWin: true };
  const pending = { winnerId: "pending", scoreDrafts: { pending: "2" } };
  const cached = { winnerId: "cached", scoreDrafts: { cached: "1" } };

  it("builds dialog player rows with TBD labels, side drafts, and score drafts", () => {
    const set = {
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
      slots: [
        { entrantId: "entrant-1", entrantName: "Player 1", seedId: null, seedNum: null, score: null },
        { entrantId: null, entrantName: "TBD", seedId: null, seedNum: null, score: null },
      ],
    } as unknown as SetSnapshot;

    const players = buildMatchDialogPlayers({
      set,
      displayBySide: false,
      sideDrafts: { "entrant-1": "2P" },
      scoreDrafts: { "entrant-1": "2" },
      directWinnerId: null,
      getSavedSide: () => "1P",
      getSideLabel: (_setId, _entrantId, options) => options.fallbackBySlotIndex === 0 ? "1P" : "-",
      getTbdSourceLabel: (_set, slotIndex) => slotIndex === 1 ? "winner of A" : null,
    });

    expect(players.map(({ entrantName, side, scoreValue, otherEntrantId }) => ({
      entrantName,
      side,
      scoreValue,
      otherEntrantId,
    }))).toEqual([
      { entrantName: "Player 1", side: "2P", scoreValue: "2", otherEntrantId: null },
      { entrantName: "winner of A", side: "", scoreValue: "", otherEntrantId: "entrant-1" },
    ]);
  });

  it("uses the applied player alias in the dialog while preserving the original slot", () => {
    const set = {
      setId: "set-alias",
      slots: [
        { entrantId: "entrant-1", entrantName: "Player 1", score: null },
        { entrantId: "entrant-2", entrantName: "Player 2", score: null },
      ],
    } as unknown as SetSnapshot;

    const players = buildMatchDialogPlayers({
      set,
      displayBySide: false,
      sideDrafts: {},
      scoreDrafts: {},
      directWinnerId: null,
      getSavedSide: () => "",
      getSideLabel: () => "",
      getTbdSourceLabel: () => null,
      aliasNamesByEntrantId: { "entrant-1": "Alias 1" },
      useAliasName: true,
    });

    expect(players[0].entrantName).toBe("Alias 1");
    expect(players[0].slot.entrantName).toBe("Player 1");
    expect(players[1].entrantName).toBe("Player 2");
  });

  it("prioritizes forced, then pending, then cached drafts", () => {
    expect(resolveExistingMatchDialogDraft(forced, pending, cached, ["forced", "pending", "cached"])).toEqual({
      draftState: forced,
      shouldPersist: true,
    });
    expect(resolveExistingMatchDialogDraft(undefined, pending, cached, ["pending", "cached"])).toEqual({
      draftState: pending,
      shouldPersist: true,
    });
    expect(resolveExistingMatchDialogDraft(undefined, undefined, cached, ["cached"])).toEqual({
      draftState: cached,
      shouldPersist: false,
    });
    expect(resolveExistingMatchDialogDraft(undefined, undefined, undefined, [])).toBeNull();
  });

  it("does not restore a draft that belongs to the previous set entrants", () => {
    const stale = { winnerId: "old-entrant", scoreDrafts: { "old-entrant": "2" } };

    expect(resolveExistingMatchDialogDraft(undefined, stale, stale, ["player-11", "player-15"])).toBeNull();
  });

  it("prefers displayed snapshot scores and otherwise initializes from the set", () => {
    const defaults = { playerA: "0", playerB: "0" };
    expect(buildInitialMatchDialogDraft({ playerA: "2", playerB: "1" }, defaults)).toEqual({
      winnerId: "",
      scoreDrafts: { playerA: "2", playerB: "1" },
      directWin: false,
    });
    expect(buildInitialMatchDialogDraft({}, defaults).scoreDrafts).toBe(defaults);
  });

  it("restores refreshed score, winner, and saved side drafts for the active match", () => {
    const workspace = {
      snapshot: {
        tournamentId: "tournament-1",
        slug: "tournament/example",
        name: "Example",
        updatedAt: "2026-01-01T00:00:00Z",
        events: [{
          eventId: "event-1",
          name: "Event",
          sets: [{
            setId: "set-1",
            fullRoundText: "Round 1",
            round: 1,
            phaseName: "Pools",
            phaseGroupName: "Pool A",
            phaseOrder: 1,
            phaseGroupDisplayIdentifier: "A",
            state: 3,
            winnerId: "entrant-1",
            entrant1Source: null,
            entrant2Source: null,
            slots: [
              { entrantId: "entrant-1", entrantName: "Player 1", seedId: null, seedNum: null, score: null },
              { entrantId: "entrant-2", entrantName: "Player 2", seedId: null, seedNum: null, score: null },
            ],
          }],
        }],
      },
      localMeta: {
        tournamentId: "tournament-1",
        slug: "tournament/example",
        events: [],
        pendingSetResults: [{
          eventId: "event-1",
          eventName: "Event",
          setId: "set-1",
          winnerId: "entrant-1",
          scoreCsv: "2-0",
          directWin: false,
          confirmed: true,
          slotScores: [
            { entrantId: "entrant-1", score: 2 },
            { entrantId: "entrant-2", score: 0 },
          ],
          recordedAt: "2026-01-01T00:00:00Z",
        }],
        updatedAt: "2026-01-01T00:00:00Z",
      },
    } satisfies TournamentWorkspace;

    expect(resolveWorkspaceMatchDraftState(
      workspace,
      "event-1",
      "set-1",
      (_setId, entrantId) => entrantId === "entrant-1" ? "1P" : "2P",
    )).toEqual({
      scoreDrafts: { "entrant-1": "2", "entrant-2": "0" },
      directWinnerId: null,
      sideDrafts: { "entrant-1": "1P", "entrant-2": "2P" },
    });
  });
});