import { useEffect, useRef } from "react";
import type { LocalSnapshotEventListItem, TournamentWorkspace } from "../domain/tournamentWorkspaceRepository";
import {
  loadLastSlug,
  loadLastSnapshotSelection,
} from "../domain/tournamentWorkspaceRepository";
import { toSlugInput } from "../domain/slugUtils";
import { findSnapshotEventByIdentity } from "../domain/snapshotDisplay";

type UseSnapshotStartupRestoreOptions = {
  localSnapshotEvents: LocalSnapshotEventListItem[];
  loadingLocalSnapshotEvents: boolean;
  workspace: TournamentWorkspace | null;
  loadWorkspace: (slug: string, eventId: string) => Promise<unknown>;
  refreshLocalSnapshotEvents: () => void | Promise<void>;
  selectLocalSnapshotEvent: (item: LocalSnapshotEventListItem) => Promise<unknown>;
  setSlug: (slug: string) => void;
  setSelectedEventId: (eventId: string) => void;
  setSelectedPhaseName: (phaseName: string) => void;
  setSelectedPhasePoolKey: (key: string) => void;
  setError: (error: string) => void;
};

export function useSnapshotStartupRestore({
  localSnapshotEvents,
  loadingLocalSnapshotEvents,
  workspace,
  loadWorkspace,
  refreshLocalSnapshotEvents,
  selectLocalSnapshotEvent,
  setSlug,
  setSelectedEventId,
  setSelectedPhaseName,
  setSelectedPhasePoolKey,
  setError,
}: UseSnapshotStartupRestoreOptions) {
  const startupSavedSlugRef = useRef("");
  const startupSavedEventIdRef = useRef("");
  const startupRestoreReadyRef = useRef(false);
  const localSnapshotEventsLoadedOnceRef = useRef(false);
  const startupAutoRestoreDoneRef = useRef(false);
  const startupDirectRestoreTriedRef = useRef(false);
  const startupListRestoreRetryCountRef = useRef(0);

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        const savedSelection = await loadLastSnapshotSelection();
        if (
          alive
          && savedSelection
          && savedSelection.slug.trim() !== ""
          && savedSelection.eventId.trim() !== ""
        ) {
          const savedSlug = savedSelection.slug.trim();
          const savedEventId = savedSelection.eventId.trim();
          const savedPhaseName = typeof savedSelection.phaseName === "string"
            ? savedSelection.phaseName.trim()
            : "";
          const savedPhaseGroupName = typeof savedSelection.phaseGroupName === "string"
            ? savedSelection.phaseGroupName.trim()
            : "";
          startupSavedSlugRef.current = savedSlug;
          startupSavedEventIdRef.current = savedEventId;
          setSelectedEventId(savedEventId);
          if (savedPhaseName !== "") {
            setSelectedPhaseName(savedPhaseName);
          }
          if (savedPhaseName !== "" && savedPhaseGroupName !== "") {
            setSelectedPhasePoolKey(`${savedPhaseName}::${savedPhaseGroupName}`);
          }
          setSlug(toSlugInput(savedSlug));
        }

        const savedSlug = await loadLastSlug();
        if (
          alive
          && startupSavedSlugRef.current === ""
          && savedSlug
          && savedSlug.trim() !== ""
        ) {
          const savedRawSlug = savedSlug.trim();
          startupSavedSlugRef.current = savedRawSlug;
          setSlug(toSlugInput(savedRawSlug));
        }
      } catch (err) {
        if (alive) {
          setError(String(err));
        }
      } finally {
        if (alive) {
          startupRestoreReadyRef.current = true;
        }
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (startupAutoRestoreDoneRef.current) {
      return;
    }

    if (!startupRestoreReadyRef.current || !localSnapshotEventsLoadedOnceRef.current) {
      return;
    }

    if (workspace) {
      startupAutoRestoreDoneRef.current = true;
      return;
    }

    const savedSlug = startupSavedSlugRef.current.trim();
    const savedEventId = startupSavedEventIdRef.current;

    if (savedSlug !== "" && savedEventId !== "" && !startupDirectRestoreTriedRef.current) {
      startupDirectRestoreTriedRef.current = true;

      void (async () => {
        try {
          await loadWorkspace(savedSlug, savedEventId);
          setSlug(toSlugInput(savedSlug));
          setSelectedEventId(savedEventId);
          startupAutoRestoreDoneRef.current = true;
        } catch {
          if (!loadingLocalSnapshotEvents) {
            void refreshLocalSnapshotEvents();
          }
        }
      })();
      return;
    }

    if (loadingLocalSnapshotEvents) {
      return;
    }

    if (savedSlug === "") {
      startupAutoRestoreDoneRef.current = true;
      return;
    }

    if (localSnapshotEvents.length === 0) {
      if (startupListRestoreRetryCountRef.current < 1) {
        startupListRestoreRetryCountRef.current += 1;
        void refreshLocalSnapshotEvents();
        return;
      }

      startupAutoRestoreDoneRef.current = true;
      return;
    }

    let matched: LocalSnapshotEventListItem | null = null;
    if (savedEventId !== "") {
      matched = findSnapshotEventByIdentity(localSnapshotEvents, savedSlug, savedEventId);
    }

    if (!matched) {
      const normalizedSavedSlug = toSlugInput(savedSlug);
      matched = localSnapshotEvents.find((item) => toSlugInput(item.slug) === normalizedSavedSlug) ?? null;
    }

    startupAutoRestoreDoneRef.current = true;

    if (matched) {
      void selectLocalSnapshotEvent(matched);
    }
  }, [loadingLocalSnapshotEvents, localSnapshotEvents, workspace]);

  return {
    startupSavedSlugRef,
    startupSavedEventIdRef,
    markSnapshotEventsLoaded: () => {
      localSnapshotEventsLoadedOnceRef.current = true;
    },
    markStartupAutoRestoreDone: () => {
      startupAutoRestoreDoneRef.current = true;
    },
    clearStartupSelection: () => {
      startupSavedSlugRef.current = "";
      startupSavedEventIdRef.current = "";
    },
  };
}