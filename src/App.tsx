import { type CSSProperties, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import QRCode from "qrcode";
import jsQR from "jsqr";
import { CreateSnapshot, type EventSnapshotProgress, type TournamentEventPreviewItem, type TournamentPreview } from "./CreateSnapshot";
import { SettingsScreen } from "./SettingMenu";
import { StatusBoard, StatusBoardHero, type CallListEventGroup, type CallListEventSortStrategy } from "./StatusBoard";
import { PlayerListInfo, type UserCardPlayer } from "./PlayerListInfo";
import { MessageBox, type GenericMessage, type MailboxDeliveryMode, type MailboxFilterSetting } from "./MessageBox";
import { ItemListEditor } from "./ItemListEditor";
import {
  clampNonNegativeInteger,
  emptyCategorySelections,
  normalizeAllowDuplicatesArray,
  normalizeEventManagementSetting,
  normalizeSelectionCountArrays,
  type EventManagementSetting,
} from "./eventManagement";
import {
  MAX_CATEGORY_SLOTS,
  normalizeItemListConfig,
  parseLinesToUniqueList,
  type ItemListConfig,
} from "./itemList";
import { EventSelector, localSnapshotAliasLabel, localSnapshotItemKey, type LocalSnapshotEventListItem } from "./EventSelector";
import { EventSetting } from "./EventSetting";
import { OverlayControl, type ObsOverlayState } from "./OverlayControl";
import { EliminationBracket, type EliminationBracketSectionView } from "./EliminationBracket";
import { RoundRobinBracket } from "./RoundRobinBracket";
import type { RoundRobinMatrixRowView } from "./RoundRobinMatrix";
import { useBracketReport } from "./useBracketReport";
import {
  buildRoundColumns,
  isCompletedSet,
  isDisplayableSet,
  isGrandFinalResetSet,
  isGrandFinalText,
  isInactiveGrandFinalReset,
  isLosersBracketSet,
  isLosersFinalText,
  isMatchupReady,
  isSlotTbd,
  isWinnersFinalText,
  shouldShowGrandFinalResetColumn,
  type EventSnapshot,
} from "./bracketDisplay";
import {
  buildCallListDedupKey,
  buildCallSyncStatusTargets,
  buildScopedMessageMeta,
  compareCallListEventGroup,
  compareCallListEventGroupByMaxElapsed,
  extractCallTargetIdentityFromMeta,
  extractCallEventMeta,
  extractCallThreadIdentity,
  extractPlayerIdFromBarcodeResults,
  extractPlayerIdFromQrRawValue,
  extractMetaString,
  getMailboxMethodLabel,
  hasSameGenericMessageOrder,
  isLikelyPlayerId,
  isMessageForScope,
  isDqRequestMessage,
  isSameCallTargetIdentity,
  isSameGenericMessageIdentity,
  isValidIpv4,
  isValidIpv4List,
  isValidSenderUserId,
  normalizeGenericMessage,
  normalizeGenericMessages,
  normalizeMailboxFilterSetting,
  normalizeCallPhaseGroupName,
  normalizeCallPhaseName,
  normalizePlayerId,
  parsePhasePoolKey,
  splitIpv4List,
  type MessageScope,
} from "./messageUtils";
import {
  calculateRoundRobinQualifyingCount,
  compareRoundRobinTieBreakRule,
  createSetEntrantResolver,
  DEFAULT_ROUND_ROBIN_TIE_BREAK_RULES,
  getBracketProgressionModel,
  isResolvedEntrantName,
  parseRoundRobinGameScore,
  rankRoundRobinStandings,
  roundRobinTieBreakRuleFromApi,
  type PhaseGroupProgressionSnapshot,
  type PhaseGroupSeedSnapshot,
  type RoundRobinStanding,
  type RoundRobinTieBreakRule,
  type SetEntrantSource,
  type SetSlot,
  type SetSnapshot,
} from "./bracketProgression";
import {
  buildPositionedRoundColumns,
  type PositionedRoundColumn,
  type RoundColumn,
} from "./bracketLayout";
import "./App.css";

type BracketSectionForView = {
  key: string;
  title: string;
  columns: PositionedRoundColumn[];
  setCount: number;
};

type PhasePoolGroup = {
  key: string;
  phaseGroupId: string | null;
  phaseName: string;
  phaseGroupName: string;
  bracketType: string | null;
  phaseOrder: number | null;
  phaseGroupDisplayIdentifier: string | null;
  tiebreakOrder?: string[];
  progressionsOut: PhaseGroupProgressionSnapshot[];
  seedMap: unknown;
  seedOrder: string[];
  seeds: PhaseGroupSeedSnapshot[];
  sets: SetSnapshot[];
  columns: RoundColumn[];
};

type RoundRobinBoardData = {
  entrants: string[];
  entrantNames: Map<string, string>;
  entrantIdsByColumnKey: Map<string, string | null>;
  entrantSeedIds: Map<string, string>;
  entrantSeedNumbers: Map<string, number>;
  sourceDiagnostics: string[];
  setsByPair: Map<string, SetSnapshot>;
  candidateSetCount: number;
  twoSlotSetCount: number;
  resolvedSetCount: number;
  registeredSetCount: number;
  unresolvedSetIds: string[];
  unresolvedSetReasons: string[];
  standings: RoundRobinStanding[];
  qualifyingCount: number;
  tieBreakRules: RoundRobinTieBreakRule[];
};

function formatAlphabetSequence(index: number): string {
  let n = index;
  let label = "";

  do {
    const remainder = n % 26;
    label = String.fromCharCode(65 + remainder) + label;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);

  return label;
}

function pickPairSourceIds(previousSetIds: string[], currentCount: number, currentIndex: number): string[] {
  if (previousSetIds.length === 0 || currentCount <= 0) {
    return [];
  }

  if (previousSetIds.length === 1) {
    return [previousSetIds[0]];
  }

  if (previousSetIds.length >= currentCount * 2) {
    const first = previousSetIds[currentIndex * 2];
    const second = previousSetIds[currentIndex * 2 + 1];
    return [first, second].filter((item): item is string => Boolean(item));
  }

  const mapped = ((currentIndex + 0.5) * previousSetIds.length) / currentCount - 0.5;
  const left = Math.max(0, Math.floor(mapped));
  const right = Math.min(previousSetIds.length - 1, Math.ceil(mapped));
  const first = previousSetIds[left];
  const second = previousSetIds[right];

  if (first && second && first !== second) {
    return [first, second];
  }

  if (first) {
    const neighbor = previousSetIds[Math.min(previousSetIds.length - 1, left + 1)] ?? previousSetIds[Math.max(0, left - 1)];
    if (neighbor && neighbor !== first) {
      return [first, neighbor];
    }
    return [first];
  }

  return [];
}

function normalizeSourceText(kind: "winners" | "losers", setCode: string): string {
  return `${kind === "winners" ? "winner" : "loser"} of ${setCode}`;
}

type TournamentSnapshot = {
  tournamentId: string;
  slug: string;
  name: string;
  events: EventSnapshot[];
  updatedAt: string;
};

type PlaySide = "1P" | "2P";

type EventEntrantMeta = {
  entrantId: string;
  entrantName: string;
  playSide: PlaySide | null;
  characterNames: string[];
  authCode: string;
  notes: string | null;
};

type EventLocalMeta = {
  eventId: string;
  eventName: string;
  eventAlias: string | null;
  lastSelectedPhaseName?: string | null;
  lastSelectedPhaseGroupName?: string | null;
  eventManagement?: EventManagementMeta | null;
  entrants: EventEntrantMeta[];
};

type SetPlaySideMeta = {
  setId: string;
  entrantId: string;
  playSide: PlaySide;
};

type LocalSetResultMeta = {
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

type LocalGrandFinalResetResultMeta = {
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

type SetScoreDraft = Record<string, string>;

type SetResultDraftState = {
  winnerId: string;
  scoreDrafts: SetScoreDraft;
  directWin?: boolean;
};

type SavePlayerMetaOptions = {
  silent?: boolean;
  manageBusy?: boolean;
};

type TournamentLocalMeta = {
  tournamentId: string;
  slug: string;
  events: EventLocalMeta[];
  setPlaySides?: SetPlaySideMeta[];
  pendingSetResults: LocalSetResultMeta[];
  pendingGrandFinalResetResults?: LocalGrandFinalResetResultMeta[];
  updatedAt: string;
};

type TournamentWorkspace = {
  snapshot: TournamentSnapshot;
  localMeta: TournamentLocalMeta;
};

type ResultConfirmationState = {
  match: SetSnapshot;
  scoreDrafts: SetScoreDraft;
  directWinnerId: string | null;
};

type WorkspaceUpdatedEvent = {
  slug: string;
  eventId: string;
};

type ResetSetResultCascadeResult = {
  workspace: TournamentWorkspace;
  affectedSetIds: string[];
  remoteResetApplied: boolean;
};

type DqRequestDialogState = {
  threadId: string;
  parentMessageId: string;
  method: string;
  subject: string;
  replyTargetMode: MailboxDeliveryMode;
  replyTargetIp: string;
  expectedPlayerId: string;
  callEntrantId: string;
  callEntrantName: string;
  setId: string;
};

type MatchSideRandomNotice = {
  setId: string;
  upperEntrantName: string;
  lowerEntrantName: string;
  upperSide: PlaySide;
  lowerSide: PlaySide;
  changed: boolean;
  triggeredAt: number;
};

type ObsOverlaySetInput = {
  enabled: boolean;
  setId: string;
  eventName: string;
  eventAlias: string;
  roundText: string;
  redPlayerName: string;
  bluePlayerName: string;
  redSetWins: number;
  blueSetWins: number;
  fontScale: number;
};

const EVENT_SNAPSHOT_PROGRESS_EVENT = "event_snapshot_progress";
const WORKSPACE_UPDATED_EVENT = "workspace_updated";
const OBS_OVERLAY_STATE_CHANGED_EVENT = "obs_overlay_state_changed";

type PlayerMetaDraft = {
  playSide: PlaySide | "";
  categorySelections: string[][];
};

type SenderProfile = {
  senderName: string;
  senderUserId: string;
  bindIp: string;
  broadcastSubnetMask: string;
};

type LocalNetworkSettingsCandidate = {
  bindIp: string;
  broadcastSubnetMask: string;
  source: string;
  interfaceName: string;
};

type MobileInputPortalInfo = {
  url: string;
  accessUrls: string[];
  token: string;
};

function localNetworkCandidateKey(candidate: LocalNetworkSettingsCandidate): string {
  return `${candidate.bindIp.trim()}::${candidate.broadcastSubnetMask.trim()}::${candidate.interfaceName.trim()}`;
}

function mobileUrlDisplayIp(url: string): string {
  const trimmed = url.trim();
  if (trimmed === "") {
    return "-";
  }

  try {
    const parsed = new URL(trimmed);
    return parsed.hostname || trimmed;
  } catch {
    const normalized = trimmed.replace(/^https?:\/\//i, "");
    const slashIndex = normalized.indexOf("/");
    const hostWithPort = slashIndex >= 0 ? normalized.slice(0, slashIndex) : normalized;
    const colonIndex = hostWithPort.lastIndexOf(":");
    if (colonIndex > 0) {
      return hostWithPort.slice(0, colonIndex);
    }
    return hostWithPort;
  }
}

function mobileInputUrlHostKey(url: string): string {
  const trimmed = url.trim();
  if (trimmed === "") {
    return "";
  }

  try {
    return new URL(trimmed).hostname.trim();
  } catch {
    return mobileUrlDisplayIp(trimmed).trim();
  }
}

function withMobileInputPollMsParam(url: string, pollMs: number): string {
  const trimmed = url.trim();
  if (trimmed === "") {
    return trimmed;
  }

  try {
    const parsed = new URL(trimmed);
    parsed.searchParams.set("pollMs", String(normalizeMobileInputPollingMs(pollMs)));
    return parsed.toString();
  } catch {
    return trimmed;
  }
}

type AppTab = "home" | "create" | "tournament" | "message" | "call-list" | "bracket" | "item-list" | "users" | "settings" | "overlay";

type EventManagementMeta = {
  sideDecisionMethod: "upper_1p" | "upper_2p" | "random";
  itemListSnapshots: ItemListConfig[];
  categoryMinCounts?: number[];
  categoryMaxCounts?: number[];
  categoryAllowDuplicates?: boolean[];
  totalMinCount?: number;
  totalMaxCount?: number;
};

const USER_CARD_PAGE_SIZE = 10;
const CALL_LIST_EVENT_PAGE_SIZE = 3;
const CALL_LIST_ROTATE_SECONDS_MIN = 1;
const CALL_LIST_ROTATE_SECONDS_MAX = 180;
const CALL_LIST_ROTATE_SECONDS_DEFAULT = 7;
const CALL_LIST_COLOR_SECONDS_MIN = 30;
const CALL_LIST_COLOR_SECONDS_MAX = 3600;
const CALL_LIST_COLOR_SECONDS_DEFAULT = 600;
const STARTGG_FETCH_PER_PAGE_DEFAULT = 50;
const MOBILE_INPUT_POLLING_MS_MIN = 500;
const MOBILE_INPUT_POLLING_MS_MAX = 10000;
const MOBILE_INPUT_POLLING_MS_DEFAULT = 1500;

function normalizeSlugForSettingKey(rawSlug: string): string {
  const trimmed = rawSlug.trim();
  const withoutPrefix = trimmed.startsWith("tournament/")
    ? trimmed.slice("tournament/".length)
    : trimmed;
  return withoutPrefix.replace(/^\/+|\/+$/g, "");
}

function normalizeEventSettingStorageKey(rawKey: string): string {
  const [slugPart, ...rest] = rawKey.split("::");
  if (!slugPart) {
    return rawKey.trim();
  }

  const eventId = rest.join("::").trim();
  if (eventId === "") {
    return normalizeSlugForSettingKey(slugPart);
  }

  return `${normalizeSlugForSettingKey(slugPart)}::${eventId}`;
}

function normalizeCallListRotateSeconds(rawValue: unknown, fallback = CALL_LIST_ROTATE_SECONDS_DEFAULT): number {
  const numeric = Number(rawValue);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  const rounded = Math.trunc(numeric);
  if (rounded < CALL_LIST_ROTATE_SECONDS_MIN) {
    return CALL_LIST_ROTATE_SECONDS_MIN;
  }
  if (rounded > CALL_LIST_ROTATE_SECONDS_MAX) {
    return CALL_LIST_ROTATE_SECONDS_MAX;
  }

  return rounded;
}

function normalizeCallListColorSeconds(rawValue: unknown, fallback = CALL_LIST_COLOR_SECONDS_DEFAULT): number {
  const numeric = Number(rawValue);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  const rounded = Math.trunc(numeric);
  if (rounded < CALL_LIST_COLOR_SECONDS_MIN) {
    return CALL_LIST_COLOR_SECONDS_MIN;
  }
  if (rounded > CALL_LIST_COLOR_SECONDS_MAX) {
    return CALL_LIST_COLOR_SECONDS_MAX;
  }

  return rounded;
}

function normalizeStartggFetchPerPage(rawValue: unknown, fallback = STARTGG_FETCH_PER_PAGE_DEFAULT): number {
  const numeric = Number(rawValue);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  const rounded = Math.trunc(numeric);
  if (rounded < 1) {
    return 1;
  }

  return rounded;
}

function normalizeMobileInputPollingMs(rawValue: unknown, fallback = MOBILE_INPUT_POLLING_MS_DEFAULT): number {
  const numeric = Number(rawValue);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  const rounded = Math.trunc(numeric);
  if (rounded < MOBILE_INPUT_POLLING_MS_MIN) {
    return MOBILE_INPUT_POLLING_MS_MIN;
  }
  if (rounded > MOBILE_INPUT_POLLING_MS_MAX) {
    return MOBILE_INPUT_POLLING_MS_MAX;
  }

  return rounded;
}

function normalizeSenderProfile(rawValue: unknown): SenderProfile {
  const source = rawValue && typeof rawValue === "object"
    ? (rawValue as Partial<SenderProfile>)
    : {};

  const senderName = typeof source.senderName === "string" ? source.senderName.trim() : "";
  const senderUserId = typeof source.senderUserId === "string"
    ? source.senderUserId.replace(/\D/g, "").slice(0, 8)
    : "";
  const bindIp = typeof source.bindIp === "string" ? source.bindIp.trim() : "0.0.0.0";
  const broadcastSubnetMask = typeof source.broadcastSubnetMask === "string"
    ? source.broadcastSubnetMask.trim()
    : "255.255.255.0";

  return {
    senderName,
    senderUserId,
    bindIp,
    broadcastSubnetMask,
  };
}

function generateRandomSenderUserId(): string {
  const array = new Uint32Array(1);
  window.crypto.getRandomValues(array);
  const value = 10_000_000 + (array[0] % 90_000_000);
  return String(value);
}

function resolveCallPhaseName(event: EventSnapshot | null, rawValue: string, phaseOrder: number | null): string {
  const normalized = normalizeCallPhaseName(rawValue);
  const orderMatch = /^order:(\d+)$/.exec(normalized);
  const resolvedPhaseOrder = phaseOrder ?? (orderMatch ? Number(orderMatch[1]) : null);
  if (!orderMatch || resolvedPhaseOrder === null || !event) {
    return normalized;
  }

  const phase = event.phaseGroups?.find((group) => group.phaseOrder === resolvedPhaseOrder);
  if (phase?.phaseName?.trim()) {
    return phase.phaseName.trim();
  }

  const set = event.sets.find(
    (candidate) => candidate.phaseOrder === resolvedPhaseOrder && candidate.phaseName?.trim(),
  );
  return set?.phaseName?.trim() || normalized;
}

function createQrBarcodeDetector(): {
  detect: (source: CanvasImageSource) => Promise<Array<{ rawValue?: string }>>;
} | null {
  const barcodeDetectorCtor = (window as unknown as {
    BarcodeDetector?: new (options?: { formats?: string[] }) => {
      detect: (source: CanvasImageSource) => Promise<Array<{ rawValue?: string }>>;
    };
  }).BarcodeDetector;

  if (!barcodeDetectorCtor) {
    return null;
  }

  return new barcodeDetectorCtor({ formats: ["qr_code"] });
}

function arraysShallowEqual<T>(left: T[], right: T[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) {
      return false;
    }
  }

  return true;
}

function isSameEventManagementSetting(
  leftRaw: EventManagementSetting | undefined,
  rightRaw: EventManagementSetting,
): boolean {
  if (!leftRaw) {
    return false;
  }

  const left = normalizeEventManagementSetting(leftRaw);
  const right = normalizeEventManagementSetting(rightRaw);

  return left.sideDecisionMethod === right.sideDecisionMethod
    && arraysShallowEqual(left.itemListIds, right.itemListIds)
    && arraysShallowEqual(
      normalizeSelectionCountArrays(left.categoryMinCounts, 0),
      normalizeSelectionCountArrays(right.categoryMinCounts, 0),
    )
    && arraysShallowEqual(
      normalizeSelectionCountArrays(left.categoryMaxCounts, 1),
      normalizeSelectionCountArrays(right.categoryMaxCounts, 1),
    )
    && arraysShallowEqual(
      normalizeAllowDuplicatesArray(left.categoryAllowDuplicates),
      normalizeAllowDuplicatesArray(right.categoryAllowDuplicates),
    )
    && clampNonNegativeInteger(Number(left.totalMinCount ?? 0), 0)
      === clampNonNegativeInteger(Number(right.totalMinCount ?? 0), 0)
    && clampNonNegativeInteger(Number(left.totalMaxCount ?? 0), 0)
      === clampNonNegativeInteger(Number(right.totalMaxCount ?? 0), 0);
}

const ITEM_LIST_STORAGE_KEY = "savakan-gg.item-lists.v1";
const EVENT_MGMT_STORAGE_KEY = "savakan-gg.event-mgmt.v1";
const SENDER_PROFILE_STORAGE_KEY = "savakan-gg.sender-profile.v1";
const GENERIC_MESSAGE_STORAGE_KEY = "savakan-gg.generic-messages.v1";
const MAILBOX_FILTER_STORAGE_KEY = "savakan-gg.mailbox-filter.v1";
const MAILBOX_READ_IDS_STORAGE_KEY = "savakan-gg.mailbox-read-ids.v1";
const CALL_LIST_ROTATE_SECONDS_STORAGE_KEY = "savakan-gg.call-list-rotate-seconds.v1";
const CALL_LIST_COLOR_SECONDS_STORAGE_KEY = "savakan-gg.call-list-color-seconds.v1";
const BRACKET_SIDE_ORDER_DISPLAY_STORAGE_KEY = "savakan-gg.bracket-side-order-display.v1";
const BRACKET_ZOOM_LEVEL_STORAGE_KEY = "savakan-gg.bracket-zoom-level.v1";
const STARTGG_FETCH_PER_PAGE_STORAGE_KEY = "savakan-gg.startgg-fetch-per-page.v1";
const MOBILE_INPUT_POLLING_MS_STORAGE_KEY = "savakan-gg.mobile-input-polling-ms.v1";
const LOCAL_COMMUNICATION_DISABLED_STORAGE_KEY = "savakan-gg.local-communication-disabled.v1";

const BRACKET_ZOOM_LEVELS = [1, 0.7, 0.5] as const;

function normalizeBracketZoomLevel(value: unknown): number {
  if (typeof value === "string" || typeof value === "number") {
    const parsed = typeof value === "string" ? Number.parseFloat(value) : Number(value);
    if (Number.isFinite(parsed)) {
      let nearest: number = Number(BRACKET_ZOOM_LEVELS[0]);
      for (const candidate of BRACKET_ZOOM_LEVELS) {
        if (Math.abs(Number(candidate) - parsed) < Math.abs(nearest - parsed)) {
          nearest = Number(candidate);
        }
      }
      return nearest;
    }
  }

  return Number(BRACKET_ZOOM_LEVELS[0]);
}

const APP_TABS: Array<{ id: AppTab; label: string; icon: string; implemented: boolean }> = [
  { id: "create", label: "新規作成", icon: "➕", implemented: true },
  { id: "home", label: "大会一覧", icon: "🏠", implemented: true },
  { id: "tournament", label: "大会管理", icon: "⚙", implemented: true },
  { id: "bracket", label: "ブラケット", icon: "🏆", implemented: true },
  { id: "overlay", label: "オーバーレイ", icon: "📺", implemented: true },
  { id: "item-list", label: "アイテムリスト", icon: "📚", implemented: true },
  { id: "message", label: "メッセージ", icon: "💬", implemented: true },
  { id: "call-list", label: "呼び出しリスト", icon: "📣", implemented: true },
  { id: "users", label: "プレイヤーリスト", icon: "👥", implemented: true },
  { id: "settings", label: "設定", icon: "🔧", implemented: true },
];

function eventSettingKey(slug: string, eventId: string): string {
  return `${normalizeSlugForSettingKey(slug)}::${eventId}`;
}

function sameSnapshotEventKey(
  leftSlug: string,
  leftEventId: string,
  rightSlug: string,
  rightEventId: string,
): boolean {
  return toSlugInput(leftSlug) === toSlugInput(rightSlug)
    && leftEventId.trim() === rightEventId.trim();
}

function roundRobinPairKey(leftEntrantId: string, rightEntrantId: string): string {
  return [leftEntrantId, rightEntrantId].sort((left, right) => left.localeCompare(right, "ja")).join("::");
}

function roundRobinPlaceholderId(slot: SetSlot, source?: SetEntrantSource | null): string {
  const sourceIdentity = source?.typeId
    ? `${source.typeId}:${source.condition?.trim().toLowerCase() || "source"}`
    : null;
  const identity = slot.seedId
    || sourceIdentity
    || slot.seedPlaceholderName?.trim()
    || source?.placeholderName?.trim()
    || slot.entrantName
    || "unknown";
  return `placeholder:${identity}`;
}

function toIntegerScore(value: number | null): number | null {
  if (value === null) {
    return null;
  }

  const rounded = Math.round(value);
  if (Math.abs(value - rounded) > 0.000_001) {
    return null;
  }

  return rounded;
}

function isDqScoreValue(value: number | null): boolean {
  return value !== null && value < 0;
}

function parseDraftScoreValue(rawValue: string): number | null {
  const trimmed = rawValue.trim();
  if (trimmed === "") {
    return null;
  }

  if (trimmed === "-") {
    return -1;
  }

  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed)) {
    return null;
  }

  return parsed;
}

function formatDraftScoreValue(value: number): string {
  return value < 0 ? "-" : String(Math.trunc(value));
}

function normalizeObsSetWins(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.trunc(value));
}

function normalizeObsFontScale(value: number): number {
  if (!Number.isFinite(value)) {
    return 1;
  }
  return Math.min(2, Math.max(0.6, value));
}

function scoreToOverlayGameWins(value: number | null): number {
  if (value === null || value < 0) {
    return 0;
  }
  return normalizeObsSetWins(value);
}

function stepScoreDraftValue(currentRaw: string, delta: number): string {
  const trimmed = currentRaw.trim();
  const parsed = Number(trimmed);
  const base = Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
  const next = Math.max(0, base + delta);
  return String(next);
}

function applyScoreDraftWithOpponentDefault(
  set: SetSnapshot,
  current: SetScoreDraft,
  entrantId: string,
  nextValue: string,
): SetScoreDraft {
  const nextDrafts: SetScoreDraft = {
    ...current,
    [entrantId]: nextValue,
  };

  const parsedNext = parseDraftScoreValue(nextValue);
  if (parsedNext === null || parsedNext < 0) {
    return nextDrafts;
  }

  const otherEntrantId = set.slots.find((slot) => slot.entrantId !== null && slot.entrantId !== entrantId)?.entrantId;
  if (!otherEntrantId) {
    return nextDrafts;
  }

  const otherRaw = nextDrafts[otherEntrantId] ?? "";
  if (otherRaw.trim() !== "") {
    return nextDrafts;
  }

  nextDrafts[otherEntrantId] = "0";
  return nextDrafts;
}

function abbreviateOverlayRoundText(value: string): string {
  return value
    .replace(/\bGrand\s+Finals?\s+Reset\b/gi, "GF Reset")
    .replace(/\bGF\s+Reset\b/gi, "GF Reset")
    .replace(/\bGrand\s+Finals?\b/gi, "GF")
    .trim();
}

function parseScoreCsvText(rawScoreCsv: string): { winnerWins: number; loserWins: number } | null {
  const trimmed = rawScoreCsv.trim();
  if (trimmed === "") {
    return null;
  }

  const parts = trimmed.split("-").map((value) => value.trim());
  if (parts.length !== 2) {
    return null;
  }

  const winnerWins = Number(parts[0]);
  const loserWins = Number(parts[1]);
  if (!Number.isFinite(winnerWins) || !Number.isFinite(loserWins)) {
    return null;
  }

  return {
    winnerWins,
    loserWins,
  };
}

function isDqScoreCsvText(rawScoreCsv: string): boolean {
  const normalized = rawScoreCsv.trim().toLowerCase().replace(/\s+/g, "");
  return normalized === "dq" || /^\d+-dq$/.test(normalized);
}

function isConfirmedSetResult(result: { confirmed?: boolean }): boolean {
  return result.confirmed !== false;
}

function oppositePlaySide(side: PlaySide): PlaySide {
  return side === "1P" ? "2P" : "1P";
}

function deterministicUpperIsOneP(seed: string): boolean {
  let acc = 0;
  for (let i = 0; i < seed.length; i += 1) {
    acc = (acc + seed.charCodeAt(i)) % 9973;
  }
  return acc % 2 === 0;
}

function toSlugInput(raw: string): string {
  const trimmed = raw.trim();
  const withoutPrefix = trimmed.startsWith("tournament/")
    ? trimmed.slice("tournament/".length)
    : trimmed;

  return withoutPrefix.replace(/^\/+|\/+$/g, "");
}

function toApiSlug(rawInput: string): string {
  const normalized = toSlugInput(rawInput);
  if (normalized === "") {
    return "";
  }

  return `tournament/${normalized}`;
}

function toEventApiSlug(tournamentInput: string, eventInput: string): string {
  const trimmed = eventInput.trim();
  if (trimmed === "") {
    return "";
  }

  if (trimmed.startsWith("tournament/")) {
    return trimmed;
  }

  const eventPart = trimmed
    .replace(/^event\//, "")
    .replace(/^\/+|\/+$/g, "");
  const tournamentSlug = toApiSlug(tournamentInput);
  if (tournamentSlug === "" || eventPart === "") {
    return "";
  }

  return `${tournamentSlug}/event/${eventPart}`;
}

function toEventSlugInput(raw: string): string {
  const normalized = raw.trim().replace(/^\/+|\/+$/g, "");
  if (normalized === "") {
    return "";
  }

  const eventPart = normalized.includes("/event/")
    ? (normalized.split("/event/").pop() ?? "")
    : normalized;

  return eventPart.replace(/^event\//, "").replace(/^\/+|\/+$/g, "");
}

function resolveCreatePreviewSelection(
  preview: TournamentPreview,
  preferredEventId: string,
): TournamentEventPreviewItem | null {
  if (preferredEventId !== "") {
    const matched = preview.events.find((event) => event.eventId === preferredEventId) ?? null;
    if (matched) {
      return matched;
    }
  }

  return preview.events[0] ?? null;
}

function bytesToBase32(bytes: Uint8Array): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let buffer = 0;
  let bitsLeft = 0;
  let output = "";

  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bitsLeft += 8;

    while (bitsLeft >= 5) {
      const index = (buffer >>> (bitsLeft - 5)) & 31;
      output += alphabet[index];
      bitsLeft -= 5;
    }
  }

  if (bitsLeft > 0) {
    const index = (buffer << (5 - bitsLeft)) & 31;
    output += alphabet[index];
  }

  return output;
}

async function deriveEncryptedPlayerId(tournamentId: string, eventId: string, entrantId: string): Promise<string> {
  const source = `${tournamentId}:${eventId}:${entrantId}`;
  const digest = await window.crypto.subtle.digest("SHA-256", new TextEncoder().encode(source));
  const token = bytesToBase32(new Uint8Array(digest).slice(0, 12));
  return `PG-${token}`;
}

function sanitizeFileSegment(value: string): string {
  const normalized = value
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/[.]+$/g, "")
    .replace(/^-+|-+$/g, "");
  return normalized === "" ? "untitled" : normalized;
}

function buildPlayerCardFileName(player: UserCardPlayer): string {
  const eventAlias = sanitizeFileSegment(player.eventAlias?.trim() || player.eventName || "event");
  const entrantName = sanitizeFileSegment(player.entrantName || "player");
  return `${eventAlias}_${entrantName}.png`;
}

function buildPrintedPlayerCardPageFileName(eventAlias: string, pageNumber: number, totalPages: number): string {
  const safeEventAlias = sanitizeFileSegment(eventAlias || "event");
  return `${safeEventAlias}_${pageNumber}of${totalPages}.png`;
}

function triggerBlobDownload(blob: Blob, fileName: string): void {
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(href);
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("画像の生成に失敗しました。"));
        return;
      }
      resolve(blob);
    }, "image/png");
  });
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.max(0, Math.min(radius, Math.min(width, height) / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

async function renderPlayerCardCanvas(
  player: UserCardPlayer,
  options?: { width?: number; height?: number },
): Promise<HTMLCanvasElement> {
  const width = Math.max(700, Math.trunc(options?.width ?? 1200));
  const height = Math.max(420, Math.trunc(options?.height ?? 680));
  const pad = Math.round(width * 0.04);
  const qrSize = Math.round(Math.min(width * 0.44, height * 0.66));
  const infoX = pad + 30;
  const infoMaxWidth = Math.max(220, width - qrSize - pad * 2 - 96);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Canvasを初期化できませんでした。ブラウザ設定を確認してください。");
  }

  const bg = ctx.createLinearGradient(0, 0, width, height);
  bg.addColorStop(0, "#f8fafc");
  bg.addColorStop(1, "#dbeafe");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = "#93c5fd";
  ctx.globalAlpha = 0.18;
  ctx.beginPath();
  ctx.ellipse(width * 0.83, height * 0.18, width * 0.21, height * 0.24, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  drawRoundedRect(ctx, pad, pad, width - pad * 2, height - pad * 2, 24);
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#cbd5e1";
  ctx.lineWidth = 2;
  ctx.fill();
  ctx.stroke();

  const titleY = pad + 44;
  ctx.fillStyle = "#1e3a8a";
  ctx.font = "700 32px 'Noto Sans JP', sans-serif";
  ctx.fillText("PLAYER CARD", infoX, titleY);

  ctx.fillStyle = "#475569";
  ctx.font = "500 19px 'Noto Sans JP', sans-serif";
  ctx.fillText("savakan-gg tournament manager", infoX, titleY + 32);

  const aliasLabel = player.eventAlias && player.eventAlias.trim() !== ""
    ? player.eventAlias.trim()
    : "未設定";

  let cursorY = titleY + 110;

  ctx.fillStyle = "#0f172a";
  ctx.font = "700 46px 'Noto Sans JP', sans-serif";
  ctx.fillText(player.entrantName, infoX, cursorY, infoMaxWidth);

  cursorY += 48;
  drawRoundedRect(ctx, infoX - 2, cursorY - 24, infoMaxWidth, 50, 12);
  ctx.fillStyle = "#dbeafe";
  ctx.fill();
  ctx.strokeStyle = "#93c5fd";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.fillStyle = "#1d4ed8";
  ctx.font = "700 24px 'Noto Sans JP', sans-serif";
  ctx.fillText(`大会通称: ${aliasLabel}`, infoX + 12, cursorY + 10, infoMaxWidth - 18);

  cursorY += 56;
  ctx.fillStyle = "#334155";
  ctx.font = "600 21px 'Noto Sans JP', sans-serif";
  ctx.fillText(`正式名称: ${player.tournamentName} / ${player.eventName}`, infoX, cursorY, infoMaxWidth);

  cursorY += 52;
  drawRoundedRect(ctx, infoX - 2, cursorY - 34, infoMaxWidth, 84, 12);
  ctx.fillStyle = "#eff6ff";
  ctx.fill();
  ctx.strokeStyle = "#bfdbfe";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.fillStyle = "#1d4ed8";
  ctx.font = "600 21px 'Noto Sans JP', sans-serif";
  ctx.fillText("PLAYER ID", infoX + 16, cursorY - 4);

  ctx.fillStyle = "#0f172a";
  ctx.font = "700 29px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
  ctx.fillText(player.playerId, infoX + 16, cursorY + 32, infoMaxWidth - 26);

  const qrCanvas = document.createElement("canvas");
  const qrPayload = JSON.stringify({
    playerId: player.playerId,
    tournamentId: player.tournamentId,
    eventId: player.eventId,
    entrantId: player.entrantId,
  });
  await QRCode.toCanvas(qrCanvas, qrPayload, {
    errorCorrectionLevel: "M",
    margin: 1,
    width: qrSize,
    color: {
      dark: "#0f172a",
      light: "#ffffff",
    },
  });

  const qrX = width - pad - qrSize - 20;
  const qrY = Math.round((height - qrSize) / 2) - 8;
  drawRoundedRect(ctx, qrX - 16, qrY - 16, qrSize + 32, qrSize + 32, 14);
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#cbd5e1";
  ctx.lineWidth = 1.5;
  ctx.fill();
  ctx.stroke();
  ctx.drawImage(qrCanvas, qrX, qrY, qrSize, qrSize);

  ctx.fillStyle = "#475569";
  ctx.font = "500 18px 'Noto Sans JP', sans-serif";
  ctx.fillText("2D code", qrX + qrSize / 2 - 34, qrY + qrSize + 36);

  ctx.fillStyle = "#64748b";
  ctx.font = "500 18px 'Noto Sans JP', sans-serif";
  ctx.fillText("Use this ID for remote DQ request identity verification.", infoX, height - pad - 24, infoMaxWidth);

  return canvas;
}

function buildScoreDraftsFromSet(set: SetSnapshot): SetScoreDraft {
  const drafts: SetScoreDraft = {};

  for (const slot of set.slots) {
    if (!slot.entrantId || slot.score === null) {
      continue;
    }

    drafts[slot.entrantId] = formatDraftScoreValue(slot.score);
  }

  return drafts;
}

function buildScoreDraftsFromResult(set: SetSnapshot, result: LocalSetResultMeta): SetScoreDraft {
  const slotScores = result.slotScores ?? [];

  if (slotScores.length > 0) {
    const drafts = buildScoreDraftsFromSet(set);
    for (const slot of slotScores) {
      if (!(slot.entrantId in drafts)) {
        drafts[slot.entrantId] = slot.score < 0 ? "-" : formatDraftScoreValue(slot.score);
      }
    }
    return drafts;
  }

  if (isDqScoreCsvText(result.scoreCsv)) {
    const drafts: SetScoreDraft = {};
    for (const slot of set.slots) {
      if (!slot.entrantId) {
        continue;
      }
      drafts[slot.entrantId] = slot.entrantId === result.winnerId ? "0" : "-1";
    }
    return drafts;
  }

  const parsed = parseScoreCsvText(result.scoreCsv);
  if (!parsed) {
    return buildScoreDraftsFromSet(set);
  }

  const drafts: SetScoreDraft = {};
  for (const slot of set.slots) {
    if (!slot.entrantId) {
      continue;
    }

    drafts[slot.entrantId] = slot.entrantId === result.winnerId
      ? String(parsed.winnerWins)
      : String(parsed.loserWins);
  }

  return drafts;
}

function buildDraftStateFromPending(set: SetSnapshot, result: LocalSetResultMeta): SetResultDraftState {
  if (result.directWin) {
    return {
      winnerId: result.winnerId,
      scoreDrafts: Object.fromEntries(
        set.slots
          .filter((slot) => slot.entrantId)
          .map((slot) => [slot.entrantId as string, slot.entrantId === result.winnerId ? "W" : "L"]),
      ),
      directWin: true,
    };
  }
  return {
    winnerId: result.winnerId,
    scoreDrafts: buildScoreDraftsFromResult(set, result),
  };
}

function buildDqDraftStateForEntrant(set: SetSnapshot, dqEntrantId: string): SetResultDraftState | null {
  const entrantIds = set.slots
    .map((slot) => slot.entrantId)
    .filter((entrantId): entrantId is string => entrantId !== null);

  if (entrantIds.length < 2 || !entrantIds.includes(dqEntrantId)) {
    return null;
  }

  const winnerId = entrantIds.find((entrantId) => entrantId !== dqEntrantId);
  if (!winnerId) {
    return null;
  }

  const scoreDrafts = buildScoreDraftsFromSet(set);
  scoreDrafts[dqEntrantId] = "-";
  scoreDrafts[winnerId] = "0";

  return {
    winnerId,
    scoreDrafts,
  };
}

function resolveWinnerIdFromDrafts(set: SetSnapshot, drafts: SetScoreDraft): string {
  const scored = set.slots
    .map((slot) => {
      if (!slot.entrantId) {
        return null;
      }

      const score = parseDraftScoreValue(drafts[slot.entrantId] ?? "");
      if (score === null) {
        return null;
      }

      return { entrantId: slot.entrantId, score };
    })
    .filter((slot): slot is { entrantId: string; score: number } => slot !== null);

  if (scored.length < 2) {
    return "";
  }

  const dqSlot = scored.find((slot) => slot.score < 0);
  const nonDqSlot = scored.find((slot) => slot.score >= 0);
  if (dqSlot && nonDqSlot && scored.length === 2) {
    return nonDqSlot.entrantId;
  }

  const sorted = [...scored].sort((left, right) => right.score - left.score);
  if (sorted[0].score === sorted[1].score) {
    return "";
  }

  return sorted[0].entrantId;
}

function buildSlotScoresForSave(set: SetSnapshot, drafts: SetScoreDraft): Array<{ entrantId: string; score: number }> {
  const entries = set.slots
    .filter((slot): slot is SetSlot & { entrantId: string } => slot.entrantId !== null)
    .map((slot) => {
      const raw = drafts[slot.entrantId] ?? "";
      return {
        entrantId: slot.entrantId,
        entrantName: slot.entrantName,
        raw,
        score: parseDraftScoreValue(raw),
      };
    });

  if (entries.length < 2) {
    throw new Error("結果入力には少なくとも2人のプレイヤーが必要です。");
  }

  const unfilled = entries.filter((entry) => entry.score === null && entry.raw.trim() === "");
  if (unfilled.length === 1) {
    const hasNonDqScore = entries.some((entry) => entry.score !== null && entry.score >= 0);
    if (hasNonDqScore) {
      unfilled[0].score = 0;
    }
  }

  const slotScores: Array<{ entrantId: string; score: number }> = [];

  for (const entry of entries) {
    if (entry.score === null) {
      throw new Error(`スコアが未入力です: ${entry.entrantName}`);
    }

    slotScores.push({
      entrantId: entry.entrantId,
      score: entry.score,
    });
  }

  return slotScores;
}

function hasDqScoreInDrafts(set: SetSnapshot, drafts: SetScoreDraft): boolean {
  for (const slot of set.slots) {
    if (!slot.entrantId) {
      continue;
    }

    const parsed = parseDraftScoreValue(drafts[slot.entrantId] ?? "");
    if (parsed !== null && parsed < 0) {
      return true;
    }
  }

  return false;
}

function App() {
  const [activeTab, setActiveTab] = useState<AppTab>("home");
  const [appVersion, setAppVersion] = useState("");
  const [token, setToken] = useState("");
  const [slug, setSlug] = useState("");
  const [startggFetchPerPage, setStartggFetchPerPage] = useState(STARTGG_FETCH_PER_PAGE_DEFAULT);
  const [createPreview, setCreatePreview] = useState<TournamentPreview | null>(null);
  const [createPreviewLoadFailed, setCreatePreviewLoadFailed] = useState(false);
  const [createSelectedEventId, setCreateSelectedEventId] = useState("");
  const [createEventSearchInput, setCreateEventSearchInput] = useState("");
  const [createEventSlugInput, setCreateEventSlugInput] = useState("");
  const [createEventAlias, setCreateEventAlias] = useState("");
  const [eventAliasDraft, setEventAliasDraft] = useState("");
  const [createBusy, setCreateBusy] = useState(false);
  const [createSnapshotProgress, setCreateSnapshotProgress] = useState<EventSnapshotProgress | null>(null);
  const [workspace, setWorkspace] = useState<TournamentWorkspace | null>(null);
  const [selectedEventId, setSelectedEventId] = useState("");
  const workspacePollingBlockedRef = useRef(false);
  const [selectedPhaseName, setSelectedPhaseName] = useState("");
  const [selectedPhasePoolKey, setSelectedPhasePoolKey] = useState("");
  const [activeMatchSetId, setActiveMatchSetId] = useState("");
  const [setId, setSetId] = useState("");
  const [scoreDrafts, setScoreDrafts] = useState<SetScoreDraft>({});
  const [directWinnerId, setDirectWinnerId] = useState<string | null>(null);
  const [activeMatchSideDrafts, setActiveMatchSideDrafts] = useState<Record<string, PlaySide | "">>({});
  const [setResultDrafts, setSetResultDrafts] = useState<Record<string, SetResultDraftState>>({});
  const [interimScoreDraftsBySetId, setInterimScoreDraftsBySetId] = useState<Record<string, SetScoreDraft>>({});
  const [metaDrafts, setMetaDrafts] = useState<Record<string, PlayerMetaDraft>>({});
  const [localSnapshotEvents, setLocalSnapshotEvents] = useState<LocalSnapshotEventListItem[]>([]);
  const [homeSnapshotSearchInput, setHomeSnapshotSearchInput] = useState("");
  const [homeSelectedSnapshotKey, setHomeSelectedSnapshotKey] = useState("");
  const [loadingLocalSnapshotEvents, setLoadingLocalSnapshotEvents] = useState(false);
  const [deletingSnapshotKey, setDeletingSnapshotKey] = useState("");
  const [itemLists, setItemLists] = useState<ItemListConfig[]>([]);
  const [itemListsReady, setItemListsReady] = useState(false);
  const [editingItemListId, setEditingItemListId] = useState<string | null>(null);
  const [itemListName, setItemListName] = useState("");
  const [itemCategoryName, setItemCategoryName] = useState("");
  const [itemListText, setItemListText] = useState("");
  const [itemListSearchInput, setItemListSearchInput] = useState("");
  const [eventMgmtSettings, setEventMgmtSettings] = useState<Record<string, EventManagementSetting>>({});
  const [eventMgmtSettingsReady, setEventMgmtSettingsReady] = useState(false);
  const [senderProfile, setSenderProfile] = useState<SenderProfile>({ senderName: "", senderUserId: "", bindIp: "0.0.0.0", broadcastSubnetMask: "255.255.255.0" });
  const [senderProfileReady, setSenderProfileReady] = useState(false);
  const [senderNameDraft, setSenderNameDraft] = useState("");
  const [senderUserIdDraft, setSenderUserIdDraft] = useState("");
  const [senderBindIpDraft, setSenderBindIpDraft] = useState("0.0.0.0");
  const [senderBroadcastSubnetMaskDraft, setSenderBroadcastSubnetMaskDraft] = useState("255.255.255.0");
  const [senderNetworkCandidates, setSenderNetworkCandidates] = useState<LocalNetworkSettingsCandidate[]>([]);
  const [selectedSenderNetworkCandidateKey, setSelectedSenderNetworkCandidateKey] = useState("");
  const [senderNetworkCandidatesLoading, setSenderNetworkCandidatesLoading] = useState(false);
  const [senderIdentityChangedSinceMailboxClear, setSenderIdentityChangedSinceMailboxClear] = useState(false);
  const [genericMessages, setGenericMessages] = useState<GenericMessage[]>([]);
  const [genericMessagesReady, setGenericMessagesReady] = useState(false);
  const [mailboxMethodDraft, setMailboxMethodDraft] = useState("generic");
  const [mailboxSubjectDraft, setMailboxSubjectDraft] = useState("");
  const [messageDeliveryMode, setMessageDeliveryMode] = useState<MailboxDeliveryMode>("broadcast");
  const [messageDeliveryIpDraft, setMessageDeliveryIpDraft] = useState("");
  const [composeFixedBodyDraft, setComposeFixedBodyDraft] = useState<string | null>(null);
  const [genericMessageBodyDraft, setGenericMessageBodyDraft] = useState("");
  const [replyBodyDraft, setReplyBodyDraft] = useState("");
  const [dqDialog, setDqDialog] = useState<DqRequestDialogState | null>(null);
  const [dqPlayerIdDraft, setDqPlayerIdDraft] = useState("");
  const [dqReasonDraft, setDqReasonDraft] = useState("");
  const [dqDialogError, setDqDialogError] = useState("");
  const [dqSubmitting, setDqSubmitting] = useState(false);
  const [dqCameraActive, setDqCameraActive] = useState(false);
  const [selectedThreadId, setSelectedThreadId] = useState("");
  const [callListPageIndex, setCallListPageIndex] = useState(0);
  const [callListPageRotateSeconds, setCallListPageRotateSeconds] = useState(CALL_LIST_ROTATE_SECONDS_DEFAULT);
  const [callListColorSeconds, setCallListColorSeconds] = useState(CALL_LIST_COLOR_SECONDS_DEFAULT);
  const [callListEventSortStrategy, setCallListEventSortStrategy] = useState<CallListEventSortStrategy>("alias");
  const [callListFocusOwnUnresolved, setCallListFocusOwnUnresolved] = useState(false);
  const [displayBracketPlayersBySide, setDisplayBracketPlayersBySide] = useState(true);
  const [bracketZoomLevel, setBracketZoomLevel] = useState<number>(Number(BRACKET_ZOOM_LEVELS[0]));
  const [mobileInputPollingMs, setMobileInputPollingMs] = useState<number>(MOBILE_INPUT_POLLING_MS_DEFAULT);
  const [overlaySwitchConfirm, setOverlaySwitchConfirm] = useState<{ targetSetId: string; targetSetLabel: string } | null>(null);
  const [resultConfirmation, setResultConfirmation] = useState<ResultConfirmationState | null>(null);
  const [callListPageSwitchedAtMs, setCallListPageSwitchedAtMs] = useState(() => Date.now());
  const [callListProgressNowMs, setCallListProgressNowMs] = useState(() => Date.now());
  const [callListDisplayGroups, setCallListDisplayGroups] = useState<CallListEventGroup[]>([]);
  const [callListRebuildToken, setCallListRebuildToken] = useState(0);
  const [callListCycleCount, setCallListCycleCount] = useState(0);
  const [mailboxServiceStarted, setMailboxServiceStarted] = useState(false);
  const [callingEntrantId, setCallingEntrantId] = useState("");
  const [composeMessageMeta, setComposeMessageMeta] = useState<Record<string, unknown> | null>(null);
  const [mailboxFilterSetting, setMailboxFilterSetting] = useState<MailboxFilterSetting>({
    unresolvedOnly: false,
    unreadOnly: false,
  });
  const [mailboxReadMessageIds, setMailboxReadMessageIds] = useState<string[]>([]);
  const [disableLocalCommunication, setDisableLocalCommunication] = useState(false);
  const [sideDecisionMethod, setSideDecisionMethod] = useState<EventManagementSetting["sideDecisionMethod"]>("upper_1p");
  const [matchSideRandomNotice, setMatchSideRandomNotice] = useState<MatchSideRandomNotice | null>(null);
  const [obsOverlayState, setObsOverlayState] = useState<ObsOverlayState | null>(null);
  const [obsOverlayBusy, setObsOverlayBusy] = useState(false);
  const [testOverlayRedName, setTestOverlayRedName] = useState("テストプレイヤー1");
  const [testOverlayBlueName, setTestOverlayBlueName] = useState("テストプレイヤー2");
  const [testOverlayRedWins, setTestOverlayRedWins] = useState(0);
  const [testOverlayBlueWins, setTestOverlayBlueWins] = useState(0);
  const [isTestOverlayActive, setIsTestOverlayActive] = useState(false);
  const [mobileInputPortalBusy, setMobileInputPortalBusy] = useState(false);
  const [mobileInputPortalOpen, setMobileInputPortalOpen] = useState(false);
  const [restoreDialogOpen, setRestoreDialogOpen] = useState(false);
  const [mobileInputPortalDialog, setMobileInputPortalDialog] = useState<MobileInputPortalInfo | null>(null);
  const [mobileInputPortalCandidates, setMobileInputPortalCandidates] = useState<LocalNetworkSettingsCandidate[]>([]);
  const [mobileInputIssuedUrl, setMobileInputIssuedUrl] = useState("");
  const [mobileInputPortalQrUrl, setMobileInputPortalQrUrl] = useState("");
  const [categorySlotListIds, setCategorySlotListIds] = useState<string[]>(["", "", ""]);
  const [categorySlotMinCounts, setCategorySlotMinCounts] = useState<number[]>([0, 0, 0]);
  const [categorySlotMaxCounts, setCategorySlotMaxCounts] = useState<number[]>([1, 1, 1]);
  const [categorySlotAllowDuplicates, setCategorySlotAllowDuplicates] = useState<boolean[]>([false, false, false]);
  const [totalItemMinCount, setTotalItemMinCount] = useState(0);
  const [totalItemMaxCount, setTotalItemMaxCount] = useState(3);
  const [selectedTournamentEntrantId, setSelectedTournamentEntrantId] = useState("");
  const [userCardPlayers, setUserCardPlayers] = useState<UserCardPlayer[]>([]);
  const [selectedUserCardPlayerIds, setSelectedUserCardPlayerIds] = useState<string[]>([]);
  const [selectedUserCardPlayerId, setSelectedUserCardPlayerId] = useState("");
  const [selectedUserCardPreviewUrl, setSelectedUserCardPreviewUrl] = useState("");
  const [userCardBusy, setUserCardBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  workspacePollingBlockedRef.current = busy || createBusy || loadingLocalSnapshotEvents;
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const autoAssigningSidesRef = useRef(false);
  const standbyReadinessRef = useRef<Record<string, string>>({});
  const startupSavedSlugRef = useRef("");
  const startupSavedEventIdRef = useRef("");
  const startupRestoreReadyRef = useRef(false);
  const localSnapshotEventsLoadedOnceRef = useRef(false);
  const startupAutoRestoreDoneRef = useRef(false);
  const startupDirectRestoreTriedRef = useRef(false);
  const startupListRestoreRetryCountRef = useRef(0);
  const lastPersistedSnapshotSelectionRef = useRef("");
  const overlaySelectionKeyRef = useRef<string | null>(null);
  const lastPersistedEventMetaPhasePoolRef = useRef("");
  const eventSettingHydratedKeyRef = useRef("");
  const suppressEventSettingAutosaveRef = useRef(false);
  const dirtyMetaDraftKeysRef = useRef(new Set<string>());
  const autoIpFillTriedRef = useRef(false);
  const tabSelectionAutoLoadInFlightRef = useRef(false);
  const dqCameraVideoRef = useRef<HTMLVideoElement | null>(null);
  const dqCameraCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const dqCameraStreamRef = useRef<MediaStream | null>(null);
  const dqCameraRafRef = useRef<number | null>(null);
  const dqCameraDetectingRef = useRef(false);
  const dqCameraDetectorRef = useRef<{
    detect: (source: CanvasImageSource) => Promise<Array<{ rawValue?: string }>>;
  } | null>(null);
  const overlayPreviewWrapRef = useRef<HTMLDivElement | null>(null);
  const overlayPreviewIframeRef = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    setMobileInputPortalOpen(false);
    setMobileInputPortalDialog(null);
    setMobileInputPortalCandidates([]);
    setMobileInputIssuedUrl("");
    setMobileInputPortalQrUrl("");
  }, [slug, selectedEventId]);

  useEffect(() => {
    let cancelled = false;

    if (!mobileInputPortalDialog || mobileInputIssuedUrl.trim() === "") {
      setMobileInputPortalQrUrl("");
      return () => {
        cancelled = true;
      };
    }

    (async () => {
      try {
        const dataUrl = await QRCode.toDataURL(mobileInputIssuedUrl, {
          errorCorrectionLevel: "M",
          margin: 1,
          width: 320,
          color: {
            dark: "#0f172a",
            light: "#ffffff",
          },
        });
        if (!cancelled) {
          setMobileInputPortalQrUrl(dataUrl);
        }
      } catch {
        if (!cancelled) {
          setMobileInputPortalQrUrl("");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [mobileInputPortalDialog, mobileInputIssuedUrl]);

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        const version = await getVersion();
        if (alive) {
          setAppVersion(version);
        }
      } catch {
        // ignore (e.g. non-Tauri environment)
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    let unlisten: (() => void) | null = null;

    void (async () => {
      try {
        const off = await listen<EventSnapshotProgress>(EVENT_SNAPSHOT_PROGRESS_EVENT, (event) => {
          if (!alive) {
            return;
          }
          if (event.payload.phase === "completed") {
            setCreateSnapshotProgress(null);
            return;
          }
          setCreateSnapshotProgress(event.payload);
        });
        unlisten = off;
      } catch {
        // ignore listener setup failure in non-Tauri environments
      }
    })();

    return () => {
      alive = false;
      if (unlisten) {
        unlisten();
      }
    };
  }, []);

  useEffect(() => {
    let alive = true;
    let unlisten: (() => void) | null = null;

    void (async () => {
      try {
        const off = await listen<WorkspaceUpdatedEvent>(WORKSPACE_UPDATED_EVENT, (event) => {
          if (!alive) {
            return;
          }

          if (toApiSlug(event.payload.slug) !== toApiSlug(slug) || event.payload.eventId !== selectedEventId) {
            return;
          }

          void (async () => {
            try {
              const result = await invoke<TournamentWorkspace>("load_local_tournament_workspace", {
                slug: toApiSlug(slug),
                eventId: selectedEventId,
              });
              if (alive) {
                setWorkspace(result);
                setSetResultDrafts({});
                setInterimScoreDraftsBySetId({});

                const refreshedSet = result.snapshot.events
                  .find((event) => event.eventId === selectedEventId)
                  ?.sets.find((set) => set.setId === activeMatchSetId);
                if (refreshedSet) {
                  const refreshedPending = result.localMeta.pendingSetResults.find(
                    (item) => item.eventId === selectedEventId && item.setId === activeMatchSetId,
                  );
                  setScoreDrafts(
                    refreshedPending
                      ? buildScoreDraftsFromResult(refreshedSet, refreshedPending)
                      : buildScoreDraftsFromSet(refreshedSet),
                  );
                  setDirectWinnerId(refreshedPending?.directWin ? refreshedPending.winnerId : null);
                  const refreshedSideDrafts: Record<string, PlaySide | ""> = {};
                  for (const slot of refreshedSet.slots) {
                    if (slot.entrantId) {
                      refreshedSideDrafts[slot.entrantId] = getSetSlotSide(refreshedSet.setId, slot.entrantId);
                    }
                  }
                  setActiveMatchSideDrafts(refreshedSideDrafts);
                }
              }
            } catch {
              // ignore refresh errors from mobile-triggered updates
            }
          })();
        });
        unlisten = off;
      } catch {
        // ignore listener setup failure in non-Tauri environments
      }
    })();

    return () => {
      alive = false;
      if (unlisten) {
        unlisten();
      }
    };
  }, [activeMatchSetId, selectedEventId, slug]);

  useEffect(() => {
    let alive = true;
    let unlisten: (() => void) | null = null;

    void (async () => {
      try {
        const off = await listen<ObsOverlayState>(OBS_OVERLAY_STATE_CHANGED_EVENT, (event) => {
          if (!alive) {
            return;
          }

          setObsOverlayState(event.payload);
          setIsTestOverlayActive(event.payload.active && event.payload.currentSetId === "__test__");
        });
        unlisten = off;
      } catch {
        // ignore listener setup failure in non-Tauri environments
      }
    })();

    return () => {
      alive = false;
      if (unlisten) {
        unlisten();
      }
    };
  }, []);

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        const savedToken = await invoke<string | null>("load_saved_startgg_token");
        if (alive && savedToken && savedToken.trim() !== "") {
          setToken(savedToken);
        }

        const savedSelection = await invoke<{
          slug: string;
          eventId: string;
          phaseName?: string | null;
          phaseGroupName?: string | null;
        } | null>(
          "load_last_snapshot_selection",
        );
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

        const savedSlug = await invoke<string | null>("load_last_slug");
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

        const savedItemLists = await invoke<ItemListConfig[] | null>("load_item_lists");
        if (!alive) {
          return;
        }

        if (savedItemLists !== null) {
          setItemLists(savedItemLists);
          return;
        }

        try {
          const raw = window.localStorage.getItem(ITEM_LIST_STORAGE_KEY);
          if (raw) {
            const parsed = JSON.parse(raw) as ItemListConfig[];
            if (Array.isArray(parsed)) {
              setItemLists(parsed);
            }
          }
        } catch {
          // ignore
        }
      } catch (err) {
        if (alive) {
          setError(String(err));
        }
      } finally {
        if (alive) {
          startupRestoreReadyRef.current = true;
          setItemListsReady(true);
        }
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    try {
      const rawFilter = window.localStorage.getItem(MAILBOX_FILTER_STORAGE_KEY);
      if (rawFilter) {
        const parsed = JSON.parse(rawFilter) as unknown;
        setMailboxFilterSetting(normalizeMailboxFilterSetting(parsed));
      }
    } catch {
      // ignore
    }

    try {
      const rawReadIds = window.localStorage.getItem(MAILBOX_READ_IDS_STORAGE_KEY);
      if (rawReadIds) {
        const parsed = JSON.parse(rawReadIds) as unknown;
        if (Array.isArray(parsed)) {
          const normalized = parsed
            .filter((item): item is string => typeof item === "string")
            .map((item) => item.trim())
            .filter((item) => item !== "");
          setMailboxReadMessageIds([...new Set(normalized)]);
        }
      }
    } catch {
      // ignore
    }

    try {
      const rawRotateSeconds = window.localStorage.getItem(CALL_LIST_ROTATE_SECONDS_STORAGE_KEY);
      if (rawRotateSeconds !== null) {
        setCallListPageRotateSeconds(normalizeCallListRotateSeconds(rawRotateSeconds));
      }
    } catch {
      // ignore
    }

    try {
      const rawColorSeconds = window.localStorage.getItem(CALL_LIST_COLOR_SECONDS_STORAGE_KEY);
      if (rawColorSeconds !== null) {
        setCallListColorSeconds(normalizeCallListColorSeconds(rawColorSeconds));
      }
    } catch {
      // ignore
    }

    try {
      const rawBracketSideOrderDisplay = window.localStorage.getItem(BRACKET_SIDE_ORDER_DISPLAY_STORAGE_KEY);
      if (rawBracketSideOrderDisplay !== null) {
        setDisplayBracketPlayersBySide(rawBracketSideOrderDisplay === "true");
      } else {
        setDisplayBracketPlayersBySide(true);
      }
    } catch {
      // ignore
    }

    try {
      const rawBracketZoomLevel = window.localStorage.getItem(BRACKET_ZOOM_LEVEL_STORAGE_KEY);
      if (rawBracketZoomLevel !== null) {
        setBracketZoomLevel(normalizeBracketZoomLevel(rawBracketZoomLevel));
      }
    } catch {
      // ignore
    }

    try {
      const rawStartggFetchPerPage = window.localStorage.getItem(STARTGG_FETCH_PER_PAGE_STORAGE_KEY);
      if (rawStartggFetchPerPage !== null) {
        setStartggFetchPerPage(normalizeStartggFetchPerPage(rawStartggFetchPerPage));
      }
    } catch {
      // ignore
    }

    try {
      const rawDisableLocalCommunication = window.localStorage.getItem(LOCAL_COMMUNICATION_DISABLED_STORAGE_KEY);
      if (rawDisableLocalCommunication !== null) {
        setDisableLocalCommunication(rawDisableLocalCommunication === "true");
      }
    } catch {
      // ignore
    }

    try {
      const rawMobileInputPollingMs = window.localStorage.getItem(MOBILE_INPUT_POLLING_MS_STORAGE_KEY);
      if (rawMobileInputPollingMs !== null) {
        setMobileInputPollingMs(normalizeMobileInputPollingMs(rawMobileInputPollingMs));
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        CALL_LIST_ROTATE_SECONDS_STORAGE_KEY,
        String(normalizeCallListRotateSeconds(callListPageRotateSeconds)),
      );
    } catch {
      // ignore
    }
  }, [callListPageRotateSeconds]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        CALL_LIST_COLOR_SECONDS_STORAGE_KEY,
        String(normalizeCallListColorSeconds(callListColorSeconds)),
      );
    } catch {
      // ignore
    }
  }, [callListColorSeconds]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        BRACKET_SIDE_ORDER_DISPLAY_STORAGE_KEY,
        displayBracketPlayersBySide ? "true" : "false",
      );
    } catch {
      // ignore
    }
  }, [displayBracketPlayersBySide]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        BRACKET_ZOOM_LEVEL_STORAGE_KEY,
        String(bracketZoomLevel),
      );
    } catch {
      // ignore
    }
  }, [bracketZoomLevel]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        STARTGG_FETCH_PER_PAGE_STORAGE_KEY,
        String(normalizeStartggFetchPerPage(startggFetchPerPage)),
      );
    } catch {
      // ignore
    }
  }, [startggFetchPerPage]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        LOCAL_COMMUNICATION_DISABLED_STORAGE_KEY,
        disableLocalCommunication ? "true" : "false",
      );
    } catch {
      // ignore
    }
  }, [disableLocalCommunication]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        MOBILE_INPUT_POLLING_MS_STORAGE_KEY,
        String(normalizeMobileInputPollingMs(mobileInputPollingMs)),
      );
    } catch {
      // ignore
    }
  }, [mobileInputPollingMs]);

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        const fromRust = await invoke<SenderProfile | null>("load_sender_profile");
        if (!alive) {
          return;
        }

        if (fromRust) {
          const normalized = normalizeSenderProfile(fromRust);
          setSenderProfile(normalized);
          setSenderNameDraft(normalized.senderName);
          setSenderUserIdDraft(normalized.senderUserId);
          setSenderBindIpDraft(normalized.bindIp);
          setSenderBroadcastSubnetMaskDraft(normalized.broadcastSubnetMask);
          return;
        }

        const raw = window.localStorage.getItem(SENDER_PROFILE_STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as unknown;
          const normalized = normalizeSenderProfile(parsed);
          setSenderProfile(normalized);
          setSenderNameDraft(normalized.senderName);
          setSenderUserIdDraft(normalized.senderUserId);
          setSenderBindIpDraft(normalized.bindIp);
          setSenderBroadcastSubnetMaskDraft(normalized.broadcastSubnetMask);
        }
      } catch {
        // ignore
      } finally {
        if (alive) {
          setSenderProfileReady(true);
        }
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        const fromRust = await invoke<GenericMessage[] | null>("load_generic_messages");
        if (!alive) {
          return;
        }

        if (fromRust) {
          setGenericMessages(normalizeGenericMessages(fromRust));
          return;
        }

        const raw = window.localStorage.getItem(GENERIC_MESSAGE_STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as unknown;
          setGenericMessages(normalizeGenericMessages(parsed));
        }
      } catch {
        // ignore
      } finally {
        if (alive) {
          setGenericMessagesReady(true);
        }
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        const fromRust = await invoke<Record<string, unknown> | null>("load_event_mgmt_settings");
        if (!alive) {
          return;
        }

        if (fromRust && typeof fromRust === "object") {
          const normalized: Record<string, EventManagementSetting> = {};
          for (const [key, value] of Object.entries(fromRust)) {
            normalized[normalizeEventSettingStorageKey(key)] = normalizeEventManagementSetting(value);
          }
          setEventMgmtSettings(normalized);
          return;
        }

        const raw = window.localStorage.getItem(EVENT_MGMT_STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as Record<string, unknown>;
          if (parsed && typeof parsed === "object") {
            const normalized: Record<string, EventManagementSetting> = {};
            for (const [key, value] of Object.entries(parsed)) {
              normalized[normalizeEventSettingStorageKey(key)] = normalizeEventManagementSetting(value);
            }
            setEventMgmtSettings(normalized);
          }
        }
      } catch {
        // ignore
      } finally {
        if (alive) {
          setEventMgmtSettingsReady(true);
        }
      }

    })();

    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!itemListsReady) {
      return;
    }

    try {
      window.localStorage.setItem(ITEM_LIST_STORAGE_KEY, JSON.stringify(itemLists));
    } catch {
      // ignore
    }

    void invoke("save_item_lists", { itemLists }).catch((err) => {
      setError(String(err));
    });
  }, [itemLists]);

  useEffect(() => {
    if (!eventMgmtSettingsReady) {
      return;
    }

    try {
      window.localStorage.setItem(EVENT_MGMT_STORAGE_KEY, JSON.stringify(eventMgmtSettings));
    } catch {
      // ignore
    }

    void invoke("save_event_mgmt_settings", { settings: eventMgmtSettings }).catch((err) => {
      setError(String(err));
    });
  }, [eventMgmtSettings]);

  useEffect(() => {
    if (!senderProfileReady) {
      return;
    }

    if (autoIpFillTriedRef.current) {
      return;
    }

    autoIpFillTriedRef.current = true;

    void invoke<string | null>("detect_local_ipv4")
      .then((detectedIp) => {
        if (!detectedIp || !isValidIpv4(detectedIp)) {
          return;
        }

        const shouldUpdateDraft = senderBindIpDraft.trim() === ""
          || senderBindIpDraft.trim() === "0.0.0.0"
          || !isValidIpv4(senderBindIpDraft.trim());

        if (shouldUpdateDraft) {
          setSenderBindIpDraft(detectedIp);
        }

        const currentProfileIp = senderProfile.bindIp.trim();
        const shouldUpdateProfile = currentProfileIp === ""
          || currentProfileIp === "0.0.0.0"
          || !isValidIpv4(currentProfileIp);

        if (shouldUpdateProfile) {
          setSenderProfile((current) => ({
            ...current,
            bindIp: detectedIp,
          }));
        }
      })
      .catch(() => {
        // ignore auto detect failure
      });
  }, [senderBindIpDraft, senderProfile, senderProfileReady]);

  useEffect(() => {
    if (!senderProfileReady) {
      return;
    }

    if (senderProfile.senderName.trim() === "" || !isValidSenderUserId(senderProfile.senderUserId)) {
      return;
    }

    try {
      window.localStorage.setItem(SENDER_PROFILE_STORAGE_KEY, JSON.stringify(senderProfile));
    } catch {
      // ignore
    }

    void invoke("save_sender_profile", { profile: senderProfile }).catch((err) => {
      setError(String(err));
    });
  }, [senderProfile, senderProfileReady]);

  useEffect(() => {
    if (!genericMessagesReady) {
      return;
    }

    try {
      window.localStorage.setItem(GENERIC_MESSAGE_STORAGE_KEY, JSON.stringify(genericMessages));
    } catch {
      // ignore
    }

    void invoke("save_generic_messages", { messages: genericMessages }).catch((err) => {
      setError(String(err));
    });
  }, [genericMessages, genericMessagesReady]);

  useEffect(() => {
    try {
      window.localStorage.setItem(MAILBOX_FILTER_STORAGE_KEY, JSON.stringify(mailboxFilterSetting));
    } catch {
      // ignore
    }
  }, [mailboxFilterSetting]);

  useEffect(() => {
    try {
      window.localStorage.setItem(MAILBOX_READ_IDS_STORAGE_KEY, JSON.stringify(mailboxReadMessageIds));
    } catch {
      // ignore
    }
  }, [mailboxReadMessageIds]);

  useEffect(() => {
    setMailboxReadMessageIds((current) => {
      const known = new Set(genericMessages.map((item) => item.messageId));
      const next = current.filter((id) => known.has(id));
      if (next.length === current.length) {
        return current;
      }
      return next;
    });
  }, [genericMessages]);

  useEffect(() => {
    if (!senderProfileReady) {
      return;
    }

    if (disableLocalCommunication) {
      setMailboxServiceStarted(false);
      void invoke("stop_udp_mailbox_service").catch(() => {
        // ignore
      });
      return;
    }

    if (!isValidSenderUserId(senderProfile.senderUserId) || !isValidIpv4(senderProfile.bindIp)) {
      return;
    }

    void invoke("start_udp_mailbox_service", { profile: senderProfile })
      .then(() => {
        setMailboxServiceStarted(true);
      })
      .catch((err) => {
        setMailboxServiceStarted(false);
        setError(String(err));
      });
  }, [disableLocalCommunication, senderProfile, senderProfileReady]);

  useEffect(() => {
    if (!genericMessagesReady) {
      return;
    }

    let disposed = false;
    const timer = window.setInterval(() => {
      void invoke<GenericMessage[] | null>("load_generic_messages")
        .then((rows) => {
          if (disposed || !rows) {
            return;
          }

          const normalized = normalizeGenericMessages(rows);
          setGenericMessages((current) => {
            if (hasSameGenericMessageOrder(current, normalized)) {
              return current;
            }
            return normalized;
          });
        })
        .catch(() => {
          // ignore polling errors
        });
    }, 1200);

    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [genericMessagesReady]);

  useEffect(() => {
    if (activeTab !== "home") {
      return;
    }

    void refreshLocalSnapshotEvents();
  }, [activeTab]);

  useEffect(() => {
    if (activeTab !== "bracket") {
      return;
    }

    const normalizedSlug = toApiSlug(slug);
    if (normalizedSlug === "" || selectedEventId.trim() === "") {
      return;
    }

    const workspaceAlreadyLoaded = workspace
      && toApiSlug(workspace.snapshot.slug) === normalizedSlug
      && workspace.snapshot.events.some((event) => event.eventId === selectedEventId);
    if (workspaceAlreadyLoaded) {
      return;
    }

    if (workspacePollingBlockedRef.current) {
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
  }, [activeTab, selectedEventId, slug, workspace]);

  useEffect(() => {
    if (startupAutoRestoreDoneRef.current) {
      return;
    }

    if (!startupRestoreReadyRef.current) {
      return;
    }

    if (!localSnapshotEventsLoadedOnceRef.current) {
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
          const result = await invoke<TournamentWorkspace>("load_local_tournament_workspace", {
            slug: savedSlug,
            eventId: savedEventId,
          });

          setSlug(toSlugInput(savedSlug));
          setSelectedEventId(savedEventId);
          setWorkspace(result);
          startupAutoRestoreDoneRef.current = true;
        } catch {
          // Direct restore can fail when old slug formats remain in persisted data.
          // Trigger list reload so this effect re-runs and falls back to list-based restore.
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

    let matched = null as LocalSnapshotEventListItem | null;
    if (savedEventId !== "") {
      matched = localSnapshotEvents.find(
        (item) => sameSnapshotEventKey(item.slug, item.eventId, savedSlug, savedEventId),
      ) ?? null;
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

  useEffect(() => {
    if (!createPreview) {
      return;
    }

    const selected = resolveCreatePreviewSelection(createPreview, createSelectedEventId);
    if (selected?.eventId === createSelectedEventId) {
      return;
    }

    setCreateSelectedEventId(selected?.eventId ?? "");
    setCreateEventSlugInput(toEventSlugInput(selected?.eventSlug ?? ""));
  }, [createPreview, createSelectedEventId]);

  const snapshot = workspace?.snapshot ?? null;
  const localMeta = workspace?.localMeta ?? null;
  const setPlaySides = localMeta?.setPlaySides ?? [];
  const pendingSetResults = localMeta?.pendingSetResults ?? [];
  const pendingGrandFinalResetResults = localMeta?.pendingGrandFinalResetResults ?? [];
  const confirmedSetResults = pendingSetResults.filter((result) => isConfirmedSetResult(result));
  const draftSetResults = pendingSetResults.filter((result) => !isConfirmedSetResult(result));
  const confirmedGrandFinalResetResults = pendingGrandFinalResetResults.filter((result) => isConfirmedSetResult(result));
  const draftGrandFinalResetResults = pendingGrandFinalResetResults.filter((result) => !isConfirmedSetResult(result));
  const confirmedReportableCount = confirmedSetResults.length + confirmedGrandFinalResetResults.length;
  const draftPendingCount = draftSetResults.length + draftGrandFinalResetResults.length;

  const setPlaySideMap = useMemo(() => {
    const map = new Map<string, PlaySide>();
    for (const item of setPlaySides) {
      map.set(`${item.setId}:${item.entrantId}`, item.playSide);
    }
    return map;
  }, [setPlaySides]);

  const allSets = useMemo(() => {
    if (!snapshot) {
      return [] as Array<{ eventName: string; set: SetSnapshot }>;
    }

    return snapshot.events.flatMap((event) =>
      event.sets
        .filter((set) => isDisplayableSet(set, event))
        .map((set) => ({ eventName: event.name, set })),
    );
  }, [snapshot]);

  const selectedEvent = useMemo(() => {
    if (!snapshot || snapshot.events.length === 0 || selectedEventId === "") {
      return null;
    }

    return snapshot.events.find((event) => event.eventId === selectedEventId) ?? null;
  }, [snapshot, selectedEventId]);

  const bracketReport = useBracketReport<TournamentWorkspace>({
    slug: toApiSlug(slug),
    eventId: selectedEvent?.eventId ?? null,
    perPage: normalizeStartggFetchPerPage(startggFetchPerPage),
    reportableCount: confirmedReportableCount,
    setWorkspace,
    closeMatchDialog,
    setBusy,
    setError,
    setMessage,
    clearSnapshotProgress: () => setCreateSnapshotProgress(null),
  });

  const resolvedEventSetsById = useMemo(() => {
    if (!selectedEvent) {
      return new Map<string, SetSnapshot>();
    }

    const resolveSetEntrants = createSetEntrantResolver(
      selectedEvent.sets,
      selectedEvent.phaseGroups ?? [],
    );
    return new Map(selectedEvent.sets.map((set) => [set.setId, resolveSetEntrants(set)]));
  }, [selectedEvent]);

  const selectedEventMeta = useMemo(() => {
    if (!localMeta || !selectedEvent) {
      return null;
    }

    return localMeta.events.find((event) => event.eventId === selectedEvent.eventId) ?? null;
  }, [localMeta, selectedEvent]);

  useEffect(() => {
    setEventAliasDraft(selectedEventMeta?.eventAlias?.trim() ?? "");
  }, [selectedEventMeta]);

  const selectedMessageScope = useMemo<MessageScope | null>(() => {
    if (!snapshot || !selectedEvent) {
      return null;
    }

    const parsedPhasePool = parsePhasePoolKey(selectedPhasePoolKey);
    const selectedPhase = parsedPhasePool?.phaseName ?? selectedPhaseName.trim();
    const selectedPhaseGroup = parsedPhasePool?.phaseGroupName ?? "";

    return {
      tournamentId: snapshot.tournamentId,
      slug: snapshot.slug,
      eventId: selectedEvent.eventId,
      phaseName: selectedPhase,
      phaseGroupName: selectedPhaseGroup,
    };
  }, [selectedEvent, selectedPhaseName, selectedPhasePoolKey, snapshot]);

  const selectedMailboxScope = useMemo<MessageScope | null>(() => {
    if (!selectedMessageScope) {
      return null;
    }

    // メッセージボックスは同一イベント内を横断表示する。
    return {
      ...selectedMessageScope,
      phaseName: "",
      phaseGroupName: "",
    };
  }, [selectedMessageScope]);

  const scopedGenericMessages = useMemo(() => {
    return genericMessages.filter((message) => isMessageForScope(message, selectedMailboxScope));
  }, [genericMessages, selectedMailboxScope]);

  const selectedEventItemListSnapshots = useMemo(() => {
    if (!selectedEventMeta?.eventManagement?.itemListSnapshots) {
      return [] as ItemListConfig[];
    }

    return selectedEventMeta.eventManagement.itemListSnapshots
      .slice(0, MAX_CATEGORY_SLOTS)
      .map((item) => normalizeItemListConfig(item));
  }, [selectedEventMeta]);

  function resolveItemListForSelectedEvent(listId: string): ItemListConfig | null {
    const normalizedId = listId.trim();
    if (normalizedId === "") {
      return null;
    }

    const snapshotItem = selectedEventItemListSnapshots.find((item) => item.id === normalizedId);
    if (snapshotItem) {
      return snapshotItem;
    }

    return itemLists.find((item) => item.id === normalizedId) ?? null;
  }

  useEffect(() => {
    if (!snapshot || !selectedEvent) {
      return;
    }

    const slugKey = toSlugInput(snapshot.slug);
    const eventIdKey = selectedEvent.eventId.trim();
    if (slugKey === "" || eventIdKey === "") {
      return;
    }

    const selectionKey = [
      slugKey,
      eventIdKey,
      selectedMessageScope?.phaseName.trim() ?? "",
      selectedMessageScope?.phaseGroupName.trim() ?? "",
    ].join("::");
    if (selectionKey === lastPersistedSnapshotSelectionRef.current) {
      return;
    }

    lastPersistedSnapshotSelectionRef.current = selectionKey;
    void invoke("save_last_snapshot_selection", {
      slug: snapshot.slug,
      eventId: selectedEvent.eventId,
      phaseName: selectedMessageScope?.phaseName ?? null,
      phaseGroupName: selectedMessageScope?.phaseGroupName ?? null,
    }).catch((err) => {
      lastPersistedSnapshotSelectionRef.current = "";
      setError(String(err));
    });
  }, [selectedEvent, selectedMessageScope, snapshot]);

  useEffect(() => {
    if (!snapshot || !selectedEvent) {
      return;
    }

    const parsed = parsePhasePoolKey(selectedPhasePoolKey);
    const phaseName = (parsed?.phaseName ?? selectedPhaseName).trim();
    const phaseGroupName = (parsed?.phaseGroupName ?? "").trim();
    if (phaseName === "" || phaseGroupName === "") {
      return;
    }

    const slugKey = toSlugInput(snapshot.slug);
    const eventIdKey = selectedEvent.eventId.trim();
    if (slugKey === "" || eventIdKey === "") {
      return;
    }

    const persistKey = `${slugKey}::${eventIdKey}::${phaseName}::${phaseGroupName}`;
    if (persistKey === lastPersistedEventMetaPhasePoolRef.current) {
      return;
    }

    lastPersistedEventMetaPhasePoolRef.current = persistKey;

    setLocalSnapshotEvents((current) => current.map((item) => {
      if (!sameSnapshotEventKey(item.slug, item.eventId, snapshot.slug, selectedEvent.eventId)) {
        return item;
      }

      return {
        ...item,
        lastSelectedPhaseName: phaseName,
        lastSelectedPhaseGroupName: phaseGroupName,
      };
    }));

    void invoke("save_event_last_phase_pool_selection", {
      slug: snapshot.slug,
      eventId: selectedEvent.eventId,
      eventName: selectedEvent.name,
      phaseName,
      phaseGroupName,
    }).catch((err) => {
      lastPersistedEventMetaPhasePoolRef.current = "";
      setError(String(err));
    });
  }, [selectedEvent, selectedPhaseName, selectedPhasePoolKey, snapshot]);

  const selectedEventSettingKey = useMemo(() => {
    if (!snapshot || !selectedEvent) {
      return "";
    }
    return eventSettingKey(snapshot.slug, selectedEvent.eventId);
  }, [snapshot, selectedEvent]);

  const configuredCategorySlots = useMemo(() => {
    const slots: Array<{
      slotIndex: number;
      list: ItemListConfig;
      minCount: number;
      maxCount: number;
      allowDuplicates: boolean;
    }> = [];

    for (let slotIndex = 0; slotIndex < MAX_CATEGORY_SLOTS; slotIndex += 1) {
      const listId = categorySlotListIds[slotIndex] ?? "";
      if (listId.trim() === "") {
        continue;
      }

      const list = resolveItemListForSelectedEvent(listId);
      if (!list) {
        continue;
      }

      const minCount = clampNonNegativeInteger(categorySlotMinCounts[slotIndex] ?? 0, 0);
      const maxCount = Math.max(
        clampNonNegativeInteger(categorySlotMaxCounts[slotIndex] ?? 1, 1),
        minCount,
      );

      slots.push({
        slotIndex,
        list,
        minCount,
        maxCount,
        allowDuplicates: Boolean(categorySlotAllowDuplicates[slotIndex]),
      });
    }

    return slots;
  }, [
    categorySlotAllowDuplicates,
    categorySlotListIds,
    categorySlotMaxCounts,
    categorySlotMinCounts,
    itemLists,
    selectedEventItemListSnapshots,
  ]);

  const selectedSummaryName = useMemo(() => {
    const alias = selectedEventMeta?.eventAlias?.trim();
    if (alias) {
      return alias;
    }

    if (selectedEvent?.name) {
      return selectedEvent.name;
    }

    const startupSelectedSlug = startupSavedSlugRef.current.trim();
    const startupSelectedEventId = startupSavedEventIdRef.current.trim();
    const currentSelectedSlug = snapshot?.slug?.trim() || startupSelectedSlug;
    const currentSelectedEventId = selectedEventId.trim() || startupSelectedEventId;
    if (currentSelectedSlug !== "" && currentSelectedEventId !== "") {
      const matched = localSnapshotEvents.find((item) =>
        sameSnapshotEventKey(currentSelectedSlug, currentSelectedEventId, item.slug, item.eventId)
      );
      const matchedAlias = matched?.eventAlias?.trim();
      if (matchedAlias) {
        return matchedAlias;
      }
      if (matched?.eventName) {
        return matched.eventName;
      }
    }

    return snapshot?.name ?? "未選択";
  }, [localSnapshotEvents, selectedEventMeta, selectedEvent, selectedEventId, snapshot]);

  const selectedSidebarItem = useMemo(() => {
    const startupSelectedSlug = startupSavedSlugRef.current.trim();
    const startupSelectedEventId = startupSavedEventIdRef.current.trim();
    const currentSelectedSlug = snapshot?.slug?.trim() || startupSelectedSlug;
    const currentSelectedEventId = selectedEvent?.eventId?.trim() || selectedEventId.trim() || startupSelectedEventId;

    if (currentSelectedSlug === "" || currentSelectedEventId === "") {
      return null;
    }

    return localSnapshotEvents.find((item) =>
      sameSnapshotEventKey(currentSelectedSlug, currentSelectedEventId, item.slug, item.eventId)
    ) ?? null;
  }, [localSnapshotEvents, selectedEvent, selectedEventId, snapshot]);

  const homeFilteredSnapshotEvents = useMemo(() => {
    const normalizedQuery = homeSnapshotSearchInput.trim().toLocaleLowerCase();
    if (normalizedQuery === "") {
      return localSnapshotEvents;
    }

    return localSnapshotEvents.filter((item) => {
      const alias = localSnapshotAliasLabel(item).toLocaleLowerCase();
      const tournamentName = item.tournamentName.toLocaleLowerCase();
      const eventName = item.eventName.toLocaleLowerCase();
      const slugText = item.slug.toLocaleLowerCase();
      return alias.includes(normalizedQuery)
        || tournamentName.includes(normalizedQuery)
        || eventName.includes(normalizedQuery)
        || slugText.includes(normalizedQuery);
    });
  }, [homeSnapshotSearchInput, localSnapshotEvents]);

  const homeSelectedSnapshotItem = useMemo(() => {
    if (homeFilteredSnapshotEvents.length === 0) {
      return null;
    }

    if (homeSelectedSnapshotKey !== "") {
      const matched = homeFilteredSnapshotEvents.find((item) => localSnapshotItemKey(item) === homeSelectedSnapshotKey);
      if (matched) {
        return matched;
      }
    }

    return null;
  }, [homeFilteredSnapshotEvents, homeSelectedSnapshotKey]);

  useEffect(() => {
    if (localSnapshotEvents.length === 0) {
      if (homeSelectedSnapshotKey !== "") {
        setHomeSelectedSnapshotKey("");
      }
      return;
    }

    if (homeSelectedSnapshotKey !== "") {
      const stillExists = localSnapshotEvents.some((item) => localSnapshotItemKey(item) === homeSelectedSnapshotKey);
      if (stillExists) {
        return;
      }
    }

  }, [homeSelectedSnapshotKey, localSnapshotEvents]);

  useEffect(() => {
    if (workspace || busy || loadingLocalSnapshotEvents || tabSelectionAutoLoadInFlightRef.current) {
      return;
    }

    const requiresSelectedEvent = activeTab === "tournament"
      || activeTab === "bracket"
      || activeTab === "message"
      || activeTab === "users";
    if (!requiresSelectedEvent) {
      return;
    }

    if (!selectedSidebarItem) {
      return;
    }

    tabSelectionAutoLoadInFlightRef.current = true;
    void (async () => {
      try {
        await selectLocalSnapshotEvent(selectedSidebarItem);
      } finally {
        tabSelectionAutoLoadInFlightRef.current = false;
      }
    })();
  }, [activeTab, busy, loadingLocalSnapshotEvents, selectedSidebarItem, workspace]);

  const filteredItemLists = useMemo(() => {
    const normalizedQuery = itemListSearchInput.trim().toLocaleLowerCase();
    if (normalizedQuery === "") {
      return [...itemLists].sort((a, b) => a.name.localeCompare(b.name, "ja"));
    }

    return [...itemLists]
      .filter((itemList) => {
        const listName = itemList.name.toLocaleLowerCase();
        const categoryName = itemList.categoryName.toLocaleLowerCase();
        const itemNames = itemList.items.map((itemName) => itemName.toLocaleLowerCase()).join(" ");

        return listName.includes(normalizedQuery)
          || categoryName.includes(normalizedQuery)
          || itemNames.includes(normalizedQuery);
      })
      .sort((a, b) => a.name.localeCompare(b.name, "ja"));
  }, [itemListSearchInput, itemLists]);

  const selectedCategoryUsageList = useMemo(() => {
    if (!selectedEventMeta) {
      return [] as Array<{
        slotIndex: number;
        categoryName: string;
        listName: string;
        entries: Array<{ itemName: string; count: number; rate: number }>;
      }>;
    }

    const denominator = Math.max(selectedEventMeta.entrants.length, 1);

    return configuredCategorySlots.map((slot) => {
      const itemCounts = new Map<string, number>();
      const items = slot.list.items
        .map((itemName) => itemName.trim())
        .filter((itemName) => itemName !== "");

      for (const itemName of items) {
        itemCounts.set(itemName, 0);
      }

      for (const entrant of selectedEventMeta.entrants) {
        const chosen = entrant.characterNames
          .map((itemName) => itemName.trim())
          .filter((itemName) => itemCounts.has(itemName));

        const uniqueChosen = new Set(chosen);
        for (const itemName of uniqueChosen) {
          itemCounts.set(itemName, (itemCounts.get(itemName) ?? 0) + 1);
        }
      }

      const entries = [...itemCounts.entries()]
        .map(([itemName, count]) => ({
          itemName,
          count,
          rate: (count / denominator) * 100,
        }))
        .filter((entry) => entry.count > 0)
        .sort((left, right) => right.rate - left.rate || left.itemName.localeCompare(right.itemName, "ja"));

      return {
        slotIndex: slot.slotIndex,
        categoryName: slot.list.categoryName,
        listName: slot.list.name,
        entries,
      };
    });
  }, [configuredCategorySlots, selectedEventMeta]);
  const selectedEventEntrants = useMemo(() => {
    if (!selectedEvent) {
      return [] as Array<{ entrantId: string; entrantName: string; seedId: string | null; seedNum: number | null }>;
    }

    const seenOrder: string[] = [];
    const byEntrant = new Map<string, { entrantId: string; entrantName: string; seedId: string | null; seedNum: number | null; firstSeenSetId: string }>();

    for (const set of selectedEvent.sets) {
      for (const slot of set.slots) {
        if (!slot.entrantId) {
          continue;
        }

        const current = byEntrant.get(slot.entrantId);
        const normalizedSeedNum = typeof slot.seedNum === "number" ? slot.seedNum : null;
        const normalizedSeedId = typeof slot.seedId === "string" && slot.seedId.trim() !== "" ? slot.seedId : null;

        if (!current) {
          seenOrder.push(slot.entrantId);
          byEntrant.set(slot.entrantId, {
            entrantId: slot.entrantId,
            entrantName: slot.entrantName,
            seedId: normalizedSeedId,
            seedNum: normalizedSeedNum,
            firstSeenSetId: set.setId,
          });
          continue;
        }

        // Keep the first observed name/order, but fill missing seed data if later slots have it.
        if (current.seedNum === null && normalizedSeedNum !== null) {
          current.seedNum = normalizedSeedNum;
        }
        if (current.seedId === null && normalizedSeedId !== null) {
          current.seedId = normalizedSeedId;
        }
      }
    }

    const entrants = seenOrder
      .map((entrantId) => byEntrant.get(entrantId))
      .filter((item): item is { entrantId: string; entrantName: string; seedId: string | null; seedNum: number | null; firstSeenSetId: string } => item !== undefined);

    if (selectedEvent) {
      console.groupCollapsed(`[seed-debug] event=${selectedEvent.eventId} entrants=${entrants.length}`);
      console.table(
        entrants.map((item, index) => ({
          order: index + 1,
          entrantId: item.entrantId,
          entrantName: item.entrantName,
          seedId: item.seedId,
          seedNum: item.seedNum,
          firstSeenSetId: item.firstSeenSetId,
        })),
      );
      console.groupEnd();
    }

    return entrants.sort((left, right) => {
      const leftSeed = typeof left.seedNum === "number" ? left.seedNum : null;
      const rightSeed = typeof right.seedNum === "number" ? right.seedNum : null;

      if (leftSeed !== null && rightSeed !== null) {
        return leftSeed - rightSeed
          || (left.seedId ?? "").localeCompare(right.seedId ?? "", "ja")
          || left.entrantName.localeCompare(right.entrantName, "ja");
      }
      if (leftSeed !== null) {
        return -1;
      }
      if (rightSeed !== null) {
        return 1;
      }

      // seed 未設定同士は推測で並び替えず、取得順を維持する。
      return 0;
    });
  }, [selectedEvent]);
  const selectedTournamentEntrant = useMemo(() => {
    if (selectedTournamentEntrantId === "") {
      return selectedEventEntrants[0] ?? null;
    }

    return selectedEventEntrants.find((entrant) => entrant.entrantId === selectedTournamentEntrantId) ?? selectedEventEntrants[0] ?? null;
  }, [selectedEventEntrants, selectedTournamentEntrantId]);

  const selectedUserCardPlayer = useMemo(() => {
    if (selectedUserCardPlayerId === "") {
      return userCardPlayers[0] ?? null;
    }

    return userCardPlayers.find((player) => player.playerId === selectedUserCardPlayerId) ?? userCardPlayers[0] ?? null;
  }, [selectedUserCardPlayerId, userCardPlayers]);

  const handleUserCardPlayerSelect = useCallback((player: UserCardPlayer, multiSelect: boolean) => {
    const selectedId = player.playerId;
    setSelectedUserCardPlayerId(selectedId);

    if (!multiSelect) {
      setSelectedUserCardPlayerIds([selectedId]);
      return;
    }

    setSelectedUserCardPlayerIds((current) => {
      if (current.includes(selectedId)) {
        const next = current.filter((id) => id !== selectedId);
        return next.length > 0 ? next : [selectedId];
      }
      return [...current, selectedId];
    });
  }, []);

  const selectAllUserCardPlayers = useCallback(() => {
    if (userCardPlayers.length === 0) {
      return;
    }

    const selectedIds = userCardPlayers.map((player) => player.playerId);
    setSelectedUserCardPlayerIds(selectedIds);
    setSelectedUserCardPlayerId(selectedIds[selectedIds.length - 1]);
  }, [userCardPlayers]);

  const clearAllUserCardPlayersSelection = useCallback(() => {
    setSelectedUserCardPlayerIds([]);
  }, []);

  const mailboxThreadSummaries = useMemo(() => {
    const roots = scopedGenericMessages.filter((item) => item.parentMessageId === null);

    return roots
      .map((root) => {
        const messages = scopedGenericMessages
          .filter((item) => item.threadId === root.threadId)
          .slice()
          .sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime());

        const resolved = messages.some((item) => item.messageType === "resolve");
        const unreadCount = messages.filter(
          (item) => item.senderUserId !== senderProfile.senderUserId && !mailboxReadMessageIds.includes(item.messageId),
        ).length;

        return {
          root,
          messages,
          resolved,
          unreadCount,
        };
      })
      .sort((left, right) => new Date(right.root.createdAt).getTime() - new Date(left.root.createdAt).getTime());
  }, [mailboxReadMessageIds, scopedGenericMessages, senderProfile.senderUserId]);

  const unreadMessageCount = useMemo(
    () => mailboxThreadSummaries
      .filter((summary) => summary.root.method !== "call_player")
      .reduce((total, summary) => total + summary.unreadCount, 0),
    [mailboxThreadSummaries],
  );

  const unresolvedCallEventGroupsLatest = useMemo(() => {
    const roots = genericMessages.filter((item) =>
      item.parentMessageId === null
      && item.method === "call_player"
      && item.messageType === "normal"
      && (!callListFocusOwnUnresolved || item.senderUserId.trim() === senderProfile.senderUserId.trim())
    );

    const groups = new Map<string, CallListEventGroup>();
    const dedupKeys = new Set<string>();

    for (const root of roots) {
      const resolved = genericMessages.some((item) => item.threadId === root.threadId && item.messageType === "resolve");
      if (resolved) {
        continue;
      }

      const dedupKey = buildCallListDedupKey(root);
      if (!callListFocusOwnUnresolved) {
        if (dedupKeys.has(dedupKey)) {
          continue;
        }
        dedupKeys.add(dedupKey);
      }

      const callIdentity = extractCallThreadIdentity(root);
      const entrantName = callIdentity?.callEntrantName
        || extractMetaString(root.messageMeta, "callEntrantName")
        || extractMetaString(root.messageMeta, "callEntrantId")
        || "不明プレイヤー";
      const eventMeta = extractCallEventMeta(root);
      const eventAlias = eventMeta.eventAlias;
      const eventName = eventMeta.eventName;
      const tournamentName = eventMeta.tournamentName;
      const phaseName = eventMeta.phaseName;
      const phaseGroupName = eventMeta.phaseGroupName;
      const groupKey = [
        eventMeta.tournamentId,
        tournamentName,
        eventMeta.eventId,
        eventName,
        eventAlias,
        phaseName,
        phaseGroupName,
      ].join("::") || "__unknown__";
      const found = groups.get(groupKey);

      if (found) {
        found.players.push({
          threadId: root.threadId,
          entrantName,
          createdAt: root.createdAt,
          senderName: root.senderName,
        });
      } else {
        groups.set(groupKey, {
          key: groupKey,
          eventAlias,
          tournamentName,
          eventName,
          eventId: eventMeta.eventId,
          phaseName,
          phaseGroupName,
          players: [{
            threadId: root.threadId,
            entrantName,
            createdAt: root.createdAt,
            senderName: root.senderName,
          }],
        });
      }
    }

    return [...groups.values()]
      .map((group) => ({
        ...group,
        players: group.players
          .slice()
          .sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime()),
      }));
  }, [callListFocusOwnUnresolved, genericMessages, senderProfile.senderUserId]);

  const callListEventGroupComparator = useMemo(() => {
    if (callListEventSortStrategy === "max-elapsed") {
      return (left: CallListEventGroup, right: CallListEventGroup) =>
        compareCallListEventGroupByMaxElapsed(left, right, callListPageSwitchedAtMs);
    }

    return compareCallListEventGroup;
  }, [callListEventSortStrategy, callListPageSwitchedAtMs]);

  const unresolvedCallEventGroupsLatestMap = useMemo(
    () => new Map(unresolvedCallEventGroupsLatest.map((group) => [group.key, group] as const)),
    [unresolvedCallEventGroupsLatest],
  );

  useEffect(() => {
    setCallListDisplayGroups((current) => {
      if (current.length === 0) {
        return [...unresolvedCallEventGroupsLatest].sort(callListEventGroupComparator);
      }

      const currentKeySet = new Set(current.map((item) => item.key));
      const next = current.map((item) => unresolvedCallEventGroupsLatestMap.get(item.key) ?? item);

      for (const group of unresolvedCallEventGroupsLatest) {
        if (!currentKeySet.has(group.key)) {
          // 新規イベントは末尾へ追加し、ページ数を即時増加させる。
          next.push(group);
        }
      }

      return next;
    });
  }, [callListEventGroupComparator, callListRebuildToken, unresolvedCallEventGroupsLatest, unresolvedCallEventGroupsLatestMap]);

  useEffect(() => {
    setCallListDisplayGroups((current) => current.slice().sort(callListEventGroupComparator));
  }, [callListEventGroupComparator]);

  const unresolvedCallEventGroups = callListDisplayGroups;

  const unresolvedCallRootCounts = useMemo(() => {
    const unresolvedRoots = genericMessages.filter((root) =>
      root.parentMessageId === null
      && root.method === "call_player"
      && root.messageType === "normal"
      && !genericMessages.some((item) => item.threadId === root.threadId && item.messageType === "resolve")
    );

    const ownUnresolvedCount = unresolvedRoots.filter(
      (root) => root.senderUserId.trim() === senderProfile.senderUserId.trim(),
    ).length;

    return {
      total: unresolvedRoots.length,
      own: ownUnresolvedCount,
      hidden: Math.max(0, unresolvedRoots.length - ownUnresolvedCount),
    };
  }, [genericMessages, senderProfile.senderUserId]);

  const unresolvedCallEventPages = useMemo(() => {
    if (unresolvedCallEventGroups.length === 0) {
      return [] as typeof unresolvedCallEventGroups[];
    }

    const pages: Array<typeof unresolvedCallEventGroups> = [];
    for (let index = 0; index < unresolvedCallEventGroups.length; index += CALL_LIST_EVENT_PAGE_SIZE) {
      pages.push(unresolvedCallEventGroups.slice(index, index + CALL_LIST_EVENT_PAGE_SIZE));
    }
    return pages;
  }, [unresolvedCallEventGroups]);

  const activeUnresolvedCallEventPage = unresolvedCallEventPages[callListPageIndex] ?? [];
  const callListCurrentPage = unresolvedCallEventPages.length === 0
    ? 0
    : Math.min(callListPageIndex + 1, unresolvedCallEventPages.length);
  const callListTotalPages = unresolvedCallEventPages.length;
  const callListRotateSeconds = normalizeCallListRotateSeconds(callListPageRotateSeconds);
  const callListColorToRedSeconds = normalizeCallListColorSeconds(callListColorSeconds);
  const callListRotateMs = callListRotateSeconds * 1000;
  const elapsedFromPageSwitchMs = Math.max(0, callListProgressNowMs - callListPageSwitchedAtMs);
  const normalizedCallListPageProgressPercent = unresolvedCallEventPages.length === 0
    ? 0
    : Math.max(0, Math.min(100, (elapsedFromPageSwitchMs / callListRotateMs) * 100));

  const createSnapshotProgressPercent = useMemo(() => {
    if (!createSnapshotProgress) {
      return 0;
    }

    if (createSnapshotProgress.phase === "completed") {
      return 100;
    }

    if (createSnapshotProgress.totalSets === null || createSnapshotProgress.totalSets <= 0) {
      return 0;
    }

    const raw = (createSnapshotProgress.completedSets / createSnapshotProgress.totalSets) * 100;
    return Math.max(0, Math.min(100, raw));
  }, [createSnapshotProgress]);

  const createSnapshotProgressLabel = useMemo(() => {
    if (!createSnapshotProgress) {
      return "";
    }

    if (createSnapshotProgress.phase === "starting") {
      return "開始準備中...";
    }

    if (createSnapshotProgress.phase === "requestingEventPage") {
      return `ページ${createSnapshotProgress.currentPage ?? 1}を取得中`;
    }

    if (createSnapshotProgress.phase === "requestingTournamentPreview") {
      return "大会event一覧を取得中";
    }

    if (createSnapshotProgress.phase === "requestingTournamentSnapshot") {
      return "大会snapshotへ切替えて取得中";
    }

    if (createSnapshotProgress.phase === "discovering") {
      const pageText = createSnapshotProgress.currentPage !== null
        ? `ページ${createSnapshotProgress.currentPage}を確認済み`
        : "ページを確認中";
      return `${pageText}（対象set数を確認中）`;
    }

    if (createSnapshotProgress.phase === "requestingSetDetails") {
      const total = createSnapshotProgress.totalSets ?? 0;
      const details = total > 0
        ? `${createSnapshotProgress.completedSets}/${total} set処理済み`
        : `${createSnapshotProgress.completedSets} set処理済み`;
      const currentSet = createSnapshotProgress.currentSetId
        ? `set ${createSnapshotProgress.currentSetId} を含むbatch`
        : "set詳細batch";
      return `${details} / ${currentSet}を取得中`;
    }

    if (createSnapshotProgress.phase === "fetchingSetDetails") {
      const total = createSnapshotProgress.totalSets ?? 0;
      const details = total > 0
        ? `${createSnapshotProgress.completedSets}/${total} set処理済み`
        : `${createSnapshotProgress.completedSets} set処理済み`;
      if (createSnapshotProgress.currentSetId) {
        return `${details} / set ${createSnapshotProgress.currentSetId} を取得中`;
      }
      return details;
    }

    if (createSnapshotProgress.phase === "completed") {
      return "取得完了";
    }

    return "取得中...";
  }, [createSnapshotProgress]);

  const shouldShowBracketSnapshotRefreshProgress = useMemo(() => {
    const isReportSnapshotRefresh = bracketReport.progress?.phase === "refreshingSnapshot";
    const isManualBracketRefresh = activeTab === "bracket" && busy && createSnapshotProgress !== null;
    return (isReportSnapshotRefresh || isManualBracketRefresh) && createSnapshotProgress !== null;
  }, [activeTab, bracketReport.progress, busy, createSnapshotProgress]);

  const mailboxThreads = useMemo(() => {
    return mailboxThreadSummaries
      .filter((summary) => {
        if (mailboxFilterSetting.unresolvedOnly && summary.resolved) {
          return false;
        }
        if (mailboxFilterSetting.unreadOnly && summary.unreadCount === 0) {
          return false;
        }
        return true;
      })
      .map((summary) => summary.root);
  }, [mailboxFilterSetting, mailboxThreadSummaries]);

  const hasMailboxThreads = mailboxThreads.length > 0;

  const activeThread = useMemo(() => {
    if (selectedThreadId.trim() === "") {
      return mailboxThreads[0] ?? null;
    }

    return mailboxThreads.find((item) => item.threadId === selectedThreadId) ?? mailboxThreads[0] ?? null;
  }, [mailboxThreads, selectedThreadId]);

  const activeThreadMessages = useMemo(() => {
    if (!activeThread) {
      return [] as GenericMessage[];
    }

    return mailboxThreadSummaries.find((summary) => summary.root.threadId === activeThread.threadId)?.messages ?? [];
  }, [activeThread, mailboxThreadSummaries]);

  const activeThreadResolved = useMemo(
    () => activeThreadMessages.some((item) => item.messageType === "resolve"),
    [activeThreadMessages],
  );

  const canResolveActiveThread = !!activeThread
    && !activeThreadResolved
    && !disableLocalCommunication
    && activeThread.senderUserId === senderProfile.senderUserId;

  useEffect(() => {
    if (!hasMailboxThreads) {
      setSelectedThreadId((current) => (current === "" ? current : ""));
      return;
    }

    setSelectedThreadId((current) => {
      if (current !== "" && mailboxThreads.some((item) => item.threadId === current)) {
        return current;
      }
      return mailboxThreads[0].threadId;
    });
  }, [hasMailboxThreads, mailboxThreads]);

  useEffect(() => {
    if (callListCycleCount === 0) {
      return;
    }

    // 1周ごとに未解決が消えたイベントを除外し、ソートルールで再整列する。
    setCallListDisplayGroups([...unresolvedCallEventGroupsLatest].sort(callListEventGroupComparator));
  }, [callListCycleCount, callListEventGroupComparator, unresolvedCallEventGroupsLatest]);

  useEffect(() => {
    if (unresolvedCallEventPages.length === 0) {
      if (callListPageIndex !== 0) {
        setCallListPageIndex(0);
      }
      return;
    }

    if (callListPageIndex >= unresolvedCallEventPages.length) {
      setCallListPageIndex(0);
    }
  }, [callListPageIndex, unresolvedCallEventPages.length]);

  useEffect(() => {
    if (activeTab !== "call-list" || unresolvedCallEventPages.length === 0) {
      return;
    }

    const now = Date.now();
    const rotateMs = callListRotateSeconds * 1000;
    const elapsedMs = Math.max(0, now - callListPageSwitchedAtMs);
    const missedTurns = Math.floor(elapsedMs / rotateMs);
    if (missedTurns <= 0) {
      return;
    }

    setCallListPageSwitchedAtMs((current) => current + missedTurns * rotateMs);
    setCallListPageIndex((current) => {
      const pageCount = unresolvedCallEventPages.length;
      if (pageCount <= 0) {
        return 0;
      }

      const advanced = current + missedTurns;
      const next = advanced % pageCount;
      const completedCycles = pageCount === 1 ? missedTurns : Math.floor(advanced / pageCount);
      if (completedCycles > 0) {
        setCallListCycleCount((cycle) => cycle + completedCycles);
      }

      return next;
    });
    setCallListProgressNowMs(now);
  }, [activeTab, callListPageSwitchedAtMs, callListRotateSeconds, unresolvedCallEventPages.length]);

  useEffect(() => {
    if (activeTab !== "call-list" || unresolvedCallEventPages.length === 0) {
      setCallListProgressNowMs(Date.now());
      return;
    }

    setCallListProgressNowMs(Date.now());
    const tickerId = window.setInterval(() => {
      setCallListProgressNowMs(Date.now());
    }, 100);

    return () => {
      window.clearInterval(tickerId);
    };
  }, [activeTab, unresolvedCallEventPages.length]);

  useEffect(() => {
    if (activeTab !== "call-list" || unresolvedCallEventPages.length === 0) {
      setCallListProgressNowMs(Date.now());
      return;
    }

    const timerId = window.setInterval(() => {
      setCallListPageSwitchedAtMs(Date.now());
      setCallListPageIndex((current) => {
        const next = (current + 1) % unresolvedCallEventPages.length;
        if (next === 0) {
          setCallListCycleCount((cycle) => cycle + 1);
        }
        return next;
      });
    }, callListRotateSeconds * 1000);

    return () => {
      window.clearInterval(timerId);
    };
  }, [activeTab, callListRotateSeconds, unresolvedCallEventPages.length]);

  useEffect(() => {
    if (activeTab !== "message" || !activeThread) {
      return;
    }

    const incomingIds = activeThreadMessages
      .filter((item) => item.senderUserId !== senderProfile.senderUserId)
      .map((item) => item.messageId);

    if (incomingIds.length === 0) {
      return;
    }

    setMailboxReadMessageIds((current) => {
      const next = new Set(current);
      let changed = false;
      for (const messageId of incomingIds) {
        if (!next.has(messageId)) {
          next.add(messageId);
          changed = true;
        }
      }

      if (!changed) {
        return current;
      }

      return [...next];
    });
  }, [activeTab, activeThread, activeThreadMessages, senderProfile.senderUserId]);

  const normalizedSenderNameDraft = senderNameDraft.trim();
  const normalizedSenderUserIdDraft = senderUserIdDraft.replace(/\D/g, "").slice(0, 8);
  const normalizedSenderBindIpDraft = senderBindIpDraft.trim();
  const normalizedBroadcastSubnetMaskDraft = senderBroadcastSubnetMaskDraft.trim();
  const selectedSenderNetworkCandidate = useMemo(
    () => senderNetworkCandidates.find(
      (candidate) => localNetworkCandidateKey(candidate) === selectedSenderNetworkCandidateKey,
    ) ?? null,
    [selectedSenderNetworkCandidateKey, senderNetworkCandidates],
  );
  const hasSelectedSenderNetworkDevice = selectedSenderNetworkCandidate !== null;
  const normalizedMailboxMethod = mailboxMethodDraft.trim().toLowerCase();
  const normalizedMailboxSubject = mailboxSubjectDraft.trim();
  const normalizedMessageDeliveryIp = messageDeliveryIpDraft.trim();
  const normalizedComposeFixedBody = composeFixedBodyDraft?.trim() ?? "";
  const normalizedGenericMessageBody = genericMessageBodyDraft.trim();
  const normalizedReplyBody = replyBodyDraft.trim();
  const composedMessageBody = normalizedComposeFixedBody === ""
    ? normalizedGenericMessageBody
    : (normalizedGenericMessageBody === ""
      ? normalizedComposeFixedBody
      : `${normalizedComposeFixedBody}\n\n補足:\n${normalizedGenericMessageBody}`);

  const senderIdCollision = useMemo(() => {
    if (!isValidSenderUserId(normalizedSenderUserIdDraft)) {
      return false;
    }

    return genericMessages.some((item) => item.senderUserId === normalizedSenderUserIdDraft && item.senderName !== normalizedSenderNameDraft);
  }, [genericMessages, normalizedSenderNameDraft, normalizedSenderUserIdDraft]);

  const senderIdentityChanged = useMemo(() => {
    const currentId = senderProfile.senderUserId.trim();
    const currentName = senderProfile.senderName.trim();
    if (currentId === "" && currentName === "") {
      return false;
    }

    const idChanged = normalizedSenderUserIdDraft !== currentId;
    const nameChanged = normalizedSenderNameDraft !== currentName;
    return idChanged || nameChanged;
  }, [
    normalizedSenderNameDraft,
    normalizedSenderUserIdDraft,
    senderProfile.senderName,
    senderProfile.senderUserId,
  ]);

  const shouldRecommendMailboxClearForIdentityChange = senderIdentityChanged
    || senderIdentityChangedSinceMailboxClear;

  const canSaveSenderProfile = normalizedSenderNameDraft !== ""
    && isValidSenderUserId(normalizedSenderUserIdDraft)
    && hasSelectedSenderNetworkDevice
    && isValidIpv4(normalizedSenderBindIpDraft)
    && isValidIpv4(normalizedBroadcastSubnetMaskDraft)
    && !senderIdCollision;

  const isSenderProfileReadyForMessaging = senderProfile.senderName.trim() !== ""
    && isValidSenderUserId(senderProfile.senderUserId)
    && isValidIpv4(senderProfile.bindIp);

  const canSendGenericMessage = isSenderProfileReadyForMessaging
    && !disableLocalCommunication
    && isValidIpv4(senderProfile.broadcastSubnetMask)
    && normalizedMailboxMethod !== ""
    && normalizedMailboxSubject !== ""
    && composedMessageBody !== ""
    && (messageDeliveryMode === "broadcast" || isValidIpv4List(normalizedMessageDeliveryIp));

  const canReplyToThread = !!activeThread
    && !activeThreadResolved
    && !disableLocalCommunication
    && isSenderProfileReadyForMessaging
    && normalizedReplyBody !== "";
  const isOwnActiveThread = !!activeThread
    && activeThread.senderUserId.trim() === senderProfile.senderUserId.trim();
  const canDeleteActiveThread = !!activeThread
    && !disableLocalCommunication
    && (!isOwnActiveThread || activeThreadResolved);
  const canBroadcastCallListSync = senderProfile.senderName.trim() !== ""
    && !disableLocalCommunication
    && isValidSenderUserId(senderProfile.senderUserId)
    && isValidIpv4(senderProfile.bindIp)
    && isValidIpv4(senderProfile.broadcastSubnetMask);

  const activeCallThreadIdentity = useMemo(() => extractCallThreadIdentity(activeThread), [activeThread]);
  const canOpenDqDialog = !!activeThread
    && !activeThreadResolved
    && !disableLocalCommunication
    && activeThread.senderUserId !== senderProfile.senderUserId
    && !!activeCallThreadIdentity;

  function fillRandomSenderUserId() {
    const usedIds = new Set(genericMessages.map((item) => item.senderUserId));
    let nextId = generateRandomSenderUserId();

    for (let retry = 0; retry < 40 && usedIds.has(nextId); retry += 1) {
      nextId = generateRandomSenderUserId();
    }

    setSenderUserIdDraft(nextId);
  }

  async function refreshLocalNetworkSettingsCandidates(showError = true) {
    if (senderNetworkCandidatesLoading) {
      return;
    }

    setSenderNetworkCandidatesLoading(true);
    try {
      const listed = await invoke<LocalNetworkSettingsCandidate[]>("list_local_network_settings");
      const normalized = Array.isArray(listed) ? listed : [];
      setSenderNetworkCandidates(normalized);

      const selectedStillExists = normalized.some(
        (candidate) => localNetworkCandidateKey(candidate) === selectedSenderNetworkCandidateKey,
      );

      if (selectedStillExists) {
        return;
      }

      const matchedByDraft = normalized.find((candidate) =>
        candidate.bindIp.trim() === senderBindIpDraft.trim()
        && candidate.broadcastSubnetMask.trim() === senderBroadcastSubnetMaskDraft.trim()
      );

      if (matchedByDraft) {
        setSelectedSenderNetworkCandidateKey(localNetworkCandidateKey(matchedByDraft));
        return;
      }

      setSelectedSenderNetworkCandidateKey(
        normalized[0] ? localNetworkCandidateKey(normalized[0]) : "",
      );
    } catch (err) {
      if (showError) {
        setError(`ネットワークデバイス一覧の取得に失敗しました: ${String(err)}`);
      }
    } finally {
      setSenderNetworkCandidatesLoading(false);
    }
  }

  useEffect(() => {
    if (activeTab !== "settings") {
      return;
    }

    void refreshLocalNetworkSettingsCandidates(false);
  }, [activeTab]);

  useEffect(() => {
    if (!selectedSenderNetworkCandidate) {
      return;
    }

    setSenderBindIpDraft(selectedSenderNetworkCandidate.bindIp.trim());
    setSenderBroadcastSubnetMaskDraft(selectedSenderNetworkCandidate.broadcastSubnetMask.trim());
  }, [selectedSenderNetworkCandidate]);

  async function saveSenderProfileSettings() {
    setError("");
    setMessage("");

    if (normalizedSenderNameDraft === "") {
      setError("送信者名を入力してください。");
      return;
    }

    if (!isValidSenderUserId(normalizedSenderUserIdDraft)) {
      setError("ユーザーIDは8桁の数字で入力してください。");
      return;
    }

    if (!hasSelectedSenderNetworkDevice) {
      setError("ネットワークデバイスを選択してください。");
      return;
    }

    if (!isValidIpv4(normalizedBroadcastSubnetMaskDraft)) {
      setError("ブロードキャスト用サブネットマスクはIPv4形式で入力してください。例: 255.255.255.0");
      return;
    }

    if (senderIdCollision) {
      setError("既存メッセージ内で同じユーザーIDが別名義に使われています。別のIDを設定してください。");
      return;
    }

    if (senderIdentityChanged) {
      const confirmed = window.confirm(
        "送信者名またはユーザーIDを変更して保存しようとしています。\n"
        + "状態不整合を防ぐため、先に設定タブ下部の「メッセージボックスを強制クリア」を実行することを推奨します。\n"
        + "このまま保存しますか？",
      );
      if (!confirmed) {
        setSenderNameDraft(senderProfile.senderName);
        setSenderUserIdDraft(senderProfile.senderUserId);
        setError("送信者設定の保存を中止し、送信者名/ユーザーIDを元の値に戻しました。");
        return;
      }
    }

    const nextProfile: SenderProfile = {
      senderName: normalizedSenderNameDraft,
      senderUserId: normalizedSenderUserIdDraft,
      bindIp: normalizedSenderBindIpDraft,
      broadcastSubnetMask: normalizedBroadcastSubnetMaskDraft,
    };

    try {
      await invoke<string>("test_sender_network", {
        profile: nextProfile,
      });
    } catch (err) {
      setError(`ネットワークテストに失敗したため保存を中止しました: ${String(err)}`);
      return;
    }

    setSenderProfile(nextProfile);
    if (senderIdentityChanged) {
      setSenderIdentityChangedSinceMailboxClear(true);
      setMessage(`送信者設定を保存しました: ${nextProfile.senderName} (${nextProfile.senderUserId}) @ ${nextProfile.bindIp} (ネットワークテストOK) / 注意: 状態整合のため、可能なタイミングでメッセージボックス強制クリアを実行してください。`);
      return;
    }

    setMessage(`送信者設定を保存しました: ${nextProfile.senderName} (${nextProfile.senderUserId}) @ ${nextProfile.bindIp} (ネットワークテストOK)`);
  }

  async function postGenericMessage() {
    setError("");
    setMessage("");

    if (disableLocalCommunication) {
      setError("ローカル通信を行わない設定のため、メッセージ送信は無効です。設定タブで解除してください。");
      return;
    }

    if (
      senderProfile.senderName.trim() === ""
      || !isValidSenderUserId(senderProfile.senderUserId)
      || !isValidIpv4(senderProfile.bindIp)
    ) {
      setError("設定タブで送信者名・8桁ユーザーID・自分のIPを保存してから送信してください。");
      return;
    }

    if (normalizedMailboxMethod === "") {
      setError("メソッド名を入力してください。");
      return;
    }

    if (normalizedMailboxSubject === "") {
      setError("件名を入力してください。");
      return;
    }

    if (messageDeliveryMode === "direct" && !isValidIpv4List(normalizedMessageDeliveryIp)) {
      setError("送信先IPはIPv4形式で複数指定できます。例: 192.168.1.20, 192.168.1.21");
      return;
    }

    if (composedMessageBody === "") {
      setError("メッセージ本文または補足を入力してください。");
      return;
    }

    const scopedMeta = buildScopedMessageMeta(composeMessageMeta, selectedMessageScope);

    try {
      if (normalizedMailboxMethod === "call_player") {
        const targetIdentity = extractCallTargetIdentityFromMeta(scopedMeta);

        if (targetIdentity) {
          const duplicateRoots = genericMessages
            .filter((item) =>
              item.parentMessageId === null
              && item.messageType === "normal"
              && item.method === "call_player"
            )
            .filter((root) => {
              const rootIdentity = extractCallTargetIdentityFromMeta(root.messageMeta);
              if (!rootIdentity) {
                return false;
              }

              const threadResolved = genericMessages.some(
                (item) => item.threadId === root.threadId && item.messageType === "resolve",
              );
              if (threadResolved) {
                return false;
              }

              return isSameCallTargetIdentity(rootIdentity, targetIdentity);
            });

          for (const root of duplicateRoots) {
            const resolved = await invoke<GenericMessage>("send_mailbox_message", {
              input: {
                profile: senderProfile,
                messageType: "resolve",
                method: root.method,
                subject: `Resolved: ${root.subject}`,
                body: "同一セット・同一プレイヤーの再呼び出し前に自動解決しました。",
                messageMeta: root.messageMeta,
                deliveryTargetMode: "broadcast",
                deliveryTargetIp: null,
                threadId: root.threadId,
                parentMessageId: root.messageId,
              },
            });

            const normalizedResolved = normalizeGenericMessage(resolved);
            if (normalizedResolved) {
              setGenericMessages((current) => {
                const next = [normalizedResolved, ...current.filter((item) => item.messageId !== normalizedResolved.messageId)];
                return next.sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
              });
            }
          }
        }
      }

      const sent = await invoke<GenericMessage>("send_mailbox_message", {
        input: {
          profile: senderProfile,
          messageType: "normal",
          messageMeta: scopedMeta,
          method: normalizedMailboxMethod,
          subject: normalizedMailboxSubject,
          body: composedMessageBody,
          deliveryTargetMode: messageDeliveryMode,
          deliveryTargetIp: messageDeliveryMode === "direct" ? splitIpv4List(normalizedMessageDeliveryIp).join(",") : null,
          threadId: null,
          parentMessageId: null,
        },
      });

      const normalized = normalizeGenericMessage(sent);
      if (normalized) {
        setGenericMessages((current) => {
          const next = [normalized, ...current.filter((item) => !isSameGenericMessageIdentity(item, normalized))];
          return next.sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
        });
        setSelectedThreadId(normalized.threadId);
      }

      setGenericMessageBodyDraft("");
      setMailboxSubjectDraft("");
      setComposeFixedBodyDraft(null);
      setComposeMessageMeta(null);
      setMessage(`メソッド ${normalizedMailboxMethod} でスレッドを開始しました。`);
    } catch (err) {
      setError(String(err));
    }
  }

  async function replyToThread() {
    setError("");
    setMessage("");

    if (disableLocalCommunication) {
      setError("ローカル通信を行わない設定のため、返信は無効です。設定タブで解除してください。");
      return;
    }

    if (!activeThread) {
      setError("返信先スレッドを選択してください。");
      return;
    }

    if (activeThreadResolved) {
      setError("解決済みスレッドには返信できません。必要な連絡は汎用メッセージで送信してください。");
      return;
    }

    if (
      senderProfile.senderName.trim() === ""
      || !isValidSenderUserId(senderProfile.senderUserId)
      || !isValidIpv4(senderProfile.bindIp)
    ) {
      setError("設定タブで送信者名・8桁ユーザーID・自分のIPを保存してから返信してください。");
      return;
    }

    if (normalizedReplyBody === "") {
      setError("返信本文を入力してください。");
      return;
    }

    const replyTargetMode: MailboxDeliveryMode = activeThread.senderUserId === senderProfile.senderUserId ? "broadcast" : "direct";
    const replyTargetIp = activeThread.senderIp.trim();

    if (replyTargetMode === "direct" && !isValidIpv4(replyTargetIp)) {
      setError("返信先メッセージの送信者IPが不正です。");
      return;
    }

    try {
      const sent = await invoke<GenericMessage>("send_mailbox_message", {
        input: {
          profile: senderProfile,
          messageType: "normal",
          method: activeThread.method,
          subject: `Re: ${activeThread.subject}`,
          body: normalizedReplyBody,
          messageMeta: buildScopedMessageMeta(null, selectedMessageScope),
          deliveryTargetMode: replyTargetMode,
          deliveryTargetIp: replyTargetMode === "direct" ? replyTargetIp : null,
          threadId: activeThread.threadId,
          parentMessageId: activeThread.messageId,
        },
      });

      const normalized = normalizeGenericMessage(sent);
      if (normalized) {
        setGenericMessages((current) => {
          const next = [normalized, ...current.filter((item) => !isSameGenericMessageIdentity(item, normalized))];
          return next.sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
        });
      }

      setReplyBodyDraft("");
      setMessage("返信を送信しました。スレッドに追加されます。");
    } catch (err) {
      setError(String(err));
    }
  }

  function openDqRequestDialog() {
    setError("");
    setMessage("");

    if (disableLocalCommunication) {
      setError("ローカル通信を行わない設定のため、DQ申請は無効です。設定タブで解除してください。");
      return;
    }

    if (!activeThread || !activeCallThreadIdentity) {
      setError("プレイヤー呼び出しスレッドを選択してください。");
      return;
    }

    if (activeThreadResolved) {
      setError("解決済みスレッドではDQ申請できません。必要な連絡は汎用メッセージで送信してください。");
      return;
    }

    const replyTargetMode: MailboxDeliveryMode = activeThread.senderUserId === senderProfile.senderUserId ? "broadcast" : "direct";
    const replyTargetIp = activeThread.senderIp.trim();

    if (replyTargetMode === "direct" && !isValidIpv4(replyTargetIp)) {
      setError("返信先メッセージの送信者IPが不正です。DQ申請を開始できません。");
      return;
    }

    setDqDialog({
      threadId: activeThread.threadId,
      parentMessageId: activeThread.messageId,
      method: activeThread.method,
      subject: activeThread.subject,
      replyTargetMode,
      replyTargetIp,
      expectedPlayerId: activeCallThreadIdentity.expectedPlayerId,
      callEntrantId: activeCallThreadIdentity.callEntrantId,
      callEntrantName: activeCallThreadIdentity.callEntrantName,
      setId: activeCallThreadIdentity.setId,
    });
    setDqPlayerIdDraft("");
    setDqReasonDraft("");
    setDqDialogError("");
  }

  function closeDqRequestDialog() {
    if (dqSubmitting) {
      return;
    }

    stopDqCameraScan();

    setDqDialog(null);
    setDqPlayerIdDraft("");
    setDqReasonDraft("");
    setDqDialogError("");
  }

  function stopDqCameraScan() {
    if (dqCameraRafRef.current !== null) {
      cancelAnimationFrame(dqCameraRafRef.current);
      dqCameraRafRef.current = null;
    }
    dqCameraDetectingRef.current = false;
    if (dqCameraStreamRef.current) {
      dqCameraStreamRef.current.getTracks().forEach((track) => track.stop());
      dqCameraStreamRef.current = null;
    }
    if (dqCameraVideoRef.current) {
      dqCameraVideoRef.current.srcObject = null;
    }
    dqCameraDetectorRef.current = null;
    setDqCameraActive(false);
  }

  async function startDqCameraScan() {
    if (!dqDialog) {
      setDqDialogError("DQ申請対象が見つかりません。再度開き直してください。");
      return;
    }

    stopDqCameraScan();
    setDqDialogError("");

    if (!navigator.mediaDevices?.getUserMedia) {
      setDqDialogError("この環境ではカメラアクセスに対応していません。PLAYER IDを手入力してください。");
      return;
    }

    const detector = createQrBarcodeDetector();

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "environment",
        },
        audio: false,
      });

      dqCameraStreamRef.current = stream;
  dqCameraDetectorRef.current = detector;

      const video = dqCameraVideoRef.current;
      if (!video) {
        stopDqCameraScan();
        setDqDialogError("カメラプレビューの初期化に失敗しました。");
        return;
      }

      const scanCanvas = dqCameraCanvasRef.current;
      if (!scanCanvas) {
        stopDqCameraScan();
        setDqDialogError("カメラスキャンの初期化に失敗しました。");
        return;
      }

      video.srcObject = stream;
      await video.play();
      setDqCameraActive(true);

      const tick = () => {
        void (async () => {
          if (!dqCameraVideoRef.current) {
            return;
          }
          if (dqCameraVideoRef.current.readyState < 2) {
            dqCameraRafRef.current = requestAnimationFrame(tick);
            return;
          }
          if (dqCameraDetectingRef.current) {
            dqCameraRafRef.current = requestAnimationFrame(tick);
            return;
          }

          dqCameraDetectingRef.current = true;
          try {
            let playerId = "";
            if (dqCameraDetectorRef.current) {
              const results = await dqCameraDetectorRef.current.detect(dqCameraVideoRef.current);
              playerId = extractPlayerIdFromBarcodeResults(results);
            }

            if (playerId === "" && dqCameraVideoRef.current) {
              const videoWidth = dqCameraVideoRef.current.videoWidth;
              const videoHeight = dqCameraVideoRef.current.videoHeight;
              if (videoWidth > 0 && videoHeight > 0) {
                if (scanCanvas.width !== videoWidth || scanCanvas.height !== videoHeight) {
                  scanCanvas.width = videoWidth;
                  scanCanvas.height = videoHeight;
                }

                const ctx = scanCanvas.getContext("2d", { willReadFrequently: true });
                if (ctx) {
                  ctx.drawImage(dqCameraVideoRef.current, 0, 0, scanCanvas.width, scanCanvas.height);
                  const imageData = ctx.getImageData(0, 0, scanCanvas.width, scanCanvas.height);
                  const decoded = jsQR(imageData.data, imageData.width, imageData.height, {
                    inversionAttempts: "attemptBoth",
                  });
                  const raw = decoded?.data?.trim() ?? "";
                  const normalized = extractPlayerIdFromQrRawValue(raw);
                  playerId = isLikelyPlayerId(normalized) ? normalized : "";
                }
              }
            }

            if (playerId !== "") {
              setDqPlayerIdDraft(playerId);
              setMessage("カメラでPLAYER IDを読み取りました。");
              stopDqCameraScan();
              return;
            }
          } catch {
            // keep scanning
          } finally {
            dqCameraDetectingRef.current = false;
          }

          dqCameraRafRef.current = requestAnimationFrame(tick);
        })();
      };

      dqCameraRafRef.current = requestAnimationFrame(tick);
    } catch (err) {
      stopDqCameraScan();
      setDqDialogError(`カメラを起動できませんでした: ${String(err)}`);
    }
  }

  useEffect(() => {
    if (dqDialog) {
      return;
    }

    stopDqCameraScan();
  }, [dqDialog]);

  useEffect(() => {
    return () => {
      stopDqCameraScan();
    };
  }, []);

  async function submitDqRequest() {
    setError("");
    setMessage("");

    if (disableLocalCommunication) {
      setDqDialogError("ローカル通信を行わない設定のため、DQ申請は無効です。設定タブで解除してください。");
      return;
    }

    if (!dqDialog) {
      setDqDialogError("DQ申請対象が見つかりません。再度開き直してください。");
      return;
    }

    if (
      senderProfile.senderName.trim() === ""
      || !isValidSenderUserId(senderProfile.senderUserId)
      || !isValidIpv4(senderProfile.bindIp)
    ) {
      setDqDialogError("設定タブで送信者名・8桁ユーザーID・自分のIPを保存してから申請してください。");
      return;
    }

    const normalizedPlayerId = normalizePlayerId(dqPlayerIdDraft);
    if (!isLikelyPlayerId(normalizedPlayerId)) {
      setDqDialogError("PLAYER IDを入力してください。プレイヤーカードの2次元コード読取にも対応しています。");
      return;
    }

    if (normalizedPlayerId !== dqDialog.expectedPlayerId) {
      setDqDialogError("入力したPLAYER IDが呼び出し対象と一致しません。なりすまし防止のため申請できません。");
      return;
    }

    const reasonText = dqReasonDraft.trim();
    const body = reasonText === ""
      ? `DQ申請\n対象: ${dqDialog.callEntrantName || dqDialog.callEntrantId}`
      : `DQ申請\n対象: ${dqDialog.callEntrantName || dqDialog.callEntrantId}\n理由: ${reasonText}`;

    const messageMeta = buildScopedMessageMeta({
      dqPlayerId: normalizedPlayerId,
      dqCallEntrantId: dqDialog.callEntrantId,
      dqCallEntrantName: dqDialog.callEntrantName,
      dqSetId: dqDialog.setId,
      dqRequestedByUserId: senderProfile.senderUserId,
      dqRequestedAt: new Date().toISOString(),
    }, selectedMessageScope);

    setDqSubmitting(true);
    setDqDialogError("");
    try {
      const sent = await invoke<GenericMessage>("send_mailbox_message", {
        input: {
          profile: senderProfile,
          messageType: "dq_request",
          method: dqDialog.method,
          subject: `DQ申請: ${dqDialog.subject}`,
          body,
          messageMeta,
          deliveryTargetMode: dqDialog.replyTargetMode,
          deliveryTargetIp: dqDialog.replyTargetMode === "direct" ? dqDialog.replyTargetIp : null,
          threadId: dqDialog.threadId,
          parentMessageId: dqDialog.parentMessageId,
        },
      });

      const normalized = normalizeGenericMessage(sent);
      if (normalized) {
        setGenericMessages((current) => {
          const next = [normalized, ...current.filter((item) => !isSameGenericMessageIdentity(item, normalized))];
          return next.sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
        });
      }

      closeDqRequestDialog();
      setMessage("DQ申請を送信しました。認証済みのPLAYER IDでのみ送信可能です。");
    } catch (err) {
      setDqDialogError(String(err));
    } finally {
      setDqSubmitting(false);
    }
  }

  async function resolveActiveThread() {
    setError("");
    setMessage("");

    if (disableLocalCommunication) {
      setError("ローカル通信を行わない設定のため、解決メッセージ送信は無効です。設定タブで解除してください。");
      return;
    }

    if (!activeThread) {
      setError("解決するスレッドを選択してください。");
      return;
    }

    if (!canResolveActiveThread) {
      setError("スレッド作成者のみが解決メッセージを送信できます。未解決スレッドを選択してください。");
      return;
    }

    const resolveTargetMode: MailboxDeliveryMode = "broadcast";

    try {
      const sent = await invoke<GenericMessage>("send_mailbox_message", {
        input: {
          profile: senderProfile,
          messageType: "resolve",
          method: activeThread.method,
          subject: `Resolved: ${activeThread.subject}`,
          body: "解決",
          messageMeta: buildScopedMessageMeta(null, selectedMessageScope),
          deliveryTargetMode: resolveTargetMode,
          deliveryTargetIp: null,
          threadId: activeThread.threadId,
          parentMessageId: activeThread.messageId,
        },
      });

      const normalized = normalizeGenericMessage(sent);
      if (normalized) {
        setGenericMessages((current) => {
          const next = [normalized, ...current.filter((item) => !isSameGenericMessageIdentity(item, normalized))];
          return next.sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
        });
      }

      setMessage("解決メッセージを送信しました。スレッドは完了扱いになります。");
    } catch (err) {
      setError(String(err));
    }
  }

  async function requestUnresolvedCallSyncBroadcast() {
    setError("");
    setMessage("");

    if (disableLocalCommunication) {
      setError("ローカル通信を行わない設定のため、呼び出し同期は無効です。設定タブで解除してください。");
      return;
    }

    if (!canBroadcastCallListSync) {
      setError("設定タブで送信者名・8桁ユーザーID・自分のIP・ブロードキャスト用サブネットマスクを保存してから実行してください。");
      return;
    }

    try {
      setCallListFocusOwnUnresolved(false);
      // 同期開始時は表示キャッシュを破棄し、取得結果で最新状態に再構築する。
      setCallListDisplayGroups([]);
      setCallListRebuildToken((current) => current + 1);
      setCallListPageIndex(0);
      setCallListCycleCount(0);
      setCallListPageSwitchedAtMs(Date.now());
      setCallListProgressNowMs(Date.now());

      await invoke<GenericMessage>("send_mailbox_message", {
        input: {
          profile: senderProfile,
          messageType: "normal",
          method: "call_player_sync",
          subject: "呼び出しの同期: 未補足の未解決呼び出しの収集",
          body: "現在未解決のプレイヤー呼び出し情報を返信してください。",
          messageMeta: {
            syncPhase: "collect_unresolved",
            requestedAt: new Date().toISOString(),
          },
          deliveryTargetMode: "broadcast",
          deliveryTargetIp: null,
          threadId: null,
          parentMessageId: null,
        },
      });

      const statusTargets = buildCallSyncStatusTargets(callListDisplayGroups, genericMessages);
      if (statusTargets.length > 0) {
        await invoke<GenericMessage>("send_mailbox_message", {
          input: {
            profile: senderProfile,
            messageType: "normal",
            method: "call_player_sync",
            subject: "呼び出しの同期: 掲載済み呼び出しの確認",
            body: "掲載中の呼び出しについて最新状態を確認します。",
            messageMeta: {
              syncPhase: "check_published_status",
              requestedAt: new Date().toISOString(),
              targets: statusTargets,
            },
            deliveryTargetMode: "broadcast",
            deliveryTargetIp: null,
            threadId: null,
            parentMessageId: null,
          },
        });
      }

      setMessage("呼び出しの同期を実行しました。未補足の未解決呼び出しを収集し、掲載済み呼び出しの状態確認を開始しました。");
    } catch (err) {
      setError(String(err));
    }
  }

  function deleteActiveThread() {
    if (disableLocalCommunication) {
      setError("ローカル通信を行わない設定のため、スレッド削除は無効です。必要な場合は設定タブの強制クリアを利用してください。");
      return;
    }

    if (!activeThread) {
      setError("削除するスレッドを選択してください。");
      return;
    }

    if (activeThread.senderUserId.trim() === senderProfile.senderUserId.trim() && !activeThreadResolved) {
      const warningMessage = "自分が発行した未解決スレッドは削除できません。先に「解決」を送信してください。";
      window.alert(warningMessage);
      setError(warningMessage);
      return;
    }

    const confirmed = window.confirm(`「${activeThread.subject}」のスレッドを削除しますか？\nこのスレッド内の全メッセージが削除されます。`);
    if (!confirmed) {
      return;
    }

    const targetThreadId = activeThread.threadId;
    const deletedMessageIds = genericMessages
      .filter((item) => item.threadId === targetThreadId)
      .map((item) => item.messageId);

    setError("");
    setMessage("");
    setGenericMessages((current) => current.filter((item) => item.threadId !== targetThreadId));
    setMailboxReadMessageIds((current) => current.filter((messageId) => !deletedMessageIds.includes(messageId)));
    setReplyBodyDraft("");
    setSelectedThreadId("");
    setMessage("スレッドを削除しました。");
  }

  function clearCallListThreads() {
    const callRoots = genericMessages.filter((item) =>
      item.parentMessageId === null
      && item.method === "call_player"
      && item.messageType === "normal"
    );
    const callThreadIds = new Set(callRoots.map((item) => item.threadId));

    if (shouldRecommendMailboxClearForIdentityChange) {
      window.alert("送信者情報が変更されています。意図しない挙動になることがあります。");
    }

    const confirmed = window.confirm(
      "呼び出しリスト表示をいったん全クリアします。\n保持中の呼び出しデータから再描画します。\nメッセージデータ自体は削除しません。実行しますか？",
    );
    if (!confirmed) {
      return;
    }

    const unresolvedCount = callRoots.filter((root) =>
      !genericMessages.some((item) => item.threadId === root.threadId && item.messageType === "resolve")
    ).length;

    setError("");
    setMessage("");
    // 表示キャッシュのみを初期化し、呼び出しデータ本体や表示フィルタは変更しない。
    setCallListDisplayGroups([]);
    setCallListRebuildToken((current) => current + 1);
    setCallListPageIndex(0);
    setCallListCycleCount(0);
    setCallListPageSwitchedAtMs(Date.now());
    setCallListProgressNowMs(Date.now());
    setMessage(`呼び出しリスト表示を初期化しました（未解決 ${unresolvedCount} 件 / 全呼び出しスレッド ${callThreadIds.size} 件保持）。`);
  }

  function forceClearMailboxMessages() {
    if (genericMessages.length === 0) {
      setError("");
      setMessage("削除対象のメッセージはありません。");
      return;
    }

    const firstConfirmed = window.confirm(
      `危険: メッセージボックス内の全メッセージ ${genericMessages.length} 件を強制削除します。\nこの操作は元に戻せません。続行しますか？`,
    );
    if (!firstConfirmed) {
      return;
    }

    const guardWord = window.prompt("最終確認: 強制削除を実行するには DELETE と入力してください。", "");
    if ((guardWord ?? "").trim() !== "DELETE") {
      setError("確認文字列が一致しなかったため、メッセージボックスの強制クリアを中止しました。");
      return;
    }

    setError("");
    setMessage("");
    setGenericMessages([]);
    setMailboxReadMessageIds([]);
    setSelectedThreadId("");
    setReplyBodyDraft("");
    setDqDialog(null);
    setCallListDisplayGroups([]);
    setCallListFocusOwnUnresolved(false);
    setCallListPageIndex(0);
    setCallListCycleCount(0);
    setCallListPageSwitchedAtMs(Date.now());
    setCallListProgressNowMs(Date.now());
    setSenderIdentityChangedSinceMailboxClear(false);

    setMessage(`メッセージボックスを強制クリアしました（${genericMessages.length} 件削除）。`);
  }

  async function sendCallMessageFromMatch(slot: SetSlot, entrantId: string) {
    setError("");
    setMessage("");

    if (disableLocalCommunication) {
      setError("ローカル通信を行わない設定のため、プレイヤー呼び出しメッセージは作成できません。設定タブで解除してください。");
      return;
    }

    if (!snapshot || !selectedEvent || !activeMatch) {
      setError("呼び出し元の試合情報が見つかりません。もう一度試してください。");
      return;
    }

    setCallingEntrantId(entrantId);

    try {
      const targetSetId = activeMatch.setId;
      const playerId = await deriveEncryptedPlayerId(snapshot.tournamentId, selectedEvent.eventId, entrantId);
      const eventAlias = selectedEventMeta?.eventAlias?.trim() || selectedEvent.name;
      const phaseName = resolveCallPhaseName(selectedEvent, activeMatch.phaseName ?? "", activeMatch.phaseOrder);
      const phaseGroupName = normalizeCallPhaseGroupName(activeMatch.phaseGroupName ?? "");
      const senderLine = senderProfile.senderName.trim() !== ""
        && isValidSenderUserId(senderProfile.senderUserId)
        && isValidIpv4(senderProfile.bindIp)
        ? `${senderProfile.senderName} (${senderProfile.senderUserId}) / ${senderProfile.bindIp}`
        : "未設定 (設定タブで送信者情報を設定してください)";

      const fixedBody = [
        "【呼び出しメッセージ】",
        `送信者: ${senderLine}`,
        `呼び出しプレイヤー: ${slot.entrantName}`,
        `entrantID: ${entrantId}`,
        `イベントエイリアス: ${eventAlias}`,
        `呼び出し元 tournament/event: ${snapshot.name} / ${selectedEvent.name}`,
        `呼び出し元 phase/pool: ${phaseName} / ${phaseGroupName}`,
      ].join("\n");

      setComposeMessageMeta({
        callId: `${snapshot.tournamentId}:${selectedEvent.eventId}:${phaseName}:${phaseGroupName}:${targetSetId}:${entrantId}`,
        playerId,
        callEntrantId: entrantId,
        callEntrantName: slot.entrantName,
        tournamentId: snapshot.tournamentId,
        tournamentName: snapshot.name,
        eventId: selectedEvent.eventId,
        eventName: selectedEvent.name,
        eventAlias,
        phaseName,
        phaseGroupName,
        setId: targetSetId,
      });
      setMailboxMethodDraft("call_player");
      setMailboxSubjectDraft(`${slot.entrantName}(${eventAlias})`);
      setComposeFixedBodyDraft(fixedBody);
      setGenericMessageBodyDraft("");
      closeMatchDialog();
      setActiveTab("message");
      setMessage(`呼び出しメッセージの下書きを作成しました: ${slot.entrantName} / 補足入力後に「スレッド開始」で送信してください。`);
    } catch (err) {
      setError(String(err));
    } finally {
      setCallingEntrantId("");
    }
  }

  useEffect(() => {
    let alive = true;

    if (!snapshot || !selectedEvent) {
      setUserCardPlayers([]);
      setSelectedUserCardPlayerId("");
      return () => {
        alive = false;
      };
    }

    (async () => {
      try {
        const rows = await Promise.all(
          selectedEventEntrants.map(async (entrant) => ({
            tournamentId: snapshot.tournamentId,
            tournamentName: snapshot.name,
            eventId: selectedEvent.eventId,
            eventName: selectedEvent.name,
            eventAlias: selectedEventMeta?.eventAlias?.trim() ? selectedEventMeta.eventAlias.trim() : null,
            entrantId: entrant.entrantId,
            entrantName: entrant.entrantName,
            playerId: await deriveEncryptedPlayerId(snapshot.tournamentId, selectedEvent.eventId, entrant.entrantId),
          })),
        );

        if (!alive) {
          return;
        }

        setUserCardPlayers(rows);
        setSelectedUserCardPlayerIds((current) => {
          const validIds = current.filter((id) => rows.some((row) => row.playerId === id));
          if (validIds.length > 0) {
            return validIds;
          }
          return rows.length > 0 ? [rows[0].playerId] : [];
        });
        setSelectedUserCardPlayerId((current) => {
          if (current !== "" && rows.some((row) => row.playerId === current)) {
            return current;
          }
          return rows[0]?.playerId ?? "";
        });
      } catch (err) {
        if (alive) {
          setError(String(err));
        }
      }
    })();

    return () => {
      alive = false;
    };
  }, [selectedEvent, selectedEventEntrants, selectedEventMeta, snapshot]);

  useEffect(() => {
    let alive = true;

    if (!selectedUserCardPlayer) {
      setSelectedUserCardPreviewUrl((current) => {
        if (current) {
          URL.revokeObjectURL(current);
        }
        return "";
      });
      return () => {
        alive = false;
      };
    }

    (async () => {
      try {
        const canvas = await renderPlayerCardCanvas(selectedUserCardPlayer);
        const blob = await canvasToBlob(canvas);
        if (!alive) {
          return;
        }

        const previewUrl = URL.createObjectURL(blob);
        setSelectedUserCardPreviewUrl((current) => {
          if (current) {
            URL.revokeObjectURL(current);
          }
          return previewUrl;
        });
      } catch (err) {
        if (alive) {
          setError(String(err));
        }
      }
    })();

    return () => {
      alive = false;
    };
  }, [selectedUserCardPlayer]);

  async function saveSelectedUserCardImage() {
    if (disableLocalCommunication) {
      setError("ローカル通信を行わない設定のため、プレイヤーリスト機能は無効です。設定タブで解除してください。");
      return;
    }

    const selectedIds = selectedUserCardPlayerIds.length > 0
      ? selectedUserCardPlayerIds
      : selectedUserCardPlayer
        ? [selectedUserCardPlayer.playerId]
        : [];

    if (selectedIds.length === 0) {
      setError("保存するプレイヤーカードがありません。");
      return;
    }

    const selectedPlayers = userCardPlayers.filter((player) => selectedIds.includes(player.playerId));

    if (selectedPlayers.length === 0) {
      setError("保存対象のプレイヤーカードが見つかりませんでした。");
      return;
    }

    setUserCardBusy(true);
    setError("");
    setMessage("");

    try {
      for (const player of selectedPlayers) {
        const canvas = await renderPlayerCardCanvas(player);
        const blob = await canvasToBlob(canvas);
        const fileName = buildPlayerCardFileName(player);
        triggerBlobDownload(blob, fileName);
      }
      setMessage(`${selectedPlayers.length} 枚のプレイヤーカードを保存しました。`);
    } catch (err) {
      setError(String(err));
    } finally {
      setUserCardBusy(false);
    }
  }

  async function exportSelectedPlayerCardsAsA4Sheet() {
    if (disableLocalCommunication) {
      setError("ローカル通信を行わない設定のため、プレイヤーリスト機能は無効です。設定タブで解除してください。");
      return;
    }

    const selectedIds = selectedUserCardPlayerIds.length > 0
      ? selectedUserCardPlayerIds
      : selectedUserCardPlayer
        ? [selectedUserCardPlayer.playerId]
        : [];
    const selectedPlayers = userCardPlayers.filter((player) => selectedIds.includes(player.playerId));

    if (selectedPlayers.length === 0) {
      setError("出力対象の選択カードがありません。");
      return;
    }

    setUserCardBusy(true);
    setError("");
    setMessage("");

    try {
      const pageWidth = 2480;
      const pageHeight = 3508;
      const marginX = 110;
      const marginY = 120;
      const colGap = 44;
      const rowGap = 34;
      const cols = 2;
      const rows = 5;
      const cardWidth = Math.floor((pageWidth - marginX * 2 - colGap) / cols);
      const cardHeight = Math.floor((pageHeight - marginY * 2 - rowGap * (rows - 1)) / rows);
      const totalPages = Math.ceil(selectedPlayers.length / USER_CARD_PAGE_SIZE);

      for (let page = 0; page < totalPages; page += 1) {
        const pagePlayers = selectedPlayers.slice(page * USER_CARD_PAGE_SIZE, (page + 1) * USER_CARD_PAGE_SIZE);
        const canvas = document.createElement("canvas");
        canvas.width = pageWidth;
        canvas.height = pageHeight;
        const ctx = canvas.getContext("2d");

        if (!ctx) {
          throw new Error("A4画像の生成に失敗しました。");
        }

        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, pageWidth, pageHeight);
        ctx.fillStyle = "#0f172a";
        ctx.font = "700 40px 'Noto Sans JP', sans-serif";
        ctx.fillText("savakan-gg PLAYER CARDS", marginX, 70);
        ctx.font = "500 24px 'Noto Sans JP', sans-serif";
        ctx.fillText(`Page ${page + 1}/${totalPages}`, pageWidth - 260, 70);

        for (let index = 0; index < pagePlayers.length; index += 1) {
          const player = pagePlayers[index];
          const row = Math.floor(index / cols);
          const col = index % cols;
          const x = marginX + col * (cardWidth + colGap);
          const y = marginY + row * (cardHeight + rowGap);
          const cardCanvas = await renderPlayerCardCanvas(player, {
            width: cardWidth,
            height: cardHeight,
          });

          ctx.drawImage(cardCanvas, x, y, cardWidth, cardHeight);
        }

        const blob = await canvasToBlob(canvas);
        const eventAlias = selectedEventMeta?.eventAlias?.trim() || selectedEvent?.name || "event";
        const fileName = buildPrintedPlayerCardPageFileName(eventAlias, page + 1, totalPages);
        triggerBlobDownload(blob, fileName);
      }

      setMessage(`選択中のカードを A4 シートにまとめて出力しました。${selectedPlayers.length} 枚 / ${totalPages} ページ`);
    } catch (err) {
      setError(String(err));
    } finally {
      setUserCardBusy(false);
    }
  }

  useEffect(() => {
    if (!selectedEvent) {
      setMetaDrafts({});
      return;
    }

    setMetaDrafts((current) => {
      const next = { ...current };

      for (const entrant of selectedEventEntrants) {
        const key = `${selectedEvent.eventId}:${entrant.entrantId}`;

        const existingMeta = selectedEventMeta?.entrants.find(
          (item) => item.entrantId === entrant.entrantId,
        );

        const categorySelections = emptyCategorySelections();
        const remaining = [...(existingMeta?.characterNames ?? [])]
          .map((value) => value.trim())
          .filter((value) => value !== "");

        for (let slotIndex = 0; slotIndex < MAX_CATEGORY_SLOTS; slotIndex += 1) {
          const listId = categorySlotListIds[slotIndex] ?? "";
          if (listId.trim() === "") {
            continue;
          }

          const itemList = resolveItemListForSelectedEvent(listId);
          if (!itemList) {
            continue;
          }

          const allowDuplicates = Boolean(categorySlotAllowDuplicates[slotIndex]);
          const selections: string[] = [];

          for (let index = 0; index < remaining.length; index += 1) {
            const itemName = remaining[index];
            if (!itemList.items.includes(itemName)) {
              continue;
            }
            if (!allowDuplicates && selections.includes(itemName)) {
              continue;
            }

            selections.push(itemName);
            remaining.splice(index, 1);
            index -= 1;
          }

          categorySelections[slotIndex] = selections;
        }

        if (!current[key] || !dirtyMetaDraftKeysRef.current.has(key)) {
          next[key] = {
            playSide: existingMeta?.playSide ?? "",
            categorySelections,
          };
        }
      }

      return next;
    });
  }, [
    categorySlotAllowDuplicates,
    categorySlotListIds,
    itemLists,
    selectedEvent,
    selectedEventEntrants,
    selectedEventItemListSnapshots,
    selectedEventMeta,
  ]);

  useEffect(() => {
    if (selectedEventSettingKey === "") {
      return;
    }

    const eventMetaSetting = selectedEventMeta?.eventManagement;
    const rawSetting = eventMetaSetting
      ? normalizeEventManagementSetting({
        sideDecisionMethod: eventMetaSetting.sideDecisionMethod,
        itemListIds: (eventMetaSetting.itemListSnapshots ?? []).map((item) => normalizeItemListConfig(item).id),
        categoryMinCounts: eventMetaSetting.categoryMinCounts,
        categoryMaxCounts: eventMetaSetting.categoryMaxCounts,
        categoryAllowDuplicates: eventMetaSetting.categoryAllowDuplicates,
        totalMinCount: eventMetaSetting.totalMinCount,
        totalMaxCount: eventMetaSetting.totalMaxCount,
      })
      : eventMgmtSettings[selectedEventSettingKey];
    if (!rawSetting) {
      suppressEventSettingAutosaveRef.current = true;
      eventSettingHydratedKeyRef.current = selectedEventSettingKey;
      setSideDecisionMethod("upper_1p");
      setCategorySlotListIds(["", "", ""]);
      setCategorySlotMinCounts([0, 0, 0]);
      setCategorySlotMaxCounts([1, 1, 1]);
      setCategorySlotAllowDuplicates([false, false, false]);
      setTotalItemMinCount(0);
      setTotalItemMaxCount(3);
      return;
    }

    const setting = normalizeEventManagementSetting(rawSetting);
    const nextSideMethod = setting.sideDecisionMethod === "upper_2p" || setting.sideDecisionMethod === "random"
      ? setting.sideDecisionMethod
      : "upper_1p";
    const nextIds = (setting.itemListIds ?? []).slice(0, 3);
    while (nextIds.length < 3) {
      nextIds.push("");
    }

    suppressEventSettingAutosaveRef.current = true;
    eventSettingHydratedKeyRef.current = selectedEventSettingKey;
    setSideDecisionMethod(nextSideMethod);
    setCategorySlotListIds(nextIds);
    setCategorySlotMinCounts(normalizeSelectionCountArrays(setting.categoryMinCounts, 0));
    setCategorySlotMaxCounts(normalizeSelectionCountArrays(setting.categoryMaxCounts, 1));
    setCategorySlotAllowDuplicates(normalizeAllowDuplicatesArray(setting.categoryAllowDuplicates));
    setTotalItemMinCount(clampNonNegativeInteger(Number(setting.totalMinCount ?? 0), 0));
    setTotalItemMaxCount(clampNonNegativeInteger(Number(setting.totalMaxCount ?? 3), 3));
  }, [eventMgmtSettingsReady, selectedEventMeta, selectedEventSettingKey]);

  useEffect(() => {
    if (selectedEventSettingKey === "") {
      return;
    }

    if (eventSettingHydratedKeyRef.current !== selectedEventSettingKey) {
      return;
    }

    if (suppressEventSettingAutosaveRef.current) {
      suppressEventSettingAutosaveRef.current = false;
      return;
    }

    const itemListIds = categorySlotListIds.slice(0, MAX_CATEGORY_SLOTS).map((id) => id.trim());
    const normalizedMinCounts = normalizeSelectionCountArrays(categorySlotMinCounts, 0);
    const normalizedMaxCounts = normalizeSelectionCountArrays(categorySlotMaxCounts, 1);
    const normalizedAllowDuplicates = normalizeAllowDuplicatesArray(categorySlotAllowDuplicates);

    for (let i = 0; i < itemListIds.length; i += 1) {
      if (itemListIds[i] === "") {
        normalizedMinCounts[i] = 0;
        normalizedMaxCounts[i] = 0;
        normalizedAllowDuplicates[i] = false;
      } else if (normalizedMaxCounts[i] < normalizedMinCounts[i]) {
        normalizedMaxCounts[i] = normalizedMinCounts[i];
      }
    }

    const normalizedTotalMinCount = clampNonNegativeInteger(totalItemMinCount, 0);
    const normalizedTotalMaxCount = Math.max(
      clampNonNegativeInteger(totalItemMaxCount, 0),
      normalizedTotalMinCount,
    );

    const nextSetting = normalizeEventManagementSetting({
      sideDecisionMethod,
      itemListIds,
      categoryMinCounts: normalizedMinCounts,
      categoryMaxCounts: normalizedMaxCounts,
      categoryAllowDuplicates: normalizedAllowDuplicates,
      totalMinCount: normalizedTotalMinCount,
      totalMaxCount: normalizedTotalMaxCount,
    });

    setEventMgmtSettings((current) => {
      if (isSameEventManagementSetting(current[selectedEventSettingKey], nextSetting)) {
        return current;
      }

      return {
        ...current,
        [selectedEventSettingKey]: nextSetting,
      };
    });
  }, [
    categorySlotAllowDuplicates,
    categorySlotListIds,
    categorySlotMaxCounts,
    categorySlotMinCounts,
    selectedEventSettingKey,
    sideDecisionMethod,
    totalItemMaxCount,
    totalItemMinCount,
  ]);

  useEffect(() => {
    if (selectedEventEntrants.length === 0) {
      if (selectedTournamentEntrantId !== "") {
        setSelectedTournamentEntrantId("");
      }
      return;
    }

    if (selectedTournamentEntrantId !== "" && selectedEventEntrants.some((entrant) => entrant.entrantId === selectedTournamentEntrantId)) {
      return;
    }

    setSelectedTournamentEntrantId(selectedEventEntrants[0].entrantId);
  }, [selectedEventEntrants, selectedTournamentEntrantId]);

  useEffect(() => {
    if (!matchSideRandomNotice) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setMatchSideRandomNotice((current) => {
        if (!current || current.triggeredAt !== matchSideRandomNotice.triggeredAt) {
          return current;
        }
        return null;
      });
    }, 6000);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [matchSideRandomNotice]);

  useEffect(() => {
    const selectionKey = `${toApiSlug(slug)}::${selectedEventId.trim()}`;
    if (overlaySelectionKeyRef.current === null) {
      overlaySelectionKeyRef.current = selectionKey;
      return;
    }

    if (overlaySelectionKeyRef.current === selectionKey) {
      return;
    }

    overlaySelectionKeyRef.current = selectionKey;
    void invoke<ObsOverlayState>("set_obs_overlay_fully_stopped", {
      fullyStopped: true,
    })
      .then((next) => {
        setObsOverlayState(next);
        setIsTestOverlayActive(next.active && next.currentSetId === "__test__");
      })
      .catch((err) => {
        setError(String(err));
      });
  }, [selectedEventId, slug]);

  useEffect(() => {
    if (activeTab !== "overlay") {
      if (isTestOverlayActive) {
        void stopTestOverlay();
      }
      return;
    }

    let alive = true;
    const loadState = async () => {
      try {
        const next = await invoke<ObsOverlayState>("get_obs_overlay_state");
        if (!alive) {
          return;
        }
        setObsOverlayState(next);
        setIsTestOverlayActive(next.active && next.currentSetId === "__test__");
      } catch (err) {
        if (alive) {
          setError(String(err));
        }
      }
    };

    void loadState();
    const pollId = window.setInterval(() => {
      void loadState();
    }, 1200);

    return () => {
      alive = false;
      window.clearInterval(pollId);
    };
  }, [activeTab, isTestOverlayActive]);

  useEffect(() => {
    if (!isTestOverlayActive || !obsOverlayState?.active || obsOverlayState.currentSetId !== "__test__") {
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const next = await invoke<ObsOverlayState>("toggle_obs_overlay_set", {
            input: {
              enabled: true,
              setId: "__test__",
              eventName: "テスト配信",
              eventAlias: "テスト大会",
              roundText: "Preview / Pool A\nPreview\nSet T",
              redPlayerName: testOverlayRedName.trim() || "テストプレイヤー1",
              bluePlayerName: testOverlayBlueName.trim() || "テストプレイヤー2",
              redSetWins: normalizeObsSetWins(testOverlayRedWins),
              blueSetWins: normalizeObsSetWins(testOverlayBlueWins),
              fontScale: normalizeObsFontScale(obsOverlayState.fontScale),
            },
          });
          if (cancelled) {
            return;
          }
          setObsOverlayState(next);
          setIsTestOverlayActive(next.active && next.currentSetId === "__test__");
        } catch (err) {
          if (!cancelled) {
            setError(String(err));
          }
        }
      })();
    }, 140);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    isTestOverlayActive,
    obsOverlayState?.active,
    obsOverlayState?.currentSetId,
    obsOverlayState?.fontScale,
    testOverlayRedName,
    testOverlayBlueName,
    testOverlayRedWins,
    testOverlayBlueWins,
  ]);

  useEffect(() => {
    if (activeTab !== "overlay") {
      return;
    }

    const postPreviewSize = () => {
      const width = overlayPreviewWrapRef.current?.clientWidth ?? 0;
      const height = overlayPreviewWrapRef.current?.clientHeight ?? 0;
      if (width <= 0 || height <= 0) {
        return;
      }
      overlayPreviewIframeRef.current?.contentWindow?.postMessage({
        type: "preview-container-width",
        width,
        height,
      }, "*");
    };

    postPreviewSize();
    const timer = window.setInterval(postPreviewSize, 500);

    return () => {
      window.clearInterval(timer);
    };
  }, [activeTab, obsOverlayState?.overlayUrl]);

  useEffect(() => {
    if (!selectedEvent) {
      standbyReadinessRef.current = {};
      return;
    }

    if (autoAssigningSidesRef.current) {
      return;
    }

    const prevReadiness = standbyReadinessRef.current;
    const nextReadiness: Record<string, string> = {};
    const updates: Array<{ setSnapshot: SetSnapshot; upperEntrantId: string; upperSide: PlaySide }> = [];

    for (const set of selectedEvent.sets.map((candidate) =>
      resolvedEventSetsById.get(candidate.setId) ?? candidate,
    )) {
      const isReadyForAutoAssign = !isCompletedSet(set) && isMatchupReady(set);
      const slots = set.slots.filter((slot) => slot.entrantId !== null);
      const upperId = slots[0]?.entrantId ?? "";
      const lowerId = slots[1]?.entrantId ?? "";
      const readinessKey = isReadyForAutoAssign && upperId !== "" && lowerId !== ""
        ? `${upperId}:${lowerId}`
        : "";
      nextReadiness[set.setId] = readinessKey;

      const previousReadinessKey = prevReadiness[set.setId] ?? "";
      if (!isReadyForAutoAssign || readinessKey === "") {
        continue;
      }

      if (slots.length < 2) {
        continue;
      }
      if (!upperId || !lowerId) {
        continue;
      }

      const upperCurrent = getSetSlotSide(set.setId, upperId);
      const lowerCurrent = getSetSlotSide(set.setId, lowerId);
      const hasInvalidPair = (upperCurrent === "") !== (lowerCurrent === "")
        || (upperCurrent !== "" && lowerCurrent !== "" && upperCurrent === lowerCurrent);
      if (previousReadinessKey === readinessKey && !hasInvalidPair) {
        continue;
      }

      let upperSide = upperCurrent;
      let lowerSide = lowerCurrent;

      if (upperSide !== "" && lowerSide !== "") {
        if (upperSide !== lowerSide) {
          continue;
        }

        const decided = resolveSidesByDecisionMethod(set, getConfiguredSideDecisionMethod());
        upperSide = decided.upperSide;
        lowerSide = decided.lowerSide;
      }

      if (upperSide !== "" && lowerSide === "") {
        lowerSide = oppositePlaySide(upperSide);
      } else if (lowerSide !== "" && upperSide === "") {
        upperSide = oppositePlaySide(lowerSide);
      } else {
        const method = getConfiguredSideDecisionMethod();
        if (method === "upper_2p") {
          upperSide = "2P";
          lowerSide = "1P";
        } else if (method === "random") {
          const upperIsOneP = deterministicUpperIsOneP(set.setId);
          upperSide = upperIsOneP ? "1P" : "2P";
          lowerSide = upperIsOneP ? "2P" : "1P";
        } else {
          upperSide = "1P";
          lowerSide = "2P";
        }
      }

      if (upperCurrent !== upperSide || lowerCurrent !== lowerSide) {
        updates.push({ setSnapshot: set, upperEntrantId: upperId, upperSide });
      }
    }

    standbyReadinessRef.current = nextReadiness;

    if (updates.length === 0) {
      return;
    }

    autoAssigningSidesRef.current = true;
    void (async () => {
      try {
        for (const update of updates) {
          await saveSetPlaySide(selectedEvent, update.setSnapshot, update.upperEntrantId, update.upperSide, {
            silent: true,
            manageBusy: false,
          });
        }
      } finally {
        autoAssigningSidesRef.current = false;
      }
    })();
  }, [selectedEvent, resolvedEventSetsById, setPlaySideMap, sideDecisionMethod, eventMgmtSettings, selectedEventSettingKey]);

  function getMetaDraftKey(eventId: string, entrantId: string): string {
    return `${eventId}:${entrantId}`;
  }

  function getMetaDraft(eventId: string, entrantId: string): PlayerMetaDraft {
    const key = getMetaDraftKey(eventId, entrantId);
    const existingMeta = localMeta?.events
      .find((event) => event.eventId === eventId)
      ?.entrants.find((entrant) => entrant.entrantId === entrantId);

    const categorySelections = emptyCategorySelections();
    const remaining = [...(existingMeta?.characterNames ?? [])]
      .map((value) => value.trim())
      .filter((value) => value !== "");

    for (let slotIndex = 0; slotIndex < MAX_CATEGORY_SLOTS; slotIndex += 1) {
      const listId = categorySlotListIds[slotIndex] ?? "";
      if (listId.trim() === "") {
        continue;
      }

      const itemList = resolveItemListForSelectedEvent(listId);
      if (!itemList) {
        continue;
      }

      const allowDuplicates = Boolean(categorySlotAllowDuplicates[slotIndex]);
      const selections: string[] = [];

      for (let index = 0; index < remaining.length; index += 1) {
        const itemName = remaining[index];
        if (!itemList.items.includes(itemName)) {
          continue;
        }
        if (!allowDuplicates && selections.includes(itemName)) {
          continue;
        }

        selections.push(itemName);
        remaining.splice(index, 1);
        index -= 1;
      }

      categorySelections[slotIndex] = selections;
    }

    return (
      metaDrafts[key] ?? {
        playSide: existingMeta?.playSide ?? "",
        categorySelections,
      }
    );
  }

  function setMetaDraft(eventId: string, entrantId: string, patch: Partial<PlayerMetaDraft>) {
    const key = getMetaDraftKey(eventId, entrantId);
    const existingMeta = localMeta?.events
      .find((event) => event.eventId === eventId)
      ?.entrants.find((entrant) => entrant.entrantId === entrantId);

    dirtyMetaDraftKeysRef.current.add(key);
    setMetaDrafts((current) => {
      const baseDraft = current[key] ?? {
        playSide: existingMeta?.playSide ?? "",
        categorySelections: emptyCategorySelections(),
      };

      const nextSelections = patch.categorySelections
        ? patch.categorySelections.slice(0, MAX_CATEGORY_SLOTS).map((items) =>
          Array.isArray(items)
            ? items.map((value) => value.trim()).filter((value) => value !== "")
            : [],
        )
        : baseDraft.categorySelections;
      while (nextSelections.length < MAX_CATEGORY_SLOTS) {
        nextSelections.push([]);
      }

      return {
        ...current,
        [key]: {
          ...baseDraft,
          ...patch,
          categorySelections: nextSelections,
        },
      };
    });
  }

  function getConfiguredSideDecisionMethod(): EventManagementSetting["sideDecisionMethod"] {
    if (selectedEventSettingKey === "") {
      return "upper_1p";
    }

    const configured = eventMgmtSettings[selectedEventSettingKey]?.sideDecisionMethod;
    if (configured === "upper_2p" || configured === "random") {
      return configured;
    }

    return "upper_1p";
  }

  function resolveSidesByDecisionMethod(
    set: SetSnapshot,
    method: EventManagementSetting["sideDecisionMethod"],
  ): { upperSide: PlaySide; lowerSide: PlaySide } {
    if (method === "upper_2p") {
      return { upperSide: "2P", lowerSide: "1P" };
    }

    if (method === "random") {
      const upperIsOneP = deterministicUpperIsOneP(set.setId);
      return {
        upperSide: upperIsOneP ? "1P" : "2P",
        lowerSide: upperIsOneP ? "2P" : "1P",
      };
    }

    return { upperSide: "1P", lowerSide: "2P" };
  }

  async function applySideDecisionMethodToAllUnconfirmedSets() {
    if (!selectedEvent) {
      return;
    }

    setBusy(true);
    setError("");
    setMessage("");

    try {
      const method = getConfiguredSideDecisionMethod();
      const updates: Array<{ setSnapshot: SetSnapshot; upperEntrantId: string; upperSide: PlaySide }> = [];

      for (const set of selectedEvent.sets.map((candidate) =>
        resolvedEventSetsById.get(candidate.setId) ?? candidate,
      )) {
        if (isCompletedSet(set) || !isMatchupReady(set)) {
          continue;
        }

        const slots = set.slots.filter((slot) => slot.entrantId !== null);
        if (slots.length < 2) {
          continue;
        }

        const upperId = slots[0].entrantId;
        const lowerId = slots[1].entrantId;
        if (!upperId || !lowerId) {
          continue;
        }

        const decided = resolveSidesByDecisionMethod(set, method);
        const upperCurrent = getSetSlotSide(set.setId, upperId);
        const lowerCurrent = getSetSlotSide(set.setId, lowerId);

        if (upperCurrent !== decided.upperSide || lowerCurrent !== decided.lowerSide) {
          updates.push({ setSnapshot: set, upperEntrantId: upperId, upperSide: decided.upperSide });
        }
      }

      if (updates.length === 0) {
        setMessage("適用対象の未確定試合はありませんでした。");
        return;
      }

      autoAssigningSidesRef.current = true;
      try {
        for (const update of updates) {
          await saveSetPlaySide(selectedEvent, update.setSnapshot, update.upperEntrantId, update.upperSide, {
            silent: true,
            manageBusy: false,
          });
        }
      } finally {
        autoAssigningSidesRef.current = false;
      }

      const affectedSetCount = new Set(updates.map((update) => update.setSnapshot.setId)).size;
      setMessage(`未確定試合 ${affectedSetCount} 件に 1P/2P 決定方法を適用しました。`);
    } catch (err) {
      setError(String(err));
    } finally {
      autoAssigningSidesRef.current = false;
      setBusy(false);
    }
  }

  function getDraftCategorySelections(draft: PlayerMetaDraft, slotIndex: number): string[] {
    return (draft.categorySelections[slotIndex] ?? [])
      .map((value) => value.trim())
      .filter((value) => value !== "");
  }

  function setDraftCategorySelections(
    eventId: string,
    entrantId: string,
    slotIndex: number,
    nextSelections: string[],
  ) {
    const draft = getMetaDraft(eventId, entrantId);
    const categorySelections = draft.categorySelections
      .slice(0, MAX_CATEGORY_SLOTS)
      .map((items) => [...items]);
    while (categorySelections.length < MAX_CATEGORY_SLOTS) {
      categorySelections.push([]);
    }

    categorySelections[slotIndex] = nextSelections
      .map((value) => value.trim())
      .filter((value) => value !== "");

    setMetaDraft(eventId, entrantId, { categorySelections });
  }

  function addDraftCategorySelection(
    eventId: string,
    entrantId: string,
    slotIndex: number,
    list: ItemListConfig,
    allowDuplicates: boolean,
    maxCount: number,
    itemName: string,
  ) {
    const normalizedItem = itemName.trim();
    if (normalizedItem === "") {
      return;
    }
    if (!list.items.includes(normalizedItem)) {
      return;
    }

    const draft = getMetaDraft(eventId, entrantId);
    const currentSelections = getDraftCategorySelections(draft, slotIndex);

    if (!allowDuplicates && currentSelections.includes(normalizedItem)) {
      return;
    }

    if (currentSelections.length >= maxCount) {
      return;
    }

    setDraftCategorySelections(eventId, entrantId, slotIndex, [...currentSelections, normalizedItem]);
  }

  function removeDraftCategorySelection(
    eventId: string,
    entrantId: string,
    slotIndex: number,
    removeIndex: number,
  ) {
    const draft = getMetaDraft(eventId, entrantId);
    const currentSelections = getDraftCategorySelections(draft, slotIndex);
    if (removeIndex < 0 || removeIndex >= currentSelections.length) {
      return;
    }

    const next = currentSelections.filter((_, index) => index !== removeIndex);
    setDraftCategorySelections(eventId, entrantId, slotIndex, next);
  }

  function buildValidatedSelections(
    draft: PlayerMetaDraft,
    slots: Array<{
      slotIndex: number;
      list: ItemListConfig;
      minCount: number;
      maxCount: number;
      allowDuplicates: boolean;
    }>,
  ): { normalizedBySlot: string[][]; flattened: string[]; errors: string[] } {
    const normalizedBySlot = emptyCategorySelections();
    const flattened: string[] = [];
    const errors: string[] = [];

    for (const slot of slots) {
      const allowedItems = new Set(slot.list.items);
      let selections = getDraftCategorySelections(draft, slot.slotIndex)
        .filter((value) => allowedItems.has(value));

      if (!slot.allowDuplicates) {
        const unique: string[] = [];
        for (const value of selections) {
          if (!unique.includes(value)) {
            unique.push(value);
          }
        }
        selections = unique;
      }

      if (selections.length < slot.minCount) {
        errors.push(`${slot.list.categoryName}: 最低 ${slot.minCount} 件必要です。`);
      }
      if (selections.length > slot.maxCount) {
        errors.push(`${slot.list.categoryName}: 最大 ${slot.maxCount} 件までです。`);
      }

      normalizedBySlot[slot.slotIndex] = selections;
      flattened.push(...selections);
    }

    const totalMin = clampNonNegativeInteger(totalItemMinCount, 0);
    const totalMax = Math.max(clampNonNegativeInteger(totalItemMaxCount, 0), totalMin);
    if (flattened.length < totalMin) {
      errors.push(`全体の選択数が不足しています (最低 ${totalMin} 件)。`);
    }
    if (flattened.length > totalMax) {
      errors.push(`全体の選択数が超過しています (最大 ${totalMax} 件)。`);
    }

    return { normalizedBySlot, flattened, errors };
  }

  function setCategoryListSlot(slotIndex: number, itemListId: string) {
    setCategorySlotListIds((current) => {
      const next = [...current];
      while (next.length < MAX_CATEGORY_SLOTS) {
        next.push("");
      }

      if (itemListId !== "") {
        for (let i = 0; i < next.length; i += 1) {
          if (i !== slotIndex && next[i] === itemListId) {
            next[i] = "";
          }
        }
      }

      next[slotIndex] = itemListId;
      return next.slice(0, MAX_CATEGORY_SLOTS);
    });

    if (itemListId.trim() === "") {
      setCategorySlotMinCounts((current) => {
        const next = [...current];
        next[slotIndex] = 0;
        return next;
      });
      setCategorySlotMaxCounts((current) => {
        const next = [...current];
        next[slotIndex] = 0;
        return next;
      });
      setCategorySlotAllowDuplicates((current) => {
        const next = [...current];
        next[slotIndex] = false;
        return next;
      });
      return;
    }

    setCategorySlotMaxCounts((current) => {
      const next = [...current];
      if ((next[slotIndex] ?? 0) < 1) {
        next[slotIndex] = 1;
      }
      return next;
    });
  }

  function resetItemListEditor() {
    setEditingItemListId(null);
    setItemListName("");
    setItemCategoryName("");
    setItemListText("");
  }

  function editItemList(itemList: ItemListConfig) {
    setEditingItemListId(itemList.id);
    setItemListName(itemList.name);
    setItemCategoryName(itemList.categoryName);
    setItemListText(itemList.items.join("\n"));
  }

  function saveItemList() {
    const name = itemListName.trim();
    const categoryName = itemCategoryName.trim();
    if (name === "" || categoryName === "") {
      setError("アイテムリスト名とカテゴリ名を入力してください。");
      return;
    }

    const items = parseLinesToUniqueList(itemListText);
    setError("");

    if (editingItemListId) {
      setItemLists((current) =>
        current.map((list) =>
          list.id === editingItemListId ? { ...list, name, categoryName, items } : list,
        ),
      );
      setMessage("アイテムリストを更新しました。");
      resetItemListEditor();
      return;
    }

    const next: ItemListConfig = {
      id: crypto.randomUUID(),
      name,
      categoryName,
      items,
    };
    setItemLists((current) => [...current, next]);
    setMessage("アイテムリストを作成しました。");
    resetItemListEditor();
  }

  function deleteItemList(itemListId: string) {
    setItemLists((current) => current.filter((list) => list.id !== itemListId));
    const nextListIds = categorySlotListIds.map((id) => (id === itemListId ? "" : id));
    setCategorySlotListIds(nextListIds);
    setCategorySlotMinCounts((current) => current.map((value, index) => (nextListIds[index] === "" && categorySlotListIds[index] === itemListId ? 0 : value)));
    setCategorySlotMaxCounts((current) => current.map((value, index) => (nextListIds[index] === "" && categorySlotListIds[index] === itemListId ? 0 : value)));
    setCategorySlotAllowDuplicates((current) => current.map((value, index) => (nextListIds[index] === "" && categorySlotListIds[index] === itemListId ? false : value)));
    if (editingItemListId === itemListId) {
      resetItemListEditor();
    }
    setEventMgmtSettings((current) => {
      const next: Record<string, EventManagementSetting> = {};
      for (const [key, value] of Object.entries(current)) {
        const normalized = normalizeEventManagementSetting(value);
        const ids = [...normalized.itemListIds];
        const mins = normalizeSelectionCountArrays(normalized.categoryMinCounts, 0);
        const maxes = normalizeSelectionCountArrays(normalized.categoryMaxCounts, 1);
        const allows = normalizeAllowDuplicatesArray(normalized.categoryAllowDuplicates);

        for (let i = 0; i < MAX_CATEGORY_SLOTS; i += 1) {
          if (ids[i] === itemListId) {
            ids[i] = "";
            mins[i] = 0;
            maxes[i] = 0;
            allows[i] = false;
          }
        }

        next[key] = normalizeEventManagementSetting({
          ...normalized,
          itemListIds: ids,
          categoryMinCounts: mins,
          categoryMaxCounts: maxes,
          categoryAllowDuplicates: allows,
        });
      }
      return next;
    });
    setMessage("アイテムリストを削除しました。");
  }

  async function saveEventManagementSetting() {
    if (selectedEventSettingKey === "" || !selectedEvent) {
      setError("先にイベントを選択してください。");
      return;
    }

    const itemListIds = categorySlotListIds.slice(0, MAX_CATEGORY_SLOTS).map((id) => id.trim());
    const normalizedMinCounts = normalizeSelectionCountArrays(categorySlotMinCounts, 0);
    const normalizedMaxCounts = normalizeSelectionCountArrays(categorySlotMaxCounts, 1);
    const normalizedAllowDuplicates = normalizeAllowDuplicatesArray(categorySlotAllowDuplicates);

    const seen = new Set<string>();
    for (let i = 0; i < itemListIds.length; i += 1) {
      if (itemListIds[i] === "") {
        normalizedMinCounts[i] = 0;
        normalizedMaxCounts[i] = 0;
        normalizedAllowDuplicates[i] = false;
        continue;
      }

      if (seen.has(itemListIds[i])) {
        setError("カテゴリは重複して設定できません。");
        return;
      }
      seen.add(itemListIds[i]);

      if (normalizedMaxCounts[i] < normalizedMinCounts[i]) {
        setError(`カテゴリ${i + 1}: 上限は下限以上にしてください。`);
        return;
      }
    }

    const normalizedTotalMinCount = clampNonNegativeInteger(totalItemMinCount, 0);
    const normalizedTotalMaxCount = Math.max(
      clampNonNegativeInteger(totalItemMaxCount, 0),
      normalizedTotalMinCount,
    );

    const nextSetting: EventManagementSetting = {
      sideDecisionMethod,
      itemListIds,
      categoryMinCounts: normalizedMinCounts,
      categoryMaxCounts: normalizedMaxCounts,
      categoryAllowDuplicates: normalizedAllowDuplicates,
      totalMinCount: normalizedTotalMinCount,
      totalMaxCount: normalizedTotalMaxCount,
    };

    setBusy(true);
    setError("");
    setMessage("");

    try {
      const itemListSnapshots = itemListIds.map((listId) => {
        if (listId === "") {
          return {
            id: "",
            name: "",
            categoryName: "",
            items: [],
          } as ItemListConfig;
        }

        const source = resolveItemListForSelectedEvent(listId);
        if (!source) {
          throw new Error(`選択中のカテゴリ設定に存在しないアイテムリストがあります: ${listId}`);
        }

        return normalizeItemListConfig(source);
      });

      const normalizedSlug = toApiSlug(slug);
      const result = await invoke<TournamentWorkspace>("save_event_management_meta", {
        input: {
          slug: normalizedSlug,
          eventId: selectedEvent.eventId,
          eventName: selectedEvent.name,
          setting: {
            sideDecisionMethod,
            itemListSnapshots,
            categoryMinCounts: normalizedMinCounts,
            categoryMaxCounts: normalizedMaxCounts,
            categoryAllowDuplicates: normalizedAllowDuplicates,
            totalMinCount: normalizedTotalMinCount,
            totalMaxCount: normalizedTotalMaxCount,
          },
        },
      });

      setWorkspace(result);
      setEventMgmtSettings((current) => ({
        ...current,
        [selectedEventSettingKey]: nextSetting,
      }));
      setMessage("大会管理設定を保存しました。");
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  function formatScoreValue(value: number): string {
    return Number.isInteger(value) ? String(value) : value.toFixed(1);
  }

  async function updateObsOverlayNameFitMode(mode: "truncate" | "shrink") {
    setObsOverlayBusy(true);
    try {
      const next = await invoke<ObsOverlayState>("set_obs_overlay_name_fit_mode", {
        nameFitMode: mode,
      });
      setObsOverlayState(next);
      setIsTestOverlayActive(next.active && next.currentSetId === "__test__");
    } catch (err) {
      setError(String(err));
    } finally {
      setObsOverlayBusy(false);
    }
  }

  async function updateObsOverlayShowSetInfo(showSetInfo: boolean) {
    setObsOverlayBusy(true);
    try {
      const next = await invoke<ObsOverlayState>("set_obs_overlay_show_set_info", {
        showSetInfo,
      });
      setObsOverlayState(next);
      setIsTestOverlayActive(next.active && next.currentSetId === "__test__");
    } catch (err) {
      setError(String(err));
    } finally {
      setObsOverlayBusy(false);
    }
  }

  async function updateObsOverlayShowEventAlias(showEventAlias: boolean) {
    setObsOverlayBusy(true);
    try {
      const next = await invoke<ObsOverlayState>("set_obs_overlay_show_event_alias", {
        showEventAlias,
      });
      setObsOverlayState(next);
      setIsTestOverlayActive(next.active && next.currentSetId === "__test__");
    } catch (err) {
      setError(String(err));
    } finally {
      setObsOverlayBusy(false);
    }
  }

  async function setObsOverlayFullyStopped(fullyStopped: boolean) {
    setObsOverlayBusy(true);
    try {
      const next = await invoke<ObsOverlayState>("set_obs_overlay_fully_stopped", {
        fullyStopped,
      });
      setObsOverlayState(next);
      setIsTestOverlayActive(next.active && next.currentSetId === "__test__");
      setError("");
    } catch (err) {
      setError(String(err));
    } finally {
      setObsOverlayBusy(false);
    }
  }

  async function toggleObsOverlaySet(input: ObsOverlaySetInput) {
    setObsOverlayBusy(true);
    try {
      const next = await invoke<ObsOverlayState>("toggle_obs_overlay_set", {
        input: {
          ...input,
          redSetWins: normalizeObsSetWins(input.redSetWins),
          blueSetWins: normalizeObsSetWins(input.blueSetWins),
          fontScale: normalizeObsFontScale(input.fontScale),
        },
      });
      setObsOverlayState(next);
      setIsTestOverlayActive(next.active && next.currentSetId === "__test__");
      setError("");
    } catch (err) {
      setError(String(err));
    } finally {
      setObsOverlayBusy(false);
    }
  }

  async function startTestOverlay() {
    if (!obsOverlayState) {
      return;
    }

    const buildInput = (fontScale: number): ObsOverlaySetInput => ({
      enabled: true,
      setId: "__test__",
      eventName: "テスト配信",
      eventAlias: "テスト大会",
      roundText: "Preview / Pool A\nPreview\nSet T",
      redPlayerName: testOverlayRedName.trim() || "テストプレイヤー1",
      bluePlayerName: testOverlayBlueName.trim() || "テストプレイヤー2",
      redSetWins: testOverlayRedWins,
      blueSetWins: testOverlayBlueWins,
      fontScale,
    });

    await toggleObsOverlaySet({
      ...buildInput(obsOverlayState.fontScale),
    });
  }

  async function stopTestOverlay() {
    await toggleObsOverlaySet({
      enabled: false,
      setId: "__test__",
      eventName: "",
      eventAlias: "",
      roundText: "",
      redPlayerName: "",
      bluePlayerName: "",
      redSetWins: 0,
      blueSetWins: 0,
      fontScale: obsOverlayState?.fontScale ?? 1,
    });
  }

  async function toggleActiveMatchOverlay(set: SetSnapshot) {
    if (!isDisplayableSet(set, selectedEvent)) {
      return;
    }
    const isSameActive = obsOverlayState?.active && obsOverlayState.currentSetId === set.setId;
    const displayCode = setDisplayCodeById.get(set.setId);
    const nextRoundLabel = abbreviateOverlayRoundText(set.fullRoundText);
    const phasePoolLabel = `${set.phaseName?.trim() || "-"} / Pool ${set.phaseGroupDisplayIdentifier?.trim() || "-"}`;
    const setName = set.identifier?.trim() || displayCode || "-";
    const nextRoundText = `${phasePoolLabel} / Set ${setName}\n${nextRoundLabel}`;
    const overlaySides = resolveOverlaySidesForSet(set);

    await toggleObsOverlaySet({
      enabled: !isSameActive,
      setId: set.setId,
      eventName: selectedEvent?.name ?? "",
      eventAlias: selectedEventMeta?.eventAlias?.trim() ?? "",
      roundText: nextRoundText,
      redPlayerName: overlaySides.redPlayerName,
      bluePlayerName: overlaySides.bluePlayerName,
      redSetWins: overlaySides.redSetWins,
      blueSetWins: overlaySides.blueSetWins,
      fontScale: obsOverlayState?.fontScale ?? 1,
    });
  }

  async function forceSwitchActiveMatchOverlay(set: SetSnapshot) {
    const currentSetId = obsOverlayState?.active ? obsOverlayState.currentSetId : null;
    if (
      currentSetId
      && currentSetId !== "__test__"
      && currentSetId !== set.setId
    ) {
      await toggleObsOverlaySet({
        enabled: false,
        setId: currentSetId,
        eventName: "",
        eventAlias: "",
        roundText: "",
        redPlayerName: "",
        bluePlayerName: "",
        redSetWins: 0,
        blueSetWins: 0,
        fontScale: obsOverlayState?.fontScale ?? 1,
      });
    }

    await toggleActiveMatchOverlay(set);
  }

  function resolveOverlaySidesForSet(
    set: SetSnapshot,
    scoreByEntrantId?: Map<string, number>,
  ): { redPlayerName: string; bluePlayerName: string; redSetWins: number; blueSetWins: number } {
    const slots = set.slots.slice(0, 2);
    const slot0 = slots[0] ?? null;
    const slot1 = slots[1] ?? null;

    const sideOf = (slot: SetSlot | null): PlaySide | "" => {
      if (!slot || !slot.entrantId) {
        return "";
      }
      return getSetSlotSide(set.setId, slot.entrantId);
    };

    const getScore = (slot: SetSlot | null): number | null => {
      if (!slot) {
        return null;
      }
      if (slot.entrantId && scoreByEntrantId?.has(slot.entrantId)) {
        return scoreByEntrantId.get(slot.entrantId) ?? null;
      }
      return slot.score ?? null;
    };

    let onePSlot: SetSlot | null = null;
    let twoPSlot: SetSlot | null = null;

    const slot0Side = sideOf(slot0);
    const slot1Side = sideOf(slot1);
    if (slot0Side === "1P") {
      onePSlot = slot0;
    }
    if (slot0Side === "2P") {
      twoPSlot = slot0;
    }
    if (slot1Side === "1P") {
      onePSlot = slot1;
    }
    if (slot1Side === "2P") {
      twoPSlot = slot1;
    }

    if (!onePSlot) {
      onePSlot = slot0;
    }
    if (!twoPSlot) {
      twoPSlot = onePSlot === slot0 ? slot1 : slot0;
    }

    const redPlayerName = onePSlot?.entrantName?.trim() || "RED";
    const bluePlayerName = twoPSlot?.entrantName?.trim() || "BLUE";
    const redSetWins = scoreToOverlayGameWins(getScore(onePSlot));
    const blueSetWins = scoreToOverlayGameWins(getScore(twoPSlot));

    return {
      redPlayerName,
      bluePlayerName,
      redSetWins,
      blueSetWins,
    };
  }

  async function syncObsOverlayScoresForSet(
    set: SetSnapshot,
    slotScores: Array<{ entrantId: string; score: number }>,
  ) {
    if (set.setId === "__test__") {
      return;
    }
    if (!isDisplayableSet(set, selectedEvent)) {
      return;
    }

    let currentOverlayState = obsOverlayState;
    if (!currentOverlayState?.active || currentOverlayState.currentSetId !== set.setId) {
      try {
        const latest = await invoke<ObsOverlayState>("get_obs_overlay_state");
        setObsOverlayState(latest);
        setIsTestOverlayActive(latest.active && latest.currentSetId === "__test__");
        currentOverlayState = latest;
      } catch {
        return;
      }
    }

    if (!currentOverlayState?.active || currentOverlayState.currentSetId !== set.setId || currentOverlayState.currentSetId === "__test__") {
      return;
    }

    const scoreByEntrantId = new Map<string, number>();
    for (const item of slotScores) {
      scoreByEntrantId.set(item.entrantId, item.score);
    }

    const displayCode = setDisplayCodeById.get(set.setId);
    const nextRoundLabel = abbreviateOverlayRoundText(set.fullRoundText);
    const phasePoolLabel = `${set.phaseName?.trim() || "-"} / Pool ${set.phaseGroupDisplayIdentifier?.trim() || "-"}`;
    const setName = set.identifier?.trim() || displayCode || "-";
    const overlaySides = resolveOverlaySidesForSet(set, scoreByEntrantId);

    await toggleObsOverlaySet({
      enabled: true,
      setId: set.setId,
      eventName: selectedEvent?.name ?? "",
      eventAlias: selectedEventMeta?.eventAlias?.trim() ?? "",
      roundText: `${phasePoolLabel} / Set ${setName}\n${nextRoundLabel}`,
      redPlayerName: overlaySides.redPlayerName,
      bluePlayerName: overlaySides.bluePlayerName,
      redSetWins: overlaySides.redSetWins,
      blueSetWins: overlaySides.blueSetWins,
      fontScale: currentOverlayState.fontScale,
    });
  }

  const phasePoolGroups = useMemo(() => {
    if (!selectedEvent) {
      return [] as PhasePoolGroup[];
    }

    const groupMap = new Map<string, {
      key: string;
      phaseGroupId: string | null;
      phaseName: string;
      phaseGroupName: string;
      bracketType: string | null;
      phaseOrder: number | null;
      phaseGroupDisplayIdentifier: string | null;
      tiebreakOrder: string[];
      progressionsOut: PhaseGroupProgressionSnapshot[];
      seedMap: unknown;
      seedOrder: string[];
      seeds: PhaseGroupSeedSnapshot[];
      sets: SetSnapshot[];
    }>();

    for (const set of selectedEvent.sets) {
      if (!isDisplayableSet(set, selectedEvent)) {
        continue;
      }
      const phaseName = set.phaseName && set.phaseName.trim() !== "" ? set.phaseName : "Phase 未設定";
      const phaseGroupName =
        set.phaseGroupName && set.phaseGroupName.trim() !== "" ? set.phaseGroupName : "Pool 未設定";
      const phaseGroupDisplayIdentifier = set.phaseGroupDisplayIdentifier?.trim() || null;
      const phaseGroupMetadata = set.phaseGroupId
        ? selectedEvent.phaseGroups?.find((group) => group.phaseGroupId === set.phaseGroupId)
        : selectedEvent.phaseGroups?.find((group) =>
          group.phaseOrder === set.phaseOrder
          && (group.displayIdentifier?.trim() || null) === phaseGroupDisplayIdentifier,
        ) ?? selectedEvent.phaseGroups?.find((group) =>
          group.phaseName === set.phaseName
          && (group.displayIdentifier?.trim() || null) === phaseGroupDisplayIdentifier,
        );
      if (!phaseGroupMetadata) {
        continue;
      }
      const bracketType = phaseGroupMetadata?.bracketType?.trim().toUpperCase() || null;
      const tiebreakOrder = phaseGroupMetadata?.tiebreakOrder ?? [];
      const progressionsOut = phaseGroupMetadata?.progressionsOut ?? [];
      const seedMap = phaseGroupMetadata?.seedMap ?? null;
      const seedOrder = phaseGroupMetadata?.seedOrder ?? [];
      const seeds = phaseGroupMetadata?.seeds ?? [];
      const hasStablePhasePoolIdentity = set.phaseOrder !== null && phaseGroupDisplayIdentifier !== null;
      const groupKey = set.phaseGroupId
        ? `id:${set.phaseGroupId}`
        : hasStablePhasePoolIdentity
          ? `order:${set.phaseOrder}::pool:${phaseGroupDisplayIdentifier}`
        : `name:${phaseName}::${phaseGroupName}`;
      const found = groupMap.get(groupKey);

      if (found) {
        found.sets.push(set);
        if (found.bracketType === null && bracketType !== null) {
          found.bracketType = bracketType;
        }
        if (found.progressionsOut.length === 0 && progressionsOut.length > 0) {
          found.progressionsOut = progressionsOut;
        }
        if (found.seedMap === null && seedMap !== null) {
          found.seedMap = seedMap;
        }
        if (found.seedOrder.length === 0 && seedOrder.length > 0) {
          found.seedOrder = seedOrder;
        }
        if (found.seeds.length === 0 && seeds.length > 0) {
          found.seeds = seeds;
        }
        continue;
      }

      groupMap.set(groupKey, {
        key: groupKey,
        phaseGroupId: set.phaseGroupId ?? null,
        phaseName,
        phaseGroupName,
        bracketType,
        phaseOrder: set.phaseOrder,
        phaseGroupDisplayIdentifier,
        tiebreakOrder,
        progressionsOut,
        seedMap,
        seedOrder,
        seeds,
        sets: [set],
      });
    }

    return [...groupMap.values()]
      .sort((a, b) => {
        if (a.phaseOrder === null && b.phaseOrder !== null) {
          return 1;
        }
        if (a.phaseOrder !== null && b.phaseOrder === null) {
          return -1;
        }
        if (a.phaseOrder !== null && b.phaseOrder !== null && a.phaseOrder !== b.phaseOrder) {
          return a.phaseOrder - b.phaseOrder;
        }
        const byPhase = a.phaseName.localeCompare(b.phaseName, "ja");
        if (byPhase !== 0) {
          return byPhase;
        }
        if (a.phaseGroupDisplayIdentifier !== null && b.phaseGroupDisplayIdentifier !== null) {
          return a.phaseGroupDisplayIdentifier.localeCompare(b.phaseGroupDisplayIdentifier, "ja");
        }
        return a.phaseGroupName.localeCompare(b.phaseGroupName, "ja");
      })
      .map((group) => ({
        key: group.key,
        phaseGroupId: group.phaseGroupId,
        phaseName: group.phaseName,
        phaseGroupName: group.phaseGroupName,
        bracketType: group.bracketType,
        phaseOrder: group.phaseOrder,
        phaseGroupDisplayIdentifier: group.phaseGroupDisplayIdentifier,
        tiebreakOrder: group.tiebreakOrder,
        progressionsOut: group.progressionsOut,
        seedMap: group.seedMap,
        seedOrder: group.seedOrder,
        seeds: group.seeds,
        sets: group.sets,
        columns: buildRoundColumns(group.sets),
      }));
  }, [selectedEvent]);

  const phaseNames = useMemo(() => {
    const names = [...new Set(phasePoolGroups.map((group) => group.phaseName))];
    const phasePositionByName = new Map<string, number>();
    for (const [index, phase] of (selectedEvent?.phases ?? []).entries()) {
      if (phase.name && !phasePositionByName.has(phase.name)) {
        phasePositionByName.set(phase.name, index);
      }
    }

    const groupOrderByName = new Map<string, number>();
    for (const group of phasePoolGroups) {
      if (group.phaseOrder === null) {
        continue;
      }
      const currentOrder = groupOrderByName.get(group.phaseName);
      if (currentOrder === undefined || group.phaseOrder < currentOrder) {
        groupOrderByName.set(group.phaseName, group.phaseOrder);
      }
    }

    const useGroupOrderFallback = phasePositionByName.size === 0;
    return names.sort((left, right) => {
      const leftPosition = phasePositionByName.get(left);
      const rightPosition = phasePositionByName.get(right);
      if (leftPosition !== undefined && rightPosition !== undefined && leftPosition !== rightPosition) {
        return leftPosition - rightPosition;
      }
      if (leftPosition !== undefined && rightPosition === undefined) {
        return -1;
      }
      if (leftPosition === undefined && rightPosition !== undefined) {
        return 1;
      }

      const leftOrder = useGroupOrderFallback ? groupOrderByName.get(left) : undefined;
      const rightOrder = useGroupOrderFallback ? groupOrderByName.get(right) : undefined;
      if (leftOrder === undefined && rightOrder !== undefined) {
        return 1;
      }
      if (leftOrder !== undefined && rightOrder === undefined) {
        return -1;
      }
      if (leftOrder !== undefined && rightOrder !== undefined && leftOrder !== rightOrder) {
        return leftOrder - rightOrder;
      }
      return left.localeCompare(right, "ja");
    });
  }, [phasePoolGroups, selectedEvent]);

  const phaseScopedPoolGroups = useMemo(() => {
    if (phasePoolGroups.length === 0) {
      return [] as PhasePoolGroup[];
    }

    const phaseName = selectedPhaseName === "" ? phasePoolGroups[0].phaseName : selectedPhaseName;
    return phasePoolGroups.filter((group) => group.phaseName === phaseName);
  }, [phasePoolGroups, selectedPhaseName]);

  const selectedPhasePoolGroup = useMemo(() => {
    if (phaseScopedPoolGroups.length === 0) {
      return null;
    }

    if (selectedPhasePoolKey === "") {
      return phaseScopedPoolGroups[0];
    }

    return phaseScopedPoolGroups.find((group) => group.key === selectedPhasePoolKey) ?? phaseScopedPoolGroups[0];
  }, [phaseScopedPoolGroups, selectedPhasePoolKey]);

  const activeMatch = useMemo(() => {
    if (!selectedPhasePoolGroup || activeMatchSetId.trim() === "") {
      return null;
    }

    const set = selectedPhasePoolGroup.sets.find((candidate) => candidate.setId === activeMatchSetId);
    return set
      ? resolvedEventSetsById.get(set.setId) ?? set
      : null;
  }, [resolvedEventSetsById, selectedEvent, selectedPhasePoolGroup, activeMatchSetId]);

  const activeObsOverlaySet = useMemo(() => {
    if (!obsOverlayState?.active || !obsOverlayState.currentSetId) {
      return null;
    }
    return allSets.find((entry) => entry.set.setId === obsOverlayState.currentSetId) ?? null;
  }, [allSets, obsOverlayState]);

  const isActiveMatchDqDraft = useMemo(() => {
    if (!activeMatch) {
      return false;
    }

    return hasDqScoreInDrafts(activeMatch, scoreDrafts);
  }, [activeMatch, scoreDrafts]);

  const selectedBracketSections = useMemo(() => {
    if (!selectedPhasePoolGroup) {
      return [] as Array<{ key: string; title: string; columns: RoundColumn[]; setCount: number }>;
    }

    const winnersSets = selectedPhasePoolGroup.sets.filter((set) => !isLosersBracketSet(set));
    const losersSets = selectedPhasePoolGroup.sets.filter((set) => isLosersBracketSet(set));

    const sections: Array<{ key: string; title: string; columns: RoundColumn[]; setCount: number }> = [];

    if (winnersSets.length > 0) {
      sections.push({
        key: "winners",
        title: "Winners",
        columns: buildRoundColumns(winnersSets),
        setCount: winnersSets.length,
      });
    }

    if (losersSets.length > 0) {
      sections.push({
        key: "losers",
        title: "Losers",
        columns: buildRoundColumns(losersSets),
        setCount: losersSets.length,
      });
    }

    if (sections.length === 0) {
      sections.push({
        key: "all",
        title: "Bracket",
        columns: selectedPhasePoolGroup.columns,
        setCount: selectedPhasePoolGroup.sets.length,
      });
    }

    return sections;
  }, [selectedPhasePoolGroup]);

  const selectedBracketSectionsForView = useMemo(() => {
    const pendingResetSetIds = new Set(
      pendingGrandFinalResetResults.map((result) => result.sourceGrandFinalSetId),
    );
    return selectedBracketSections.map((section) => {
      const preparedColumns = section.columns.map((column) => ({
        column,
        hidden: !shouldShowGrandFinalResetColumn(
          column,
          selectedPhasePoolGroup?.sets ?? [],
          selectedEvent,
          pendingResetSetIds,
        ),
      }));

      const hasResetColumn = preparedColumns.some((item) => item.column.sets.some((set) => isGrandFinalResetSet(set)));
      if (!hasResetColumn) {
        const grandFinalColumnIndex = preparedColumns.findIndex((item) =>
          item.column.sets.some((set) => isGrandFinalText(set.fullRoundText) && !isGrandFinalResetSet(set)),
        );

        if (grandFinalColumnIndex >= 0) {
          const grandFinalColumn = preparedColumns[grandFinalColumnIndex].column;
          preparedColumns.splice(grandFinalColumnIndex + 1, 0, {
            column: {
              key: `placeholder-gf-reset-${grandFinalColumn.key}`,
              title: "Grand Final Reset",
              round: grandFinalColumn.round,
              seq: grandFinalColumn.seq + 1,
              sets: [],
            },
            hidden: true,
          });
        }
      }

      const visualColumns = section.key === "losers" ? [...preparedColumns].reverse() : preparedColumns;
      const hiddenByKey = new Map(visualColumns.map((item) => [item.column.key, item.hidden] as const));
      const positionedColumns = buildPositionedRoundColumns(
        visualColumns.map((item) => item.column),
        section.key,
      ).map((column) => ({
        ...column,
        hidden: hiddenByKey.get(column.key) ?? false,
      }));

      return {
        ...section,
        columns: positionedColumns,
      };
    });
  }, [pendingGrandFinalResetResults, selectedEvent, selectedPhasePoolGroup, selectedBracketSections]) as BracketSectionForView[];

  const bracketScaleStyle = useMemo(() => ({
    ["--bracket-scale" as string]: String(bracketZoomLevel),
  } satisfies CSSProperties), [bracketZoomLevel]);

  const bracketVerticalLayoutScale = useMemo(() => {
    if (bracketZoomLevel >= 0.9) {
      return 1;
    }
    if (bracketZoomLevel >= 0.6) {
      return 0.72;
    }
    return 0.58;
  }, [bracketZoomLevel]);

  const renderedBracketSectionsForView = useMemo(() => {
    return selectedBracketSectionsForView.map((section) => ({
      ...section,
      columns: section.columns.map((column) => ({
        ...column,
        height: column.height * bracketVerticalLayoutScale,
        positionedSets: column.positionedSets.map((item) => ({
          ...item,
          y: item.y * bracketVerticalLayoutScale,
        })),
      })),
    }));
  }, [bracketVerticalLayoutScale, selectedBracketSectionsForView]);

  const setDisplayCodeById = useMemo(() => {
    const map = new Map<string, string>();
    const used = new Set<string>();
    const orderedSets: SetSnapshot[] = [];

    const orderedSections = [...selectedBracketSectionsForView].sort((left, right) => {
      const weight = (key: string): number => {
        if (key === "winners") {
          return 0;
        }
        if (key === "losers") {
          return 1;
        }
        return 2;
      };

      return weight(left.key) - weight(right.key);
    });

    for (const section of orderedSections) {
      for (const column of section.columns) {
        const setsInColumn = [...column.positionedSets].sort((left, right) => {
          const byY = left.y - right.y;
          if (Math.abs(byY) > 0.0001) {
            return byY;
          }
          return left.set.setId.localeCompare(right.set.setId, "ja");
        });

        for (const item of setsInColumn) {
          orderedSets.push(item.set);
        }
      }
    }

    for (const set of orderedSets) {
      const identifier = set.identifier?.trim();
      if (identifier) {
        map.set(set.setId, identifier);
      }
    }

    let fallbackIndex = 0;
    let gfSeen = false;
    let reservedAfterGf = false;
    for (const set of orderedSets) {
      if (map.has(set.setId)) {
        continue;
      }

      const currentIsLosers = isLosersBracketSet(set);
      const currentIsGf = isGrandFinalText(set.fullRoundText);
      const currentIsReset = isGrandFinalResetSet(set);

      if (currentIsLosers && gfSeen && reservedAfterGf && !currentIsReset) {
        // GF直後の潜在GF Reset枠を1つ予約する。
        fallbackIndex += 1;
        reservedAfterGf = false;
      }

      let code = formatAlphabetSequence(fallbackIndex);
      while (used.has(code)) {
        fallbackIndex += 1;
        code = formatAlphabetSequence(fallbackIndex);
      }

      map.set(set.setId, code);
      used.add(code);
      fallbackIndex += 1;

      if (currentIsGf) {
        gfSeen = true;
        reservedAfterGf = true;
      }

      if (currentIsReset) {
        reservedAfterGf = false;
      }
    }

    return map;
  }, [selectedBracketSectionsForView]);

  const tbdSourceLabelBySlotKey = useMemo(() => {
    const map = new Map<string, string>();
    const winnersSection = selectedBracketSections.find((section) => section.key === "winners") ?? null;
    const losersSection = selectedBracketSections.find((section) => section.key === "losers") ?? null;

    const winnersColumnsOrdered = winnersSection?.columns ?? [];
    const losersColumnsOrdered = losersSection?.columns ?? [];

    const winnersRoundOneIds = winnersColumnsOrdered[0]?.sets.map((set) => set.setId) ?? [];
    const losersRoundOne = losersColumnsOrdered[0];
    if (losersRoundOne && winnersRoundOneIds.length > 0) {
      losersRoundOne.sets.forEach((set, currentIndex) => {
        const sources = pickPairSourceIds(winnersRoundOneIds, losersRoundOne.sets.length, currentIndex)
          .map((setId) => setDisplayCodeById.get(setId))
          .filter((code): code is string => Boolean(code));

        sources.forEach((code, sourceIndex) => {
          map.set(`${set.setId}:${sourceIndex}`, normalizeSourceText("losers", code));
        });
      });
    }

    for (let columnIndex = 1; columnIndex < winnersColumnsOrdered.length; columnIndex += 1) {
      const previousColumn = winnersColumnsOrdered[columnIndex - 1];
      const currentColumn = winnersColumnsOrdered[columnIndex];
      const previousIds = previousColumn.sets.map((set) => set.setId);

      currentColumn.sets.forEach((set, currentIndex) => {
        const sources = pickPairSourceIds(previousIds, currentColumn.sets.length, currentIndex)
          .map((setId) => setDisplayCodeById.get(setId))
          .filter((code): code is string => Boolean(code));

        sources.forEach((code, sourceIndex) => {
          map.set(`${set.setId}:${sourceIndex}`, normalizeSourceText("winners", code));
        });
      });
    }

    const winnersColumnsByCount = new Map<number, Array<Array<string>>>();
    for (const column of winnersColumnsOrdered) {
      const ids = column.sets.map((set) => set.setId);
      if (ids.length === 0) {
        continue;
      }
      const found = winnersColumnsByCount.get(ids.length);
      if (found) {
        found.push(ids);
      } else {
        winnersColumnsByCount.set(ids.length, [ids]);
      }
    }

    const winnersCountUseCursor = new Map<number, number>();

    for (let columnIndex = 1; columnIndex < losersColumnsOrdered.length; columnIndex += 1) {
      const previousColumn = losersColumnsOrdered[columnIndex - 1];
      const currentColumn = losersColumnsOrdered[columnIndex];
      const previousIds = previousColumn.sets.map((set) => set.setId);
      const currentCount = currentColumn.sets.length;

      if (currentCount <= 0) {
        continue;
      }

      if (previousIds.length === currentCount) {
        const candidateWinnersColumns = winnersColumnsByCount.get(currentCount) ?? [];
        const winnerCursor = winnersCountUseCursor.get(currentCount) ?? 0;
        const winnersSourceIds = candidateWinnersColumns[winnerCursor] ?? [];

        if (candidateWinnersColumns.length > winnerCursor) {
          winnersCountUseCursor.set(currentCount, winnerCursor + 1);
        }

        currentColumn.sets.forEach((set, currentIndex) => {
          const losersCode = setDisplayCodeById.get(previousIds[currentIndex]);
          if (losersCode) {
            map.set(`${set.setId}:0`, normalizeSourceText("winners", losersCode));
          }

          const winnersSourceId = winnersSourceIds[currentIndex];
          const winnersCode = winnersSourceId ? setDisplayCodeById.get(winnersSourceId) : undefined;
          if (winnersCode) {
            map.set(`${set.setId}:1`, normalizeSourceText("losers", winnersCode));
          }
        });
        continue;
      }

      currentColumn.sets.forEach((set, currentIndex) => {
        const sources = pickPairSourceIds(previousIds, currentCount, currentIndex)
          .map((setId) => setDisplayCodeById.get(setId))
          .filter((code): code is string => Boolean(code));

        sources.forEach((code, sourceIndex) => {
          map.set(`${set.setId}:${sourceIndex}`, normalizeSourceText("winners", code));
        });
      });
    }

    const winnersAllSets = winnersColumnsOrdered
      .flatMap((column) => column.sets);
    const losersAllSets = losersColumnsOrdered
      .flatMap((column) => column.sets);

    const winnersFinalSet = winnersAllSets.find((set) => isWinnersFinalText(set.fullRoundText))
      ?? winnersAllSets
        .filter((set) => !isGrandFinalText(set.fullRoundText))
        .slice(-1)[0];
    const losersFinalSet = losersAllSets.find((set) => isLosersFinalText(set.fullRoundText))
      ?? losersAllSets.slice(-1)[0];

    const winnersFinalCode = winnersFinalSet ? setDisplayCodeById.get(winnersFinalSet.setId) : undefined;
    const losersFinalCode = losersFinalSet ? setDisplayCodeById.get(losersFinalSet.setId) : undefined;

    if (winnersFinalCode || losersFinalCode) {
      for (const set of winnersAllSets) {
        if (!isGrandFinalText(set.fullRoundText)) {
          continue;
        }
        if (winnersFinalCode) {
          map.set(`${set.setId}:0`, normalizeSourceText("winners", winnersFinalCode));
        }
        if (losersFinalCode) {
          map.set(`${set.setId}:1`, normalizeSourceText("winners", losersFinalCode));
        }
      }
    }

    return map;
  }, [selectedBracketSections, setDisplayCodeById]);

  function resolveTbdSourceLabel(set: SetSnapshot, slotIndex: number, slot: SetSlot): string | null {
    if (!isSlotTbd(slot)) {
      return null;
    }

    const source = slotIndex === 0 ? set.entrant1Source : set.entrant2Source;
    const resolveSource = (
      currentSource: SetEntrantSource | null | undefined,
      visited: Set<string>,
    ): string | null => {
      if (!currentSource) {
        return null;
      }
      const sourceSetId = currentSource.resolvedSetId ?? currentSource.typeId;
      const sourceSet = sourceSetId
        ? selectedEvent?.sets.find((candidate) => candidate.setId === sourceSetId)
        : undefined;
      if (!sourceSetId || !sourceSet || visited.has(sourceSetId)) {
        return currentSource.placeholderName?.trim() || null;
      }

      const nextVisited = new Set(visited);
      nextVisited.add(sourceSetId);

      const sourceCondition = currentSource.condition?.trim().toLowerCase();
      if (sourceSet.winnerId && (sourceCondition === "winner" || sourceCondition === "loser")) {
        const resolvedSlot = sourceSet.slots.find((candidate) => {
          if (candidate.entrantId === null || !isResolvedEntrantName(candidate.entrantName)) {
            return false;
          }

          const isWinner = candidate.entrantId === sourceSet.winnerId;
          return sourceCondition === "winner" ? isWinner : !isWinner;
        });
        if (resolvedSlot) {
          return resolvedSlot.entrantName.trim();
        }
      }

      if (
        sourceSet.isIntermediate
        && !sourceSet.winnerId
        && sourceCondition !== "winner"
        && sourceCondition !== "loser"
      ) {
        const resolvedSlots = sourceSet.slots.filter(
          (candidate) => candidate.entrantId !== null && isResolvedEntrantName(candidate.entrantName),
        );
        if (resolvedSlots.length === 1) {
          return resolvedSlots[0].entrantName.trim();
        }
      }

      if (sourceSet.isIntermediate) {
        const nested = [sourceSet.entrant1Source, sourceSet.entrant2Source]
          .map((nestedSource) => resolveSource(nestedSource, nextVisited))
          .find((label): label is string => Boolean(label));
        if (nested) {
          return nested;
        }
      }

      const sourceSetCode = setDisplayCodeById.get(sourceSetId);
      if (currentSource.placeholderName?.trim()) {
        return currentSource.placeholderName.trim();
      }
      if (sourceSetCode && (sourceCondition === "winner" || sourceCondition === "loser")) {
        return normalizeSourceText(sourceCondition === "winner" ? "winners" : "losers", sourceSetCode);
      }
      return null;
    };

    const resolvedSourceLabel = resolveSource(source, new Set<string>());
    if (resolvedSourceLabel) {
      return resolvedSourceLabel;
    }

    const own = tbdSourceLabelBySlotKey.get(`${set.setId}:${slotIndex}`);
    if (own) {
      return own;
    }

    const conditionString = source?.conditionString?.trim();
    if (conditionString) {
      return conditionString;
    }

    if (set.slots.length === 2) {
      const other = tbdSourceLabelBySlotKey.get(`${set.setId}:${slotIndex === 0 ? 1 : 0}`);
      if (other) {
        return other;
      }
    }

    return null;
  }

  const pendingResultBySetId = useMemo(() => {
    const map = new Map<string, LocalSetResultMeta>();
    for (const pending of pendingSetResults) {
      map.set(pending.setId, pending);
    }
    for (const pending of pendingGrandFinalResetResults) {
      const setId = `virtual_gf_reset_${pending.sourceGrandFinalSetId}`;
      map.set(setId, {
        eventId: pending.eventId,
        eventName: pending.eventName,
        setId,
        winnerId: pending.winnerId,
        scoreCsv: pending.scoreCsv,
        directWin: pending.directWin,
        confirmed: pending.confirmed,
        slotScores: pending.slotScores,
        recordedAt: pending.recordedAt,
      });
    }
    return map;
  }, [pendingGrandFinalResetResults, pendingSetResults]);

  const roundRobinBoardData = useMemo<RoundRobinBoardData>(() => {
    if (getBracketProgressionModel(selectedPhasePoolGroup?.bracketType ?? null) !== "round_robin") {
      return {
        entrants: [],
        entrantNames: new Map(),
        entrantIdsByColumnKey: new Map(),
        entrantSeedIds: new Map(),
        entrantSeedNumbers: new Map(),
        sourceDiagnostics: [],
        setsByPair: new Map(),
        candidateSetCount: 0,
        twoSlotSetCount: 0,
        resolvedSetCount: 0,
        registeredSetCount: 0,
        unresolvedSetIds: [],
        unresolvedSetReasons: [],
        standings: [],
        qualifyingCount: 0,
        tieBreakRules: DEFAULT_ROUND_ROBIN_TIE_BREAK_RULES,
      };
    }

    const entrantNames = new Map<string, string>();
    const entrantSeedIds = new Map<string, string>();
    const sourceDiagnostics: string[] = [];
    const candidateSetCount = selectedPhasePoolGroup?.sets.length ?? 0;
    let twoSlotSetCount = 0;
    let resolvedSetCount = 0;
    const registeredSetIds = new Set<string>();
    const unresolvedSetIds: string[] = [];
    const unresolvedSetReasons: string[] = [];
    const isLaterPhase = (selectedPhasePoolGroup?.phaseOrder ?? 1) > 1;
    const entrantSeedNumbers = new Map<string, number>();
    const entrantOriginPlacements = new Map<string, number>();
    const entrantOriginOrders = new Map<string, number>();
    const entrantOriginDisplayIdentifiers = new Map<string, string>();
    const originDisplayIdentifiers = new Set<string>();
    const setsByPair = new Map<string, SetSnapshot>();
    const standingByEntrantId = new Map<string, RoundRobinStanding>();
    const headToHeadWins = new Map<string, Map<string, number>>();
    const setById = new Map((selectedEvent?.sets ?? []).map((set) => [set.setId, set]));
    const phaseGroupSeedById = new Map(
      (selectedPhasePoolGroup?.seeds ?? [])
        .filter((seed) => Boolean(seed.seedId))
        .map((seed) => [seed.seedId, seed]),
    );
    const phaseGroupSeedByNum = new Map(
      (selectedPhasePoolGroup?.seeds ?? [])
        .filter((seed) => seed.seedNum !== null && seed.seedNum !== undefined)
        .map((seed) => [seed.seedNum as number, seed]),
    );
    const phaseGroupSeedByOriginPlacement = new Map(
      (selectedPhasePoolGroup?.seeds ?? [])
        .filter((seed) => seed.originPlacement !== null && seed.originPlacement !== undefined)
        .map((seed) => [seed.originPlacement as number, seed]),
    );
    const phaseGroupSeedIdByEntrantId = new Map(
      (selectedPhasePoolGroup?.seeds ?? [])
        .filter((seed) => Boolean(seed.seedId && seed.entrantId))
        .map((seed) => [seed.entrantId as string, seed.seedId]),
    );
    const phaseGroupSeeds = [...(selectedPhasePoolGroup?.seeds ?? [])]
      .filter((seed) => Boolean(seed.seedId))
      .sort((left, right) => {
        if (left.seedNum !== null && left.seedNum !== undefined
          && right.seedNum !== null && right.seedNum !== undefined
          && left.seedNum !== right.seedNum) {
          return left.seedNum - right.seedNum;
        }
        if (left.seedNum !== null && left.seedNum !== undefined) {
          return -1;
        }
        if (right.seedNum !== null && right.seedNum !== undefined) {
          return 1;
        }
        return left.seedId.localeCompare(right.seedId);
      });
    const seedSlotById = new Map<string, SetSlot>();
    for (const set of selectedPhasePoolGroup?.sets ?? []) {
      for (const slot of set.slots) {
        if (!slot.seedId) {
          continue;
        }
        const current = seedSlotById.get(slot.seedId);
        const slotHasOrigin = slot.seedOriginPlacement !== null
          && slot.seedOriginPlacement !== undefined
          && Boolean(slot.seedOriginPhaseGroupDisplayIdentifier?.trim());
        const currentHasOrigin = current?.seedOriginPlacement !== null
          && current?.seedOriginPlacement !== undefined
          && Boolean(current?.seedOriginPhaseGroupDisplayIdentifier?.trim());
        if (!current || (slotHasOrigin && !currentHasOrigin)) {
          seedSlotById.set(slot.seedId, slot);
        }
      }
    }

    const fixedEntrants: string[] = [];
    const entrantIdsByColumnKey = new Map<string, string | null>();
    for (const seed of phaseGroupSeeds) {
      const seedId = seed.seedId;
      const columnKey = `seed:${seedId}`;
      fixedEntrants.push(columnKey);
      entrantIdsByColumnKey.set(columnKey, seed?.entrantId ?? null);
      if (seed.entrantId) {
        entrantSeedIds.set(seed.entrantId, seed.seedId);
        if (seed.seedNum !== null && seed.seedNum !== undefined) {
          entrantSeedNumbers.set(seed.entrantId, seed.seedNum);
        }
      }
      if (seed?.entrantId && seed.entrantName?.trim()) {
        entrantNames.set(columnKey, seed.entrantName.trim());
      } else {
        entrantNames.set(
          columnKey,
          seed?.placeholderName?.trim()
            || seedSlotById.get(seedId)?.seedPlaceholderName?.trim()
            || seed?.entrantName?.trim()
            || "TBD",
        );
      }
    }

    for (const seed of phaseGroupSeeds) {
      if (!seed.entrantId || standingByEntrantId.has(seed.entrantId)) {
        continue;
      }
      standingByEntrantId.set(seed.entrantId, {
        entrantId: seed.entrantId,
        entrantName: seed.entrantName?.trim() || seed.entrantId,
        isPlaceholder: false,
        wins: 0,
        losses: 0,
        gameWins: 0,
        gameLosses: 0,
        h2hPoints: 0,
        qualified: false,
      });
    }

    type ResolvedRoundRobinSlot = {
      entrantId: string;
      entrantName: string;
      isPlaceholder: boolean;
      seedId?: string | null;
      seedNum?: number | null;
      originPlacement?: number | null;
      originDisplayIdentifier?: string | null;
      originOrder?: number | null;
    };

    const findOriginOrder = (
      originPhaseOrder: number | null | undefined,
      originDisplayIdentifier: string | null | undefined,
      originPlacement: number | null | undefined,
    ): number | null => {
      if (originPlacement === null || originPlacement === undefined) {
        return null;
      }
      const sourceGroup = (selectedEvent?.phaseGroups ?? []).find((group) =>
        group.phaseOrder === originPhaseOrder
        && (group.displayIdentifier?.trim() || null) === (originDisplayIdentifier?.trim() || null),
      );
      return sourceGroup?.progressionsOut
        ?.filter((progression) => progression.originPlacement === originPlacement)
        .map((progression) => progression.originOrder)
        .filter((order): order is number => order !== null)
        .sort((left, right) => left - right)[0] ?? null;
    };

    const progressionSeedById = new Map<string, ResolvedRoundRobinSlot>();
    for (const set of selectedEvent?.sets ?? []) {
      const progressionSeeds = [
        {
          seedId: set.winnerProgressionSeedId,
          placeholderName: set.winnerProgressionSeedPlaceholderName,
          originDisplayIdentifier: set.winnerProgressionOriginPhaseGroupDisplayIdentifier,
          originPhaseOrder: set.winnerProgressionOriginPhaseOrder,
          originPlacement: set.winnerProgressionOriginPlacement,
        },
        {
          seedId: set.loserProgressionSeedId,
          placeholderName: set.loserProgressionSeedPlaceholderName,
          originDisplayIdentifier: set.loserProgressionOriginPhaseGroupDisplayIdentifier,
          originPhaseOrder: set.loserProgressionOriginPhaseOrder,
          originPlacement: set.loserProgressionOriginPlacement,
        },
      ];
      for (const progressionSeed of progressionSeeds) {
        if (!progressionSeed.seedId || progressionSeedById.has(progressionSeed.seedId)) {
          continue;
        }
        progressionSeedById.set(progressionSeed.seedId, {
          entrantId: `placeholder:${progressionSeed.seedId}`,
          entrantName: progressionSeed.placeholderName?.trim() || progressionSeed.seedId,
          isPlaceholder: true,
          seedId: progressionSeed.seedId,
          originPlacement: progressionSeed.originPlacement,
          originDisplayIdentifier: progressionSeed.originDisplayIdentifier,
        });
      }
    }

    const resolveSourceSlot = (
      source: SetEntrantSource | null | undefined,
      visited: Set<string>,
    ): ResolvedRoundRobinSlot | null => {
      if (!source) {
        return null;
      }

      if (source.sourceType?.trim().toLowerCase() === "seed" && source.typeId) {
        const phaseGroupSeed = phaseGroupSeedById.get(source.typeId)
          ?? (source.seedNum !== null && source.seedNum !== undefined
            ? phaseGroupSeedByNum.get(source.seedNum)
            : undefined)
          ?? (source.groupSeedNum !== null && source.groupSeedNum !== undefined
            ? phaseGroupSeedByNum.get(source.groupSeedNum)
            : undefined)
          ?? (source.placement !== null && source.placement !== undefined
            ? phaseGroupSeedByOriginPlacement.get(source.placement)
            : undefined);
        if (phaseGroupSeed?.entrantId) {
          return {
            entrantId: phaseGroupSeed.entrantId,
            entrantName: phaseGroupSeed.entrantName?.trim() || phaseGroupSeed.entrantId,
            isPlaceholder: false,
            seedId: phaseGroupSeed.seedId,
            seedNum: source.seedNum ?? phaseGroupSeed.seedNum,
            originPlacement: source.placement ?? phaseGroupSeed.originPlacement,
            originDisplayIdentifier: source.originPhaseGroupDisplayIdentifier
              ?? phaseGroupSeed.originPhaseGroupDisplayIdentifier,
            originOrder: findOriginOrder(
              source.originPhaseOrder ?? phaseGroupSeed.originPhaseOrder,
              source.originPhaseGroupDisplayIdentifier
                ?? phaseGroupSeed.originPhaseGroupDisplayIdentifier,
              source.placement ?? phaseGroupSeed.originPlacement,
            ),
          };
        }
        const seedSlot = seedSlotById.get(source.typeId);
        if (seedSlot) {
          const placeholderName = source.placeholderName?.trim()
            || seedSlot.seedPlaceholderName?.trim()
            || source.conditionString?.trim();
          if (seedSlot.entrantId) {
            return {
              entrantId: seedSlot.entrantId,
              entrantName: seedSlot.entrantName,
              isPlaceholder: false,
              seedId: seedSlot.seedId,
              seedNum: source.seedNum ?? seedSlot.seedNum,
              originPlacement: source.placement ?? seedSlot.seedOriginPlacement,
              originDisplayIdentifier: source.originPhaseGroupDisplayIdentifier
                ?? seedSlot.seedOriginPhaseGroupDisplayIdentifier,
              originOrder: findOriginOrder(
                source.originPhaseOrder ?? seedSlot.seedOriginPhaseOrder,
                source.originPhaseGroupDisplayIdentifier ?? seedSlot.seedOriginPhaseGroupDisplayIdentifier,
                source.placement ?? seedSlot.seedOriginPlacement,
              ),
            };
          }
          if (placeholderName) {
            return {
              entrantId: roundRobinPlaceholderId(seedSlot, source),
              entrantName: placeholderName,
              isPlaceholder: true,
              seedId: seedSlot.seedId,
              seedNum: source.seedNum ?? seedSlot.seedNum,
              originPlacement: source.placement ?? seedSlot.seedOriginPlacement,
              originDisplayIdentifier: source.originPhaseGroupDisplayIdentifier
                ?? seedSlot.seedOriginPhaseGroupDisplayIdentifier,
              originOrder: findOriginOrder(
                source.originPhaseOrder ?? seedSlot.seedOriginPhaseOrder,
                source.originPhaseGroupDisplayIdentifier ?? seedSlot.seedOriginPhaseGroupDisplayIdentifier,
                source.placement ?? seedSlot.seedOriginPlacement,
              ),
            };
          }
        }
        const progressionSeed = progressionSeedById.get(source.typeId);
        if (progressionSeed?.entrantName && progressionSeed.entrantName !== progressionSeed.seedId) {
          return {
            ...progressionSeed,
            entrantName: source.placeholderName?.trim() || progressionSeed.entrantName,
            seedNum: source.seedNum ?? progressionSeed.seedNum,
            originPlacement: source.originPlacement ?? progressionSeed.originPlacement,
            originDisplayIdentifier: source.originPhaseGroupDisplayIdentifier
              ?? progressionSeed.originDisplayIdentifier,
            originOrder: findOriginOrder(
              source.originPhaseOrder,
              source.originPhaseGroupDisplayIdentifier ?? progressionSeed.originDisplayIdentifier,
              source.originPlacement ?? progressionSeed.originPlacement,
            ),
          };
        }
      }

      const sourceSetId = source.resolvedSetId ?? source.typeId;
      const sourceSet = sourceSetId ? setById.get(sourceSetId) : undefined;
      if (!sourceSet || visited.has(sourceSet.setId)) {
        const placeholderName = source.placeholderName?.trim() || source.conditionString?.trim();
        return placeholderName
          ? {
            entrantId: roundRobinPlaceholderId({
              entrantId: null,
              entrantName: placeholderName,
              seedId: null,
              seedNum: null,
              seedPlaceholderName: null,
              score: null,
            }, source),
            entrantName: placeholderName,
            isPlaceholder: true,
          }
          : null;
      }

      const nextVisited = new Set(visited);
      nextVisited.add(sourceSet.setId);
      const condition = source.condition?.trim().toLowerCase();
      if ((condition === "winner" || condition === "loser") && sourceSet.winnerId) {
        const candidate = sourceSet.slots.find((slot) => {
          if (!slot.entrantId) {
            return false;
          }
          return condition === "winner"
            ? slot.entrantId === sourceSet.winnerId
            : slot.entrantId !== sourceSet.winnerId;
        });
        if (candidate?.entrantId) {
          return {
            entrantId: candidate.entrantId,
            entrantName: candidate.entrantName,
            isPlaceholder: false,
            seedId: candidate.seedId,
            seedNum: candidate.seedNum,
            originPlacement: candidate.seedOriginPlacement,
            originDisplayIdentifier: candidate.seedOriginPhaseGroupDisplayIdentifier,
            originOrder: findOriginOrder(
              source.originPhaseOrder,
              source.originPhaseGroupDisplayIdentifier ?? candidate.seedOriginPhaseGroupDisplayIdentifier,
              source.originPlacement ?? candidate.seedOriginPlacement,
            ),
          };
        }
      }

      const nestedSources = [sourceSet.entrant1Source, sourceSet.entrant2Source];
      return nestedSources
        .map((nestedSource) => resolveSourceSlot(nestedSource, nextVisited))
        .find((resolved): resolved is ResolvedRoundRobinSlot => resolved !== null)
        ?? (source.placeholderName?.trim()
          ? {
            entrantId: roundRobinPlaceholderId({
              entrantId: null,
              entrantName: source.placeholderName.trim(),
              seedId: null,
              seedNum: null,
              seedPlaceholderName: source.placeholderName.trim(),
              score: null,
            }, source),
            entrantName: source.placeholderName.trim(),
            isPlaceholder: true,
          }
          : null);
    };

    for (const set of selectedPhasePoolGroup?.sets ?? []) {
      if (set.slots.length === 2) {
        twoSlotSetCount += 1;
      }
      const entrants = set.slots.map((slot, slotIndex) => {
        const source = slotIndex === 0 ? set.entrant1Source : set.entrant2Source;
        if (isLaterPhase) {
          const sourceSeedSlot = source?.sourceType?.trim().toLowerCase() === "seed" && source.typeId
            ? seedSlotById.get(source.typeId)
            : undefined;
          const sourceProgressionSeed = source?.sourceType?.trim().toLowerCase() === "seed" && source.typeId
            ? progressionSeedById.get(source.typeId)
            : undefined;
          sourceDiagnostics.push([
            `${set.setId}[${slotIndex + 1}]`,
            `rawName=${slot.entrantName || ""}`,
            `entrantId=${slot.entrantId || ""}`,
            `seedId=${slot.seedId || ""}`,
            `placeholder=${slot.seedPlaceholderName || ""}`,
            `sourceType=${source?.sourceType || ""}`,
            `sourceTypeId=${source?.typeId || ""}`,
            `sourceGroupSeedNum=${source?.groupSeedNum ?? ""}`,
            `sourceSeedNum=${source?.seedNum ?? ""}`,
            `sourcePlacement=${source?.placement ?? ""}`,
            `seedLookupPlaceholder=${sourceSeedSlot?.seedPlaceholderName || ""}`,
            `progressionSeedPlaceholder=${sourceProgressionSeed?.entrantName || ""}`,
            `sourcePlaceholder=${source?.placeholderName || ""}`,
            `condition=${source?.conditionString || ""}`,
          ].join(" | "));
        }
        const slotSeed = (slot.seedId ? phaseGroupSeedById.get(slot.seedId) : undefined)
          ?? (slot.seedNum !== null && slot.seedNum !== undefined
            ? phaseGroupSeedByNum.get(slot.seedNum)
            : undefined)
          ?? (source?.seedNum !== null && source?.seedNum !== undefined
            ? phaseGroupSeedByNum.get(source.seedNum)
            : undefined)
          ?? (source?.groupSeedNum !== null && source?.groupSeedNum !== undefined
            ? phaseGroupSeedByNum.get(source.groupSeedNum)
            : undefined)
          ?? (source?.placement !== null && source?.placement !== undefined
            ? phaseGroupSeedByOriginPlacement.get(source.placement)
            : undefined);
        const slotSeedSlot = slot.seedId ? seedSlotById.get(slot.seedId) : undefined;
        const resolved = slot.entrantId
          ? {
            entrantId: slot.entrantId,
            entrantName: slot.entrantName,
            isPlaceholder: false,
            seedId: slot.seedId,
            seedNum: slot.seedNum,
            originPlacement: slot.seedOriginPlacement,
            originDisplayIdentifier: slot.seedOriginPhaseGroupDisplayIdentifier,
            originOrder: findOriginOrder(
              source?.originPhaseOrder ?? null,
              source?.originPhaseGroupDisplayIdentifier ?? slot.seedOriginPhaseGroupDisplayIdentifier,
              source?.originPlacement ?? slot.seedOriginPlacement,
            ),
          }
          : (slotSeed?.entrantId
            ? {
              entrantId: slotSeed.entrantId,
              entrantName: slotSeed.entrantName?.trim() || slotSeed.entrantId,
              isPlaceholder: false,
              seedId: slotSeed.seedId,
              seedNum: slot.seedNum ?? slotSeed.seedNum,
              originPlacement: slot.seedOriginPlacement ?? slotSeed.originPlacement,
              originDisplayIdentifier: slot.seedOriginPhaseGroupDisplayIdentifier
                ?? slotSeed.originPhaseGroupDisplayIdentifier,
              originOrder: slotSeed.originOrder,
            }
            : slotSeedSlot?.entrantId
              ? {
                entrantId: slotSeedSlot.entrantId,
                entrantName: slotSeedSlot.entrantName,
                isPlaceholder: false,
                seedId: slotSeedSlot.seedId,
                seedNum: slot.seedNum ?? slotSeedSlot.seedNum,
                originPlacement: slot.seedOriginPlacement ?? slotSeedSlot.seedOriginPlacement,
                originDisplayIdentifier: slot.seedOriginPhaseGroupDisplayIdentifier
                  ?? slotSeedSlot.seedOriginPhaseGroupDisplayIdentifier,
                originOrder: null,
              }
              : resolveSourceSlot(source, new Set([set.setId])))
            ?? (slot.seedPlaceholderName?.trim()
              ? {
                entrantId: roundRobinPlaceholderId(slot, source),
                entrantName: slot.seedPlaceholderName.trim(),
                isPlaceholder: true,
                seedId: slot.seedId,
                seedNum: slot.seedNum,
                originPlacement: slot.seedOriginPlacement,
                originDisplayIdentifier: slot.seedOriginPhaseGroupDisplayIdentifier,
              }
              : null);
        const entrantId = resolved?.entrantId ?? roundRobinPlaceholderId(slot, source);
        const sourcePlaceholderName = source?.placeholderName?.trim()
          || source?.conditionString?.trim();
        const entrantName = resolved && !resolved.isPlaceholder
          ? resolved.entrantName
          : sourcePlaceholderName
            ?? resolved?.entrantName
          ?? slot.seedPlaceholderName?.trim()
          ?? sourcePlaceholderName
          ?? slot.entrantName
          ?? "TBD";
        const effectiveSeedId = phaseGroupSeedIdByEntrantId.get(entrantId)
          ?? resolved?.seedId
          ?? slot.seedId;
        return {
          slot,
          entrantId,
          entrantName,
          isPlaceholder: resolved?.isPlaceholder ?? slot.entrantId === null,
          seedId: effectiveSeedId,
          seedNum: source?.seedNum ?? resolved?.seedNum,
          originPlacement: source?.placement ?? resolved?.originPlacement,
          originDisplayIdentifier: source?.originPhaseGroupDisplayIdentifier
            ?? resolved?.originDisplayIdentifier,
          originOrder: resolved?.originOrder ?? findOriginOrder(
            source?.originPhaseOrder ?? null,
            source?.originPhaseGroupDisplayIdentifier ?? slot.seedOriginPhaseGroupDisplayIdentifier,
            source?.originPlacement ?? slot.seedOriginPlacement,
          ),
        };
      });
      entrants.forEach(({ slot, entrantId, entrantName, isPlaceholder, seedId, seedNum, originPlacement, originDisplayIdentifier, originOrder }) => {
        entrantNames.set(entrantId, entrantName);
        const effectiveSeedId = phaseGroupSeedIdByEntrantId.get(entrantId)
          ?? seedId
          ?? slot.seedId;
        if (effectiveSeedId) {
          entrantSeedIds.set(entrantId, effectiveSeedId);
        }
        const effectiveSeedNum = seedNum ?? slot.seedNum;
        const effectiveOriginPlacement = originPlacement ?? slot.seedOriginPlacement;
        const effectiveOriginDisplayIdentifier = originDisplayIdentifier?.trim()
          || slot.seedOriginPhaseGroupDisplayIdentifier?.trim();
        if (effectiveSeedNum !== null && effectiveSeedNum !== undefined) {
          const currentSeedNumber = entrantSeedNumbers.get(entrantId);
          if (currentSeedNumber === undefined || effectiveSeedNum < currentSeedNumber) {
            entrantSeedNumbers.set(entrantId, effectiveSeedNum);
          }
        }
        if (effectiveOriginPlacement !== null && effectiveOriginPlacement !== undefined) {
          const currentPlacement = entrantOriginPlacements.get(entrantId);
          if (currentPlacement === undefined || effectiveOriginPlacement < currentPlacement) {
            entrantOriginPlacements.set(entrantId, effectiveOriginPlacement);
          }
        }
        if (originOrder !== null && originOrder !== undefined) {
          const currentOrder = entrantOriginOrders.get(entrantId);
          if (currentOrder === undefined || originOrder < currentOrder) {
            entrantOriginOrders.set(entrantId, originOrder);
          }
        }
        if (effectiveOriginDisplayIdentifier) {
          originDisplayIdentifiers.add(effectiveOriginDisplayIdentifier);
          const currentPlacement = entrantOriginPlacements.get(entrantId);
          const currentDisplayIdentifier = entrantOriginDisplayIdentifiers.get(entrantId);
          if (currentDisplayIdentifier === undefined
            || (effectiveOriginPlacement !== null
              && effectiveOriginPlacement !== undefined
              && currentPlacement === effectiveOriginPlacement)) {
            entrantOriginDisplayIdentifiers.set(entrantId, effectiveOriginDisplayIdentifier);
          }
        }
        if (!standingByEntrantId.has(entrantId)) {
          standingByEntrantId.set(entrantId, {
            entrantId,
            entrantName,
            isPlaceholder,
            wins: 0,
            losses: 0,
            gameWins: 0,
            gameLosses: 0,
            h2hPoints: 0,
            qualified: false,
          });
        }
      });

      const hasUnassignedSlot = set.slots.some((slot) => slot.entrantId === null);
      if (entrants.length !== 2 || entrants[0].entrantId === entrants[1].entrantId) {
        unresolvedSetIds.push(set.setId);
        unresolvedSetReasons.push([
          set.setId,
          `slots=${set.slots.length}`,
          `unassigned=${hasUnassignedSlot}`,
          `entrantIds=${entrants.map((entrant) => entrant.entrantId).join(",")}`,
          `seedIds=${entrants.map((entrant) => entrant.seedId ?? "").join(",")}`,
        ].join(" | "));
        continue;
      }

      resolvedSetCount += 1;
      registeredSetIds.add(set.setId);

      setsByPair.set(
        roundRobinPairKey(entrants[0].entrantId, entrants[1].entrantId),
        set,
      );
      if (entrants[0].seedId && entrants[1].seedId) {
        setsByPair.set(
          roundRobinPairKey(entrants[0].seedId, entrants[1].seedId),
          set,
        );
      }
      const setDisplay = getSetScoresForDisplay(set);
      const winnerId = setDisplay.winnerId ?? set.winnerId;
      if (!winnerId || !standingByEntrantId.has(winnerId)) {
        continue;
      }

      const loser = entrants.find((entrant) => entrant.entrantId !== winnerId);
      const winner = entrants.find((entrant) => entrant.entrantId === winnerId);
      if (!loser || !winner) {
        continue;
      }

      const winnerStanding = standingByEntrantId.get(winner.entrantId);
      const loserStanding = standingByEntrantId.get(loser.entrantId);
      if (!winnerStanding || !loserStanding) {
        continue;
      }

      winnerStanding.wins += 1;
      loserStanding.losses += 1;
      const winnerHeadToHead = headToHeadWins.get(winner.entrantId) ?? new Map<string, number>();
      winnerHeadToHead.set(loser.entrantId, (winnerHeadToHead.get(loser.entrantId) ?? 0) + 1);
      headToHeadWins.set(winner.entrantId, winnerHeadToHead);
      const winnerSlot = winner.slot;
      const loserSlot = loser.slot;
      const winnerScore = parseRoundRobinGameScore(
        setDisplay.scores[winner.entrantId] ?? winnerSlot?.score ?? undefined,
      );
      const loserScore = parseRoundRobinGameScore(
        setDisplay.scores[loser.entrantId] ?? loserSlot?.score ?? undefined,
      );
      if (winnerScore !== null && loserScore !== null) {
        winnerStanding.gameWins += winnerScore;
        winnerStanding.gameLosses += loserScore;
        loserStanding.gameWins += loserScore;
        loserStanding.gameLosses += winnerScore;
      }
    }

    const configuredTieBreakOrder: string[] = selectedPhasePoolGroup?.tiebreakOrder ?? [];
    const tieBreakRules = configuredTieBreakOrder.length === 0
      ? [...DEFAULT_ROUND_ROBIN_TIE_BREAK_RULES]
      : [...new Set<RoundRobinTieBreakRule>(configuredTieBreakOrder
        .map((rule) => roundRobinTieBreakRuleFromApi(rule))
        .filter((rule): rule is RoundRobinTieBreakRule => rule !== null))];
    const headToHeadRuleIndex = tieBreakRules.indexOf("head_to_head");
    if (headToHeadRuleIndex >= 0) {
      const standingsBeforeHeadToHead = [...standingByEntrantId.values()];
      const precedingRules = tieBreakRules.slice(0, headToHeadRuleIndex);
      for (const standing of standingsBeforeHeadToHead) {
        const tiedEntrantIds = new Set(
          standingsBeforeHeadToHead
            .filter((candidate) => precedingRules.every((rule) =>
              compareRoundRobinTieBreakRule(candidate, standing, rule) === 0))
            .map((candidate) => candidate.entrantId),
        );
        standing.h2hPoints = [...(headToHeadWins.get(standing.entrantId)?.entries() ?? [])]
          .filter(([opponentId]) => tiedEntrantIds.has(opponentId))
          .reduce((points, [, wins]) => points + wins, 0);
      }
    }

    const currentPhaseOrder = selectedPhasePoolGroup?.phaseOrder ?? null;
    const nextPhaseOrder = currentPhaseOrder === null
      ? null
      : (selectedEvent?.phaseGroups ?? [])
        .map((group) => group.phaseOrder)
        .filter((order): order is number => order !== null && order > currentPhaseOrder)
        .sort((left, right) => left - right)[0] ?? null;
    const qualifyingCount = calculateRoundRobinQualifyingCount({
      progressionsOut: selectedPhasePoolGroup?.progressionsOut ?? [],
      currentPhaseOrder,
      currentPhaseGroupDisplayIdentifier: selectedPhasePoolGroup?.phaseGroupDisplayIdentifier ?? null,
      nextPhaseOrder,
      downstreamSets: selectedEvent?.sets ?? [],
    });
    const seedOrderById = new Map<string, number>(
      (selectedPhasePoolGroup?.seedOrder ?? []).map((seedId: string, index: number) => [seedId, index]),
    );
    const entrantSeedOrder = (entrantId: string): number | undefined => {
      const seedId = entrantSeedIds.get(entrantId);
      return seedId === undefined ? undefined : seedOrderById.get(seedId);
    };
    const orderedOriginDisplayIdentifiers = [...originDisplayIdentifiers].sort((left, right) =>
      left.localeCompare(right, "ja"),
    );
    const originDisplayIdentifierOrder = new Map(
      orderedOriginDisplayIdentifiers.map((displayIdentifier, index) => [displayIdentifier, index]),
    );
    const originGroupCount = orderedOriginDisplayIdentifiers.length;
    const entrantAxisOrder = (entrantId: string): number => {
      const placement = entrantOriginPlacements.get(entrantId);
      const groupIdentifier = entrantOriginDisplayIdentifiers.get(entrantId);
      const groupOrder = groupIdentifier === undefined
        ? originGroupCount
        : originDisplayIdentifierOrder.get(groupIdentifier) ?? originGroupCount;
      if (placement === undefined) {
        return Number.MAX_SAFE_INTEGER;
      }
      if (originGroupCount === 0 || groupOrder === originGroupCount) {
        return placement * (originGroupCount + 1);
      }

      const groupOrderInPlacement = placement % 2 === 0
        ? originGroupCount - 1 - groupOrder
        : groupOrder;
      return (placement - 1) * originGroupCount + groupOrderInPlacement;
    };
    const sortedEntrants = [...standingByEntrantId.keys()].sort((leftEntrantId, rightEntrantId) => {
      const leftSeedOrder = entrantSeedOrder(leftEntrantId);
      const rightSeedOrder = entrantSeedOrder(rightEntrantId);
      if (leftSeedOrder !== undefined || rightSeedOrder !== undefined) {
        if (leftSeedOrder === undefined || rightSeedOrder === undefined) {
          return leftSeedOrder === undefined ? 1 : -1;
        }
        if (leftSeedOrder !== rightSeedOrder) {
          return leftSeedOrder - rightSeedOrder;
        }
      }

      if (isLaterPhase) {
        const leftPlacement = entrantOriginPlacements.get(leftEntrantId);
        const rightPlacement = entrantOriginPlacements.get(rightEntrantId);
        if (leftPlacement !== undefined || rightPlacement !== undefined) {
          if (leftPlacement === undefined || rightPlacement === undefined) {
            return leftPlacement === undefined ? 1 : -1;
          }
        }

        if (leftPlacement !== undefined
          && rightPlacement !== undefined
          && leftPlacement === rightPlacement) {
          const leftOriginOrder = entrantOriginOrders.get(leftEntrantId);
          const rightOriginOrder = entrantOriginOrders.get(rightEntrantId);
          if (leftOriginOrder !== undefined || rightOriginOrder !== undefined) {
            if (leftOriginOrder === undefined || rightOriginOrder === undefined) {
              return leftOriginOrder === undefined ? 1 : -1;
            }
            if (leftOriginOrder !== rightOriginOrder) {
              return leftOriginOrder - rightOriginOrder;
            }
          }
        }

        const byDisplayIdentifier = entrantAxisOrder(leftEntrantId) - entrantAxisOrder(rightEntrantId);
        if (byDisplayIdentifier !== 0) {
          return byDisplayIdentifier;
        }
      }

      const leftSeedNumber = entrantSeedNumbers.get(leftEntrantId);
      const rightSeedNumber = entrantSeedNumbers.get(rightEntrantId);
      if (leftSeedNumber !== undefined && rightSeedNumber !== undefined && leftSeedNumber !== rightSeedNumber) {
        return leftSeedNumber - rightSeedNumber;
      }
      if (leftSeedNumber !== undefined || rightSeedNumber !== undefined) {
        return leftSeedNumber === undefined ? 1 : -1;
      }
      const byName = (entrantNames.get(leftEntrantId) ?? "").localeCompare(entrantNames.get(rightEntrantId) ?? "", "ja");
      return byName || leftEntrantId.localeCompare(rightEntrantId, "ja");
    });
    if (phaseGroupSeeds.length === 0) {
      const fixedEntrantIds = new Set(
        [...entrantIdsByColumnKey.values()].filter((entrantId): entrantId is string => entrantId !== null),
      );
      for (const entrantId of sortedEntrants) {
        if (fixedEntrantIds.has(entrantId)) {
          continue;
        }
        fixedEntrants.push(entrantId);
        entrantIdsByColumnKey.set(entrantId, entrantId);
        fixedEntrantIds.add(entrantId);
      }
    }
    const entrantOrder = new Map(fixedEntrants.map((entrantId, index) => [entrantId, index]));

    const standings = rankRoundRobinStandings({
      standings: [...standingByEntrantId.values()],
      tieBreakRules,
      entrantSeedNumbers,
      entrantOrder,
      qualifyingCount,
    });

    return {
      entrants: fixedEntrants,
      entrantNames,
      entrantIdsByColumnKey,
      entrantSeedIds,
      entrantSeedNumbers,
      sourceDiagnostics,
      setsByPair,
      candidateSetCount,
      twoSlotSetCount,
      resolvedSetCount,
      registeredSetCount: registeredSetIds.size,
      unresolvedSetIds,
      unresolvedSetReasons,
      standings,
      qualifyingCount,
      tieBreakRules,
    };
  }, [interimScoreDraftsBySetId, pendingResultBySetId, selectedEvent, selectedPhasePoolGroup]);

  const roundRobinMatrixRows = useMemo<RoundRobinMatrixRowView[]>(() => {
    return roundRobinBoardData.entrants.map((rowEntrantId) => {
      const rowSeedId = rowEntrantId.startsWith("seed:")
        ? rowEntrantId.slice("seed:".length)
        : roundRobinBoardData.entrantSeedIds.get(rowEntrantId);
      const rowColumnEntrantId = roundRobinBoardData.entrantIdsByColumnKey.get(rowEntrantId);
      const standing = roundRobinBoardData.standings.find((item) =>
        item.entrantId === rowColumnEntrantId
        || (rowSeedId !== undefined
          && roundRobinBoardData.entrantSeedIds.get(item.entrantId) === rowSeedId)
        || (!rowEntrantId.startsWith("seed:") && item.entrantId === rowEntrantId),
      );

      const cells = roundRobinBoardData.entrants.map((columnEntrantId) => {
        const isDiagonal = rowEntrantId === columnEntrantId;
        const columnSeedId = columnEntrantId.startsWith("seed:")
          ? columnEntrantId.slice("seed:".length)
          : roundRobinBoardData.entrantSeedIds.get(columnEntrantId);
        const set = isDiagonal
          ? null
          : roundRobinBoardData.setsByPair.get(roundRobinPairKey(
            roundRobinBoardData.entrantIdsByColumnKey.get(rowEntrantId) ?? rowEntrantId,
            roundRobinBoardData.entrantIdsByColumnKey.get(columnEntrantId) ?? columnEntrantId,
          ))
            ?? roundRobinBoardData.setsByPair.get(roundRobinPairKey(
              rowSeedId ?? rowEntrantId,
              columnSeedId ?? columnEntrantId,
            ));

        if (!set) {
          return {
            key: columnEntrantId,
            kind: isDiagonal ? "diagonal" as const : "empty" as const,
          };
        }

        const setDisplay = getSetScoresForDisplay(set);
        const pendingResult = pendingResultBySetId.get(set.setId);
        const resultStatus = getSetResultVisualStatus(set);
        const resultStatusClass = resultStatus ? `set-card-status-${resultStatus}` : "";
        const resultStatusLabel = resultStatus === "confirmed"
          ? "確定"
          : resultStatus === "draft"
            ? "下書き"
            : resultStatus === "inprogress"
              ? "進行中"
              : "";
        const winnerId = setDisplay.winnerId ?? set.winnerId;
        const columnColumnEntrantId = roundRobinBoardData.entrantIdsByColumnKey.get(columnEntrantId);
        const rowSlot = set.slots.find((slot) =>
          rowColumnEntrantId !== null && rowColumnEntrantId !== undefined
          && slot.entrantId === rowColumnEntrantId,
        ) ?? set.slots.find((slot) => rowSeedId && slot.seedId === rowSeedId);
        const columnSlot = set.slots.find((slot) =>
          columnColumnEntrantId !== null && columnColumnEntrantId !== undefined
          && slot.entrantId === columnColumnEntrantId,
        ) ?? set.slots.find((slot) => columnSeedId && slot.seedId === columnSeedId);
        const rowEntrantIdForSet = rowSlot?.entrantId ?? null;
        const columnEntrantIdForSet = columnSlot?.entrantId ?? null;
        const rowGameScore = rowEntrantIdForSet
          ? setDisplay.scores[rowEntrantIdForSet]
            ?? (rowSlot?.score !== null && rowSlot?.score !== undefined ? String(rowSlot.score) : "-")
          : "-";
        const columnGameScore = columnEntrantIdForSet
          ? setDisplay.scores[columnEntrantIdForSet]
            ?? (columnSlot?.score !== null && columnSlot?.score !== undefined ? String(columnSlot.score) : "-")
          : "-";
        const changeClass = pendingResult
          ? (isConfirmedSetResult(pendingResult) ? "set-card-changed-confirmed" : "set-card-changed-draft")
          : "";
        const outcomeClass = winnerId === null
          ? ""
          : winnerId === rowEntrantIdForSet
            ? "round-robin-match-win"
            : winnerId === columnEntrantIdForSet
              ? "round-robin-match-loss"
              : "";
        const isLiveOverlaySet = Boolean(
          obsOverlayState?.active
          && obsOverlayState.currentSetId === set.setId
          && obsOverlayState.currentSetId !== "__test__",
        );
        const roundLabel = set.fullRoundText.trim() || `Round ${set.round ?? "-"}`;
        const setLabel = `Set ${setDisplayCodeById.get(set.setId) ?? set.identifier?.trim() ?? "-"}`;

        return {
          key: columnEntrantId,
          kind: "match" as const,
          match: {
            set,
            className: `round-robin-match ${outcomeClass} ${changeClass} ${resultStatusClass} ${isLiveOverlaySet ? "set-card-live" : ""}`,
            title: `${roundLabel} / ${setLabel}: ${roundRobinBoardData.entrantNames.get(rowEntrantId) || "-"} vs ${roundRobinBoardData.entrantNames.get(columnEntrantId) || "-"}`,
            roundLabel,
            setLabel,
            resultStatus,
            resultStatusLabel,
            isLiveOverlaySet,
            rowGameScore,
            columnGameScore,
          },
        };
      });

      return {
        key: rowEntrantId,
        entrantName: roundRobinBoardData.entrantNames.get(rowEntrantId) || "-",
        cells,
        setSummary: standing ? `${standing.wins}-${standing.losses}` : "-",
        gameSummary: standing ? `${standing.gameWins}-${standing.gameLosses}` : "-",
      };
    });
  }, [
    getSetResultVisualStatus,
    getSetScoresForDisplay,
    interimScoreDraftsBySetId,
    obsOverlayState,
    pendingResultBySetId,
    roundRobinBoardData,
    setDisplayCodeById,
  ]);

  const eliminationBracketSections: EliminationBracketSectionView[] = renderedBracketSectionsForView.map((section) => ({
    key: section.key,
    title: section.title,
    setCount: section.setCount,
    columns: section.columns.map((column) => ({
      key: column.key,
      title: column.title,
      round: column.round,
      height: column.height,
      hidden: column.hidden,
      cards: column.positionedSets.map(({ set, y }) => {
        const displaySet = resolvedEventSetsById.get(set.setId) ?? set;
        const pendingResult = pendingResultBySetId.get(set.setId);
        const resultStatus = getSetResultVisualStatus(set);
        const resultStatusLabel = resultStatus === "confirmed"
          ? "確定"
          : resultStatus === "draft"
            ? "下書き"
            : resultStatus === "inprogress"
              ? "途中"
              : "";
        const finishedSet = isCompletedSet(set);
        const matchupReady = isMatchupReady(displaySet);
        const setDisplay = getSetScoresForDisplay(displaySet);
        const winnerId = setDisplay.winnerId ?? set.winnerId;

        return {
          set,
          positionY: y,
          displayCode: setDisplayCodeById.get(set.setId),
          changeClass: pendingResult
            ? (isConfirmedSetResult(pendingResult) ? "set-card-changed-confirmed" : "set-card-changed-draft")
            : "",
          resultStatus,
          resultStatusLabel,
          isLiveOverlaySet: Boolean(
            obsOverlayState?.active
            && obsOverlayState.currentSetId === set.setId
            && obsOverlayState.currentSetId !== "__test__",
          ),
          slots: displaySet.slots.map((slot, index) => {
            const entrantId = slot.entrantId;
            const tbdSourceLabel = resolveTbdSourceLabel(set, index, slot);
            const entrantName = !entrantId && tbdSourceLabel ? tbdSourceLabel : slot.entrantName;
            const isWinner = entrantId && winnerId ? entrantId === winnerId : false;
            const sideLabel = getSetSlotSideLabel(set.setId, entrantId, {
              fallbackBySlotIndex: index,
              finishedSet,
              matchupReady,
            });
            const sideBadgeClass = sideLabel === "1P"
              ? (finishedSet ? "side-1p-finished" : "side-1p")
              : sideLabel === "2P"
                ? (finishedSet ? "side-2p-finished" : "side-2p")
                : "side-none";
            const gameWins = entrantId
              ? (setDisplay.scores[entrantId]
                ?? (slot.score !== null
                  ? (isDqScoreValue(slot.score) ? "DQ" : formatScoreValue(slot.score))
                  : (winnerId ? (isWinner ? "✓" : "-") : "-")))
              : "-";
            const scoreClass = (isDqScoreValue(slot.score) || setDisplay.isDq)
              ? (isWinner ? "win" : "dq")
              : (isWinner ? "win" : "lose");

            return {
              key: `${set.setId}-${index}`,
              sideLabel,
              sideBadgeClass,
              entrantName,
              gameWins,
              scoreClass,
            };
          }),
        };
      }),
    })),
  }));

  useEffect(() => {
    if (phaseNames.length === 0) {
      if (selectedPhaseName !== "") {
        setSelectedPhaseName("");
      }
      return;
    }

    if (phaseNames.includes(selectedPhaseName)) {
      return;
    }

    setSelectedPhaseName(phaseNames[0]);
  }, [phaseNames, selectedPhaseName]);

  useEffect(() => {
    if (phaseScopedPoolGroups.length === 0) {
      if (selectedPhasePoolKey !== "") {
        setSelectedPhasePoolKey("");
      }
      return;
    }

    if (phaseScopedPoolGroups.some((group) => group.key === selectedPhasePoolKey)) {
      return;
    }

    setSelectedPhasePoolKey(phaseScopedPoolGroups[0].key);
  }, [phaseScopedPoolGroups, selectedPhasePoolKey]);

  useEffect(() => {
    if (!snapshot || snapshot.events.length === 0) {
      return;
    }

    if (selectedEventId === "") {
      return;
    }

    const exists = snapshot.events.some((event) => event.eventId === selectedEventId);
    if (!exists) {
      setSelectedEventId("");
    }
  }, [snapshot, selectedEventId]);

  async function saveToken(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    clearStatusMessages();

    try {
      await saveStartggToken();
      setMessage("start.ggトークンを保存しました。");
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  function clearStatusMessages() {
    setError("");
    setMessage("");
  }

  async function saveStartggToken() {
    await invoke("save_startgg_token", { token });
  }

  function applyCreateEventSelection(event: TournamentEventPreviewItem | null, options?: { resetAlias?: boolean }) {
    setCreateSelectedEventId(event?.eventId ?? "");
    setCreateEventSlugInput(toEventSlugInput(event?.eventSlug ?? ""));
    if (options?.resetAlias) {
      setCreateEventAlias("");
    }
  }

  async function loadCreatePreview(e?: FormEvent) {
    e?.preventDefault();

    const apiSlug = toApiSlug(slug);
    if (apiSlug === "") {
      setError("大会IDを入力してください。");
      return;
    }

    const previousSelectedEventId = createSelectedEventId;
    setCreateBusy(true);
    clearStatusMessages();
    setCreateSnapshotProgress(null);
    setCreatePreview(null);
    setCreatePreviewLoadFailed(false);
    setCreateEventSearchInput("");

    try {
      await saveStartggToken();
      const preview = await invoke<TournamentPreview>("preview_tournament", {
        slug: apiSlug,
      });
      setCreatePreview(preview);
      const selected = resolveCreatePreviewSelection(preview, previousSelectedEventId);
      applyCreateEventSelection(selected);
      setMessage("tournamentのイベント一覧を取得しました。");
    } catch (err) {
      setCreatePreviewLoadFailed(true);
      setError(String(err));
    } finally {
      setCreateBusy(false);
    }
  }

  function handleCreateEventSearchInputChange(nextValue: string) {
    setCreateEventSearchInput(nextValue);
  }

  function handleCreateEventDropdownChange(nextEventId: string) {
    if (!createPreview) {
      return;
    }

    const selected = createPreview.events.find((event) => event.eventId === nextEventId) ?? null;
    if (!selected || selected.eventId === createSelectedEventId) {
      return;
    }

    applyCreateEventSelection(selected, { resetAlias: true });
  }

  const createFilteredEvents = useMemo(() => {
    if (!createPreview) {
      return [] as TournamentEventPreviewItem[];
    }

    const normalizedQuery = createEventSearchInput.trim().toLocaleLowerCase();
    if (normalizedQuery === "") {
      return createPreview.events;
    }

    return createPreview.events.filter((event) => {
      const eventName = event.eventName.toLocaleLowerCase();
      const eventId = event.eventId.toLocaleLowerCase();
      const eventSlug = (event.eventSlug ?? "").toLocaleLowerCase();
      return eventName.includes(normalizedQuery)
        || eventId.includes(normalizedQuery)
        || eventSlug.includes(normalizedQuery);
    });
  }, [createPreview, createEventSearchInput]);

  async function createEventSnapshotBySlug() {
    const tournamentSlug = toApiSlug(slug);
    const eventSlug = toEventApiSlug(slug, createEventSlugInput);
    if (tournamentSlug === "" || eventSlug === "") {
      setError("大会IDとevent ID(またはevent slug)を入力してください。");
      return;
    }

    if (createSelectedEventId !== "") {
      try {
        const existingItems = await invoke<LocalSnapshotEventListItem[]>("list_local_snapshot_events");
        const existing = existingItems.find((item) =>
          toApiSlug(item.slug) === tournamentSlug
          && item.eventId === createSelectedEventId,
        );
        if (existing) {
          const confirmed = window.confirm(
            `このeventのスナップショットは既に存在します。上書きして再取得しますか？\n${existing.slug}`,
          );
          if (!confirmed) {
            return;
          }
        }
      } catch (err) {
        setError(String(err));
        return;
      }
    }

    setCreateBusy(true);
    clearStatusMessages();
    setCreateSnapshotProgress({
      phase: "starting",
      completedSets: 0,
      totalSets: null,
      currentPage: null,
      currentSetId: null,
    });

    try {
      await saveStartggToken();
      await invoke("save_last_slug", { slug: tournamentSlug });

      await invoke("create_event_snapshot_by_slug", {
        input: {
          tournamentSlug,
          eventSlug,
          eventAlias: createEventAlias.trim() === "" ? null : createEventAlias.trim(),
          perPage: normalizeStartggFetchPerPage(startggFetchPerPage),
        },
      });

      setWorkspace(null);
      startupAutoRestoreDoneRef.current = true;
      setCreateSnapshotProgress(null);
      await refreshLocalSnapshotEvents();
      setActiveTab("home");
      setMessage("eventのローカルスナップショットを作成しました。");
    } catch (err) {
      setError(String(err));
    } finally {
      setCreateSnapshotProgress(null);
      setCreateBusy(false);
    }
  }

  async function refreshLocalSnapshotEvents() {
    setLoadingLocalSnapshotEvents(true);

    try {
      const items = await invoke<LocalSnapshotEventListItem[]>("list_local_snapshot_events");
      setLocalSnapshotEvents(items);

      const savedSlug = startupSavedSlugRef.current.trim();
      const savedEventId = startupSavedEventIdRef.current.trim();
      const savedSelectionStillExists = savedSlug === "" || savedEventId === ""
        || items.some((item) => sameSnapshotEventKey(savedSlug, savedEventId, item.slug, item.eventId));
      if (!savedSelectionStillExists) {
        setWorkspace(null);
        setSelectedEventId("");
        setSelectedPhaseName("");
        setSelectedPhasePoolKey("");
        startupSavedSlugRef.current = "";
        startupSavedEventIdRef.current = "";
        lastPersistedSnapshotSelectionRef.current = "";
        await invoke("save_last_snapshot_selection", {
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
        startupSavedSlugRef.current = "";
        startupSavedEventIdRef.current = "";
        lastPersistedSnapshotSelectionRef.current = "";
      }
    } catch (err) {
      setError(String(err));
    } finally {
      localSnapshotEventsLoadedOnceRef.current = true;
      setLoadingLocalSnapshotEvents(false);
    }
  }

  async function selectLocalSnapshotEvent(item: LocalSnapshotEventListItem) {
    setBusy(true);
    setError("");
    setMessage("");

    const savedPhaseName = typeof item.lastSelectedPhaseName === "string"
      ? item.lastSelectedPhaseName.trim()
      : "";
    const savedPhaseGroupName = typeof item.lastSelectedPhaseGroupName === "string"
      ? item.lastSelectedPhaseGroupName.trim()
      : "";

    try {
      await invoke("save_last_slug", { slug: item.slug });
      await invoke("save_last_snapshot_selection", {
        slug: item.slug,
        eventId: item.eventId,
        phaseName: savedPhaseName === "" ? null : savedPhaseName,
        phaseGroupName: savedPhaseGroupName === "" ? null : savedPhaseGroupName,
      });
      const result = await invoke<TournamentWorkspace>("load_local_tournament_workspace", {
        slug: item.slug,
        eventId: item.eventId,
      });

      setSlug(toSlugInput(item.slug));
      setSelectedEventId(item.eventId);
      if (savedPhaseName !== "" && savedPhaseGroupName !== "") {
        setSelectedPhaseName(savedPhaseName);
        setSelectedPhasePoolKey(`${savedPhaseName}::${savedPhaseGroupName}`);
      } else {
        setSelectedPhaseName("");
        setSelectedPhasePoolKey("");
      }
      setWorkspace(result);
      closeMatchDialog();
      setMessage(`イベントを読み込みました: ${item.tournamentName} / ${item.eventName}`);
    } catch (err) {
      setError(String(err));
    } finally {
      setCreateSnapshotProgress(null);
      setBusy(false);
    }
  }

  async function deleteLocalSnapshotEvent(item: LocalSnapshotEventListItem) {
    const displayEventName = item.eventAlias && item.eventAlias.trim() !== ""
      ? item.eventAlias
      : item.eventName;
    const confirmed = window.confirm(
      `このローカルスナップショットを削除しますか？\n${item.tournamentName} / ${displayEventName}`,
    );
    if (!confirmed) {
      return;
    }

    const deletingKey = `${item.slug}:${item.eventId}`;
    setDeletingSnapshotKey(deletingKey);
    setError("");
    setMessage("");

    try {
      await invoke("delete_local_snapshot_event", {
        slug: item.slug,
        eventId: item.eventId,
      });

      const removedSettingKey = eventSettingKey(item.slug, item.eventId);
      setEventMgmtSettings((current) => {
        if (!(removedSettingKey in current)) {
          return current;
        }

        const next = { ...current };
        delete next[removedSettingKey];
        return next;
      });

      if (
        snapshot
        && selectedEvent
        && sameSnapshotEventKey(snapshot.slug, selectedEvent.eventId, item.slug, item.eventId)
      ) {
        setWorkspace(null);
        setSelectedEventId("");
        closeMatchDialog();
      }

      await refreshLocalSnapshotEvents();
      setMessage(`削除しました: ${item.tournamentName} / ${displayEventName}`);
    } catch (err) {
      setError(String(err));
    } finally {
      setDeletingSnapshotKey("");
    }
  }

  async function saveSelectedEventAlias() {
    if (!selectedEvent) {
      setError("先にイベントを選択してください。");
      return;
    }

    const normalizedSlug = toApiSlug(slug);
    if (normalizedSlug === "") {
      setError("大会slugが確認できません。イベントを選択してください。");
      return;
    }

    const trimmed = eventAliasDraft.trim();
    setBusy(true);
    setError("");
    setMessage("");

    try {
      const result = await invoke<TournamentWorkspace>("save_event_alias", {
        slug: normalizedSlug,
        eventId: selectedEvent.eventId,
        eventAlias: trimmed === "" ? null : trimmed,
      });

      setWorkspace(result);
      await refreshLocalSnapshotEvents();
      setMessage(trimmed === "" ? "エイリアス名を未設定にしました。" : `エイリアス名を保存しました: ${trimmed}`);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  async function updateSnapshot() {
    const normalizedSlug = toApiSlug(slug);
    const eventId = selectedEvent?.eventId ?? selectedEventId;
    if (normalizedSlug === "" || eventId === "") {
      setError("先にイベントを選択してください。");
      return;
    }

    setBusy(true);
    setError("");
    setMessage("");
    setCreateSnapshotProgress({
      phase: "starting",
      completedSets: 0,
      totalSets: null,
      currentPage: null,
      currentSetId: null,
    });

    try {
      const result = await invoke<TournamentWorkspace>("refresh_local_event_snapshot_from_remote", {
        slug: normalizedSlug,
        eventId,
        perPage: normalizeStartggFetchPerPage(startggFetchPerPage),
      });
      setWorkspace(result);
      setSetResultDrafts({});
      setInterimScoreDraftsBySetId({});
      closeMatchDialog();
      setCreateSnapshotProgress(null);
      await refreshLocalSnapshotEvents();
      setMessage("スナップショットを更新しました。未報告のローカル結果・途中経過は破棄され、start.gg状態に合わせました。");
    } catch (err) {
      setError(String(err));
    } finally {
      setCreateSnapshotProgress(null);
      setBusy(false);
    }
  }

  async function restoreGraphFromSnapshot() {
    const normalizedSlug = toApiSlug(slug);
    const eventId = selectedEvent?.eventId ?? selectedEventId;
    if (normalizedSlug === "" || eventId === "") {
      setError("先にイベントを選択してください。");
      return;
    }

    setRestoreDialogOpen(false);
    setBusy(true);
    setError("");
    setMessage("");

    try {
      const result = await invoke<TournamentWorkspace>("restore_local_event_graph_from_snapshot", {
        slug: normalizedSlug,
        eventId,
      });
      setWorkspace(result);
      setSetResultDrafts({});
      setInterimScoreDraftsBySetId({});
      closeMatchDialog();
      setMessage("最後に取得したスナップショット時点に復元しました。対象eventの未報告結果は破棄されました。");
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  function getSetSlotSide(setId: string, entrantId: string | null): PlaySide | "" {
    if (!entrantId) {
      return "";
    }

    return setPlaySideMap.get(`${setId}:${entrantId}`) ?? "";
  }

  function getSetSlotSideLabel(
    setId: string,
    entrantId: string | null,
    options?: { fallbackBySlotIndex?: number; finishedSet?: boolean; matchupReady?: boolean },
  ): string {
    if (!entrantId) {
      return "-";
    }

    // 対戦カードが未確定の間は、保存済みサイドが残っていても表示しない。
    if (!options?.finishedSet && !options?.matchupReady) {
      return "-";
    }

    const side = getSetSlotSide(setId, entrantId);
    if (side !== "") {
      return side;
    }

    if ((options?.finishedSet || options?.matchupReady) && options.fallbackBySlotIndex !== undefined) {
      if (options.fallbackBySlotIndex === 0) {
        return "1P";
      }
      if (options.fallbackBySlotIndex === 1) {
        return "2P";
      }
    }

    return "-";
  }

  function getDisplaySlotsForSet(
    set: SetSnapshot,
    options?: {
      finishedSet?: boolean;
      matchupReady?: boolean;
      sideDrafts?: Record<string, PlaySide | "">;
    },
  ): Array<{ slot: SetSlot; slotIndex: number }> {
    const indexed = set.slots.map((slot, slotIndex) => ({ slot, slotIndex }));
    if (!displayBracketPlayersBySide) {
      return indexed;
    }

    const sideRank = (label: string): number => {
      if (label === "1P") {
        return 0;
      }
      if (label === "2P") {
        return 2;
      }
      return 1;
    };

    return indexed
      .slice()
      .sort((left, right) => {
        const leftDraftSide = left.slot.entrantId ? (options?.sideDrafts?.[left.slot.entrantId] ?? "") : "";
        const rightDraftSide = right.slot.entrantId ? (options?.sideDrafts?.[right.slot.entrantId] ?? "") : "";
        const leftSide = getSetSlotSideLabel(set.setId, left.slot.entrantId, {
          fallbackBySlotIndex: left.slotIndex,
          finishedSet: options?.finishedSet,
          matchupReady: options?.matchupReady,
        });
        const rightSide = getSetSlotSideLabel(set.setId, right.slot.entrantId, {
          fallbackBySlotIndex: right.slotIndex,
          finishedSet: options?.finishedSet,
          matchupReady: options?.matchupReady,
        });

        const resolvedLeftSide = leftDraftSide !== "" ? leftDraftSide : leftSide;
        const resolvedRightSide = rightDraftSide !== "" ? rightDraftSide : rightSide;

        const bySide = sideRank(resolvedLeftSide) - sideRank(resolvedRightSide);
        if (bySide !== 0) {
          return bySide;
        }

        return left.slotIndex - right.slotIndex;
      });
  }

  function getSetScoresForDisplay(set: SetSnapshot): { scores: Record<string, string>; isDq: boolean; winnerId: string | null } {
    const result = pendingResultBySetId.get(set.setId);
    const interimDrafts = interimScoreDraftsBySetId[set.setId];

    if (!result && interimDrafts) {
      const directWinner = set.slots.find((slot) => slot.entrantId && interimDrafts[slot.entrantId] === "W")?.entrantId;
      if (directWinner) {
        return {
          scores: Object.fromEntries(
            set.slots
              .filter((slot) => slot.entrantId)
              .map((slot) => [slot.entrantId as string, slot.entrantId === directWinner ? "W" : "L"]),
          ),
          isDq: false,
          winnerId: directWinner,
        };
      }
      const scores: Record<string, string> = {};
      let hasDq = false;

      for (const slot of set.slots) {
        if (!slot.entrantId) {
          continue;
        }

        const parsed = parseDraftScoreValue(interimDrafts[slot.entrantId] ?? "");
        if (parsed === null) {
          continue;
        }

        if (parsed < 0) {
          scores[slot.entrantId] = "DQ";
          hasDq = true;
        } else {
          scores[slot.entrantId] = String(parsed);
        }
      }

      const resolvedWinnerId = resolveWinnerIdFromDrafts(set, interimDrafts);

      return {
        scores,
        isDq: hasDq,
        winnerId: resolvedWinnerId === "" ? null : resolvedWinnerId,
      };
    }

    if (!result) {
      const winnerId = set.winnerId;
      if (winnerId) {
        const winnerSlot = set.slots.find((slot) => slot.entrantId === winnerId);
        const loserSlot = set.slots.find((slot) => slot.entrantId !== null && slot.entrantId !== winnerId);
        const winnerScore = winnerSlot ? toIntegerScore(winnerSlot.score) : null;
        const loserScore = loserSlot ? toIntegerScore(loserSlot.score) : null;
        const loserIsDq = loserSlot ? isDqScoreValue(loserSlot.score) : false;

        if (winnerSlot && loserSlot && !loserIsDq && (winnerScore === null || loserScore === null)) {
          const scores: Record<string, string> = {};
          scores[winnerId] = "W";
          if (loserSlot.entrantId) {
            scores[loserSlot.entrantId] = "L";
          }
          return {
            scores,
            isDq: false,
            winnerId,
          };
        }

        if (winnerScore === null && loserScore === null && !loserIsDq) {
          const scores: Record<string, string> = {};
          for (const slot of set.slots) {
            if (slot.entrantId) {
              scores[slot.entrantId] = slot.entrantId === winnerId ? "W" : "L";
            }
          }
          return {
            scores,
            isDq: false,
            winnerId,
          };
        }

        if (winnerScore !== null && (loserScore === null || loserIsDq)) {
          const scores: Record<string, string> = {};
          for (const slot of set.slots) {
            if (!slot.entrantId) {
              continue;
            }
            scores[slot.entrantId] = slot.entrantId === winnerId ? "✓" : "DQ";
          }

          return {
            scores,
            isDq: true,
            winnerId,
          };
        }
      }

      return {
        scores: {},
        isDq: false,
        winnerId,
      };
    }

    const slotScores = result.slotScores ?? [];

    if (result.directWin) {
      const scores: Record<string, string> = {};
      for (const slot of set.slots) {
        if (slot.entrantId) {
          scores[slot.entrantId] = slot.entrantId === result.winnerId ? "W" : "L";
        }
      }
      return { scores, isDq: false, winnerId: result.winnerId };
    }

    if (slotScores.length > 0) {
      const scores: Record<string, string> = {};
      const matchedEntrantIds = new Set<string>();
      const unresolvedSlots: SetSlot[] = [];
      for (const slot of set.slots) {
        if (!slot.entrantId) {
          continue;
        }
        const matchedScore = slotScores.find((score) => score.entrantId === slot.entrantId);
        if (matchedScore) {
          scores[slot.entrantId] = matchedScore.score < 0 ? "DQ" : String(matchedScore.score);
          matchedEntrantIds.add(matchedScore.entrantId);
        } else {
          unresolvedSlots.push(slot);
        }
      }

      const unresolvedScores = slotScores.filter((slot) => !matchedEntrantIds.has(slot.entrantId));
      for (const [index, slot] of unresolvedSlots.entries()) {
        const fallbackScore = unresolvedScores[index];
        if (slot.entrantId && fallbackScore) {
          scores[slot.entrantId] = fallbackScore.score < 0 ? "DQ" : String(fallbackScore.score);
        }
      }

      return {
        scores,
        isDq: slotScores.some((slot) => slot.score < 0),
        winnerId: result.winnerId,
      };
    }

    if (isDqScoreCsvText(result.scoreCsv)) {
      const scores: Record<string, string> = {};
      for (const slot of set.slots) {
        if (!slot.entrantId) {
          continue;
        }
        scores[slot.entrantId] = slot.entrantId === result.winnerId ? "✓" : "DQ";
      }

      return {
        scores,
        isDq: true,
        winnerId: result.winnerId,
      };
    }

    const parsed = parseScoreCsvText(result.scoreCsv);
    if (!parsed) {
      return {
        scores: {},
        isDq: false,
        winnerId: result.winnerId,
      };
    }

    const scores: Record<string, string> = {};
    for (const slot of set.slots) {
      if (!slot.entrantId) {
        continue;
      }

      if (slot.entrantId === result.winnerId) {
        scores[slot.entrantId] = String(parsed.winnerWins);
      } else {
        scores[slot.entrantId] = String(parsed.loserWins);
      }
    }

    return {
      scores,
      isDq: false,
      winnerId: result.winnerId,
    };
  }

  function getSetResultVisualStatus(set: SetSnapshot): "inprogress" | "draft" | "confirmed" | null {
    const pending = pendingResultBySetId.get(set.setId);
    if (pending) {
      return isConfirmedSetResult(pending) ? "confirmed" : "draft";
    }

    const interimDrafts = interimScoreDraftsBySetId[set.setId];
    if (interimDrafts) {
      return "inprogress";
    }

    const hasSnapshotScores = set.slots.some((slot) => slot.score !== null);
    if (!set.winnerId && hasSnapshotScores) {
      return "inprogress";
    }

    if (isCompletedSet(set) && Boolean(set.winnerId?.trim())) {
      return "confirmed";
    }

    return null;
  }

  function openMatchDialog(set: SetSnapshot, forcedDraftState?: SetResultDraftState) {
    if (!isDisplayableSet(set, selectedEvent)) {
      return;
    }
    if (isInactiveGrandFinalReset(set, selectedEvent)) {
      return;
    }
    const inputSet = resolvedEventSetsById.get(set.setId) ?? set;
    setActiveMatchSetId(set.setId);
    setSetId(set.setId);

    const sideDrafts: Record<string, PlaySide | ""> = {};
    for (const slot of inputSet.slots) {
      if (!slot.entrantId) {
        continue;
      }
      sideDrafts[slot.entrantId] = getSetSlotSide(set.setId, slot.entrantId);
    }
    setActiveMatchSideDrafts(sideDrafts);

    if (forcedDraftState) {
      setDirectWinnerId(forcedDraftState.directWin ? forcedDraftState.winnerId : null);
      setScoreDrafts(forcedDraftState.scoreDrafts);
      setSetResultDrafts((current) => ({
        ...current,
        [set.setId]: forcedDraftState,
      }));
      return;
    }

    const pending = pendingResultBySetId.get(set.setId);
    if (pending) {
      const draftState = buildDraftStateFromPending(inputSet, pending);
      setDirectWinnerId(draftState.directWin ? draftState.winnerId : null);
      setScoreDrafts(draftState.scoreDrafts);
      setSetResultDrafts((current) => ({
        ...current,
        [set.setId]: draftState,
      }));
      return;
    }

    const cached = setResultDrafts[set.setId];
    if (cached) {
      setDirectWinnerId(cached.directWin ? cached.winnerId : null);
      setScoreDrafts(cached.scoreDrafts);
      return;
    }

    setDirectWinnerId(null);
    const snapshotDisplay = getSetScoresForDisplay(set);
    const snapshotScoreDrafts = Object.keys(snapshotDisplay.scores).length > 0
      ? snapshotDisplay.scores
      : buildScoreDraftsFromSet(inputSet);
    setScoreDrafts(snapshotScoreDrafts);
    setSetResultDrafts((current) => ({
      ...current,
      [set.setId]: {
        winnerId: "",
        scoreDrafts: snapshotScoreDrafts,
        directWin: false,
      },
    }));
  }

  function requestResultConfirmation(match: SetSnapshot) {
    if (!isMatchupReady(match)) {
      return;
    }

    setResultConfirmation({
      match,
      scoreDrafts: { ...scoreDrafts },
      directWinnerId,
    });
  }

  function resolveDqRequestContext(message: GenericMessage): { setId: string; dqEntrantId: string } | null {
    const directSetId = extractMetaString(message.messageMeta, "dqSetId");
    const directEntrantId = extractMetaString(message.messageMeta, "dqCallEntrantId");

    if (directSetId !== "" && directEntrantId !== "") {
      return {
        setId: directSetId,
        dqEntrantId: directEntrantId,
      };
    }

    const root = mailboxThreadSummaries.find((summary) => summary.root.threadId === message.threadId)?.root;
    if (!root) {
      return null;
    }

    const rootSetId = extractMetaString(root.messageMeta, "setId");
    const rootEntrantId = extractMetaString(root.messageMeta, "callEntrantId");
    if (rootSetId === "" || rootEntrantId === "") {
      return null;
    }

    return {
      setId: rootSetId,
      dqEntrantId: rootEntrantId,
    };
  }

  function processDqRequestFromMessage(message: GenericMessage) {
    setError("");
    setMessage("");

    if (!selectedEvent) {
      setError("先にイベントを選択してください。DQ処理先を開けません。");
      return;
    }

    const context = resolveDqRequestContext(message);
    if (!context) {
      setError("DQ申請メッセージから対象setを特定できませんでした。");
      return;
    }

    const targetSet = selectedEvent.sets.find((set) => set.setId === context.setId);
    if (!targetSet) {
      setError(`対象setが現在のイベント内に見つかりません: ${context.setId}`);
      return;
    }

    const draftState = buildDqDraftStateForEntrant(targetSet, context.dqEntrantId);
    if (!draftState) {
      setError("DQ入力の自動設定に失敗しました。対象プレイヤーまたは対戦カードを確認してください。");
      return;
    }

    const phaseName = targetSet.phaseName && targetSet.phaseName.trim() !== "" ? targetSet.phaseName : "Phase 未設定";
    const phaseGroupName = targetSet.phaseGroupName && targetSet.phaseGroupName.trim() !== "" ? targetSet.phaseGroupName : "Pool 未設定";
    setSelectedPhaseName(phaseName);
    setSelectedPhasePoolKey(`${phaseName}::${phaseGroupName}`);
    setActiveTab("bracket");
    openMatchDialog(targetSet, draftState);
    setMessage("DQ申請から対象setを開きました。DQ入力済みなので「確定」を押すと反映できます。");
  }

  function closeMatchDialog() {
    setActiveMatchSetId("");
    setSetId("");
    setActiveMatchSideDrafts({});
    setMatchSideRandomNotice(null);
    setDirectWinnerId(null);
  }

  function closeMobileInputPortalDialog() {
    setMobileInputPortalOpen(false);
  }

  async function refreshMobileInputPortalDialog() {
    if (!selectedEvent) {
      setError("先にイベントを選択してください。");
      return;
    }

    const normalizedSlug = toApiSlug(slug);
    if (normalizedSlug === "") {
      setError("大会IDを入力してください。");
      return;
    }

    const activeHost = mobileInputUrlHostKey(mobileInputIssuedUrl);
    if (activeHost === "") {
      setError("先にURLを発行してください。");
      return;
    }

    setMobileInputPortalBusy(true);
    setError("");
    setMessage("");

    try {
      const portalInfo = await invoke<MobileInputPortalInfo>("get_mobile_input_portal_info", {
        slug: normalizedSlug,
        eventId: selectedEvent.eventId,
      });
      const pollingMs = normalizeMobileInputPollingMs(mobileInputPollingMs);
      const patchedUrl = withMobileInputPollMsParam(portalInfo.url, pollingMs);
      const patchedAccessUrls = Array.from(new Set(
        portalInfo.accessUrls
          .map((item) => withMobileInputPollMsParam(item, pollingMs))
          .filter((item) => item.trim() !== ""),
      ));
      const nextPortalInfo: MobileInputPortalInfo = {
        ...portalInfo,
        url: patchedUrl,
        accessUrls: patchedAccessUrls.length > 0 ? patchedAccessUrls : [patchedUrl],
      };

      const refreshedUrl = nextPortalInfo.accessUrls.find((item) => mobileInputUrlHostKey(item) === activeHost) ?? nextPortalInfo.url;

      setMobileInputPortalDialog(nextPortalInfo);
      setMobileInputIssuedUrl(refreshedUrl);
      setMessage("スマートフォン向けURLを更新しました。新しい2次元コードを共有してください。");
    } catch (err) {
      setError(String(err));
    } finally {
      setMobileInputPortalBusy(false);
    }
  }

  async function issueMobileInputPortalUrl(bindIp: string) {
    if (!selectedEvent) {
      setError("先にイベントを選択してください。");
      return;
    }

    const normalizedSlug = toApiSlug(slug);
    if (normalizedSlug === "") {
      setError("大会IDを入力してください。");
      return;
    }

    const selectedHost = bindIp.trim();
    if (selectedHost === "") {
      setError("IPを選択してください。");
      return;
    }

    setMobileInputPortalBusy(true);
    setError("");
    setMessage("");

    try {
      const portalInfo = await invoke<MobileInputPortalInfo>("get_mobile_input_portal_info", {
        slug: normalizedSlug,
        eventId: selectedEvent.eventId,
      });
      const pollingMs = normalizeMobileInputPollingMs(mobileInputPollingMs);
      const patchedUrl = withMobileInputPollMsParam(portalInfo.url, pollingMs);
      const patchedAccessUrls = Array.from(new Set(
        portalInfo.accessUrls
          .map((item) => withMobileInputPollMsParam(item, pollingMs))
          .filter((item) => item.trim() !== ""),
      ));
      const nextPortalInfo: MobileInputPortalInfo = {
        ...portalInfo,
        url: patchedUrl,
        accessUrls: patchedAccessUrls.length > 0 ? patchedAccessUrls : [patchedUrl],
      };
      const selectedUrl = nextPortalInfo.accessUrls.find((item) => mobileInputUrlHostKey(item) === selectedHost) ?? nextPortalInfo.url;

      setMobileInputPortalDialog(nextPortalInfo);
      setMobileInputIssuedUrl(selectedUrl);
      setMessage("スマートフォン向けURLを発行しました。必要に応じてURLを更新できます。");
    } catch (err) {
      setError(String(err));
    } finally {
      setMobileInputPortalBusy(false);
    }
  }

  async function openMobileInputPortalDialog() {
    if (!selectedEvent) {
      setError("先にイベントを選択してください。");
      return;
    }

    const normalizedSlug = toApiSlug(slug);
    if (normalizedSlug === "") {
      setError("大会IDを入力してください。");
      return;
    }

    setMobileInputPortalOpen(true);
    setError("");
    setMessage("");

    if (mobileInputPortalDialog && mobileInputIssuedUrl.trim() !== "") {
      setMessage("発行中のURLを表示しています。必要に応じてURL更新で再発行できます。");
      return;
    }

    try {
      const listed = await invoke<LocalNetworkSettingsCandidate[]>("list_local_network_settings");
      const candidates = Array.isArray(listed) ? listed : [];
      setMobileInputPortalCandidates(candidates);

      if (candidates.length === 0) {
        setError("利用可能なIP候補が見つかりませんでした。");
        return;
      }

      setMessage("IP候補を表示しました。URL発行を押すと結果を共有できます。");
    } catch (err) {
      setError(String(err));
    } finally {
      setMobileInputPortalBusy(false);
    }
  }

  async function copyMobileInputUrl(value: string) {
    if (value.trim() === "") {
      return;
    }

    try {
      if (!navigator.clipboard || !navigator.clipboard.writeText) {
        throw new Error("この環境ではクリップボードAPIが使用できません。");
      }
      await navigator.clipboard.writeText(value);
      setMessage("スマホ入力URLをクリップボードへコピーしました。");
    } catch {
      setError("URLコピーに失敗しました。URLを手動で共有してください。");
    }
  }

  async function saveLocalResultForMatch(confirmed: boolean) {
    if (!selectedEvent) {
      setError("イベントが選択されていません。");
      return;
    }

    if (!activeMatch) {
      setError("試合が選択されていません。");
      return;
    }

    if (isCompletedSet(activeMatch)) {
      setError("確定済みsetの結果は変更できません。修正する場合は「影響setを取消」からやり直してください。");
      return;
    }
    if (isInactiveGrandFinalReset(activeMatch, selectedEvent)) {
      setError("Winners側のプレイヤーがGrand Finalに勝利したため、Grand Final Resetは行われません。");
      return;
    }

    setBusy(true);
    setError("");
    setMessage("");

    try {
      const normalizedSlug = toApiSlug(slug);
      await invoke("save_last_slug", { slug: normalizedSlug });

      await saveMatchSidesIfNeeded(selectedEvent, activeMatch, activeMatchSideDrafts);

      const directWin = directWinnerId !== null;
      const slotScores = directWin
        ? activeMatch.slots
          .filter((slot): slot is SetSlot & { entrantId: string } => slot.entrantId !== null)
          .map((slot) => ({ entrantId: slot.entrantId, score: 0 }))
        : buildSlotScoresForSave(activeMatch, scoreDrafts);
      let resolvedWinnerId = directWinnerId ?? resolveWinnerIdFromDrafts(activeMatch, scoreDrafts);

      if (resolvedWinnerId === "") {
        if (confirmed) {
          setError("スコアから勝者を特定できませんでした。入力を確認してください。");
          return;
        }

        const result = await invoke<TournamentWorkspace>("save_local_set_scores", {
          input: {
            slug: normalizedSlug,
            eventId: selectedEvent.eventId,
            setId,
            slotScores,
          },
        });
        setWorkspace(result);
        setSetResultDrafts((current) => {
          if (!(setId in current)) {
            return current;
          }
          const next = { ...current };
          delete next[setId];
          return next;
        });
        setInterimScoreDraftsBySetId((current) => {
          if (!(setId in current)) {
            return current;
          }
          const next = { ...current };
          delete next[setId];
          return next;
        });

        try {
          await syncObsOverlayScoresForSet(activeMatch, slotScores);
        } catch {
          // オーバーレイ反映失敗は入力中の進行を止めない
        }

        setMessage("勝者未確定のため結果は確定せず、現在スコアを更新しました。オーバーレイへも同期済みです。");
        return;
      }

      const result = await invoke<TournamentWorkspace>("save_local_set_result", {
        input: {
          slug: normalizedSlug,
          eventId: selectedEvent.eventId,
          setId,
          winnerId: resolvedWinnerId,
          confirmed,
            directWin,
          slotScores,
        },
      });
      setWorkspace(result);
      setSetResultDrafts((current) => ({
        ...current,
        [setId]: {
          winnerId: resolvedWinnerId,
          scoreDrafts,
          directWin,
        },
      }));
      setInterimScoreDraftsBySetId((current) => {
        if (!(setId in current)) {
          return current;
        }
        const next = { ...current };
        delete next[setId];
        return next;
      });
      try {
        await syncObsOverlayScoresForSet(activeMatch, slotScores);
      } catch {
        // local結果保存は成功しているため、オーバーレイ反映失敗は致命扱いにしない
      }
      setMessage(
        confirmed
          ? "結果を確定しました。確定済みの試合だけが一括報告の対象になります。"
          : "入力を保存しました。確定すると一括報告の対象になります。",
      );
      if (confirmed) {
        closeMatchDialog();
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  async function discardLocalResultDraftsForBracket() {
    if (!selectedEvent) {
      return;
    }

    setBusy(true);
    setError("");
    setMessage("");

    try {
      const normalizedSlug = toApiSlug(slug);
      const result = await invoke<TournamentWorkspace>("clear_local_set_result_drafts", {
        slug: normalizedSlug,
        eventId: selectedEvent.eventId,
      });

      setWorkspace(result);
      setSetResultDrafts({});
      setInterimScoreDraftsBySetId({});
      closeMatchDialog();
      await refreshLocalSnapshotEvents();
      setMessage("全下書きを破棄しました。スナップショットの内容に戻しました。");
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  async function discardLocalResultDraftForMatch() {
    if (!selectedEvent) {
      setError("先にイベントを選択してください。");
      return;
    }

    if (!activeMatch) {
      setError("試合が選択されていません。");
      return;
    }

    const targetSetId = activeMatch.setId;

    setBusy(true);
    setError("");
    setMessage("");

    try {
      const normalizedSlug = toApiSlug(slug);
      const result = await invoke<TournamentWorkspace>("clear_local_set_result_draft_for_set", {
        input: {
          slug: normalizedSlug,
          eventId: selectedEvent.eventId,
          setId: targetSetId,
        },
      });

      setWorkspace(result);
      setSetResultDrafts((current) => {
        if (!(targetSetId in current)) {
          return current;
        }
        const next = { ...current };
        delete next[targetSetId];
        return next;
      });
      setInterimScoreDraftsBySetId((current) => {
        if (!(targetSetId in current)) {
          return current;
        }
        const next = { ...current };
        delete next[targetSetId];
        return next;
      });

      const restoredSet = result.snapshot.events
        .find((event) => event.eventId === selectedEvent.eventId)
        ?.sets.find((set) => set.setId === targetSetId);

      if (!restoredSet) {
        closeMatchDialog();
      } else {
        setScoreDrafts(buildScoreDraftsFromSet(restoredSet));

        const sideMap = new Map(
          (result.localMeta.setPlaySides ?? []).map((item) => [`${item.setId}:${item.entrantId}`, item.playSide] as const),
        );
        const sideDrafts: Record<string, PlaySide | ""> = {};
        for (const slot of restoredSet.slots) {
          if (!slot.entrantId) {
            continue;
          }
          sideDrafts[slot.entrantId] = sideMap.get(`${restoredSet.setId}:${slot.entrantId}`) ?? "";
        }
        setActiveMatchSideDrafts(sideDrafts);
      }

      await refreshLocalSnapshotEvents();
      setMessage("このsetの下書きを破棄しました。保存用スナップショットの内容に戻しました。");
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  async function resetSetResultCascadeForMatch() {
    if (!selectedEvent) {
      setError("先にイベントを選択してください。");
      return;
    }

    if (!activeMatch) {
      setError("試合が選択されていません。");
      return;
    }

    const confirmed = window.confirm("このsetと影響するsetの結果をローカルで取り消します。実行しますか？");
    if (!confirmed) {
      return;
    }

    setBusy(true);
    setError("");
    setMessage("");

    try {
      const normalizedSlug = toApiSlug(slug);
      const result = await invoke<ResetSetResultCascadeResult>("reset_set_result_cascade", {
        input: {
          slug: normalizedSlug,
          eventId: selectedEvent.eventId,
          setId: activeMatch.setId,
          resetRemote: false,
          perPage: normalizeStartggFetchPerPage(startggFetchPerPage),
        },
      });

      setWorkspace(result.workspace);
      closeMatchDialog();
      setMessage(`結果をローカルで取り消しました。${result.affectedSetIds.length} 件のsetを更新しています。`);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  async function savePlayerMeta(
    eventSnapshot: EventSnapshot,
    entrantId: string,
    entrantName: string,
    options?: SavePlayerMetaOptions,
  ) {
    const silent = options?.silent ?? false;
    const manageBusy = options?.manageBusy ?? true;
    const normalizedSlug = toApiSlug(slug);
    const draft = getMetaDraft(eventSnapshot.eventId, entrantId);
    const validated = buildValidatedSelections(draft, configuredCategorySlots);

    if (validated.errors.length > 0) {
      setError(validated.errors.join(" "));
      return;
    }

    setMetaDraft(eventSnapshot.eventId, entrantId, {
      categorySelections: validated.normalizedBySlot,
    });

    if (manageBusy) {
      setBusy(true);
    }
    setError("");
    if (!silent) {
      setMessage("");
    }

    try {
      const result = await invoke<TournamentWorkspace>("save_local_player_meta", {
        input: {
          slug: normalizedSlug,
          eventId: eventSnapshot.eventId,
          eventName: eventSnapshot.name,
          entrantId,
          entrantName,
          playSide: null,
          characterNames: validated.flattened,
          notes: null,
        },
      });

      setWorkspace(result);
      dirtyMetaDraftKeysRef.current.delete(getMetaDraftKey(eventSnapshot.eventId, entrantId));
      if (!silent) {
        setMessage("ローカルメタを保存しました。");
      }
    } catch (err) {
      setError(String(err));
      throw err;
    } finally {
      if (manageBusy) {
        setBusy(false);
      }
    }
  }

  async function saveSetPlaySide(
    eventSnapshot: EventSnapshot,
    setSnapshot: SetSnapshot,
    entrantId: string,
    playSide: PlaySide | "",
    options?: { silent?: boolean; manageBusy?: boolean },
  ) {
    const silent = options?.silent ?? true;
    const manageBusy = options?.manageBusy ?? true;

    if (manageBusy) {
      setBusy(true);
    }
    setError("");
    if (!silent) {
      setMessage("");
    }

    try {
      const normalizedSlug = toApiSlug(slug);
      const result = await invoke<TournamentWorkspace>("save_local_set_play_side", {
        input: {
          slug: normalizedSlug,
          eventId: eventSnapshot.eventId,
          setId: setSnapshot.setId,
          entrantId,
          opponentEntrantId: setSnapshot.slots
            .map((slot) => slot.entrantId)
            .find((candidate) => candidate && candidate !== entrantId) ?? null,
          playSide: playSide === "" ? null : playSide,
        },
      });

      setWorkspace(result);
      if (!silent) {
        setMessage("setサイドを保存しました。");
      }
    } catch (err) {
      const errorMessage = String(err);
      const isTransientSideAssignmentError = errorMessage.includes("対戦カードが確定していないsetはサイド設定できません");
      if (!silent || !isTransientSideAssignmentError) {
        setError(errorMessage);
        throw err;
      }
    } finally {
      if (manageBusy) {
        setBusy(false);
      }
    }
  }

  function swapMatchSides(setSnapshot: SetSnapshot) {
    if (!isMatchupReady(setSnapshot)) {
      return;
    }

    const slots = setSnapshot.slots.filter((slot) => slot.entrantId !== null);
    if (slots.length < 2) {
      return;
    }

    const upper = slots[0];
    const lower = slots[1];
    const upperId = upper.entrantId;
    const lowerId = lower.entrantId;
    if (!upperId || !lowerId) {
      return;
    }

    const resolveSide = (entrantId: string, fallbackSlotIndex: number): PlaySide => {
      const draftSide = activeMatchSideDrafts[entrantId] ?? "";
      if (draftSide !== "") {
        return draftSide;
      }

      const savedSide = getSetSlotSide(setSnapshot.setId, entrantId);
      if (savedSide !== "") {
        return savedSide;
      }

      return fallbackSlotIndex === 0 ? "1P" : "2P";
    };

    const upperCurrent = resolveSide(upperId, 0);
    const lowerCurrent = resolveSide(lowerId, 1);

    setActiveMatchSideDrafts((current) => ({
      ...current,
      [upperId]: lowerCurrent,
      [lowerId]: upperCurrent,
    }));
  }

  async function randomizeMatchSides(setSnapshot: SetSnapshot) {
    if (!isMatchupReady(setSnapshot)) {
      return;
    }

    const slots = setSnapshot.slots.filter((slot) => slot.entrantId !== null);
    if (slots.length < 2) {
      return;
    }

    const upper = slots[0];
    const lower = slots[1];
    const upperId = upper.entrantId;
    const lowerId = lower.entrantId;
    if (!upperId || !lowerId) {
      return;
    }

    const upperIsOneP = Math.random() < 0.5;
    const upperSide: PlaySide = upperIsOneP ? "1P" : "2P";
    const lowerSide: PlaySide = upperIsOneP ? "2P" : "1P";

    const upperCurrent = activeMatchSideDrafts[upperId] ?? "";
    const lowerCurrent = activeMatchSideDrafts[lowerId] ?? "";
    const changed = upperCurrent !== upperSide || lowerCurrent !== lowerSide;

    setActiveMatchSideDrafts((current) => ({
      ...current,
      [upperId]: upperSide,
      [lowerId]: lowerSide,
    }));

    setMatchSideRandomNotice({
      setId: setSnapshot.setId,
      upperEntrantName: upper.entrantName,
      lowerEntrantName: lower.entrantName,
      upperSide,
      lowerSide,
      changed,
      triggeredAt: Date.now(),
    });
  }

  async function saveMatchSidesIfNeeded(
    eventSnapshot: EventSnapshot,
    set: SetSnapshot,
    sideDrafts: Record<string, PlaySide | "">,
  ) {
    if (!isMatchupReady(set)) {
      return;
    }

    const slots = set.slots.filter((slot) => slot.entrantId !== null);
    if (slots.length < 2) {
      return;
    }

    const upperId = slots[0].entrantId;
    const lowerId = slots[1].entrantId;
    if (!upperId || !lowerId) {
      return;
    }

    const currentUpper = getSetSlotSide(set.setId, upperId);
    const currentLower = getSetSlotSide(set.setId, lowerId);
    const fallbackUpper = getSetSlotSideLabel(set.setId, upperId, {
      fallbackBySlotIndex: 0,
      matchupReady: true,
    });
    const fallbackLower = getSetSlotSideLabel(set.setId, lowerId, {
      fallbackBySlotIndex: 1,
      matchupReady: true,
    });
    const toPlaySide = (value: string): PlaySide | "" => value === "1P" || value === "2P" ? value : "";
    const draftUpper = sideDrafts[upperId] || currentUpper || toPlaySide(fallbackUpper);
    const draftLower = sideDrafts[lowerId] || currentLower || toPlaySide(fallbackLower);

    let resolvedUpper: PlaySide | "" = "";
    if (draftUpper !== "" && draftLower !== "") {
      resolvedUpper = draftUpper;
    } else if (draftUpper !== "") {
      resolvedUpper = draftUpper;
    } else if (draftLower !== "") {
      resolvedUpper = oppositePlaySide(draftLower);
    }

    if (resolvedUpper === "") {
      return;
    }

    const resolvedLower = oppositePlaySide(resolvedUpper);
    if (currentUpper === resolvedUpper && currentLower === resolvedLower) {
      return;
    }

    await saveSetPlaySide(eventSnapshot, set, upperId, resolvedUpper, {
      silent: true,
      manageBusy: false,
    });
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-head">
          <div className="sidebar-head-title">
            <h1>savakan-gg</h1>
            {appVersion !== "" ? <span className="app-version">v{appVersion}</span> : null}
          </div>
          <p>大会運営コンソール</p>
        </div>

        <div className="sidebar-summary">
          <p className="meta">選択中の大会</p>
          {snapshot ? (
            <>
              <p className="summary-name">{selectedSummaryName}</p>
              <p className="summary-meta">slug: {snapshot.slug}</p>
              <p className="summary-meta">events: {snapshot.events.length}</p>
            </>
          ) : selectedSidebarItem ? (
            <>
              <p className="summary-name">{selectedSummaryName}</p>
              <p className="summary-meta">slug: {selectedSidebarItem.slug}</p>
              <p className="summary-meta">tournament: {selectedSidebarItem.tournamentName}</p>
            </>
          ) : (
            <p className="summary-meta">未選択</p>
          )}
        </div>

        <nav className="tab-nav" role="tablist" aria-label="メインタブ">
          {APP_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              className={`tab-trigger ${activeTab === tab.id ? "active" : ""}`}
              aria-selected={activeTab === tab.id}
              disabled={!tab.implemented}
              title={tab.implemented ? tab.label : `${tab.label} は未実装です`}
              onClick={() => setActiveTab(tab.id)}
            >
              <span aria-hidden="true">{tab.icon}</span>
              <span>{tab.label}</span>
              {tab.id === "message" && unreadMessageCount > 0 && (
                <span className="tab-count-badge" aria-label={`未読メッセージ ${unreadMessageCount}件`}>
                  {unreadMessageCount >= 10 ? "9+" : unreadMessageCount}
                </span>
              )}
              {tab.id === "call-list" && unresolvedCallRootCounts.total > 0 && (
                <span className="tab-count-badge" aria-label={`未解決の呼び出し ${unresolvedCallRootCounts.total}件`}>
                  {unresolvedCallRootCounts.total >= 10 ? "9+" : unresolvedCallRootCounts.total}
                </span>
              )}
            </button>
          ))}
        </nav>
      </aside>

      <main className={`content ${activeTab === "call-list" ? "call-list-mode" : ""}`}>
        <section className="hero">
          {activeTab === "call-list" ? (
            <StatusBoardHero
              currentPage={callListCurrentPage}
              totalPages={callListTotalPages}
              sortStrategy={callListEventSortStrategy}
              onToggleSort={() => setCallListEventSortStrategy((current) => (current === "alias" ? "max-elapsed" : "alias"))}
              canBroadcastSync={canBroadcastCallListSync}
              onBroadcastSync={() => void requestUnresolvedCallSyncBroadcast()}
              onNextPage={() => {
                setCallListPageSwitchedAtMs(Date.now());
                setCallListPageIndex((current) => {
                  const next = (current + 1) % unresolvedCallEventPages.length;
                  if (next === 0) {
                    setCallListCycleCount((cycle) => cycle + 1);
                  }
                  return next;
                });
              }}
              pageProgressPercent={normalizedCallListPageProgressPercent}
            />
          ) : (
            <>
              <h2>{activeTab === "create" ? "新規作成" : (APP_TABS.find((tab) => tab.id === activeTab)?.label ?? "大会管理")}</h2>
              {activeTab !== "create" && (
                <>
                  <p className="description">start.ggのローカルスナップショットをベースにした大会データ単位で管理</p>
                </>
              )}
            </>
          )}
        </section>

        <section className="message-stack" aria-live="polite">
          <p className={`message success ${message === "" ? "empty" : ""}`}>{message === "" ? " " : message}</p>
          <p className={`message error ${error === "" ? "empty" : ""}`}>{error === "" ? " " : error}</p>
        </section>

        {activeTab === "home" && (
          <EventSelector
            items={localSnapshotEvents}
            filteredItems={homeFilteredSnapshotEvents}
            loading={loadingLocalSnapshotEvents}
            searchInput={homeSnapshotSearchInput}
            onSearchInputChange={setHomeSnapshotSearchInput}
            selectedItem={homeSelectedSnapshotItem}
            onSelectedKeyChange={setHomeSelectedSnapshotKey}
            deletingKey={deletingSnapshotKey}
            busy={busy}
            onRefresh={() => void refreshLocalSnapshotEvents()}
            onSelectEvent={(item) => void selectLocalSnapshotEvent(item)}
            onDeleteEvent={(item) => void deleteLocalSnapshotEvent(item)}
          />
        )}

        {activeTab === "create" && (
          <CreateSnapshot
            token={token}
            onTokenChange={setToken}
            slug={slug}
            onSlugChange={setSlug}
            createBusy={createBusy}
            canLoadPreview={toApiSlug(slug) !== "" && token.trim() !== ""}
            onSaveToken={saveToken}
            onLoadPreview={loadCreatePreview}
            createPreview={createPreview}
            createPreviewLoadFailed={createPreviewLoadFailed}
            createEventSearchInput={createEventSearchInput}
            onEventSearchInputChange={handleCreateEventSearchInputChange}
            createFilteredEvents={createFilteredEvents}
            createSelectedEventId={createSelectedEventId}
            onEventDropdownChange={handleCreateEventDropdownChange}
            createEventAlias={createEventAlias}
            onEventAliasChange={setCreateEventAlias}
            createEventSlugInput={createEventSlugInput}
            onEventSlugInputChange={setCreateEventSlugInput}
            canCreateSnapshot={token.trim() !== "" && toApiSlug(slug) !== "" && toEventApiSlug(slug, createEventSlugInput) !== ""}
            onCreateSnapshot={() => void createEventSnapshotBySlug()}
            createSnapshotProgress={createSnapshotProgress}
            createSnapshotProgressPercent={createSnapshotProgressPercent}
            createSnapshotProgressLabel={createSnapshotProgressLabel}
          />
        )}

        {activeTab === "tournament" && (
          <EventSetting
            hasSelectedEvent={Boolean(selectedEvent)}
            eventAlias={selectedEventMeta?.eventAlias ?? ""}
            tournamentName={snapshot?.name ?? "-"}
            eventName={selectedEvent?.name ?? ""}
            busy={busy}
            canUpdateSnapshot={toApiSlug(slug) !== ""}
            onUpdateSnapshot={() => void updateSnapshot()}
            eventAliasDraft={eventAliasDraft}
            onEventAliasDraftChange={setEventAliasDraft}
            onSaveEventAlias={() => void saveSelectedEventAlias()}
            sideDecisionMethod={sideDecisionMethod}
            onSideDecisionMethodChange={(method) => setSideDecisionMethod(method as EventManagementSetting["sideDecisionMethod"])}
            onApplySideDecisionMethod={() => void applySideDecisionMethodToAllUnconfirmedSets()}
            itemLists={itemLists}
            categorySlotListIds={categorySlotListIds}
            categorySlotMinCounts={categorySlotMinCounts}
            categorySlotMaxCounts={categorySlotMaxCounts}
            categorySlotAllowDuplicates={categorySlotAllowDuplicates}
            onCategoryListChange={setCategoryListSlot}
            onCategoryMinChange={(slotIndex, value) => {
              const nextMin = clampNonNegativeInteger(Number(value), 0);
              setCategorySlotMinCounts((current) => {
                const next = [...current];
                next[slotIndex] = nextMin;
                return next;
              });
              setCategorySlotMaxCounts((current) => {
                const next = [...current];
                if ((next[slotIndex] ?? 0) < nextMin) {
                  next[slotIndex] = nextMin;
                }
                return next;
              });
            }}
            onCategoryMaxChange={(slotIndex, value) => {
              const rawMax = clampNonNegativeInteger(Number(value), 0);
              const ensuredMax = Math.max(rawMax, categorySlotMinCounts[slotIndex] ?? 0);
              setCategorySlotMaxCounts((current) => {
                const next = [...current];
                next[slotIndex] = ensuredMax;
                return next;
              });
            }}
            onCategoryAllowDuplicatesChange={(slotIndex, allowed) => {
              setCategorySlotAllowDuplicates((current) => {
                const next = [...current];
                next[slotIndex] = allowed;
                return next;
              });
            }}
            totalItemMinCount={totalItemMinCount}
            totalItemMaxCount={totalItemMaxCount}
            onTotalItemMinChange={(value) => {
              const nextMin = clampNonNegativeInteger(Number(value), 0);
              setTotalItemMinCount(nextMin);
              setTotalItemMaxCount((current) => Math.max(current, nextMin));
            }}
            onTotalItemMaxChange={(value) => {
              const nextMax = clampNonNegativeInteger(Number(value), 0);
              setTotalItemMaxCount(Math.max(nextMax, totalItemMinCount));
            }}
            onSaveEventManagementSetting={saveEventManagementSetting}
            selectedEventEntrants={selectedEventEntrants}
            selectedEventMetaEntrantCount={selectedEventMeta?.entrants.length ?? 0}
            selectedEntrantId={selectedTournamentEntrant?.entrantId ?? ""}
            selectedEntrantName={selectedTournamentEntrant?.entrantName ?? ""}
            onSelectEntrant={setSelectedTournamentEntrantId}
            configuredCategorySlots={configuredCategorySlots}
            selectedCategoryUsageList={selectedCategoryUsageList}
            draftSelectionsBySlot={selectedEvent && selectedTournamentEntrant
              ? configuredCategorySlots.map((slot) => getDraftCategorySelections(
                getMetaDraft(selectedEvent.eventId, selectedTournamentEntrant.entrantId),
                slot.slotIndex,
              ))
              : []}
            validationErrors={selectedEvent && selectedTournamentEntrant
              ? buildValidatedSelections(
                getMetaDraft(selectedEvent.eventId, selectedTournamentEntrant.entrantId),
                configuredCategorySlots,
              ).errors
              : []}
            onAddDraftSelection={(slot, itemName) => {
              if (!selectedEvent || !selectedTournamentEntrant) {
                return;
              }
              addDraftCategorySelection(
                selectedEvent.eventId,
                selectedTournamentEntrant.entrantId,
                slot.slotIndex,
                slot.list,
                slot.allowDuplicates,
                slot.maxCount,
                itemName,
              );
            }}
            onRemoveDraftSelection={(slotIndex, selectionIndex) => {
              if (!selectedEvent || !selectedTournamentEntrant) {
                return;
              }
              removeDraftCategorySelection(
                selectedEvent.eventId,
                selectedTournamentEntrant.entrantId,
                slotIndex,
                selectionIndex,
              );
            }}
            canSavePlayerMeta={!busy && toApiSlug(slug) !== ""}
            onSavePlayerMeta={() => {
              if (selectedEvent && selectedTournamentEntrant) {
                void savePlayerMeta(selectedEvent, selectedTournamentEntrant.entrantId, selectedTournamentEntrant.entrantName);
              }
            }}
          />
        )}
        {activeTab === "message" && (
          <MessageBox
            senderLabel={`${senderProfile.senderName.trim() === "" ? "未設定" : senderProfile.senderName} / ${isValidSenderUserId(senderProfile.senderUserId) ? senderProfile.senderUserId : "未設定"} / IP: ${isValidIpv4(senderProfile.bindIp) ? senderProfile.bindIp : "未設定"}`}
            senderProfileReady={isSenderProfileReadyForMessaging}
            disableLocalCommunication={disableLocalCommunication}
            mailboxServiceStarted={mailboxServiceStarted}
            mailboxMethodDraft={mailboxMethodDraft}
            getMailboxMethodLabel={getMailboxMethodLabel}
            mailboxSubjectDraft={mailboxSubjectDraft}
            onMailboxSubjectChange={setMailboxSubjectDraft}
            messageDeliveryMode={messageDeliveryMode}
            onMessageDeliveryModeChange={setMessageDeliveryMode}
            messageDeliveryIpDraft={messageDeliveryIpDraft}
            onMessageDeliveryIpChange={setMessageDeliveryIpDraft}
            composeFixedBodyDraft={composeFixedBodyDraft}
            genericMessageBodyDraft={genericMessageBodyDraft}
            onGenericMessageBodyChange={setGenericMessageBodyDraft}
            onCancelFixedMessage={() => {
              setComposeFixedBodyDraft(null);
              setComposeMessageMeta(null);
              setMailboxMethodDraft("generic");
              setMailboxSubjectDraft("");
              setMessageDeliveryMode("broadcast");
              setMessageDeliveryIpDraft("");
              setGenericMessageBodyDraft("");
              setMessage("呼び出しメッセージをキャンセルしました。汎用メッセージ入力に戻りました。");
            }}
            canSendGenericMessage={canSendGenericMessage}
            onPostGenericMessage={() => void postGenericMessage()}
            mailboxFilterSetting={mailboxFilterSetting}
            onMailboxFilterChange={(key, checked) => {
              setSelectedThreadId("");
              setMailboxFilterSetting((current) => ({ ...current, [key]: checked }));
            }}
            mailboxThreads={mailboxThreads}
            mailboxThreadSummaries={mailboxThreadSummaries}
            activeThread={activeThread}
            activeThreadMessages={activeThreadMessages}
            activeThreadResolved={activeThreadResolved}
            onSelectThread={setSelectedThreadId}
            onProcessDqRequest={processDqRequestFromMessage}
            isDqRequestMessage={isDqRequestMessage}
            canResolveActiveThread={canResolveActiveThread}
            onResolveActiveThread={() => void resolveActiveThread()}
            canDeleteActiveThread={canDeleteActiveThread}
            onDeleteActiveThread={deleteActiveThread}
            replyBodyDraft={replyBodyDraft}
            onReplyBodyChange={setReplyBodyDraft}
            canReplyToThread={canReplyToThread}
            onReplyToThread={() => void replyToThread()}
            canOpenDqDialog={canOpenDqDialog}
            onOpenDqDialog={openDqRequestDialog}
          />
      )}

      {activeTab === "call-list" && (
        <StatusBoard
          eventGroups={unresolvedCallEventGroups}
          activePage={activeUnresolvedCallEventPage}
          hiddenUnresolvedCount={unresolvedCallRootCounts.hidden}
          focusOwnUnresolved={callListFocusOwnUnresolved}
          onShowAllUnresolved={() => {
            setCallListFocusOwnUnresolved(false);
            setCallListDisplayGroups([]);
            setCallListPageIndex(0);
            setCallListCycleCount(0);
            setCallListPageSwitchedAtMs(Date.now());
            setCallListProgressNowMs(Date.now());
            setMessage("呼び出しリストを全未解決表示に戻しました。");
          }}
          resolvePhaseName={(eventId, phaseName) => resolveCallPhaseName(
            snapshot?.events.find((event) => event.eventId === eventId) ?? null,
            phaseName,
            null,
          )}
          pageSwitchedAtMs={callListPageSwitchedAtMs}
          colorToRedSeconds={callListColorToRedSeconds}
        />
      )}

      {dqDialog && (
        <div className="dialog-backdrop" onClick={closeDqRequestDialog}>
          <section
            className="dialog-panel conflict-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="DQ申請認証"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="dialog-head">
              <div>
                <h3>DQ申請認証</h3>
                <p className="meta">呼び出しプレイヤー本人確認のため、PLAYER IDを入力してください。</p>
              </div>
              <button type="button" className="ghost" disabled={dqSubmitting} onClick={closeDqRequestDialog}>閉じる</button>
            </div>

            <div className="dialog-body">
              <p className="meta">対象: {dqDialog.callEntrantName || dqDialog.callEntrantId}</p>
              <label>
                PLAYER ID (伏字入力)
                <input
                  type="password"
                  value={dqPlayerIdDraft}
                  onChange={(event) => setDqPlayerIdDraft(event.currentTarget.value)}
                  placeholder="PG-..."
                  autoComplete="off"
                />
              </label>
              <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginTop: "0.55rem" }}>
                <button
                  type="button"
                  className="ghost"
                  disabled={dqSubmitting}
                  onClick={() => {
                    void startDqCameraScan();
                  }}
                >
                  カメラで2次元コードを読む
                </button>
                <button
                  type="button"
                  className="ghost"
                  disabled={dqSubmitting || !dqCameraActive}
                  onClick={stopDqCameraScan}
                >
                  カメラ停止
                </button>
              </div>

              <div style={{ marginTop: "0.7rem" }}>
                <p className="meta">
                  {dqCameraActive
                    ? "カメラをコードに向けると、自動でPLAYER IDを入力します。"
                    : "「カメラで2次元コードを読む」を押すとプレビューが起動します。"}
                </p>
                <video
                  ref={dqCameraVideoRef}
                  autoPlay
                  playsInline
                  muted
                  style={{
                    width: "100%",
                    maxWidth: "420px",
                    borderRadius: "10px",
                    border: "1px solid var(--line)",
                    background: "#0f172a",
                    display: dqCameraActive ? "block" : "none",
                  }}
                />
                <canvas ref={dqCameraCanvasRef} style={{ display: "none" }} />
              </div>

              <label style={{ marginTop: "0.7rem" }}>
                申請理由 (任意)
                <textarea
                  value={dqReasonDraft}
                  onChange={(event) => setDqReasonDraft(event.currentTarget.value)}
                  rows={3}
                  placeholder="理由を補足する場合に入力"
                  style={{ width: "100%" }}
                />
              </label>

              {dqDialogError !== "" && <p className="message error">{dqDialogError}</p>}
            </div>

            <div className="dialog-actions dialog-actions-split">
              <button type="button" className="ghost" disabled={dqSubmitting} onClick={closeDqRequestDialog}>キャンセル</button>
              <button type="button" disabled={dqSubmitting} onClick={() => void submitDqRequest()}>
                {dqSubmitting ? "申請中..." : "認証してDQ申請"}
              </button>
            </div>
          </section>
        </div>
      )}

        {activeTab === "item-list" && (
          <ItemListEditor
            itemListName={itemListName}
            onItemListNameChange={setItemListName}
            itemCategoryName={itemCategoryName}
            onItemCategoryNameChange={setItemCategoryName}
            itemListText={itemListText}
            onItemListTextChange={setItemListText}
            isEditing={editingItemListId !== null}
            onSave={saveItemList}
            onReset={resetItemListEditor}
            searchInput={itemListSearchInput}
            onSearchInputChange={setItemListSearchInput}
            filteredItemLists={filteredItemLists}
            onEditItemList={editItemList}
            onDeleteItemList={(itemList) => {
              if (window.confirm(`「${itemList.name}」を削除しますか？`)) {
                deleteItemList(itemList.id);
              }
            }}
          />
      )}

      {activeTab === "overlay" && (
        <OverlayControl
          overlayState={obsOverlayState}
          isTestOverlayActive={isTestOverlayActive}
          activeSetLabel={activeObsOverlaySet?.set.fullRoundText ?? null}
          busy={obsOverlayBusy}
          testRedName={testOverlayRedName}
          testBlueName={testOverlayBlueName}
          testRedWins={testOverlayRedWins}
          testBlueWins={testOverlayBlueWins}
          previewWrapRef={overlayPreviewWrapRef}
          previewIframeRef={overlayPreviewIframeRef}
          onOpenUrl={(url) => {
            void openUrl(url).catch((err) => {
              setError(`URLをブラウザで開けませんでした: ${String(err)}`);
            });
          }}
          onNameFitModeChange={(mode) => void updateObsOverlayNameFitMode(mode)}
          onShowSetInfoChange={(checked) => void updateObsOverlayShowSetInfo(checked)}
          onShowEventAliasChange={(checked) => void updateObsOverlayShowEventAlias(checked)}
          onTestRedNameChange={setTestOverlayRedName}
          onTestBlueNameChange={setTestOverlayBlueName}
          onTestRedWinsChange={(value) => setTestOverlayRedWins(normalizeObsSetWins(value))}
          onTestBlueWinsChange={(value) => setTestOverlayBlueWins(normalizeObsSetWins(value))}
          onToggleTestOverlay={() => {
            if (isTestOverlayActive) {
              void stopTestOverlay();
            } else {
              void startTestOverlay();
            }
          }}
          onFullyStop={() => void setObsOverlayFullyStopped(true)}
          onPreviewLoad={() => {
            const width = overlayPreviewWrapRef.current?.clientWidth ?? 0;
            const height = overlayPreviewWrapRef.current?.clientHeight ?? 0;
            if (width <= 0 || height <= 0) {
              return;
            }
            overlayPreviewIframeRef.current?.contentWindow?.postMessage({
              type: "preview-container-width",
              width,
              height,
            }, "*");
          }}
        />
      )}

        {activeTab === "settings" && (
          <SettingsScreen
            disableLocalCommunication={disableLocalCommunication}
            onDisableLocalCommunicationChange={(checked) => {
              setDisableLocalCommunication(checked);
              setMessage(checked
                ? "ローカル通信を無効化しました。メッセージ機能とプレイヤーリストは閲覧のみになります。"
                : "ローカル通信を有効化しました。メッセージ機能とプレイヤーリストを再開できます。");
            }}
            senderNameDraft={senderNameDraft}
            onSenderNameChange={setSenderNameDraft}
            senderUserIdDraft={senderUserIdDraft}
            onSenderUserIdChange={(value) => setSenderUserIdDraft(value.replace(/\D/g, "").slice(0, 8))}
            networkCandidates={senderNetworkCandidates.map((candidate) => ({
              key: localNetworkCandidateKey(candidate),
              label: `${candidate.interfaceName} / ${candidate.source} / ${candidate.bindIp} / ${candidate.broadcastSubnetMask}`,
            }))}
            selectedNetworkCandidateKey={selectedSenderNetworkCandidateKey}
            onNetworkCandidateChange={setSelectedSenderNetworkCandidateKey}
            networkCandidatesLoading={senderNetworkCandidatesLoading}
            normalizedBindIp={normalizedSenderBindIpDraft}
            normalizedSubnetMask={normalizedBroadcastSubnetMaskDraft}
            senderSettingsStatus={senderIdCollision
              ? "既存履歴で同一IDが別名義に使われています。"
              : shouldRecommendMailboxClearForIdentityChange
                ? "履歴メッセージあり: 送信者名/ID変更前にメッセージボックス強制クリアを推奨します。"
                : !hasSelectedSenderNetworkDevice
                  ? "ネットワークデバイスを選択してください。"
                  : !isValidIpv4(normalizedSenderBindIpDraft)
                    ? "選択デバイスのIPが不正です。"
                    : !isValidIpv4(normalizedBroadcastSubnetMaskDraft)
                      ? "選択デバイスのサブネットマスクが不正です。"
                      : "デバイス選択後、IP/サブネットは自動適用されます。"}
            onRefreshNetworkCandidates={() => void refreshLocalNetworkSettingsCandidates(true)}
            onRandomizeSenderUserId={fillRandomSenderUserId}
            onSaveSenderProfile={() => void saveSenderProfileSettings()}
            canSaveSenderProfile={canSaveSenderProfile}
            startggFetchPerPage={normalizeStartggFetchPerPage(startggFetchPerPage)}
            onStartggFetchPerPageChange={(value) => {
              const next = normalizeStartggFetchPerPage(value, startggFetchPerPage);
              setStartggFetchPerPage(next);
            }}
            onStartggFetchPerPageBlur={(value) => {
              const normalized = normalizeStartggFetchPerPage(value);
              if (normalized !== startggFetchPerPage) {
                setStartggFetchPerPage(normalized);
              }
            }}
            mobileInputPollingMs={normalizeMobileInputPollingMs(mobileInputPollingMs)}
            mobileInputPollingMsMin={MOBILE_INPUT_POLLING_MS_MIN}
            mobileInputPollingMsMax={MOBILE_INPUT_POLLING_MS_MAX}
            onMobileInputPollingMsChange={(value) => {
              const next = normalizeMobileInputPollingMs(value, mobileInputPollingMs);
              setMobileInputPollingMs(next);
            }}
            onMobileInputPollingMsBlur={(value) => {
              const normalized = normalizeMobileInputPollingMs(value);
              if (normalized !== mobileInputPollingMs) {
                setMobileInputPollingMs(normalized);
              }
            }}
            callListPageRotateSeconds={callListPageRotateSeconds}
            callListRotateSecondsMin={CALL_LIST_ROTATE_SECONDS_MIN}
            callListRotateSecondsMax={CALL_LIST_ROTATE_SECONDS_MAX}
            onCallListPageRotateSecondsChange={(value) => {
              const next = normalizeCallListRotateSeconds(value, callListPageRotateSeconds);
              setCallListPageRotateSeconds(next);
            }}
            onCallListPageRotateSecondsBlur={(value) => {
              const normalized = normalizeCallListRotateSeconds(value);
              if (normalized !== callListPageRotateSeconds) {
                setCallListPageRotateSeconds(normalized);
              }
            }}
            callListColorSeconds={callListColorSeconds}
            callListColorSecondsMin={CALL_LIST_COLOR_SECONDS_MIN}
            callListColorSecondsMax={CALL_LIST_COLOR_SECONDS_MAX}
            onCallListColorSecondsChange={(value) => {
              const next = normalizeCallListColorSeconds(value, callListColorSeconds);
              setCallListColorSeconds(next);
            }}
            onCallListColorSecondsBlur={(value) => {
              const normalized = normalizeCallListColorSeconds(value);
              if (normalized !== callListColorSeconds) {
                setCallListColorSeconds(normalized);
              }
            }}
            callListRotateSecondsDisplay={normalizeCallListRotateSeconds(callListPageRotateSeconds)}
            callListColorToRedSeconds={callListColorToRedSeconds}
            hasCallListMessages={callListDisplayGroups.length > 0 || genericMessages.some((item) => item.parentMessageId === null && item.method === "call_player")}
            onClearCallList={clearCallListThreads}
            hasMessages={genericMessages.length > 0}
            onForceClearMessages={forceClearMailboxMessages}
          />
        )}

        {activeTab === "users" && (
          <PlayerListInfo
            disableLocalCommunication={disableLocalCommunication}
            userCardBusy={userCardBusy}
            hasSelectedEvent={Boolean(snapshot && selectedEvent)}
            selectedEventLabel={selectedEventMeta?.eventAlias?.trim() || "未設定"}
            players={userCardPlayers}
            selectedPlayerIds={selectedUserCardPlayerIds}
            selectedPlayer={selectedUserCardPlayer}
            selectedPlayerPreviewUrl={selectedUserCardPreviewUrl}
            onSaveSelectedCard={() => void saveSelectedUserCardImage()}
            onExportA4Sheet={() => void exportSelectedPlayerCardsAsA4Sheet()}
            onSelectAllPlayers={selectAllUserCardPlayers}
            onClearPlayerSelection={clearAllUserCardPlayersSelection}
            onSelectPlayer={handleUserCardPlayerSelect}
          />
      )}

        {activeTab === "bracket" && (
        <>
          <section className="panel">
            <h2>使用方法</h2>
            <p className="meta">試合setのカードをクリックすると詳細ダイアログが開き、各種入力が可能です。</p>
            <p className="meta">カードを Ctrl+クリックで配信画面のON/OFF(最大1set)。Alt+左クリックで完全停止します。</p>
            <div className="panel-toolbar compact">
              <p className="meta">
                下書き: {draftPendingCount} / 確定済み: {confirmedReportableCount}
              </p>
            </div>
            {(busy || bracketReport.progress) && (
              <div className="create-snapshot-progress" role="status" aria-live="polite" style={{ marginTop: "0.7rem" }}>
                <div
                  className="create-snapshot-progress-track"
                  role="progressbar"
                  aria-label="結果報告の進捗"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(bracketReport.progressPercent)}
                >
                  <div
                    className="create-snapshot-progress-fill"
                    style={{ width: `${bracketReport.progressPercent}%` }}
                  />
                </div>
                <p className="create-snapshot-progress-meta">
                  {bracketReport.progressLabel}
                  {bracketReport.progress ? ` (${Math.round(bracketReport.progressPercent)}%)` : ""}
                </p>
              </div>
            )}
            {shouldShowBracketSnapshotRefreshProgress && (
              <div className="create-snapshot-progress" role="status" aria-live="polite" style={{ marginTop: "0.45rem" }}>
                <div
                  className="create-snapshot-progress-track"
                  role="progressbar"
                  aria-label="報告後スナップショット更新の進捗"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(createSnapshotProgressPercent)}
                >
                  <div
                    className="create-snapshot-progress-fill"
                    style={{ width: `${createSnapshotProgressPercent}%` }}
                  />
                </div>
                <p className="create-snapshot-progress-meta">
                  {`報告後スナップショット更新: ${createSnapshotProgressLabel}`}
                  {createSnapshotProgress?.totalSets !== null ? ` (${Math.round(createSnapshotProgressPercent)}%)` : ""}
                </p>
              </div>
            )}
            <p className="meta">カード枠が黄色の試合は、現在のスナップショットからローカル変更があります。</p>
          </section>

          {snapshot && (
            <section className="panel">
              <h2>{selectedEventMeta?.eventAlias?.trim() ? selectedEventMeta.eventAlias : "未設定"}</h2>
              <p className="meta">start.ggのtournament名: {snapshot.name}</p>
              <p className="meta">start.ggのevent名: {selectedEvent?.name ?? "-"}</p>

              <div className="event-toolbar">
                <label htmlFor="phase-select">対象フェーズ</label>
                <select
                  id="phase-select"
                  value={selectedPhaseName}
                  onChange={(e) => setSelectedPhaseName(e.currentTarget.value)}
                  disabled={phaseNames.length === 0}
                >
                  {phaseNames.length === 0 ? (
                    <option value="">フェーズがありません</option>
                  ) : (
                    phaseNames.map((phaseName) => (
                      <option key={phaseName} value={phaseName}>
                        {phaseName}
                      </option>
                    ))
                  )}
                </select>

                <label htmlFor="phase-pool-select">対象プール</label>
                <select
                  id="phase-pool-select"
                  value={selectedPhasePoolGroup?.key ?? ""}
                  onChange={(e) => setSelectedPhasePoolKey(e.currentTarget.value)}
                  disabled={phaseScopedPoolGroups.length === 0}
                >
                  {phaseScopedPoolGroups.length === 0 ? (
                    <option value="">フェーズ/プールがありません</option>
                  ) : (
                    phaseScopedPoolGroups.map((group) => (
                      <option key={group.key} value={group.key}>
                        {group.phaseName} / Pool {group.phaseGroupName} ({group.sets.length} sets)
                      </option>
                    ))
                  )}
                </select>

                <div className="bracket-view-tools" style={bracketScaleStyle}>
                  <label htmlFor="bracket-zoom-select">
                    表示倍率
                    <select
                      id="bracket-zoom-select"
                      value={String(bracketZoomLevel)}
                      onChange={(event) => setBracketZoomLevel(normalizeBracketZoomLevel(event.currentTarget.value))}
                    >
                      {BRACKET_ZOOM_LEVELS.map((level) => (
                        <option key={level} value={String(level)}>
                          {level.toFixed(2)}x
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <button
                    type="button"
                    className="ghost"
                    disabled={busy || mobileInputPortalBusy || toApiSlug(slug) === "" || !selectedEvent}
                    onClick={() => {
                      void openMobileInputPortalDialog();
                    }}
                  >
                    スマートフォンでアクセス
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    disabled={busy || toApiSlug(slug) === "" || !selectedEvent}
                    onClick={() => setRestoreDialogOpen(true)}
                  >
                    復元
                  </button>
                  <button
                    type="button"
                    disabled={busy || toApiSlug(slug) === "" || confirmedReportableCount === 0}
                    onClick={() => void bracketReport.startReport()}
                  >
                    確定済みを一括報告
                  </button>
                </div>
              </div>
              <div className="phase-groups">
                {!selectedPhasePoolGroup ? (
                  <p className="meta">選択中イベントにフェーズ/プール情報がありません。</p>
                ) : (
                  <section className="phase-group" key={selectedPhasePoolGroup.key}>
                    <p className="meta">sets: {selectedPhasePoolGroup.sets.length}</p>

                    {getBracketProgressionModel(selectedPhasePoolGroup.bracketType) === "round_robin" ? (
                      <RoundRobinBracket
                        scaleStyle={bracketScaleStyle}
                        setCount={selectedPhasePoolGroup.sets.length}
                        phaseGroupId={selectedPhasePoolGroup.phaseGroupId}
                        seeds={selectedPhasePoolGroup.seeds}
                        progressionsOut={selectedPhasePoolGroup.progressionsOut}
                        entrantNames={roundRobinBoardData.entrants.map((entrantId) =>
                          roundRobinBoardData.entrantNames.get(entrantId) ?? "",
                        )}
                        rows={roundRobinMatrixRows}
                        standings={roundRobinBoardData.standings}
                        tieBreakRules={roundRobinBoardData.tieBreakRules}
                        qualifyingCount={roundRobinBoardData.qualifyingCount}
                        diagnostics={{
                          candidateSetCount: roundRobinBoardData.candidateSetCount,
                          twoSlotSetCount: roundRobinBoardData.twoSlotSetCount,
                          resolvedSetCount: roundRobinBoardData.resolvedSetCount,
                          registeredSetCount: roundRobinBoardData.registeredSetCount,
                          unresolvedSetIds: roundRobinBoardData.unresolvedSetIds,
                          unresolvedSetReasons: roundRobinBoardData.unresolvedSetReasons,
                        }}
                        onMatchClick={(set, event) => {
                          if (event.altKey) {
                            event.preventDefault();
                            if (!busy && !obsOverlayBusy) void setObsOverlayFullyStopped(true);
                            return;
                          }
                          if (event.ctrlKey) {
                            event.preventDefault();
                            if (!busy && !obsOverlayBusy) void toggleActiveMatchOverlay(set);
                            return;
                          }
                          openMatchDialog(set);
                        }}
                      />
                    ) : (
                      <EliminationBracket
                        scaleStyle={bracketScaleStyle}
                        phaseGroupKey={selectedPhasePoolGroup.key}
                        seeds={selectedPhasePoolGroup.seeds}
                        seedMap={selectedPhasePoolGroup.seedMap}
                        sections={eliminationBracketSections}
                        onActivateSet={(set, event) => {
                          if (event.altKey && event.button === 0) {
                            event.preventDefault();
                            if (busy || obsOverlayBusy) {
                              return;
                            }
                            void setObsOverlayFullyStopped(true);
                            return;
                          }
                          if (event.ctrlKey) {
                            event.preventDefault();
                            if (busy || obsOverlayBusy) {
                              return;
                            }
                            void toggleActiveMatchOverlay(set);
                            return;
                          }
                          openMatchDialog(set);
                        }}
                        onOpenSet={openMatchDialog}
                      />
                    )}
                  </section>
                )}
              </div>
            </section>
          )}

          {activeMatch && selectedEvent && (() => {
            const currentDialogMatch = activeMatch;
            const activeMatchCompleted = isCompletedSet(currentDialogMatch);
            const dialogSetCode = setDisplayCodeById.get(currentDialogMatch.setId);
            const dialogIsLiveOverlaySet = Boolean(
              obsOverlayState?.active
              && obsOverlayState.currentSetId === currentDialogMatch.setId
              && obsOverlayState.currentSetId !== "__test__",
            );

            return (
              <div className="dialog-backdrop" onClick={closeMatchDialog}> 
                <section
                  className="dialog-panel"
                  role="dialog"
                  aria-modal="true"
                  aria-label="試合詳細"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="dialog-head">
                    <div className="dialog-head-summary">
                      <h3>{activeMatch.fullRoundText}</h3>
                      <div className="dialog-set-meta">
                        <span className="set-identifier">Set {dialogSetCode ?? "-"}</span>
                        {dialogIsLiveOverlaySet && <span className="set-live-badge">配信中</span>}
                      </div>
                    </div>
                    <button type="button" className="ghost" onClick={closeMatchDialog}>閉じる</button>
                  </div>
                  <p className="meta">setId: {activeMatch.setId} / state: {activeMatch.state}</p>
                  {activeMatchCompleted && (
                    <p className="meta">確定済みsetのスコアは変更できません。修正する場合は「影響setを取消」からやり直してください。</p>
                  )}
                  {!isMatchupReady(activeMatch) && <p className="meta">対戦カード確定後にプレイヤーサイドを変更できます。</p>}
                  {matchSideRandomNotice && matchSideRandomNotice.setId === activeMatch.setId && (
                    <p className={`meta side-random-notice ${matchSideRandomNotice.changed ? "changed" : "unchanged"}`}>
                      ランダム実行済み ({new Date(matchSideRandomNotice.triggeredAt).toLocaleTimeString("ja-JP", { hour12: false })})
                      : 上段 {matchSideRandomNotice.upperEntrantName} = {matchSideRandomNotice.upperSide} / 下段 {matchSideRandomNotice.lowerEntrantName} = {matchSideRandomNotice.lowerSide}
                      {!matchSideRandomNotice.changed ? " (結果は変更なし)" : ""}
                    </p>
                  )}
                  <label className="checkbox-row" style={{ marginTop: "0.4rem" }}>
                    <input
                      type="checkbox"
                      checked={displayBracketPlayersBySide}
                      onChange={(event) => setDisplayBracketPlayersBySide(event.currentTarget.checked)}
                    />
                    プレイヤーサイドに合わせて表示 (1Pが左 / 2Pが右)
                  </label>
                  <div className="side-toggle-row" style={{ marginTop: "0.45rem" }}>
                    <button
                      type="button"
                      className="ghost tiny"
                      disabled={busy || !isMatchupReady(activeMatch)}
                      onClick={() => {
                        swapMatchSides(activeMatch);
                      }}
                    >
                      1P/2P入替
                    </button>
                    <button
                      type="button"
                      className="ghost tiny side-choice side-choice-random"
                      disabled={busy || !isMatchupReady(activeMatch)}
                      onClick={() => {
                        void randomizeMatchSides(activeMatch);
                      }}
                    >
                      1P/2Pランダム決定
                    </button>
                  </div>

                  <div className="dialog-players">
                    {(() => {
                      const matchupReady = isMatchupReady(activeMatch);
                      const displaySlots = getDisplaySlotsForSet(activeMatch, {
                        matchupReady,
                        sideDrafts: activeMatchSideDrafts,
                      });

                      return displaySlots.map(({ slot, slotIndex: idx }) => {
                        const entrantId = slot.entrantId;
                        const dialogTbdLabel = resolveTbdSourceLabel(activeMatch, idx, slot);
                        const dialogEntrantName = !entrantId && dialogTbdLabel ? dialogTbdLabel : slot.entrantName;
                        const fallbackSide = getSetSlotSideLabel(activeMatch.setId, entrantId, {
                          fallbackBySlotIndex: idx,
                          matchupReady,
                        });
                        const currentSide = entrantId
                          ? (activeMatchSideDrafts[entrantId] || getSetSlotSide(activeMatch.setId, entrantId) || fallbackSide)
                          : "";
                        const scoreValue = entrantId && directWinnerId
                          ? (entrantId === directWinnerId ? "W" : "L")
                          : entrantId ? scoreDrafts[entrantId] ?? "" : "";
                        const otherEntrantId = activeMatch.slots.find(
                          (item) => item.entrantId !== null && item.entrantId !== entrantId,
                        )?.entrantId ?? null;

                        return (
                          <article
                            className={`dialog-player-card ${currentSide === "1P" ? "side-card-1p" : currentSide === "2P" ? "side-card-2p" : ""}`}
                            key={`${activeMatch.setId}-dialog-${idx}`}
                          >
                            <p className="dialog-player-name">{dialogEntrantName}</p>
                            <p className="meta">entrantId: {entrantId ?? "-"}</p>
                            {entrantId && (
                              <>
                                <p className="meta">プレイヤーサイド: {currentSide === "" ? "-" : currentSide}</p>
                                <label>
                                  取得ゲーム数
                                  <div className="set-score-stepper">
                                    <button
                                      type="button"
                                      className="ghost tiny"
                                      disabled={busy || activeMatchCompleted || !isMatchupReady(activeMatch) || directWinnerId !== null}
                                      onClick={() => {
                                        if (!entrantId) {
                                          return;
                                        }
                                        setScoreDrafts((current) =>
                                          applyScoreDraftWithOpponentDefault(
                                            activeMatch,
                                            current,
                                            entrantId,
                                            stepScoreDraftValue(current[entrantId] ?? "", -1),
                                          ));
                                      }}
                                    >
                                      -
                                    </button>
                                    <input
                                      className="set-score-input"
                                      type="text"
                                      inputMode="numeric"
                                      value={scoreValue}
                                      disabled={busy || activeMatchCompleted || !isMatchupReady(activeMatch) || directWinnerId !== null}
                                      onChange={(e) => {
                                        if (!entrantId) {
                                          return;
                                        }
                                        const nextValue = e.currentTarget.value;
                                        setScoreDrafts((current) =>
                                          applyScoreDraftWithOpponentDefault(
                                            activeMatch,
                                            current,
                                            entrantId,
                                            nextValue,
                                          ));
                                      }}
                                    />
                                    <button
                                      type="button"
                                      className="ghost tiny"
                                      disabled={busy || activeMatchCompleted || !isMatchupReady(activeMatch) || directWinnerId !== null}
                                      onClick={() => {
                                        if (!entrantId) {
                                          return;
                                        }
                                        setScoreDrafts((current) =>
                                          applyScoreDraftWithOpponentDefault(
                                            activeMatch,
                                            current,
                                            entrantId,
                                            stepScoreDraftValue(current[entrantId] ?? "", 1),
                                          ));
                                      }}
                                    >
                                      +
                                    </button>
                                  </div>
                                </label>
                                {entrantId && otherEntrantId && (
                                  <button
                                    type="button"
                                    className="ghost tiny"
                                    disabled={busy || activeMatchCompleted}
                                    onClick={() => {
                                      setDirectWinnerId((current) => current === entrantId ? null : entrantId);
                                      setScoreDrafts((current) => ({
                                        ...current,
                                        [entrantId]: directWinnerId === entrantId ? "" : "W",
                                        [otherEntrantId]: directWinnerId === entrantId ? "" : "L",
                                      }));
                                    }}
                                  >
                                    {directWinnerId === entrantId ? "解除" : "Win"}
                                  </button>
                                )}
                                {entrantId && otherEntrantId && (
                                  <button
                                    type="button"
                                    className="ghost tiny"
                                    disabled={busy || activeMatchCompleted}
                                    onClick={() => {
                                      setScoreDrafts((current) => ({
                                        ...current,
                                        [entrantId]: "-",
                                        [otherEntrantId]: "0",
                                      }));
                                    }}
                                  >
                                    DQ
                                  </button>
                                )}
                                <button
                                  type="button"
                                  className="ghost tiny"
                                  disabled={
                                    busy
                                    || callingEntrantId === entrantId
                                  }
                                  onClick={() => {
                                    if (!entrantId) {
                                      return;
                                    }
                                    void sendCallMessageFromMatch(slot, entrantId);
                                  }}
                                >
                                  {callingEntrantId === entrantId ? "送信中..." : "呼び出し"}
                                </button>
                              </>
                            )}
                          </article>
                        );
                      });
                    })()}
                  </div>

                  <div className="dialog-actions dialog-actions-split match-dialog-actions">
                    <div className="dialog-danger-actions">
                      <button
                        type="button"
                        className="ghost"
                        disabled={busy || activeMatchCompleted}
                        onClick={() => {
                          void discardLocalResultDraftForMatch();
                        }}
                      >
                        下書きの破棄
                      </button>
                      <button
                        type="button"
                        className="ghost"
                        disabled={busy}
                        onClick={() => {
                          void resetSetResultCascadeForMatch();
                        }}
                      >
                        setの取り消し
                      </button>
                    </div>
                    <div className="dialog-primary-actions">
                      <button
                        type="button"
                        disabled={busy || activeMatchCompleted || !isMatchupReady(activeMatch) || isActiveMatchDqDraft}
                        onClick={() => {
                          void saveLocalResultForMatch(false);
                        }}
                      >
                        更新
                      </button>
                      <button
                        type="button"
                        className="ghost"
                        disabled={busy || obsOverlayBusy}
                        onClick={() => {
                          const isSameActive = obsOverlayState?.active && obsOverlayState.currentSetId === currentDialogMatch.setId;
                          const otherSetIsActive = Boolean(
                            obsOverlayState?.active
                            && obsOverlayState.currentSetId
                            && obsOverlayState.currentSetId !== currentDialogMatch.setId
                            && obsOverlayState.currentSetId !== "__test__",
                          );

                          if (otherSetIsActive && !isSameActive) {
                            setOverlaySwitchConfirm({
                              targetSetId: currentDialogMatch.setId,
                              targetSetLabel: currentDialogMatch.fullRoundText || `Set ${dialogSetCode ?? "-"}`,
                            });
                            return;
                          }

                          void toggleActiveMatchOverlay(currentDialogMatch);
                        }}
                      >
                        {obsOverlayState?.active && obsOverlayState.currentSetId === currentDialogMatch.setId && obsOverlayState.currentSetId !== "__test__"
                          ? "配信停止"
                          : "配信開始"}
                      </button>
                      <button
                        type="button"
                        disabled={busy || activeMatchCompleted || !isMatchupReady(activeMatch)}
                        onClick={() => {
                          requestResultConfirmation(activeMatch);
                        }}
                      >
                        確定
                      </button>
                    </div>
                  </div>
                </section>
              </div>
            );
          })()}
          {resultConfirmation && activeMatch && resultConfirmation.match.setId === activeMatch.setId && (
            <div className="dialog-backdrop" onClick={() => setResultConfirmation(null)}>
              <section
                className="dialog-panel"
                role="dialog"
                aria-modal="true"
                aria-label="結果確定確認"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="dialog-head">
                  <div>
                    <h3>結果を確定しますか？</h3>
                    <p className="meta">確定後は通常の下書き破棄では取り消せません。</p>
                  </div>
                </div>
                <div className="dialog-body">
                  <div className="dialog-summary-box">
                    <p className="dialog-summary-title">{resultConfirmation.match.fullRoundText}</p>
                    {resultConfirmation.match.slots
                      .filter((slot) => slot.entrantId)
                      .map((slot) => (
                        <p className="meta" key={`result-confirm-${resultConfirmation.match.setId}-${slot.entrantId}`}>
                          {slot.entrantName}: {resultConfirmation.scoreDrafts[slot.entrantId ?? ""] || "未入力"}
                        </p>
                      ))}
                  </div>
                  <p className="meta">内容を確認し、正しければ確定してください。修正する場合はキャンセルしてください。</p>
                </div>
                <div className="dialog-actions dialog-actions-split" style={{ justifyContent: "flex-end" }}>
                  <button type="button" className="ghost" onClick={() => setResultConfirmation(null)}>キャンセル</button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setResultConfirmation(null);
                      void saveLocalResultForMatch(true);
                    }}
                  >
                    この結果を確定
                  </button>
                </div>
              </section>
            </div>
          )}
          {restoreDialogOpen && (
            <div className="dialog-backdrop" onClick={() => setRestoreDialogOpen(false)}>
              <section
                className="dialog-panel"
                role="dialog"
                aria-modal="true"
                aria-label="復元方法"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="dialog-head">
                  <div>
                    <h3>復元方法</h3>
                    <p className="meta">対象: {selectedEvent?.name ?? "選択中のイベント"}</p>
                  </div>
                  <button type="button" className="ghost" onClick={() => setRestoreDialogOpen(false)}>閉じる</button>
                </div>
                <div className="dialog-body" style={{ display: "grid", gap: "0.5rem" }}>
                  <p className="meta">
                    スナップショット取得後の対象eventの未報告結果（確定済みを含む）は破棄されます。
                  </p>
                  <button
                    type="button"
                    className="ghost"
                    disabled={busy || !selectedEvent}
                    onClick={() => void restoreGraphFromSnapshot()}
                  >
                    スナップショットから復元
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    disabled={busy || toApiSlug(slug) === ""}
                    onClick={() => {
                      setRestoreDialogOpen(false);
                      void updateSnapshot();
                    }}
                  >
                    スナップショットの更新
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    disabled={busy || toApiSlug(slug) === "" || !selectedEvent}
                    onClick={() => {
                      setRestoreDialogOpen(false);
                      void discardLocalResultDraftsForBracket();
                    }}
                  >
                    全下書きの破棄
                  </button>
                </div>
              </section>
            </div>
          )}
          {overlaySwitchConfirm && activeMatch && activeObsOverlaySet && (
            <div
              className="dialog-backdrop"
              onClick={() => {
                setOverlaySwitchConfirm(null);
              }}
            >
              <section
                className="dialog-panel"
                role="dialog"
                aria-modal="true"
                aria-label="配信切替確認"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="dialog-head">
                  <div>
                    <h3>配信先の切り替え確認</h3>
                    <p className="meta">他のセットが配信中です。</p>
                  </div>
                </div>

                <div className="dialog-body">
                  <div className="dialog-summary-box">
                    <p className="dialog-summary-title">現在の配信中セット</p>
                    <p className="dialog-summary-value">{activeObsOverlaySet.set.fullRoundText}</p>
                    <p className="meta">{activeObsOverlaySet.set.slots.filter((slot) => slot.entrantName.trim() !== "").map((slot) => slot.entrantName).join(" vs ") || "対戦カード未確定"}</p>
                  </div>

                  <p className="meta">
                    「{overlaySwitchConfirm.targetSetLabel}」へ切り替えますか？
                  </p>
                </div>

                <div className="dialog-actions dialog-actions-split" style={{ justifyContent: "flex-end" }}>
                  <button type="button" className="ghost" onClick={() => setOverlaySwitchConfirm(null)}>キャンセル</button>
                  <button
                    type="button"
                    disabled={busy || obsOverlayBusy}
                    onClick={() => {
                      setOverlaySwitchConfirm(null);
                      void forceSwitchActiveMatchOverlay(activeMatch);
                    }}
                  >
                    強制切り替え
                  </button>
                </div>
              </section>
            </div>
          )}
          {mobileInputPortalOpen && (
            <div
              className="dialog-backdrop"
              onClick={() => {
                closeMobileInputPortalDialog();
              }}
            >
              <section
                className="dialog-panel mobile-input-dialog"
                role="dialog"
                aria-modal="true"
                aria-label="スマホ入力URL"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="dialog-head">
                  <div>
                    <h3>スマートフォンでアクセス</h3>
                    <p className="meta">同一LAN内の端末に共有してください。</p>
                  </div>
                  <button type="button" className="ghost" onClick={closeMobileInputPortalDialog}>閉じる</button>
                </div>

                <div className="dialog-body">
                  <div className="dialog-summary-box">
                    <p className="dialog-summary-title">アクセス候補</p>
                    <div className="mobile-url-list">
                      {mobileInputPortalCandidates.map((item) => (
                        <article className="mobile-url-item" key={`${item.bindIp}::${item.interfaceName}`}>
                          <span className="mobile-url-text">{item.bindIp}</span>
                          <button
                            type="button"
                            className="ghost tiny"
                            onClick={() => {
                              void issueMobileInputPortalUrl(item.bindIp);
                            }}
                          >
                            URL発行
                          </button>
                        </article>
                      ))}
                    </div>
                  </div>

                  {mobileInputIssuedUrl.trim() !== "" && mobileInputPortalDialog && (
                    <>
                      <div className="mobile-input-qr-wrap">
                        {mobileInputPortalQrUrl === "" ? (
                          <p className="meta">2次元コードを生成中です...</p>
                        ) : (
                          <img className="mobile-input-qr" src={mobileInputPortalQrUrl} alt="スマホ入力URLの2次元コード" />
                        )}
                      </div>

                      <div className="dialog-summary-box">
                        <p className="dialog-summary-title">発行中のURL</p>
                        <p className="dialog-summary-value mobile-url-text">{mobileUrlDisplayIp(mobileInputIssuedUrl)}</p>
                        <p className="meta mobile-url-full">{mobileInputIssuedUrl}</p>
                        <div className="mobile-url-actions">
                          <button
                            type="button"
                            className="ghost"
                            disabled={mobileInputPortalBusy || mobileInputIssuedUrl.trim() === ""}
                            onClick={() => {
                              void copyMobileInputUrl(mobileInputIssuedUrl);
                            }}
                          >
                            URLをコピー
                          </button>
                          <button
                            type="button"
                            className="ghost"
                            disabled={mobileInputPortalBusy}
                            onClick={() => {
                              void refreshMobileInputPortalDialog();
                            }}
                          >
                            {mobileInputPortalBusy ? "更新中..." : "URLを更新"}
                          </button>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </section>
            </div>
          )}
          {bracketReport.conflictDialog && (
            <div
              className="dialog-backdrop"
              onClick={() => {
                if (!busy) {
                  bracketReport.cancelConflict();
                }
              }}
            >
              <section
                className="dialog-panel conflict-dialog"
                role="dialog"
                aria-modal="true"
                aria-label="一括報告の競合確認"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="dialog-head">
                  <div>
                    <h3>一括報告の競合</h3>
                    <p className="meta">このsetは start.gg 側の状態が進んでいるため、そのままでは更新できません。</p>
                  </div>
                  <button type="button" className="ghost" disabled={busy} onClick={bracketReport.cancelConflict}>中止</button>
                </div>

                <div className="dialog-body">
                  <div className="dialog-summary-box">
                    <p className="dialog-summary-title">対象set</p>
                    <p className="dialog-summary-value">{bracketReport.conflictDialog.conflict.fullRoundText}</p>
                    <p className="meta">{bracketReport.conflictDialog.conflict.entrantNames.filter((name) => name.trim() !== "").join(" vs ") || bracketReport.conflictDialog.conflict.setId}</p>
                    <p className="meta">remote state: {bracketReport.conflictDialog.conflict.remoteState} / remote winner: {bracketReport.conflictDialog.conflict.remoteWinnerId ?? "-"}</p>
                  </div>

                  <div className="dialog-summary-box">
                    <p className="dialog-summary-title">ここまでの進捗</p>
                    <p className="dialog-summary-value">
                      対象 {bracketReport.conflictDialog.progress.totalCount} 件 / 送信 {bracketReport.conflictDialog.progress.reportedCount} 件 / スキップ {bracketReport.conflictDialog.progress.skippedCount} 件
                    </p>
                  </div>

                  <label className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={bracketReport.forceOverwriteRemaining}
                      onChange={(event) => bracketReport.setForceOverwriteRemaining(event.currentTarget.checked)}
                    />
                    この一括報告の残りでも、競合したsetは自動で reset して強制上書きする
                  </label>
                </div>

                <div className="dialog-actions dialog-actions-split">
                  <button type="button" className="ghost" disabled={busy} onClick={bracketReport.cancelConflict}>この時点で止める</button>
                  <button type="button" disabled={busy} onClick={() => void bracketReport.continueWithForceOverwrite()}>
                    このsetを reset して続行
                  </button>
                </div>
              </section>
            </div>
          )}
        </>
      )}
      </main>
    </div>
  );
}

export default App;
