import { invoke } from "@tauri-apps/api/core";
import type { EventSnapshot } from "./bracketDisplay";
import type { ItemListConfig } from "./itemList";

export type LocalSnapshotEventListItem = {
  tournamentId: string;
  slug: string;
  tournamentName: string;
  updatedAt: string;
  eventId: string;
  eventName: string;
  eventAlias: string | null;
  lastSelectedPhaseName?: string | null;
  lastSelectedPhaseGroupName?: string | null;
  setCount: number;
};

export type PlaySide = "1P" | "2P";

export type EventManagementMeta = {
  sideDecisionMethod: "upper_1p" | "upper_2p" | "random";
  useAliasName?: boolean;
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
  aliasName?: string;
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
  scoreEditEnabledPhaseGroupIds?: string[];
  externalScoreBroadcastPhaseGroupIds?: string[];
  externalEditors?: PhaseGroupExternalEditor[];
  entrants: EventEntrantMeta[];
};

export type PhaseGroupExternalEditor = {
  phaseGroupId: string;
  senderName: string;
  senderUserId: string;
};

export type SetPhaseGroupExternalEditorInput = {
  slug: string;
  eventId: string;
  eventName: string;
  phaseGroupId: string;
  senderName: string;
  senderUserId: string;
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
  resetSourceSetId?: string;
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
  tournamentName?: string;
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

export type SnapshotSelection = {
  slug: string;
  eventId: string;
  phaseName?: string | null;
  phaseGroupName?: string | null;
};

export type CreateEventSnapshotInput = {
  tournamentSlug: string;
  eventSlug: string;
  eventAlias: string | null;
  perPage: number;
};

export type SaveEventManagementMetaInput = {
  slug: string;
  eventId: string;
  eventName: string;
  setting: EventManagementMeta;
};

export type SetPhaseGroupScoreEditLockInput = {
  slug: string;
  eventId: string;
  eventName: string;
  phaseGroupId: string;
  locked: boolean;
};

export type SetPhaseGroupExternalScoreBroadcastInput = {
  slug: string;
  eventId: string;
  eventName: string;
  phaseGroupId: string;
  enabled: boolean;
};

export type ApplyExternalScoreReportInput = {
  result: {
    slug: string;
    eventId: string;
    setId: string;
    winnerId: string;
    confirmed: boolean;
    directWin: boolean;
    slotScores: Array<{ entrantId: string; score: number }>;
  };
  senderName: string;
  senderUserId: string;
};

export type SaveLocalPlayerMetaInput = {
  slug: string;
  eventId: string;
  eventName: string;
  entrantId: string;
  entrantName: string;
  aliasName: string;
  playSide: PlaySide | null;
  characterNames: string[];
  notes: string | null;
};

export type SaveLocalSetPlaySideInput = {
  slug: string;
  eventId: string;
  setId: string;
  entrantId: string;
  opponentEntrantId: string | null;
  playSide: PlaySide | null;
};

export type SaveLastSnapshotSelectionInput = {
  slug: string;
  eventId: string;
  phaseName: string | null;
  phaseGroupName: string | null;
};

export type SaveEventPhasePoolSelectionInput = {
  slug: string;
  eventId: string;
  eventName: string;
  phaseName: string;
  phaseGroupName: string;
};

export async function listLocalSnapshotEvents(): Promise<LocalSnapshotEventListItem[]> {
  return invoke<LocalSnapshotEventListItem[]>("list_local_snapshot_events");
}

export async function loadTournamentWorkspace(slug: string, eventId: string): Promise<TournamentWorkspace> {
  return invoke<TournamentWorkspace>("load_local_tournament_workspace", { slug, eventId });
}

export async function refreshTournamentSnapshot(
  slug: string,
  eventId: string,
  perPage: number,
): Promise<TournamentWorkspace> {
  return invoke<TournamentWorkspace>("refresh_local_event_snapshot_from_remote", {
    slug,
    eventId,
    perPage,
  });
}

export async function restoreTournamentGraph(slug: string, eventId: string): Promise<TournamentWorkspace> {
  return invoke<TournamentWorkspace>("restore_local_event_graph_from_snapshot", { slug, eventId });
}

export async function persistEventManagementMeta(input: SaveEventManagementMetaInput): Promise<TournamentWorkspace> {
  return invoke<TournamentWorkspace>("save_event_management_meta", { input });
}

export async function persistPhaseGroupScoreEditLock(
  input: SetPhaseGroupScoreEditLockInput,
): Promise<TournamentWorkspace> {
  return invoke<TournamentWorkspace>("set_phase_group_score_edit_lock", { input });
}

export async function persistPhaseGroupExternalScoreBroadcast(
  input: SetPhaseGroupExternalScoreBroadcastInput,
): Promise<TournamentWorkspace> {
  return invoke<TournamentWorkspace>("set_phase_group_external_score_broadcast", { input });
}

export async function applyExternalScoreReport(
  input: ApplyExternalScoreReportInput,
): Promise<TournamentWorkspace> {
  return invoke<TournamentWorkspace>("apply_external_score_report", { input });
}

export async function persistPhaseGroupExternalEditor(
  input: SetPhaseGroupExternalEditorInput,
): Promise<TournamentWorkspace> {
  return invoke<TournamentWorkspace>("set_phase_group_external_editor", { input });
}

export async function persistEventAlias(
  slug: string,
  eventId: string,
  eventAlias: string | null,
): Promise<TournamentWorkspace> {
  return invoke<TournamentWorkspace>("save_event_alias", { slug, eventId, eventAlias });
}

export async function persistLocalPlayerMeta(input: SaveLocalPlayerMetaInput): Promise<TournamentWorkspace> {
  return invoke<TournamentWorkspace>("save_local_player_meta", { input });
}

export async function persistLocalSetPlaySide(input: SaveLocalSetPlaySideInput): Promise<TournamentWorkspace> {
  return invoke<TournamentWorkspace>("save_local_set_play_side", { input });
}

export async function persistEventSnapshot(input: CreateEventSnapshotInput): Promise<void> {
  await invoke("create_event_snapshot_by_slug", { input });
}

export async function removeSnapshotEvent(slug: string, eventId: string): Promise<void> {
  await invoke("delete_local_snapshot_event", { slug, eventId });
}

export async function loadLastSnapshotSelection(): Promise<SnapshotSelection | null> {
  return invoke<SnapshotSelection | null>("load_last_snapshot_selection");
}

export async function saveLastSnapshotSelection(input: SaveLastSnapshotSelectionInput): Promise<void> {
  await invoke("save_last_snapshot_selection", input);
}

export async function loadLastSlug(): Promise<string | null> {
  return invoke<string | null>("load_last_slug");
}

export async function saveLastSlug(slug: string): Promise<void> {
  await invoke("save_last_slug", { slug });
}

export async function saveEventPhasePoolSelection(input: SaveEventPhasePoolSelectionInput): Promise<void> {
  await invoke("save_event_last_phase_pool_selection", input);
}
