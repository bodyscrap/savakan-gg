import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  listLocalSnapshotEvents,
  loadTournamentWorkspace,
  clearPhaseGroupExternalEditor,
  persistEventAlias,
  persistEventManagementMeta,
  persistPhaseGroupExternalScoreBroadcast,
  persistPhaseGroupExternalEditor,
  persistPhaseGroupScoreEditLock,
  persistLocalPlayerMeta,
  persistLocalSetPlaySide,
  refreshTournamentSnapshot,
  restoreTournamentGraph,
  type EventManagementMeta,
  type LocalSnapshotEventListItem,
  type PlaySide,
  type RestoreEventGraphInput,
  type TournamentWorkspace,
} from "../domain/tournamentWorkspaceRepository";

export type {
  EventEntrantMeta,
  EventLocalMeta,
  EventManagementMeta,
  LocalGrandFinalResetResultMeta,
  LocalSetResultMeta,
  PlaySide,
  RestoreEventGraphInput,
  RestoreEventGraphResult,
  SnapshotRestoreScope,
  SetPlaySideMeta,
  TournamentLocalMeta,
  TournamentSnapshot,
  TournamentWorkspace,
} from "../domain/tournamentWorkspaceRepository";

type WorkspaceUpdatedEvent = {
  slug: string;
  eventId: string;
};

type UseTournamentWorkspaceOptions = {
  activeTab: string;
  slug: string;
  selectedEventId: string;
  busy: boolean;
  createBusy: boolean;
  onWorkspaceUpdated: (workspace: TournamentWorkspace) => void;
};

const WORKSPACE_UPDATED_EVENT = "workspace_updated";

function normalizeApiSlug(rawSlug: string): string {
  const trimmed = rawSlug.trim();
  const withoutPrefix = trimmed.startsWith("tournament/")
    ? trimmed.slice("tournament/".length)
    : trimmed;
  const normalized = withoutPrefix.replace(/^\/+|\/+$/g, "");
  return normalized === "" ? "" : `tournament/${normalized}`;
}

