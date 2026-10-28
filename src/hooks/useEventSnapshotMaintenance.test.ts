import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { removeSnapshotEvent, type LocalSnapshotEventListItem, type SnapshotRestoreScope, type TournamentWorkspace } from "../domain/tournamentWorkspaceRepository";
import { useEventSnapshotMaintenance } from "./useEventSnapshotMaintenance";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../domain/tournamentWorkspaceRepository", async (importOriginal) => ({
  ...await importOriginal<typeof import("../domain/tournamentWorkspaceRepository")>(),
  removeSnapshotEvent: vi.fn().mockResolvedValue(undefined),
}));

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllGlobals());

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

describe("asynchronous snapshot confirmations", () => {
  const item: LocalSnapshotEventListItem = {
    tournamentId: "tournament", slug: "test", eventId: "event",
    tournamentName: "Tournament", eventName: "Event", eventAlias: "Alias",
    updatedAt: "2026-10-29T00:00:00Z", setCount: 1,
  };

  it.each([false, true])("waits for deletion confirmation (%s) before touching data or selection", async (confirmed) => {
    const { options, maintenance } = setup();
    let answer!: (value: boolean) => void;
    const pending = new Promise<boolean>((resolve) => { answer = resolve; });
    vi.stubGlobal("window", { confirm: vi.fn(() => pending) });

    const operation = maintenance.deleteLocalSnapshotEvent(item);
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("Tournament / Alias"));
    expect(removeSnapshotEvent).not.toHaveBeenCalled();
    expect(options.setDeletingSnapshotKey).not.toHaveBeenCalled();
    expect(options.setEventMgmtSettings).not.toHaveBeenCalled();
    expect(options.setWorkspace).not.toHaveBeenCalled();
    expect(options.refreshLocalSnapshotEvents).not.toHaveBeenCalled();

    answer(confirmed);
    await operation;
    expect(removeSnapshotEvent).toHaveBeenCalledTimes(confirmed ? 1 : 0);
    expect(options.setWorkspace).toHaveBeenCalledTimes(confirmed ? 1 : 0);
    expect(options.refreshLocalSnapshotEvents).toHaveBeenCalledTimes(confirmed ? 1 : 0);
    if (confirmed) {
      expect(removeSnapshotEvent).toHaveBeenCalledWith("test", "event");
      expect(options.setWorkspace).toHaveBeenCalledWith(null);
    } else {
      expect(options.setEventMgmtSettings).not.toHaveBeenCalled();
      expect(options.setMessage).not.toHaveBeenCalled();
    }
  });

  it("waits for the Start check before checking seeds or fetching a replacement snapshot", async () => {
    const { options } = setup();
    options.seedSnapshotRefreshRequired = true;
    let answer!: (value: boolean) => void;
    vi.stubGlobal("window", {
      confirm: vi.fn(() => new Promise<boolean>((resolve) => { answer = resolve; })),
    });
    const operation = useEventSnapshotMaintenance(options).updateSnapshot();
    expect(invoke).not.toHaveBeenCalled();
    expect(options.refreshRemoteSnapshot).not.toHaveBeenCalled();
    answer(false);
    await operation;
    expect(invoke).not.toHaveBeenCalled();
    expect(options.refreshRemoteSnapshot).not.toHaveBeenCalled();
  });

  it.each([false, true])("waits before discarding an unreported seed shuffle (%s)", async (confirmed) => {
    const { options, maintenance } = setup();
    vi.mocked(invoke).mockResolvedValueOnce(true);
    let answer!: (value: boolean) => void;
    const dialogOpened = new Promise<void>((opened) => {
      vi.stubGlobal("window", { confirm: vi.fn(() => {
        opened();
        return new Promise<boolean>((resolve) => { answer = resolve; });
      }) });
    });
    const operation = maintenance.updateSnapshot();
    await dialogOpened;
    expect(options.refreshRemoteSnapshot).not.toHaveBeenCalled();
    expect(options.clearAllDrafts).not.toHaveBeenCalled();
    answer(confirmed);
    await operation;
    expect(options.refreshRemoteSnapshot).toHaveBeenCalledTimes(confirmed ? 1 : 0);
    expect(options.clearAllDrafts).toHaveBeenCalledTimes(confirmed ? 1 : 0);
  });
});

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
