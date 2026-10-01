import { useEffect, useRef } from "react";
import type { LocalSnapshotEventListItem, TournamentWorkspace } from "./tournamentWorkspaceRepository";

type UseSnapshotTabAutoLoadOptions = {
  activeTab: string;
  busy: boolean;
  loadingLocalSnapshotEvents: boolean;
  selectedSidebarItem: LocalSnapshotEventListItem | null;
  workspace: TournamentWorkspace | null;
  selectLocalSnapshotEvent: (item: LocalSnapshotEventListItem) => Promise<unknown>;
};

export function useSnapshotTabAutoLoad({
  activeTab,
  busy,
  loadingLocalSnapshotEvents,
  selectedSidebarItem,
  workspace,
  selectLocalSnapshotEvent,
}: UseSnapshotTabAutoLoadOptions) {
  const inFlightRef = useRef(false);

  useEffect(() => {
    if (workspace || busy || loadingLocalSnapshotEvents || inFlightRef.current) {
      return;
    }

    const requiresSelectedEvent = activeTab === "tournament"
      || activeTab === "bracket"
      || activeTab === "message"
      || activeTab === "users";
    if (!requiresSelectedEvent || !selectedSidebarItem) {
      return;
    }

    inFlightRef.current = true;
    void (async () => {
      try {
        await selectLocalSnapshotEvent(selectedSidebarItem);
      } finally {
        inFlightRef.current = false;
      }
    })();
  }, [activeTab, busy, loadingLocalSnapshotEvents, selectedSidebarItem, workspace]);
}