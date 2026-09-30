import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { EventSnapshot } from "./bracketDisplay";
import type { LocalSnapshotEventListItem } from "./EventSelector";
import type { ItemListConfig } from "./itemList";

export type PlaySide = "1P" | "2P";

export type EventManagementMeta = {
  sideDecisionMethod: "upper_1p" | "upper_2p" | "random";
  itemListSnapshots: ItemListConfig[];
  categoryMinCounts?: number[];
  categoryMaxCounts?: number[];
  categoryAllowDuplicates?: boolean[];
  totalMinCount?: number;
  totalMaxCount?: number;
};

export type TournamentSnapshot = {
  tournamentId: string;
  slug: string;
  name: string;
  events: EventSnapshot[];
  updatedAt: string;
};

export type EventEntrantMeta = {
  entrantId: string;
  entrantName: string;
  playSide: PlaySide | null;
  characterNames: string[];
  authCode: string;
  notes: string | null;
};

export type EventLocalMeta = {
  eventId: string;
  eventName: string;
  eventAlias: string | null;
  lastSelectedPhaseName?: string | null;
  lastSelectedPhaseGroupName?: string | null;
  eventManagement?: EventManagementMeta | null;
  entrants: EventEntrantMeta[];
};

export type SetPlaySideMeta = {
  setId: string;
  entrantId: string;
  playSide: PlaySide;
};

export type LocalSetResultMeta = {
  eventId: string;
  eventName: string;
  setId: string;
  winnerId: string;
  scoreCsv: string;
  directWin?: boolean;
  confirmed?: boolean;
  slotScores?: Array<{ entrantId: string; score: number }>;
  recordedAt: string;
};

export type LocalGrandFinalResetResultMeta = {
  eventId: string;
  eventName: string;
  sourceGrandFinalSetId: string;
  winnerId: string;
  scoreCsv: string;
  directWin?: boolean;
  confirmed?: boolean;
  slotScores?: Array<{ entrantId: string; score: number }>;
  recordedAt: string;
};

export type TournamentLocalMeta = {
  tournamentId: string;
  slug: string;
  events: EventLocalMeta[];
  setPlaySides?: SetPlaySideMeta[];
  pendingSetResults: LocalSetResultMeta[];
  pendingGrandFinalResetResults?: LocalGrandFinalResetResultMeta[];
  updatedAt: string;
};

export type TournamentWorkspace = {
  snapshot: TournamentSnapshot;
  localMeta: TournamentLocalMeta;
};

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
      const items = await invoke<LocalSnapshotEventListItem[]>("list_local_snapshot_events");
      setLocalSnapshotEvents(items);
      return items;
    } finally {
      setLoadingLocalSnapshotEvents(false);
    }
  }

  async function loadWorkspace(targetSlug: string, eventId: string) {
    const result = await invoke<TournamentWorkspace>("load_local_tournament_workspace", {
      slug: targetSlug,
      eventId,
    });
    setWorkspace(result);
    return result;
  }

  async function refreshRemoteSnapshot(targetSlug: string, eventId: string, perPage: number) {
    const result = await invoke<TournamentWorkspace>("refresh_local_event_snapshot_from_remote", {
      slug: targetSlug,
      eventId,
      perPage,
    });
    setWorkspace(result);
    return result;
  }

  async function restoreWorkspaceGraph(targetSlug: string, eventId: string) {
    const result = await invoke<TournamentWorkspace>("restore_local_event_graph_from_snapshot", {
      slug: targetSlug,
      eventId,
    });
    setWorkspace(result);
    return result;
  }

  async function saveWorkspaceCommand(command: string, args: Record<string, unknown>) {
    const result = await invoke<TournamentWorkspace>(command, args);
    setWorkspace(result);
    return result;
  }

  async function saveEventManagementMeta(input: {
    slug: string;
    eventId: string;
    eventName: string;
    setting: EventManagementMeta;
  }) {
    return saveWorkspaceCommand("save_event_management_meta", { input });
  }

  async function saveEventAlias(targetSlug: string, eventId: string, eventAlias: string | null) {
    return saveWorkspaceCommand("save_event_alias", {
      slug: targetSlug,
      eventId,
      eventAlias,
    });
  }

  async function saveLocalPlayerMeta(input: {
    slug: string;
    eventId: string;
    eventName: string;
    entrantId: string;
    entrantName: string;
    playSide: PlaySide | null;
    characterNames: string[];
    notes: string | null;
  }) {
    return saveWorkspaceCommand("save_local_player_meta", { input });
  }

  async function saveLocalSetPlaySide(input: {
    slug: string;
    eventId: string;
    setId: string;
    entrantId: string;
    opponentEntrantId: string | null;
    playSide: PlaySide | null;
  }) {
    return saveWorkspaceCommand("save_local_set_play_side", { input });
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
    void invoke<TournamentWorkspace>("load_local_tournament_workspace", {
      slug: normalizedSlug,
      eventId: selectedEventId,
    })
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

          void invoke<TournamentWorkspace>("load_local_tournament_workspace", {
            slug: normalizeApiSlug(slug),
            eventId: selectedEventId,
          })
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
    saveEventAlias,
    saveLocalPlayerMeta,
    saveLocalSetPlaySide,
  };
}
