import { useEffect } from "react";
import { sameSnapshotEventKey } from "./snapshotDisplay";
import {
  saveLastSnapshotSelection,
  type LocalSnapshotEventListItem,
  type TournamentWorkspace,
} from "./tournamentWorkspaceRepository";

type UseSnapshotEventListRefreshOptions = {
  activeTab: string;
  fetchLocalSnapshotEvents: () => Promise<LocalSnapshotEventListItem[]>;
  startupSavedSlugRef: { current: string };
  startupSavedEventIdRef: { current: string };
  clearStartupSelection: () => void;
  markSnapshotEventsLoaded: () => void;
  resetLastPersistedSnapshotSelection: () => void;
  setWorkspace: (workspace: TournamentWorkspace | null) => void;
  setSelectedEventId: (eventId: string) => void;
  setSelectedPhaseName: (phaseName: string) => void;
  setSelectedPhasePoolKey: (key: string) => void;
  setHomeSelectedSnapshotKey: (key: string) => void;
  setError: (error: string) => void;
};

export function useSnapshotEventListRefresh({
  activeTab,
  fetchLocalSnapshotEvents,
  startupSavedSlugRef,
  startupSavedEventIdRef,
  clearStartupSelection,
  markSnapshotEventsLoaded,
  resetLastPersistedSnapshotSelection,
  setWorkspace,
  setSelectedEventId,
  setSelectedPhaseName,
  setSelectedPhasePoolKey,
  setHomeSelectedSnapshotKey,
  setError,
}: UseSnapshotEventListRefreshOptions) {
  async function refreshLocalSnapshotEvents() {
    try {
      const items = await fetchLocalSnapshotEvents();

      const savedSlug = startupSavedSlugRef.current.trim();
      const savedEventId = startupSavedEventIdRef.current.trim();
      const savedSelectionStillExists = savedSlug === "" || savedEventId === ""
        || items.some((item) => sameSnapshotEventKey(savedSlug, savedEventId, item.slug, item.eventId));
      if (!savedSelectionStillExists) {
        setWorkspace(null);
        setSelectedEventId("");
        setSelectedPhaseName("");
        setSelectedPhasePoolKey("");
        clearStartupSelection();
        resetLastPersistedSnapshotSelection();
        await saveLastSnapshotSelection({
          slug: "",
          eventId: "",
          phaseName: null,
          phaseGroupName: null,
        });
      }

      if (items.length === 0) {
        setWorkspace(null);
        setSelectedEventId("");
        setSelectedPhaseName("");
        setSelectedPhasePoolKey("");
        setHomeSelectedSnapshotKey("");
        clearStartupSelection();
        resetLastPersistedSnapshotSelection();
      }
    } catch (err) {
      setError(String(err));
    } finally {
      markSnapshotEventsLoaded();
    }
  }

  useEffect(() => {
    if (activeTab === "home") {
      void refreshLocalSnapshotEvents();
    }
  }, [activeTab]);

  return { refreshLocalSnapshotEvents };
}