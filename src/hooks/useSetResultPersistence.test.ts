import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EventSnapshot } from "../domain/bracketDisplay";
import type { SetSnapshot } from "../domain/bracketProgression";
import { useSetResultPersistence } from "./useSetResultPersistence";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

describe("set result overlay synchronization", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue({});
  });

  it("passes the saved player sides to overlay sync when scores are empty", async () => {
    const event = { eventId: "event-1", name: "Event", sets: [] } as EventSnapshot;
    const set = { setId: "set-1", slots: [] } as unknown as SetSnapshot;
    const savedSides = { player1: "2P" as const, player2: "1P" as const };
    const syncOverlayScores = vi.fn().mockResolvedValue(undefined);
    const persistence = useSetResultPersistence({
      setWorkspace: vi.fn(),
      setBusy: vi.fn(),
      setError: vi.fn(),
      setMessage: vi.fn(),
      saveSides: vi.fn().mockResolvedValue(savedSides),
      buildSlotScores: () => [],
      resolveWinnerId: () => "",
      syncOverlayScores,
      saveSetDraft: vi.fn(),
      removeInterimDraft: vi.fn(),
      removeDraftsForSet: vi.fn(),
      clearAllDrafts: vi.fn(),
      restoreSetDraftState: vi.fn(),
      refreshSnapshotEvents: vi.fn().mockResolvedValue(undefined),
      closeMatchDialog: vi.fn(),
    });

    await persistence.saveLocalResult({
      slug: "tournament/example",
      event,
      setId: set.setId,
      set,
      confirmed: false,
      directWinnerId: null,
      scoreDrafts: {},
      sideDrafts: {},
    });

    expect(syncOverlayScores).toHaveBeenCalledWith(set, [], savedSides, { winnerId: null, completed: false });
  });

  it("confirms tied scores as a First to N wins draw without reporting a winner", async () => {
    const event = {
      eventId: "event-1",
      name: "Event",
      phaseGroups: [{
        phaseGroupId: "group-1",
        phaseName: "Final",
        phaseOrder: 1,
        displayIdentifier: "A",
        bracketType: "FIRST_TO_N_WINS",
        firstToNWins: {
          phaseSetCount: 3,
          winsRequired: 2,
          playerOneEntrantId: "player-1",
          playAllMatches: false,
          drawCountsAsWin: false,
          suddenDeath: true,
        },
      }],
      sets: [],
    } as EventSnapshot;
    const set = {
      setId: "set-1",
      phaseGroupId: "group-1",
      slots: [
        { entrantId: "player-1", entrantName: "Player 1", score: null },
        { entrantId: "player-2", entrantName: "Player 2", score: null },
      ],
    } as unknown as SetSnapshot;
    const onConfirmedResult = vi.fn().mockResolvedValue(false);
    const syncOverlayScores = vi.fn().mockResolvedValue(undefined);
    const persistence = useSetResultPersistence({
      setWorkspace: vi.fn(),
      setBusy: vi.fn(),
      setError: vi.fn(),
      setMessage: vi.fn(),
      saveSides: vi.fn().mockResolvedValue(undefined),
      buildSlotScores: () => [
        { entrantId: "player-1", score: 2 },
        { entrantId: "player-2", score: 2 },
      ],
      resolveWinnerId: () => "",
      syncOverlayScores,
      saveSetDraft: vi.fn(),
      removeInterimDraft: vi.fn(),
      removeDraftsForSet: vi.fn(),
      clearAllDrafts: vi.fn(),
      restoreSetDraftState: vi.fn(),
      refreshSnapshotEvents: vi.fn().mockResolvedValue(undefined),
      closeMatchDialog: vi.fn(),
      onConfirmedResult,
    });

    await persistence.saveLocalResult({
      slug: "tournament/example",
      event,
      setId: set.setId,
      set,
      confirmed: true,
      directWinnerId: null,
      scoreDrafts: {},
      sideDrafts: {},
    });

    expect(invokeMock).toHaveBeenCalledWith("save_local_set_result", {
      input: expect.objectContaining({
        setId: set.setId,
        winnerId: "",
        confirmed: true,
      }),
    });
    expect(onConfirmedResult).not.toHaveBeenCalled();
    expect(syncOverlayScores).toHaveBeenCalledWith(set, [
      { entrantId: "player-1", score: 2 },
      { entrantId: "player-2", score: 2 },
    ], {}, { winnerId: null, completed: true, confirmed: true });
  });

  it("confirms a direct First to N wins draw without scores", async () => {
    const event = {
      eventId: "event-1",
      name: "Event",
      phaseGroups: [{
        phaseGroupId: "group-1",
        phaseName: "Final",
        phaseOrder: 1,
        displayIdentifier: "A",
        bracketType: "FIRST_TO_N_WINS",
        firstToNWins: {
          phaseSetCount: 3,
          winsRequired: 2,
          playerOneEntrantId: "player-1",
          playAllMatches: false,
          drawCountsAsWin: false,
          suddenDeath: true,
        },
      }],
      sets: [],
    } as EventSnapshot;
    const set = {
      setId: "set-1",
      phaseGroupId: "group-1",
      slots: [
        { entrantId: "player-1", entrantName: "Player 1", score: null },
        { entrantId: "player-2", entrantName: "Player 2", score: null },
      ],
    } as unknown as SetSnapshot;
    const saveSetDraft = vi.fn();
    const onConfirmedResult = vi.fn().mockResolvedValue(false);
    const closeMatchDialog = vi.fn();
    const persistence = useSetResultPersistence({
      setWorkspace: vi.fn(),
      setBusy: vi.fn(),
      setError: vi.fn(),
      setMessage: vi.fn(),
      saveSides: vi.fn().mockResolvedValue(undefined),
      buildSlotScores: vi.fn(() => []),
      resolveWinnerId: vi.fn(() => ""),
      syncOverlayScores: vi.fn().mockResolvedValue(undefined),
      saveSetDraft,
      removeInterimDraft: vi.fn(),
      removeDraftsForSet: vi.fn(),
      clearAllDrafts: vi.fn(),
      restoreSetDraftState: vi.fn(),
      refreshSnapshotEvents: vi.fn().mockResolvedValue(undefined),
      closeMatchDialog,
      onConfirmedResult,
    });

    await persistence.saveLocalResult({
      slug: "tournament/example",
      event,
      setId: set.setId,
      set,
      confirmed: true,
      directWinnerId: null,
      directDraw: true,
      scoreDrafts: { "player-1": "4", "player-2": "1" },
      sideDrafts: {},
    });

    expect(invokeMock).toHaveBeenCalledWith("save_local_set_result", {
      input: expect.objectContaining({
        setId: set.setId,
        winnerId: "",
        confirmed: true,
        slotScores: [],
      }),
    });
    expect(saveSetDraft).toHaveBeenCalledWith(set.setId, {
      winnerId: "",
      scoreDrafts: {},
      directWin: false,
    });
    expect(onConfirmedResult).not.toHaveBeenCalled();
    expect(closeMatchDialog).toHaveBeenCalledOnce();
  });
});
