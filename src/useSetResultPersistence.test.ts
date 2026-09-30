import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EventSnapshot } from "./bracketDisplay";
import type { SetSnapshot } from "./bracketProgression";
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

    expect(syncOverlayScores).toHaveBeenCalledWith(set, [], savedSides);
  });
});