export function useTournamentWorkspace({
  activeTab,
  slug,
  selectedEventId,
  busy,
  createBusy,
  onWorkspaceUpdated,
}: UseTournamentWorkspaceOptions) {
  const [workspace, setWorkspace] = useState<TournamentWorkspace | null>(null);
  const [localSnapshotEvents, setLocalSnapshotEvents] = useState<LocalSnapshotEventListItem[]>([]);
  const [loadingLocalSnapshotEvents, setLoadingLocalSnapshotEvents] = useState(false);
  const onWorkspaceUpdatedRef = useRef(onWorkspaceUpdated);
  onWorkspaceUpdatedRef.current = onWorkspaceUpdated;

  async function fetchLocalSnapshotEvents() {
    setLoadingLocalSnapshotEvents(true);
    try {
      const items = await listLocalSnapshotEvents();
      setLocalSnapshotEvents(items);
      return items;
    } finally {
      setLoadingLocalSnapshotEvents(false);
    }
  }

  async function loadWorkspace(targetSlug: string, eventId: string) {
    const result = await loadTournamentWorkspace(targetSlug, eventId);
    setWorkspace(result);
    return result;
  }

  async function refreshRemoteSnapshot(targetSlug: string, eventId: string, perPage: number) {
    const result = await refreshTournamentSnapshot(targetSlug, eventId, perPage);
    setWorkspace(result);
    return result;
  }

  async function restoreWorkspaceGraph(input: RestoreEventGraphInput) {
    const result = await restoreTournamentGraph(input);
    setWorkspace(result.workspace);
    return result;
  }

  async function saveEventManagementMeta(input: {
    slug: string;
    eventId: string;
    eventName: string;
    setting: EventManagementMeta;
  }) {
    const result = await persistEventManagementMeta(input);
    setWorkspace(result);
    return result;
  }

  async function savePhaseGroupScoreEditLock(input: {
    slug: string;
    eventId: string;
    eventName: string;
    phaseGroupId: string;
    locked: boolean;
  }) {
    const result = await persistPhaseGroupScoreEditLock(input);
    setWorkspace(result);
    return result;
  }

  async function savePhaseGroupExternalScoreBroadcast(input: {
    slug: string;
    eventId: string;
    eventName: string;
    phaseGroupId: string;
    enabled: boolean;
  }) {
    const result = await persistPhaseGroupExternalScoreBroadcast(input);
    setWorkspace(result);
    return result;
  }

  async function savePhaseGroupExternalEditor(input: {
    slug: string;
    eventId: string;
    eventName: string;
    phaseGroupId: string;
    senderName: string;
    senderUserId: string;
  }) {
    const result = await persistPhaseGroupExternalEditor(input);
    setWorkspace(result);
    return result;
  }

  async function clearPhaseGroupExternalEditorForPool(input: {
    slug: string;
    eventId: string;
    eventName: string;
    phaseGroupId: string;
  }) {
    const result = await clearPhaseGroupExternalEditor(input);
    setWorkspace(result);
    return result;
  }

  async function saveEventAlias(targetSlug: string, eventId: string, eventAlias: string | null) {
    const result = await persistEventAlias(targetSlug, eventId, eventAlias);
    setWorkspace(result);
    return result;
  }

  async function saveLocalPlayerMeta(input: {
    slug: string;
    eventId: string;
    eventName: string;
    entrantId: string;
    entrantName: string;
    aliasName: string;
    playSide: PlaySide | null;
    characterNames: string[];
    notes: string | null;
  }) {
    const result = await persistLocalPlayerMeta(input);
    setWorkspace(result);
    return result;
  }

  async function saveLocalSetPlaySide(input: {
    slug: string;
    eventId: string;
    setId: string;
    entrantId: string;
    opponentEntrantId: string | null;
    playSide: PlaySide | null;
  }) {
    const result = await persistLocalSetPlaySide(input);
    setWorkspace(result);
    return result;
  }

  useEffect(() => {
    if (activeTab !== "bracket") {
      return;
    }

    const normalizedSlug = normalizeApiSlug(slug);
    if (normalizedSlug === "" || selectedEventId.trim() === "") {
      return;
    }

    const workspaceAlreadyLoaded = workspace
      && normalizeApiSlug(workspace.snapshot.slug) === normalizedSlug
      && workspace.snapshot.events.some((event) => event.eventId === selectedEventId);
    if (workspaceAlreadyLoaded || busy || createBusy || loadingLocalSnapshotEvents) {
      return;
    }

    let disposed = false;
    void loadTournamentWorkspace(normalizedSlug, selectedEventId)
      .then((result) => {
        if (!disposed) {
          setWorkspace(result);
        }
      })
      .catch(() => {
        // Ignore refresh failures when opening the bracket.
      });

    return () => {
      disposed = true;
    };
  }, [activeTab, busy, createBusy, loadingLocalSnapshotEvents, selectedEventId, slug, workspace]);

  useEffect(() => {
    let alive = true;
    let unlisten: (() => void) | null = null;

    void (async () => {
      try {
        const off = await listen<WorkspaceUpdatedEvent>(WORKSPACE_UPDATED_EVENT, (event) => {
          if (!alive) {
            return;
          }

          if (
            normalizeApiSlug(event.payload.slug).toLowerCase() !== normalizeApiSlug(slug).toLowerCase()
            || event.payload.eventId !== selectedEventId
          ) {
            return;
          }

          void loadTournamentWorkspace(normalizeApiSlug(slug), selectedEventId)
            .then((result) => {
              if (alive) {
                setWorkspace(result);
                onWorkspaceUpdatedRef.current(result);
              }
            })
            .catch(() => {
              // Ignore refresh errors from mobile-triggered updates.
            });
        });
        unlisten = off;
      } catch {
        // Ignore listener setup failure in non-Tauri environments.
      }
    })();

    return () => {
      alive = false;
      unlisten?.();
    };
  }, [selectedEventId, slug]);

  return {
    workspace,
    setWorkspace,
    localSnapshotEvents,
    setLocalSnapshotEvents,
    loadingLocalSnapshotEvents,
    fetchLocalSnapshotEvents,
    loadWorkspace,
    refreshRemoteSnapshot,
    restoreWorkspaceGraph,
    saveEventManagementMeta,
    savePhaseGroupScoreEditLock,
    savePhaseGroupExternalScoreBroadcast,
    savePhaseGroupExternalEditor,
    clearPhaseGroupExternalEditor: clearPhaseGroupExternalEditorForPool,
    saveEventAlias,
    saveLocalPlayerMeta,
    saveLocalSetPlaySide,
  };
}
