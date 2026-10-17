import { describe, expect, it, vi } from "vitest";
import type { SnapshotRestoreScope, TournamentWorkspace } from "../domain/tournamentWorkspaceRepository";
import { useEventSnapshotMaintenance } from "./useEventSnapshotMaintenance";

function setup() {
  const workspace: TournamentWorkspace = {
    snapshot: {
      tournamentId: "tournament", slug: "test", name: "Tournament",
      events: [], updatedAt: "2026-10-17T00:00:00Z",
    },
    localMeta: {
      tournamentId: "tournament", slug: "test", events: [],
      pendingSetResults: [], pendingGrandFinalResetResults: [],
      updatedAt: "2026-10-17T00:00:00Z",
    },
  };
  const restoreWorkspaceGraph = vi.fn().mockResolvedValue({ workspace, affectedSetIds: ["set-a"] });
  const options: Parameters<typeof useEventSnapshotMaintenance>[0] = {
    slug: "test",
    selectedEventId: "event",
    selectedEvent: { eventId: "event" },
    eventAliasDraft: "",
    perPage: 20,
    setBusy: vi.fn(),
    setError: vi.fn(),
    setMessage: vi.fn(),
    setCreateSnapshotProgress: vi.fn(),
    setRestoreDialogOpen: vi.fn(),
    setSlug: vi.fn(),
    setSelectedEventId: vi.fn(),
    setSelectedPhaseName: vi.fn(),
    setSelectedPhasePoolKey: vi.fn(),
    setDeletingSnapshotKey: vi.fn(),
    setWorkspace: vi.fn(),
    setEventMgmtSettings: vi.fn(),
    eventSettingKey: (slug, eventId) => `${slug}::${eventId}`,
    snapshot: { slug: "test" },
    saveEventAlias: vi.fn(),
    refreshRemoteSnapshot: vi.fn(),
    restoreWorkspaceGraph,
    refreshLocalSnapshotEvents: vi.fn(),
    loadWorkspace: vi.fn(),
    clearAllDrafts: vi.fn(),
    closeMatchDialog: vi.fn(),
    seedSnapshotRefreshRequired: false,
    onSeedSnapshotRefreshCompleted: vi.fn(),
    onSeedStateRefreshRequested: vi.fn(),
  };
  return { options, restoreWorkspaceGraph, maintenance: useEventSnapshotMaintenance(options) };
}

describe("snapshot restore seed policy", () => {
  it.each<SnapshotRestoreScope>(["currentPool", "lockedPoolsInCurrentPhase", "all"])(
    "preserves seeds by default for %s",
    async (scope) => {
      const { options, restoreWorkspaceGraph, maintenance } = setup();
      const restored = await maintenance.restoreGraphFromSnapshot(scope, "pool-a", "Phase 1");
      expect(restoreWorkspaceGraph).toHaveBeenCalledWith({
        slug: "tournament/test", eventId: "event", scope, phaseGroupId: "pool-a", phaseName: "Phase 1",
        discardSeedShuffle: false,
      });
      expect(restored?.affectedSetIds).toEqual(["set-a"]);
      expect(options.onSeedStateRefreshRequested).toHaveBeenCalledOnce();
      expect(options.clearAllDrafts).toHaveBeenCalledTimes(scope === "all" ? 1 : 0);
    },
  );

  it("passes an explicit discard selection for full restoration", async () => {
    const { options, restoreWorkspaceGraph, maintenance } = setup();
    await maintenance.restoreGraphFromSnapshot("all", null, null, true);
    expect(restoreWorkspaceGraph).toHaveBeenCalledWith(expect.objectContaining({
      scope: "all", discardSeedShuffle: true,
    }));
    expect(options.setMessage).toHaveBeenLastCalledWith(expect.stringContaining("Seedの並び替えを破棄しました"));
  });

  it("reports restore failures without clearing drafts", async () => {
    const { options, restoreWorkspaceGraph, maintenance } = setup();
    restoreWorkspaceGraph.mockRejectedValue(new Error("restore failed"));
    expect(await maintenance.restoreGraphFromSnapshot("all", null, null)).toBeNull();
    expect(options.setError).toHaveBeenLastCalledWith("Error: restore failed");
    expect(options.clearAllDrafts).not.toHaveBeenCalled();
    expect(options.setBusy).toHaveBeenLastCalledWith(false);
  });
});
