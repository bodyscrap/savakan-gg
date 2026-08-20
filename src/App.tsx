import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import QRCode from "qrcode";
import "./App.css";

type SetSlot = {
  entrantId: string | null;
  entrantName: string;
  seedId: string | null;
  seedNum: number | null;
  score: number | null;
};

type SetSnapshot = {
  setId: string;
  fullRoundText: string;
  round: number | null;
  phaseName: string | null;
  phaseGroupName: string | null;
  state: number;
  winnerId: string | null;
  slots: SetSlot[];
};

type RoundColumn = {
  key: string;
  title: string;
  round: number | null;
  seq: number;
  sets: SetSnapshot[];
};

type PhasePoolGroup = {
  key: string;
  phaseName: string;
  phaseGroupName: string;
  sets: SetSnapshot[];
  columns: RoundColumn[];
};

function buildRoundColumns(sets: SetSnapshot[]): RoundColumn[] {
  const map = new Map<string, RoundColumn>();
  let seq = 0;

  for (const set of sets) {
    const roundKey = set.round !== null ? `round-${set.round}` : `text-${set.fullRoundText}`;
    const found = map.get(roundKey);

    if (found) {
      found.sets.push(set);
      continue;
    }

    map.set(roundKey, {
      key: roundKey,
      title: set.fullRoundText,
      round: set.round,
      seq,
      sets: [set],
    });
    seq += 1;
  }

  return [...map.values()].sort((a, b) => {
    if (a.round !== null && b.round !== null) {
      return a.round - b.round;
    }

    if (a.round !== null) {
      return -1;
    }

    if (b.round !== null) {
      return 1;
    }

    return a.seq - b.seq;
  });
}

type EventSnapshot = {
  eventId: string;
  name: string;
  sets: SetSnapshot[];
};

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
  confirmed?: boolean;
  slotScores?: Array<{ entrantId: string; score: number }>;
  recordedAt: string;
};

type SetScoreDraft = Record<string, string>;

type SetResultDraftState = {
  winnerId: string;
  scoreDrafts: SetScoreDraft;
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
  updatedAt: string;
};

type TournamentWorkspace = {
  snapshot: TournamentSnapshot;
  localMeta: TournamentLocalMeta;
};

type TournamentEventPreviewItem = {
  eventId: string;
  eventName: string;
  eventSlug: string | null;
  setCount: number;
};

type TournamentPreview = {
  tournamentId: string;
  slug: string;
  name: string;
  updatedAt: string;
  events: TournamentEventPreviewItem[];
};

type LocalSnapshotEventListItem = {
  tournamentId: string;
  slug: string;
  tournamentName: string;
  updatedAt: string;
  eventId: string;
  eventName: string;
  eventAlias: string | null;
  setCount: number;
};

type BracketBatchReportResult = {
  workspace: TournamentWorkspace;
  processedCount: number;
  reportedCount: number;
  skippedCount: number;
  completed: boolean;
  conflict: BracketBatchConflict | null;
};

type BracketBatchConflict = {
  setId: string;
  fullRoundText: string;
  localWinnerId: string;
  remoteWinnerId: string | null;
  remoteState: number;
  entrantNames: string[];
};

type BatchReportProgress = {
  totalCount: number;
  reportedCount: number;
  skippedCount: number;
};

type BatchConflictDialogState = {
  conflict: BracketBatchConflict;
  progress: BatchReportProgress;
};

type CallThreadIdentity = {
  expectedPlayerId: string;
  callEntrantId: string;
  callEntrantName: string;
  setId: string;
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

type EventSeedStatus = {
  totalEntrants: number;
  missingSeedEntrants: number;
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

type GenericMessage = {
  messageId: string;
  threadId: string;
  parentMessageId: string | null;
  messageType: "normal" | "resolve" | "dq_request";
  messageMeta: Record<string, unknown> | null;
  method: string;
  subject: string;
  senderName: string;
  senderUserId: string;
  senderIp: string;
  body: string;
  createdAt: string;
};

type MessageScope = {
  tournamentId: string;
  slug: string;
  eventId: string;
};

type MailboxDeliveryMode = "broadcast" | "direct";

type MailboxFilterSetting = {
  unresolvedOnly: boolean;
  unreadOnly: boolean;
};

type AppTab = "home" | "create" | "tournament" | "message" | "bracket" | "item-list" | "users" | "settings";

type UserCardPlayer = {
  tournamentId: string;
  tournamentName: string;
  eventId: string;
  eventName: string;
  eventAlias: string | null;
  entrantId: string;
  entrantName: string;
  playerId: string;
};

type ItemListConfig = {
  id: string;
  name: string;
  categoryName: string;
  items: string[];
};

type EventManagementMeta = {
  sideDecisionMethod: "upper_1p" | "upper_2p" | "random";
  itemListSnapshots: ItemListConfig[];
  categoryMinCounts?: number[];
  categoryMaxCounts?: number[];
  categoryAllowDuplicates?: boolean[];
  totalMinCount?: number;
  totalMaxCount?: number;
};

type EventManagementSetting = {
  sideDecisionMethod: "upper_1p" | "upper_2p" | "random";
  itemListIds: string[];
  categoryMinCounts?: number[];
  categoryMaxCounts?: number[];
  categoryAllowDuplicates?: boolean[];
  totalMinCount?: number;
  totalMaxCount?: number;
};

const MAX_CATEGORY_SLOTS = 3;
const USER_CARD_PAGE_SIZE = 10;

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

function clampNonNegativeInteger(value: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  const rounded = Math.trunc(value);
  if (rounded < 0) {
    return 0;
  }

  return rounded;
}

function normalizeSelectionCountArrays(
  value: unknown,
  fallbackValue: number,
): number[] {
  const source = Array.isArray(value) ? value : [];
  const normalized = source
    .slice(0, MAX_CATEGORY_SLOTS)
    .map((item) => clampNonNegativeInteger(Number(item), fallbackValue));

  while (normalized.length < MAX_CATEGORY_SLOTS) {
    normalized.push(fallbackValue);
  }

  return normalized;
}

function normalizeAllowDuplicatesArray(value: unknown): boolean[] {
  const source = Array.isArray(value) ? value : [];
  const normalized = source
    .slice(0, MAX_CATEGORY_SLOTS)
    .map((item) => Boolean(item));

  while (normalized.length < MAX_CATEGORY_SLOTS) {
    normalized.push(false);
  }

  return normalized;
}

function normalizeEventManagementSetting(rawValue: unknown): EventManagementSetting {
  const source = rawValue && typeof rawValue === "object"
    ? (rawValue as Partial<EventManagementSetting>)
    : {};

  const sideDecisionMethod = source.sideDecisionMethod === "upper_2p" || source.sideDecisionMethod === "random"
    ? source.sideDecisionMethod
    : "upper_1p";

  const ids = Array.isArray(source.itemListIds)
    ? source.itemListIds.filter((id): id is string => typeof id === "string").slice(0, MAX_CATEGORY_SLOTS)
    : [];
  while (ids.length < MAX_CATEGORY_SLOTS) {
    ids.push("");
  }

  const categoryMinCounts = normalizeSelectionCountArrays(source.categoryMinCounts, 0);
  const categoryMaxCounts = normalizeSelectionCountArrays(source.categoryMaxCounts, 1)
    .map((maxCount, index) => Math.max(maxCount, categoryMinCounts[index]));
  const categoryAllowDuplicates = normalizeAllowDuplicatesArray(source.categoryAllowDuplicates);

  const enabledSlotCount = ids.filter((id) => id.trim() !== "").length;
  const totalMinCount = clampNonNegativeInteger(Number(source.totalMinCount ?? 0), 0);
  const totalMaxCount = Math.max(
    clampNonNegativeInteger(Number(source.totalMaxCount ?? enabledSlotCount), enabledSlotCount),
    totalMinCount,
  );

  return {
    sideDecisionMethod,
    itemListIds: ids,
    categoryMinCounts,
    categoryMaxCounts,
    categoryAllowDuplicates,
    totalMinCount,
    totalMaxCount,
  };
}

function normalizeItemListConfig(rawValue: unknown): ItemListConfig {
  const source = rawValue && typeof rawValue === "object"
    ? (rawValue as Partial<ItemListConfig>)
    : {};

  const id = typeof source.id === "string" ? source.id.trim() : "";
  const name = typeof source.name === "string" ? source.name.trim() : "";
  const categoryName = typeof source.categoryName === "string" ? source.categoryName.trim() : "";
  const items = Array.isArray(source.items)
    ? source.items
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter((item) => item !== "")
    : [];

  return {
    id,
    name,
    categoryName,
    items: [...new Set(items)],
  };
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

function normalizeGenericMessage(rawValue: unknown): GenericMessage | null {
  const source = rawValue && typeof rawValue === "object"
    ? (rawValue as Partial<GenericMessage>)
    : null;
  if (!source) {
    return null;
  }

  const messageId = typeof source.messageId === "string" ? source.messageId.trim() : "";
  const threadId = typeof source.threadId === "string" ? source.threadId.trim() : messageId;
  const parentMessageId = typeof source.parentMessageId === "string"
    ? source.parentMessageId.trim()
    : null;
  const messageType = source.messageType === "resolve"
    ? "resolve"
    : source.messageType === "dq_request"
      ? "dq_request"
      : "normal";
  const messageMeta = source.messageMeta && typeof source.messageMeta === "object"
    ? (source.messageMeta as Record<string, unknown>)
    : null;
  const method = typeof source.method === "string" ? source.method.trim().toLowerCase() : "generic";
  const subject = typeof source.subject === "string" ? source.subject.trim() : "汎用メッセージ";
  const senderName = typeof source.senderName === "string" ? source.senderName.trim() : "";
  const senderUserId = typeof source.senderUserId === "string"
    ? source.senderUserId.replace(/\D/g, "").slice(0, 8)
    : "";
  const senderIp = typeof source.senderIp === "string" ? source.senderIp.trim() : "";
  const body = typeof source.body === "string" ? source.body.trim() : "";
  const createdAt = typeof source.createdAt === "string" ? source.createdAt : "";

  if (
    messageId === ""
    || threadId === ""
    || method === ""
    || subject === ""
    || senderName === ""
    || senderUserId.length !== 8
    || body === ""
    || createdAt === ""
  ) {
    return null;
  }

  return {
    messageId,
    threadId,
    parentMessageId,
    messageType,
    messageMeta,
    method,
    subject,
    senderName,
    senderUserId,
    senderIp,
    body,
    createdAt,
  };
}

function normalizeMailboxFilterSetting(rawValue: unknown): MailboxFilterSetting {
  const source = rawValue && typeof rawValue === "object"
    ? (rawValue as Partial<MailboxFilterSetting>)
    : {};

  return {
    unresolvedOnly: Boolean(source.unresolvedOnly),
    unreadOnly: Boolean(source.unreadOnly),
  };
}

function normalizeGenericMessages(rawValue: unknown): GenericMessage[] {
  if (!Array.isArray(rawValue)) {
    return [];
  }

  return rawValue
    .map((item) => normalizeGenericMessage(item))
    .filter((item): item is GenericMessage => item !== null)
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
}

function isValidSenderUserId(value: string): boolean {
  return /^\d{8}$/.test(value.trim());
}

function isValidIpv4(value: string): boolean {
  const trimmed = value.trim();
  const parts = trimmed.split(".");
  if (parts.length !== 4) {
    return false;
  }

  return parts.every((part) => {
    if (!/^\d+$/.test(part)) {
      return false;
    }
    const num = Number(part);
    return Number.isInteger(num) && num >= 0 && num <= 255;
  });
}

function splitIpv4List(value: string): string[] {
  return value
    .split(/[\s,;\n\r]+/)
    .map((item) => item.trim())
    .filter((item) => item !== "");
}

function isValidIpv4List(value: string): boolean {
  const values = splitIpv4List(value);
  return values.length > 0 && values.every((item) => isValidIpv4(item));
}

function generateRandomSenderUserId(): string {
  const array = new Uint32Array(1);
  window.crypto.getRandomValues(array);
  const value = 10_000_000 + (array[0] % 90_000_000);
  return String(value);
}

function getMailboxMethodLabel(method: string): string {
  const normalized = method.trim().toLowerCase();
  if (normalized === "generic") {
    return "汎用";
  }
  if (normalized === "call_player") {
    return "プレイヤー呼び出し";
  }
  return normalized === "" ? "不明" : normalized;
}

function buildScopedMessageMeta(
  baseMeta: Record<string, unknown> | null,
  scope: MessageScope | null,
): Record<string, unknown> | null {
  const merged: Record<string, unknown> = { ...(baseMeta ?? {}) };

  if (scope) {
    merged.scopeTournamentId = scope.tournamentId;
    merged.scopeSlug = scope.slug;
    merged.scopeEventId = scope.eventId;
  }

  return Object.keys(merged).length > 0 ? merged : null;
}

function isMessageForScope(message: GenericMessage, scope: MessageScope | null): boolean {
  if (!scope) {
    return true;
  }

  const meta = message.messageMeta;
  if (!meta || typeof meta !== "object") {
    return true;
  }

  const source = meta as Record<string, unknown>;
  const scopeTournamentId = typeof source.scopeTournamentId === "string" ? source.scopeTournamentId.trim() : "";
  const scopeSlug = typeof source.scopeSlug === "string" ? source.scopeSlug.trim() : "";
  const scopeEventId = typeof source.scopeEventId === "string" ? source.scopeEventId.trim() : "";

  if (
    scopeEventId !== ""
    && scopeEventId === scope.eventId
    && (scopeTournamentId === "" || scopeTournamentId === scope.tournamentId)
    && (scopeSlug === "" || scopeSlug === scope.slug)
  ) {
    return true;
  }

  const legacyTournamentId = typeof source.tournamentId === "string" ? source.tournamentId.trim() : "";
  const legacyEventId = typeof source.eventId === "string" ? source.eventId.trim() : "";

  if (legacyEventId !== "" && legacyEventId === scope.eventId) {
    return legacyTournamentId === "" || legacyTournamentId === scope.tournamentId;
  }

  return true;
}

function normalizePlayerId(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, "");
}

function isLikelyPlayerId(value: string): boolean {
  return /^PG-[A-Z2-7]+$/.test(normalizePlayerId(value));
}

function extractMetaString(meta: Record<string, unknown> | null, key: string): string {
  if (!meta) {
    return "";
  }

  const value = meta[key];
  return typeof value === "string" ? value.trim() : "";
}

function extractCallThreadIdentity(rootMessage: GenericMessage | null): CallThreadIdentity | null {
  if (!rootMessage || rootMessage.method !== "call_player") {
    return null;
  }

  const expectedPlayerId = normalizePlayerId(extractMetaString(rootMessage.messageMeta, "playerId"));
  const callEntrantId = extractMetaString(rootMessage.messageMeta, "callEntrantId");
  const callEntrantName = extractMetaString(rootMessage.messageMeta, "callEntrantName");
  const setId = extractMetaString(rootMessage.messageMeta, "setId");

  if (expectedPlayerId === "" || callEntrantId === "" || setId === "") {
    return null;
  }

  return {
    expectedPlayerId,
    callEntrantId,
    callEntrantName,
    setId,
  };
}

function extractPlayerIdFromQrRawValue(rawValue: string): string {
  const trimmed = rawValue.trim();
  if (trimmed === "") {
    return "";
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed && typeof parsed === "object") {
      const maybePlayerId = (parsed as { playerId?: unknown }).playerId;
      if (typeof maybePlayerId === "string") {
        return normalizePlayerId(maybePlayerId);
      }
    }
  } catch {
    // Non-JSON payload is allowed.
  }

  return normalizePlayerId(trimmed);
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

function extractPlayerIdFromBarcodeResults(results: Array<{ rawValue?: string }>): string {
  for (const result of results) {
    const rawValue = typeof result.rawValue === "string" ? result.rawValue : "";
    const playerId = extractPlayerIdFromQrRawValue(rawValue);
    if (isLikelyPlayerId(playerId)) {
      return playerId;
    }
  }

  return "";
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

function emptyCategorySelections(): string[][] {
  return Array.from({ length: MAX_CATEGORY_SLOTS }, () => [] as string[]);
}

const ITEM_LIST_STORAGE_KEY = "savakan-gg.item-lists.v1";
const EVENT_MGMT_STORAGE_KEY = "savakan-gg.event-mgmt.v1";
const SENDER_PROFILE_STORAGE_KEY = "savakan-gg.sender-profile.v1";
const GENERIC_MESSAGE_STORAGE_KEY = "savakan-gg.generic-messages.v1";
const MAILBOX_FILTER_STORAGE_KEY = "savakan-gg.mailbox-filter.v1";
const MAILBOX_READ_IDS_STORAGE_KEY = "savakan-gg.mailbox-read-ids.v1";

const APP_TABS: Array<{ id: AppTab; label: string; icon: string; implemented: boolean }> = [
  { id: "create", label: "新規作成", icon: "➕", implemented: true },
  { id: "home", label: "大会一覧", icon: "🏠", implemented: true },
  { id: "tournament", label: "大会管理", icon: "⚙", implemented: true },
  { id: "bracket", label: "ブラケット", icon: "🏆", implemented: true },
  { id: "item-list", label: "アイテムリスト", icon: "📚", implemented: true },
  { id: "message", label: "メッセージ", icon: "💬", implemented: true },
  { id: "users", label: "プレイヤーリスト", icon: "👥", implemented: true },
  { id: "settings", label: "設定", icon: "🔧", implemented: true },
];

function parseLinesToUniqueList(value: string): string[] {
  const seen = new Set<string>();
  const items: string[] = [];
  for (const line of value.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "" || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    items.push(trimmed);
  }
  return items;
}

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

function isMatchupReady(set: SetSnapshot): boolean {
  if (set.slots.length < 2) {
    return false;
  }

  return set.slots.every((slot) => slot.entrantId !== null && slot.entrantName !== "TBD");
}

function isStandbySet(set: SetSnapshot): boolean {
  return set.state === 1;
}

function isLosersBracketSet(set: SetSnapshot): boolean {
  if (set.round !== null && set.round < 0) {
    return true;
  }

  const roundText = set.fullRoundText.toLowerCase();
  return roundText.includes("losers") || roundText.includes("loser") || roundText.includes("敗者");
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

function isConfirmedSetResult(result: LocalSetResultMeta): boolean {
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
  const normalized = value.trim().replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, "-");
  return normalized === "" ? "untitled" : normalized;
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
    const drafts: SetScoreDraft = {};
    for (const slot of slotScores) {
      drafts[slot.entrantId] = slot.score < 0 ? "-" : formatDraftScoreValue(slot.score);
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
  const slotScores: Array<{ entrantId: string; score: number }> = [];

  for (const slot of set.slots) {
    if (!slot.entrantId) {
      continue;
    }

    const parsed = parseDraftScoreValue(drafts[slot.entrantId] ?? "");
    if (parsed === null) {
      throw new Error(`スコアが未入力です: ${slot.entrantName}`);
    }

    slotScores.push({
      entrantId: slot.entrantId,
      score: parsed,
    });
  }

  if (slotScores.length < 2) {
    throw new Error("結果入力には少なくとも2人のプレイヤーが必要です。");
  }

  return slotScores;
}

function App() {
  const [activeTab, setActiveTab] = useState<AppTab>("home");
  const [token, setToken] = useState("");
  const [slug, setSlug] = useState("");
  const [perPage, setPerPage] = useState("50");
  const [createPreview, setCreatePreview] = useState<TournamentPreview | null>(null);
  const [createPreviewLoadFailed, setCreatePreviewLoadFailed] = useState(false);
  const [createSelectedEventId, setCreateSelectedEventId] = useState("");
  const [createEventSlugInput, setCreateEventSlugInput] = useState("");
  const [createEventAlias, setCreateEventAlias] = useState("");
  const [createBusy, setCreateBusy] = useState(false);
  const [workspace, setWorkspace] = useState<TournamentWorkspace | null>(null);
  const [selectedEventId, setSelectedEventId] = useState("");
  const [selectedPhaseName, setSelectedPhaseName] = useState("");
  const [selectedPhasePoolKey, setSelectedPhasePoolKey] = useState("");
  const [activeMatchSetId, setActiveMatchSetId] = useState("");
  const [setId, setSetId] = useState("");
  const [scoreDrafts, setScoreDrafts] = useState<SetScoreDraft>({});
  const [activeMatchSideDrafts, setActiveMatchSideDrafts] = useState<Record<string, PlaySide | "">>({});
  const [setResultDrafts, setSetResultDrafts] = useState<Record<string, SetResultDraftState>>({});
  const [batchConflictDialog, setBatchConflictDialog] = useState<BatchConflictDialogState | null>(null);
  const [batchForceOverwriteRemaining, setBatchForceOverwriteRemaining] = useState(false);
  const [metaDrafts, setMetaDrafts] = useState<Record<string, PlayerMetaDraft>>({});
  const [localSnapshotEvents, setLocalSnapshotEvents] = useState<LocalSnapshotEventListItem[]>([]);
  const [loadingLocalSnapshotEvents, setLoadingLocalSnapshotEvents] = useState(false);
  const [deletingSnapshotKey, setDeletingSnapshotKey] = useState("");
  const [itemLists, setItemLists] = useState<ItemListConfig[]>([]);
  const [itemListsReady, setItemListsReady] = useState(false);
  const [editingItemListId, setEditingItemListId] = useState<string | null>(null);
  const [itemListName, setItemListName] = useState("");
  const [itemCategoryName, setItemCategoryName] = useState("");
  const [itemListText, setItemListText] = useState("");
  const [eventMgmtSettings, setEventMgmtSettings] = useState<Record<string, EventManagementSetting>>({});
  const [eventMgmtSettingsReady, setEventMgmtSettingsReady] = useState(false);
  const [senderProfile, setSenderProfile] = useState<SenderProfile>({ senderName: "", senderUserId: "", bindIp: "0.0.0.0", broadcastSubnetMask: "255.255.255.0" });
  const [senderProfileReady, setSenderProfileReady] = useState(false);
  const [senderNameDraft, setSenderNameDraft] = useState("");
  const [senderUserIdDraft, setSenderUserIdDraft] = useState("");
  const [senderBindIpDraft, setSenderBindIpDraft] = useState("0.0.0.0");
  const [senderBroadcastSubnetMaskDraft, setSenderBroadcastSubnetMaskDraft] = useState("255.255.255.0");
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
  const [mailboxServiceStarted, setMailboxServiceStarted] = useState(false);
  const [callingEntrantId, setCallingEntrantId] = useState("");
  const [composeMessageMeta, setComposeMessageMeta] = useState<Record<string, unknown> | null>(null);
  const [mailboxFilterSetting, setMailboxFilterSetting] = useState<MailboxFilterSetting>({
    unresolvedOnly: false,
    unreadOnly: false,
  });
  const [mailboxReadMessageIds, setMailboxReadMessageIds] = useState<string[]>([]);
  const [sideDecisionMethod, setSideDecisionMethod] = useState<EventManagementSetting["sideDecisionMethod"]>("upper_1p");
  const [matchSideRandomNotice, setMatchSideRandomNotice] = useState<MatchSideRandomNotice | null>(null);
  const [categorySlotListIds, setCategorySlotListIds] = useState<string[]>(["", "", ""]);
  const [categorySlotMinCounts, setCategorySlotMinCounts] = useState<number[]>([0, 0, 0]);
  const [categorySlotMaxCounts, setCategorySlotMaxCounts] = useState<number[]>([1, 1, 1]);
  const [categorySlotAllowDuplicates, setCategorySlotAllowDuplicates] = useState<boolean[]>([false, false, false]);
  const [totalItemMinCount, setTotalItemMinCount] = useState(0);
  const [totalItemMaxCount, setTotalItemMaxCount] = useState(3);
  const [selectedTournamentEntrantId, setSelectedTournamentEntrantId] = useState("");
  const [userCardPlayers, setUserCardPlayers] = useState<UserCardPlayer[]>([]);
  const [selectedUserCardPlayerId, setSelectedUserCardPlayerId] = useState("");
  const [selectedUserCardPreviewUrl, setSelectedUserCardPreviewUrl] = useState("");
  const [userCardBusy, setUserCardBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const autoAssigningSidesRef = useRef(false);
  const standbyReadinessRef = useRef<Record<string, boolean>>({});
  const startupSavedSlugRef = useRef("");
  const startupSavedEventIdRef = useRef("");
  const startupRestoreReadyRef = useRef(false);
  const localSnapshotEventsLoadedOnceRef = useRef(false);
  const startupAutoRestoreDoneRef = useRef(false);
  const startupDirectRestoreTriedRef = useRef(false);
  const startupListRestoreRetryCountRef = useRef(0);
  const lastPersistedSnapshotSelectionRef = useRef("");
  const eventSettingHydratedKeyRef = useRef("");
  const suppressEventSettingAutosaveRef = useRef(false);
  const autoIpFillTriedRef = useRef(false);
  const tabSelectionAutoLoadInFlightRef = useRef(false);
  const dqCameraVideoRef = useRef<HTMLVideoElement | null>(null);
  const dqCameraStreamRef = useRef<MediaStream | null>(null);
  const dqCameraScanTimerRef = useRef<number | null>(null);
  const dqCameraDetectingRef = useRef(false);
  const dqCameraDetectorRef = useRef<{
    detect: (source: CanvasImageSource) => Promise<Array<{ rawValue?: string }>>;
  } | null>(null);

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        const savedToken = await invoke<string | null>("load_saved_startgg_token");
        if (alive && savedToken && savedToken.trim() !== "") {
          setToken(savedToken);
        }

        const savedSelection = await invoke<{ slug: string; eventId: string } | null>(
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
          startupSavedSlugRef.current = savedSlug;
          startupSavedEventIdRef.current = savedEventId;
          setSelectedEventId(savedEventId);
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
  }, []);

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
  }, [senderProfile, senderProfileReady]);

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
            if (current.length === normalized.length && current[0]?.messageId === normalized[0]?.messageId) {
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

    if (
      createSelectedEventId !== "" &&
      createPreview.events.some((event) => event.eventId === createSelectedEventId)
    ) {
      return;
    }

    setCreateSelectedEventId(createPreview.events[0]?.eventId ?? "");
  }, [createPreview, createSelectedEventId]);

  const snapshot = workspace?.snapshot ?? null;
  const localMeta = workspace?.localMeta ?? null;
  const setPlaySides = localMeta?.setPlaySides ?? [];
  const pendingSetResults = localMeta?.pendingSetResults ?? [];
  const confirmedSetResults = pendingSetResults.filter((result) => isConfirmedSetResult(result));
  const draftSetResults = pendingSetResults.filter((result) => !isConfirmedSetResult(result));

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
      event.sets.map((set) => ({ eventName: event.name, set })),
    );
  }, [snapshot]);

  const selectedEvent = useMemo(() => {
    if (!snapshot || snapshot.events.length === 0) {
      return null;
    }

    if (selectedEventId === "") {
      return snapshot.events[0];
    }

    return snapshot.events.find((event) => event.eventId === selectedEventId) ?? snapshot.events[0];
  }, [snapshot, selectedEventId]);

  const selectedEventMeta = useMemo(() => {
    if (!localMeta || !selectedEvent) {
      return null;
    }

    return localMeta.events.find((event) => event.eventId === selectedEvent.eventId) ?? null;
  }, [localMeta, selectedEvent]);

  const selectedMessageScope = useMemo<MessageScope | null>(() => {
    if (!snapshot || !selectedEvent) {
      return null;
    }

    return {
      tournamentId: snapshot.tournamentId,
      slug: snapshot.slug,
      eventId: selectedEvent.eventId,
    };
  }, [selectedEvent, snapshot]);

  const scopedGenericMessages = useMemo(() => {
    return genericMessages.filter((message) => isMessageForScope(message, selectedMessageScope));
  }, [genericMessages, selectedMessageScope]);

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

    const selectionKey = `${toSlugInput(snapshot.slug)}::${selectedEvent.eventId.trim()}`;
    if (selectionKey === "::" || selectionKey === lastPersistedSnapshotSelectionRef.current) {
      return;
    }

    lastPersistedSnapshotSelectionRef.current = selectionKey;
    void invoke("save_last_snapshot_selection", {
      slug: snapshot.slug,
      eventId: selectedEvent.eventId,
    }).catch((err) => {
      lastPersistedSnapshotSelectionRef.current = "";
      setError(String(err));
    });
  }, [selectedEvent, snapshot]);

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
  const eventSeedStatusByKey = useMemo(() => {
    const map = new Map<string, EventSeedStatus>();

    if (!snapshot) {
      return map;
    }

    for (const event of snapshot.events) {
      const byEntrantId = new Map<string, number | null>();

      for (const set of event.sets) {
        for (const slot of set.slots) {
          if (!slot.entrantId) {
            continue;
          }

          const current = byEntrantId.get(slot.entrantId);
          const normalizedSeedNum = typeof slot.seedNum === "number" ? slot.seedNum : null;

          if (current === undefined) {
            byEntrantId.set(slot.entrantId, normalizedSeedNum);
            continue;
          }

          if (current === null && normalizedSeedNum !== null) {
            byEntrantId.set(slot.entrantId, normalizedSeedNum);
          }
        }
      }

      const totalEntrants = byEntrantId.size;
      const missingSeedEntrants = [...byEntrantId.values()].filter((seedNum) => seedNum === null).length;

      map.set(`${snapshot.slug}:${event.eventId}`, {
        totalEntrants,
        missingSeedEntrants,
      });
    }

    return map;
  }, [snapshot]);

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
  const selectedEventSeedStatus = useMemo(() => {
    if (!snapshot || !selectedEvent) {
      return null;
    }

    return eventSeedStatusByKey.get(`${snapshot.slug}:${selectedEvent.eventId}`) ?? null;
  }, [eventSeedStatusByKey, selectedEvent, snapshot]);

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
      for (const messageId of incomingIds) {
        next.add(messageId);
      }
      return [...next];
    });
  }, [activeTab, activeThread, activeThreadMessages, senderProfile.senderUserId]);

  const normalizedSenderNameDraft = senderNameDraft.trim();
  const normalizedSenderUserIdDraft = senderUserIdDraft.replace(/\D/g, "").slice(0, 8);
  const normalizedSenderBindIpDraft = senderBindIpDraft.trim();
  const normalizedBroadcastSubnetMaskDraft = senderBroadcastSubnetMaskDraft.trim();
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

  const canSaveSenderProfile = normalizedSenderNameDraft !== ""
    && isValidSenderUserId(normalizedSenderUserIdDraft)
    && isValidIpv4(normalizedSenderBindIpDraft)
    && isValidIpv4(normalizedBroadcastSubnetMaskDraft)
    && !senderIdCollision;

  const canSendGenericMessage = senderProfile.senderName.trim() !== ""
    && isValidSenderUserId(senderProfile.senderUserId)
    && isValidIpv4(senderProfile.bindIp)
    && isValidIpv4(senderProfile.broadcastSubnetMask)
    && normalizedMailboxMethod !== ""
    && normalizedMailboxSubject !== ""
    && composedMessageBody !== ""
    && (messageDeliveryMode === "broadcast" || isValidIpv4List(normalizedMessageDeliveryIp));

  const canReplyToThread = !!activeThread
    && senderProfile.senderName.trim() !== ""
    && isValidSenderUserId(senderProfile.senderUserId)
    && isValidIpv4(senderProfile.bindIp)
    && normalizedReplyBody !== "";

  const activeCallThreadIdentity = useMemo(() => extractCallThreadIdentity(activeThread), [activeThread]);
  const canOpenDqDialog = !!activeThread
    && !activeThreadResolved
    && !!activeCallThreadIdentity;

  function fillRandomSenderUserId() {
    const usedIds = new Set(genericMessages.map((item) => item.senderUserId));
    let nextId = generateRandomSenderUserId();

    for (let retry = 0; retry < 40 && usedIds.has(nextId); retry += 1) {
      nextId = generateRandomSenderUserId();
    }

    setSenderUserIdDraft(nextId);
  }

  function saveSenderProfileSettings() {
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

    if (!isValidIpv4(normalizedBroadcastSubnetMaskDraft)) {
      setError("ブロードキャスト用サブネットマスクはIPv4形式で入力してください。例: 255.255.255.0");
      return;
    }

    if (senderIdCollision) {
      setError("既存メッセージ内で同じユーザーIDが別名義に使われています。別のIDを設定してください。");
      return;
    }

    const nextProfile: SenderProfile = {
      senderName: normalizedSenderNameDraft,
      senderUserId: normalizedSenderUserIdDraft,
      bindIp: normalizedSenderBindIpDraft,
      broadcastSubnetMask: normalizedBroadcastSubnetMaskDraft,
    };

    setSenderProfile(nextProfile);
    setMessage(`送信者設定を保存しました: ${nextProfile.senderName} (${nextProfile.senderUserId}) @ ${nextProfile.bindIp}`);
  }

  async function postGenericMessage() {
    setError("");
    setMessage("");

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
          const next = [normalized, ...current.filter((item) => item.messageId !== normalized.messageId)];
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

    if (!activeThread) {
      setError("返信先スレッドを選択してください。");
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
          const next = [normalized, ...current.filter((item) => item.messageId !== normalized.messageId)];
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

    if (!activeThread || !activeCallThreadIdentity) {
      setError("プレイヤー呼び出しスレッドを選択してください。");
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
    if (dqCameraScanTimerRef.current !== null) {
      window.clearInterval(dqCameraScanTimerRef.current);
      dqCameraScanTimerRef.current = null;
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

    const detector = createQrBarcodeDetector();
    if (!detector) {
      setDqDialogError("この環境ではカメラ2次元コード読取に対応していません。PLAYER IDを手入力してください。");
      return;
    }

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

      video.srcObject = stream;
      await video.play();
      setDqCameraActive(true);

      dqCameraScanTimerRef.current = window.setInterval(() => {
        void (async () => {
          if (!dqCameraDetectorRef.current || !dqCameraVideoRef.current || dqCameraDetectingRef.current) {
            return;
          }
          if (dqCameraVideoRef.current.readyState < 2) {
            return;
          }

          dqCameraDetectingRef.current = true;
          try {
            const results = await dqCameraDetectorRef.current.detect(dqCameraVideoRef.current);
            const playerId = extractPlayerIdFromBarcodeResults(results);
            if (playerId !== "") {
              setDqPlayerIdDraft(playerId);
              setMessage("カメラでPLAYER IDを読み取りました。");
              stopDqCameraScan();
            }
          } catch {
            // ignore transient detection failures
          } finally {
            dqCameraDetectingRef.current = false;
          }
        })();
      }, 400);
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
          const next = [normalized, ...current.filter((item) => item.messageId !== normalized.messageId)];
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
          const next = [normalized, ...current.filter((item) => item.messageId !== normalized.messageId)];
          return next.sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
        });
      }

      setMessage("解決メッセージを送信しました。スレッドは完了扱いになります。");
    } catch (err) {
      setError(String(err));
    }
  }

  function deleteActiveThread() {
    if (!activeThread) {
      setError("削除するスレッドを選択してください。");
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

  async function sendCallMessageFromMatch(slot: SetSlot, entrantId: string) {
    setError("");
    setMessage("");

    if (!snapshot || !selectedEvent || !activeMatch) {
      setError("呼び出し元の試合情報が見つかりません。もう一度試してください。");
      return;
    }

    setCallingEntrantId(entrantId);

    try {
      const playerId = await deriveEncryptedPlayerId(snapshot.tournamentId, selectedEvent.eventId, entrantId);
      const eventAlias = selectedEventMeta?.eventAlias?.trim() || selectedEvent.name;
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
      ].join("\n");

      setComposeMessageMeta({
        callId: `${snapshot.tournamentId}:${selectedEvent.eventId}:${activeMatch.setId}:${entrantId}`,
        playerId,
        callEntrantId: entrantId,
        callEntrantName: slot.entrantName,
        tournamentId: snapshot.tournamentId,
        tournamentName: snapshot.name,
        eventId: selectedEvent.eventId,
        eventName: selectedEvent.name,
        eventAlias,
        setId: activeMatch.setId,
      });
      setMailboxMethodDraft("call_player");
      setMailboxSubjectDraft(`${slot.entrantName}(${eventAlias})`);
      setComposeFixedBodyDraft(fixedBody);
      setGenericMessageBodyDraft("");
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
    if (!selectedUserCardPlayer) {
      setError("保存するプレイヤーカードがありません。");
      return;
    }

    setUserCardBusy(true);
    setError("");
    setMessage("");

    try {
      const canvas = await renderPlayerCardCanvas(selectedUserCardPlayer);
      const blob = await canvasToBlob(canvas);
      const fileName = `${sanitizeFileSegment(selectedUserCardPlayer.eventName)}-${sanitizeFileSegment(selectedUserCardPlayer.entrantName)}-${selectedUserCardPlayer.playerId}.png`;
      triggerBlobDownload(blob, fileName);
      setMessage(`プレイヤーカードを保存しました: ${selectedUserCardPlayer.entrantName}`);
    } catch (err) {
      setError(String(err));
    } finally {
      setUserCardBusy(false);
    }
  }

  async function exportAllPlayerCardsAsA4Pages() {
    if (userCardPlayers.length === 0) {
      setError("出力対象のプレイヤーがいません。");
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
      const totalPages = Math.ceil(userCardPlayers.length / USER_CARD_PAGE_SIZE);

      for (let page = 0; page < totalPages; page += 1) {
        const pagePlayers = userCardPlayers.slice(page * USER_CARD_PAGE_SIZE, (page + 1) * USER_CARD_PAGE_SIZE);
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
        const fileName = `${sanitizeFileSegment(selectedEvent?.name ?? "event")}-player-cards-a4-${String(page + 1).padStart(2, "0")}.png`;
        triggerBlobDownload(blob, fileName);
      }

      setMessage(`A4画像を出力しました。全 ${totalPages} ページ / 1ページ最大 ${USER_CARD_PAGE_SIZE} 人です。`);
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

        next[key] = {
          playSide: existingMeta?.playSide ?? "",
          categorySelections,
        };
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
  }, [eventMgmtSettings, selectedEventMeta, selectedEventSettingKey]);

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
    if (!selectedEvent) {
      standbyReadinessRef.current = {};
      return;
    }

    if (autoAssigningSidesRef.current) {
      return;
    }

    const prevReadiness = standbyReadinessRef.current;
    const nextReadiness: Record<string, boolean> = {};
    const updates: Array<{ setSnapshot: SetSnapshot; entrantId: string; side: PlaySide }> = [];

    for (const set of selectedEvent.sets) {
      const isReadyStandby = isStandbySet(set) && isMatchupReady(set);
      nextReadiness[set.setId] = isReadyStandby;

      const wasReadyStandby = prevReadiness[set.setId] ?? false;
      if (!isReadyStandby || wasReadyStandby) {
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

      const upperCurrent = getSetSlotSide(set.setId, upperId);
      const lowerCurrent = getSetSlotSide(set.setId, lowerId);
      let upperSide = upperCurrent;
      let lowerSide = lowerCurrent;

      if (upperSide !== "" && lowerSide !== "") {
        continue;
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

      if (upperCurrent !== upperSide) {
        updates.push({ setSnapshot: set, entrantId: upperId, side: upperSide });
      }
      if (lowerCurrent !== lowerSide) {
        updates.push({ setSnapshot: set, entrantId: lowerId, side: lowerSide });
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
          await saveSetPlaySide(selectedEvent, update.setSnapshot, update.entrantId, update.side, {
            silent: true,
            manageBusy: false,
          });
        }
      } finally {
        autoAssigningSidesRef.current = false;
      }
    })();
  }, [selectedEvent, setPlaySideMap, sideDecisionMethod, eventMgmtSettings, selectedEventSettingKey]);

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
    setCategorySlotListIds((current) => current.map((id) => (id === itemListId ? "" : id)));
    setCategorySlotMinCounts((current) => current.map((value, index) => (categorySlotListIds[index] === itemListId ? 0 : value)));
    setCategorySlotMaxCounts((current) => current.map((value, index) => (categorySlotListIds[index] === itemListId ? 0 : value)));
    setCategorySlotAllowDuplicates((current) => current.map((value, index) => (categorySlotListIds[index] === itemListId ? false : value)));
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
      setMessage("大会管理設定を保存しました。アイテム選択設定が変わった場合、既存のプレイヤー選択はクリアされます。");
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  function formatScoreValue(value: number): string {
    return Number.isInteger(value) ? String(value) : value.toFixed(1);
  }

  const phasePoolGroups = useMemo(() => {
    if (!selectedEvent) {
      return [] as PhasePoolGroup[];
    }

    const groupMap = new Map<string, { key: string; phaseName: string; phaseGroupName: string; sets: SetSnapshot[] }>();

    for (const set of selectedEvent.sets) {
      const phaseName = set.phaseName && set.phaseName.trim() !== "" ? set.phaseName : "Phase 未設定";
      const phaseGroupName =
        set.phaseGroupName && set.phaseGroupName.trim() !== "" ? set.phaseGroupName : "Pool 未設定";
      const groupKey = `${phaseName}::${phaseGroupName}`;
      const found = groupMap.get(groupKey);

      if (found) {
        found.sets.push(set);
        continue;
      }

      groupMap.set(groupKey, {
        key: groupKey,
        phaseName,
        phaseGroupName,
        sets: [set],
      });
    }

    return [...groupMap.values()]
      .sort((a, b) => {
        const byPhase = a.phaseName.localeCompare(b.phaseName, "ja");
        if (byPhase !== 0) {
          return byPhase;
        }
        return a.phaseGroupName.localeCompare(b.phaseGroupName, "ja");
      })
      .map((group) => ({
        key: group.key,
        phaseName: group.phaseName,
        phaseGroupName: group.phaseGroupName,
        sets: group.sets,
        columns: buildRoundColumns(group.sets),
      }));
  }, [selectedEvent]);

  const phaseNames = useMemo(() => {
    const seen = new Set<string>();
    const names: string[] = [];

    for (const group of phasePoolGroups) {
      if (seen.has(group.phaseName)) {
        continue;
      }
      seen.add(group.phaseName);
      names.push(group.phaseName);
    }

    return names;
  }, [phasePoolGroups]);

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

    return selectedPhasePoolGroup.sets.find((set) => set.setId === activeMatchSetId) ?? null;
  }, [selectedPhasePoolGroup, activeMatchSetId]);

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

  const pendingResultBySetId = useMemo(() => {
    const map = new Map<string, LocalSetResultMeta>();
    for (const pending of pendingSetResults) {
      map.set(pending.setId, pending);
    }
    return map;
  }, [pendingSetResults]);

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

    const exists = snapshot.events.some((event) => event.eventId === selectedEventId);
    if (!exists) {
      setSelectedEventId(snapshot.events[0].eventId);
    }
  }, [snapshot, selectedEventId]);

  async function saveToken(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");

    try {
      await invoke("save_startgg_token", { token });
      setMessage("start.ggトークンを保存しました。");
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  async function loadCreatePreview(e?: FormEvent) {
    e?.preventDefault();

    const apiSlug = toApiSlug(slug);
    if (apiSlug === "") {
      setError("大会IDを入力してください。");
      return;
    }

    setCreateBusy(true);
    setError("");
    setMessage("");
    setCreatePreview(null);
    setCreatePreviewLoadFailed(false);
    setCreateSelectedEventId("");

    try {
      await invoke("save_startgg_token", { token });
      const preview = await invoke<TournamentPreview>("preview_tournament", {
        slug: apiSlug,
      });
      setCreatePreview(preview);
      setCreateSelectedEventId((current) => {
        if (current !== "" && preview.events.some((event) => event.eventId === current)) {
          return current;
        }
        return preview.events[0]?.eventId ?? "";
      });
      setMessage("tournamentのイベント一覧を取得しました。");
    } catch (err) {
      setCreatePreviewLoadFailed(true);
      setError(String(err));
    } finally {
      setCreateBusy(false);
    }
  }

  async function createEventSnapshot() {
    const eventId = createSelectedEventId.trim();
    const apiSlug = toApiSlug(slug);
    if (apiSlug === "" || eventId === "") {
      setError("大会IDとeventを選択してください。");
      return;
    }

    setCreateBusy(true);
    setError("");
    setMessage("");

    try {
      await invoke("save_startgg_token", { token });
      await invoke("save_last_slug", { slug: apiSlug });
      const result = await invoke<TournamentWorkspace>("create_event_snapshot", {
        input: {
          slug: apiSlug,
          eventId,
          eventSlug:
            createPreview?.events.find((event) => event.eventId === eventId)?.eventSlug ?? null,
          eventAlias: createEventAlias.trim() === "" ? null : createEventAlias.trim(),
          perPage: Number(perPage),
        },
      });

      setWorkspace(result);
      await refreshLocalSnapshotEvents();
      setActiveTab("home");
      setMessage("イベントのローカルスナップショットを作成しました。");
    } catch (err) {
      setError(String(err));
    } finally {
      setCreateBusy(false);
    }
  }

  async function createEventSnapshotBySlug() {
    const tournamentSlug = toApiSlug(slug);
    const eventSlug = toEventApiSlug(slug, createEventSlugInput);
    if (tournamentSlug === "" || eventSlug === "") {
      setError("大会IDとevent ID(またはevent slug)を入力してください。");
      return;
    }

    setCreateBusy(true);
    setError("");
    setMessage("");

    try {
      await invoke("save_startgg_token", { token });
      await invoke("save_last_slug", { slug: tournamentSlug });

      const result = await invoke<TournamentWorkspace>("create_event_snapshot_by_slug", {
        input: {
          tournamentSlug,
          eventSlug,
          eventAlias: createEventAlias.trim() === "" ? null : createEventAlias.trim(),
          perPage: Number(perPage),
        },
      });

      setWorkspace(result);
      await refreshLocalSnapshotEvents();
      setActiveTab("home");
      setMessage("直接指定したeventのローカルスナップショットを作成しました。");
    } catch (err) {
      setError(String(err));
    } finally {
      setCreateBusy(false);
    }
  }

  async function refreshLocalSnapshotEvents() {
    setLoadingLocalSnapshotEvents(true);

    try {
      const items = await invoke<LocalSnapshotEventListItem[]>("list_local_snapshot_events");
      setLocalSnapshotEvents(items);
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

    try {
      await invoke("save_last_slug", { slug: item.slug });
      await invoke("save_last_snapshot_selection", {
        slug: item.slug,
        eventId: item.eventId,
      });
      const result = await invoke<TournamentWorkspace>("load_local_tournament_workspace", {
        slug: item.slug,
        eventId: item.eventId,
      });

      setSlug(toSlugInput(item.slug));
      setSelectedEventId(item.eventId);
      setWorkspace(result);
      closeMatchDialog();
      setMessage(`イベントを読み込みました: ${item.tournamentName} / ${item.eventName}`);
    } catch (err) {
      setError(String(err));
    } finally {
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

    try {
      const result = await invoke<TournamentWorkspace>("refresh_local_event_snapshot_from_remote", {
        slug: normalizedSlug,
        eventId,
        perPage: Number(perPage),
      });
      setWorkspace(result);
      closeMatchDialog();
      await refreshLocalSnapshotEvents();
      setMessage("スナップショットを更新しました。反映済みの変更は自動で変更リストから除外されます。");
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

  function getSetSlotSideLabel(setId: string, entrantId: string | null): string {
    if (!entrantId) {
      return "-";
    }

    const side = getSetSlotSide(setId, entrantId);
    return side === "" ? "-" : side;
  }

  function getSetScoresForDisplay(set: SetSnapshot): { scores: Record<string, string>; isDq: boolean; winnerId: string | null } {
    const result = pendingResultBySetId.get(set.setId);
    if (!result) {
      const winnerId = set.winnerId;
      if (winnerId) {
        const winnerSlot = set.slots.find((slot) => slot.entrantId === winnerId);
        const loserSlot = set.slots.find((slot) => slot.entrantId !== null && slot.entrantId !== winnerId);
        const winnerScore = winnerSlot ? toIntegerScore(winnerSlot.score) : null;
        const loserScore = loserSlot ? toIntegerScore(loserSlot.score) : null;
        const loserIsDq = loserSlot ? isDqScoreValue(loserSlot.score) : false;

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

    if (slotScores.length > 0) {
      const scores: Record<string, string> = {};
      for (const slot of slotScores) {
        scores[slot.entrantId] = slot.score < 0 ? "DQ" : String(slot.score);
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

  function openMatchDialog(set: SetSnapshot, forcedDraftState?: SetResultDraftState) {
    setActiveMatchSetId(set.setId);
    setSetId(set.setId);

    const sideDrafts: Record<string, PlaySide | ""> = {};
    for (const slot of set.slots) {
      if (!slot.entrantId) {
        continue;
      }
      sideDrafts[slot.entrantId] = getSetSlotSide(set.setId, slot.entrantId);
    }
    setActiveMatchSideDrafts(sideDrafts);

    if (forcedDraftState) {
      setScoreDrafts(forcedDraftState.scoreDrafts);
      setSetResultDrafts((current) => ({
        ...current,
        [set.setId]: forcedDraftState,
      }));
      return;
    }

    const cached = setResultDrafts[set.setId];
    if (cached) {
      setScoreDrafts(cached.scoreDrafts);
      return;
    }

    const pending = pendingResultBySetId.get(set.setId);
    if (pending) {
      const draftState = buildDraftStateFromPending(set, pending);
      setScoreDrafts(draftState.scoreDrafts);
      setSetResultDrafts((current) => ({
        ...current,
        [set.setId]: draftState,
      }));
      return;
    }

    setScoreDrafts(buildScoreDraftsFromSet(set));
    setSetResultDrafts((current) => ({
      ...current,
      [set.setId]: {
        winnerId: "",
        scoreDrafts: buildScoreDraftsFromSet(set),
      },
    }));
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

    setBusy(true);
    setError("");
    setMessage("");

    try {
      const normalizedSlug = toApiSlug(slug);
      await invoke("save_last_slug", { slug: normalizedSlug });

      await saveMatchSidesIfNeeded(selectedEvent, activeMatch, activeMatchSideDrafts);

      const slotScores = buildSlotScoresForSave(activeMatch, scoreDrafts);
      let resolvedWinnerId = resolveWinnerIdFromDrafts(activeMatch, scoreDrafts);

      if (resolvedWinnerId === "") {
        setError("スコアから勝者を特定できませんでした。入力を確認してください。");
        return;
      }

      const result = await invoke<TournamentWorkspace>("save_local_set_result", {
        input: {
          slug: normalizedSlug,
          eventId: selectedEvent.eventId,
          setId,
          winnerId: resolvedWinnerId,
          confirmed,
          slotScores,
        },
      });
      setWorkspace(result);
      setSetResultDrafts((current) => ({
        ...current,
        [setId]: {
          winnerId: resolvedWinnerId,
          scoreDrafts,
        },
      }));
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

  function cancelBracketBatchConflict() {
    setBatchConflictDialog(null);
    setBatchForceOverwriteRemaining(false);
    setMessage("一括報告を中断しました。未送信のsetはそのまま残しています。");
  }

  async function runBracketBatchReport(
    progress: BatchReportProgress,
    forceOverwriteCurrentConflict: boolean,
    forceOverwriteRemainingConflicts: boolean,
  ) {
    if (!selectedEvent) {
      throw new Error("先にイベントを選択してください。");
    }

    const normalizedSlug = toApiSlug(slug);
    const result = await invoke<BracketBatchReportResult>("report_confirmed_sets_from_bracket", {
      input: {
        slug: normalizedSlug,
        eventId: selectedEvent.eventId,
        perPage: Number(perPage),
        forceOverwriteCurrentConflict,
        forceOverwriteRemainingConflicts,
      },
    });

    setWorkspace(result.workspace);
    closeMatchDialog();

    const nextProgress: BatchReportProgress = {
      totalCount: progress.totalCount,
      reportedCount: progress.reportedCount + result.reportedCount,
      skippedCount: progress.skippedCount + result.skippedCount,
    };

    if (result.completed) {
      setBatchConflictDialog(null);
      setBatchForceOverwriteRemaining(false);
      setMessage(
        `一括報告を実行しました。対象 ${nextProgress.totalCount} 件 / 送信 ${nextProgress.reportedCount} 件 / スキップ ${nextProgress.skippedCount} 件`,
      );
      return;
    }

    if (result.conflict) {
      setBatchConflictDialog({
        conflict: result.conflict,
        progress: nextProgress,
      });
      setMessage(
        `一括報告を一時停止しました。${result.conflict.fullRoundText} で start.gg 側との競合を確認してください。`,
      );
      return;
    }

    throw new Error("一括報告の状態が不正です。競合情報を取得できませんでした。");
  }

  async function reportConfirmedSetsFromBracket() {
    if (!selectedEvent) {
      setError("先にイベントを選択してください。");
      return;
    }

    const normalizedSlug = toApiSlug(slug);
    if (normalizedSlug === "") {
      setError("大会IDを入力してください。");
      return;
    }

    setBusy(true);
    setError("");
    setMessage("");
    setBatchConflictDialog(null);
    setBatchForceOverwriteRemaining(false);

    try {
      await runBracketBatchReport(
        {
          totalCount: confirmedSetResults.length,
          reportedCount: 0,
          skippedCount: 0,
        },
        false,
        false,
      );
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  async function continueBracketBatchWithForceOverwrite() {
    if (!batchConflictDialog) {
      return;
    }

    setBusy(true);
    setError("");
    setMessage("");

    try {
      await runBracketBatchReport(
        batchConflictDialog.progress,
        true,
        batchForceOverwriteRemaining,
      );
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
          playSide: playSide === "" ? null : playSide,
        },
      });

      setWorkspace(result);
      if (!silent) {
        setMessage("setサイドを保存しました。");
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

  async function togglePlaySide(
    entrantId: string,
    targetSide: PlaySide,
  ) {
    const currentSide = activeMatchSideDrafts[entrantId] ?? "";
    const nextSide: PlaySide | "" = currentSide === targetSide ? "" : targetSide;

    setActiveMatchSideDrafts((current) => ({
      ...current,
      [entrantId]: nextSide,
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
    const slots = set.slots.filter((slot) => slot.entrantId !== null);
    for (const slot of slots) {
      const entrantId = slot.entrantId;
      if (!entrantId) {
        continue;
      }

      const side = sideDrafts[entrantId] ?? getSetSlotSide(set.setId, entrantId);
      if (side === "") {
        continue;
      }

      const current = getSetSlotSide(set.setId, entrantId);
      if (current === side) {
        continue;
      }

      await saveSetPlaySide(eventSnapshot, set, entrantId, side, {
        silent: true,
        manageBusy: false,
      });
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-head">
          <h1>savakan-gg</h1>
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
            </button>
          ))}
        </nav>
      </aside>

      <main className="content">
        <section className="hero">
          <p className="eyebrow">Tournament Workspace</p>
          <h2>{APP_TABS.find((tab) => tab.id === activeTab)?.label ?? "大会管理"}</h2>
          <p className="description">start.gg とローカル保存データを統合して運用します。</p>
        </section>

        {message !== "" && <p className="message success">{message}</p>}
        {error !== "" && <p className="message error">{error}</p>}

        {activeTab === "home" && (
          <section className="panel">
            <h2>大会一覧</h2>

            <p className="meta">ローカルスナップショット作成済みのイベントを選択します。</p>

            <div className="panel-toolbar compact">
              <p className="meta">件数: {localSnapshotEvents.length}</p>
              <button
                type="button"
                className="ghost"
                disabled={loadingLocalSnapshotEvents}
                onClick={() => void refreshLocalSnapshotEvents()}
              >
                {loadingLocalSnapshotEvents ? "更新中..." : "一覧を更新"}
              </button>
            </div>

            {loadingLocalSnapshotEvents ? (
              <p className="meta">ローカルイベント一覧を読み込んでいます...</p>
            ) : localSnapshotEvents.length === 0 ? (
              <p className="meta">保存済みイベントがありません。大会管理タブから start.gg 同期を実行してください。</p>
            ) : (
              <div className="event-list">
                {localSnapshotEvents.map((item) => {
                  const startupSelectedSlug = startupSavedSlugRef.current.trim();
                  const startupSelectedEventId = startupSavedEventIdRef.current.trim();
                  const currentSelectedSlug = snapshot?.slug?.trim() || startupSelectedSlug;
                  const currentSelectedEventId = selectedEvent?.eventId?.trim() || selectedEventId.trim() || startupSelectedEventId;
                  const isSelected =
                    currentSelectedSlug !== ""
                    && currentSelectedEventId !== ""
                    ? sameSnapshotEventKey(currentSelectedSlug, currentSelectedEventId, item.slug, item.eventId)
                    : false;
                  const seedStatus = eventSeedStatusByKey.get(`${item.slug}:${item.eventId}`) ?? null;
                  const itemKey = `${item.slug}:${item.eventId}`;
                  const isDeleting = deletingSnapshotKey === itemKey;
                  const aliasName = item.eventAlias && item.eventAlias.trim() !== ""
                    ? item.eventAlias
                    : "-";

                  return (
                    <article
                      key={`${item.slug}:${item.eventId}`}
                      className={`event-list-item ${isSelected ? "selected" : ""}`}
                      role="button"
                      tabIndex={0}
                      onClick={() => {
                        if (!isDeleting && !busy) {
                          void selectLocalSnapshotEvent(item);
                        }
                      }}
                      onDoubleClick={() => {
                        if (!isDeleting) {
                          void (async () => {
                            await selectLocalSnapshotEvent(item);
                            setActiveTab("tournament");
                          })();
                        }
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          if (!isDeleting && !busy) {
                            void selectLocalSnapshotEvent(item);
                          }
                        }
                      }}
                    >
                      <div className="event-list-head">
                        <h3>{aliasName}</h3>
                        <span className="meta">{new Date(item.updatedAt).toLocaleString()}</span>
                      </div>
                      <p className="meta">start.ggのtournament名: {item.tournamentName}</p>
                      <p className="meta">start.ggのevent名: {item.eventName}</p>
                      {seedStatus && seedStatus.totalEntrants > 0 && (
                        <p className={`meta ${seedStatus.missingSeedEntrants > 0 ? "error-text" : ""}`}>
                          {seedStatus.missingSeedEntrants > 0
                            ? `⚠ seed未設定: ${seedStatus.missingSeedEntrants}/${seedStatus.totalEntrants}`
                            : `seed設定済み: ${seedStatus.totalEntrants}/${seedStatus.totalEntrants}`}
                        </p>
                      )}
                      <button
                        type="button"
                        className="ghost"
                        disabled={busy || isDeleting}
                        onClick={(e) => {
                          e.stopPropagation();
                          void deleteLocalSnapshotEvent(item);
                        }}
                      >
                        {isDeleting ? "削除中..." : "このイベントを削除"}
                      </button>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {activeTab === "create" && (
          <>
            <section className="panel">
              <h2>1.APIキーの設定</h2>

              <form className="form" onSubmit={saveToken}>
                <input
                  value={token}
                  onChange={(e) => setToken(e.currentTarget.value)}
                  placeholder="start.gg API token"
                />
                <button type="submit" disabled={createBusy || token.trim() === ""}>
                  APIキーを保存
                </button>
              </form>
            </section>

            <section className="panel">
              <h2>2. tournamentの選択</h2>
              <div className="panel-toolbar compact">
                <p className="meta">大会IDを直接入力してイベント一覧を取得します。</p>
              </div>

              <form className="form" onSubmit={loadCreatePreview}>
                <input
                  value={slug}
                  onChange={(e) => setSlug(e.currentTarget.value)}
                  placeholder="大会ID (例: sabakan-weekly-1)"
                />
                <input
                  value={perPage}
                  onChange={(e) => setPerPage(e.currentTarget.value)}
                  placeholder="ページサイズ (例: 50)"
                />
                <p className="meta">start.ggのobject上限ではなく、取得時の1ページ件数です。通常は50のままで問題ありません。</p>
                <button type="submit" disabled={createBusy || toApiSlug(slug) === "" || token.trim() === ""}>
                  tournamentからイベント一覧を取得
                </button>
              </form>
            </section>

            <section className="panel">
              <h2>3. event一覧の表示</h2>
              {createPreviewLoadFailed ? (
                <p className="meta">イベント一覧の取得に失敗しました</p>
              ) : !createPreview ? (
                <p className="meta">先に tournament を選択してイベント一覧を取得してください。</p>
              ) : createPreview.events.length === 0 ? (
                <p className="meta">この tournament にはイベントがありません。</p>
              ) : (
                <>
                  <p className="meta">
                    {createPreview.name} / slug: {createPreview.slug} / updatedAt: {new Date(createPreview.updatedAt).toLocaleString()}
                  </p>
                  <div className="event-list">
                    {createPreview.events.map((event) => (
                      <article
                        key={event.eventId}
                        className={`event-list-item ${createSelectedEventId === event.eventId ? "selected" : ""}`}
                        onClick={() => setCreateSelectedEventId(event.eventId)}
                        role="button"
                        tabIndex={0}
                      >
                        <div className="event-list-head">
                          <h3>{event.eventName}</h3>
                          <span className="meta">sets: {event.setCount}</span>
                        </div>
                        <p className="meta">eventId: {event.eventId}</p>
                      </article>
                    ))}
                  </div>
                </>
              )}
            </section>

            <section className="panel">
              <h2>4. eventのスナップショット作成</h2>
              <div className="form">
                <input
                  value={createEventAlias}
                  onChange={(e) => setCreateEventAlias(e.currentTarget.value)}
                  placeholder="アプリ内表示用のevent alias"
                />
                <button
                  type="button"
                  disabled={createBusy || token.trim() === "" || toApiSlug(slug) === "" || createSelectedEventId.trim() === ""}
                  onClick={() => void createEventSnapshot()}
                >
                  ローカルスナップショットを作成
                </button>
              </div>
              <p className="meta">
                選択中 event: {createPreview?.events.find((event) => event.eventId === createSelectedEventId)?.eventName ?? "-"}
              </p>

              <div className="form" style={{ marginTop: "0.8rem" }}>
                <input
                  value={createEventSlugInput}
                  onChange={(e) => setCreateEventSlugInput(e.currentTarget.value)}
                  placeholder="event ID (例: ultimate-singles) または event slug"
                />
                <button
                  type="button"
                  className="ghost"
                  disabled={createBusy || token.trim() === "" || toApiSlug(slug) === "" || toEventApiSlug(slug, createEventSlugInput) === ""}
                  onClick={() => void createEventSnapshotBySlug()}
                >
                  直接指定でスナップショット作成
                </button>
              </div>
              <p className="meta">
                event一覧が取得できない場合は、上記で tournament + event を直接指定して作成できます。
              </p>
            </section>
          </>
        )}

        {activeTab === "tournament" && (
        <>
          <section className="panel">
            {selectedEvent ? (
              <>
                <div className="stats-grid">
                  <article className="stat-card">
                    <p className="meta">エイリアス名</p>
                    <h3>{selectedEventMeta?.eventAlias?.trim() ? selectedEventMeta.eventAlias : "未設定"}</h3>
                  </article>
                  <article className="stat-card">
                    <p className="meta">tournament名 (start.gg)</p>
                    <h3>{snapshot?.name ?? "-"}</h3>
                  </article>
                  <article className="stat-card">
                    <p className="meta">event名 (start.gg)</p>
                    <h3>{selectedEvent.name}</h3>
                  </article>
                </div>

                <div className="panel-toolbar compact">
                  <p className={`meta ${selectedEventSeedStatus && selectedEventSeedStatus.missingSeedEntrants > 0 ? "error-text" : ""}`}>
                    {selectedEventSeedStatus
                      ? (selectedEventSeedStatus.missingSeedEntrants > 0
                        ? `⚠ seed未設定のプレイヤーがあります (${selectedEventSeedStatus.missingSeedEntrants}/${selectedEventSeedStatus.totalEntrants})`
                        : `seed設定済み (${selectedEventSeedStatus.totalEntrants}/${selectedEventSeedStatus.totalEntrants})`)
                      : "seed状態: 不明"}
                  </p>
                  <button type="button" className="ghost" disabled={busy || toApiSlug(slug) === ""} onClick={updateSnapshot}>
                    スナップショットを更新
                  </button>
                </div>

                <div className="tournament-settings" style={{ marginTop: "0.9rem" }}>
                  <div className="setting-row">
                    <p className="setting-row-title">1P/2P決定方法</p>
                    <div className="setting-row-fields single">
                      <select
                        id="side-method"
                        value={sideDecisionMethod}
                        onChange={(e) => setSideDecisionMethod(e.currentTarget.value as EventManagementSetting["sideDecisionMethod"])}
                      >
                        <option value="upper_1p">上側を1P</option>
                        <option value="upper_2p">上側を2P</option>
                        <option value="random">ランダム</option>
                      </select>
                    </div>
                  </div>

                  {Array.from({ length: MAX_CATEGORY_SLOTS }, (_, slotIndex) => {
                    const listId = categorySlotListIds[slotIndex] ?? "";
                    const minCount = categorySlotMinCounts[slotIndex] ?? 0;
                    const maxCount = categorySlotMaxCounts[slotIndex] ?? 0;
                    const allowDuplicates = categorySlotAllowDuplicates[slotIndex] ?? false;
                    const disabledSlot = listId.trim() === "";

                    return (
                      <div className="setting-row" key={`category-setting-${slotIndex}`}>
                        <p className="setting-row-title">カテゴリ{slotIndex + 1}</p>
                        <div className="setting-row-fields">
                          <label htmlFor={`item-list-slot-${slotIndex}`}>使用リスト</label>
                          <select
                            id={`item-list-slot-${slotIndex}`}
                            value={listId}
                            onChange={(e) => setCategoryListSlot(slotIndex, e.currentTarget.value)}
                          >
                            <option value="">未選択</option>
                            {itemLists
                              .slice()
                              .sort((a, b) => a.name.localeCompare(b.name, "ja"))
                              .map((itemList) => (
                                <option key={`slot-${slotIndex}-${itemList.id}`} value={itemList.id}>
                                  {itemList.name} / {itemList.categoryName} ({itemList.items.length})
                                </option>
                              ))}
                          </select>

                          <label htmlFor={`item-list-slot-min-${slotIndex}`}>カテゴリ下限</label>
                          <input
                            id={`item-list-slot-min-${slotIndex}`}
                            type="number"
                            min={0}
                            step={1}
                            value={minCount}
                            disabled={disabledSlot}
                            onChange={(e) => {
                              const nextMin = clampNonNegativeInteger(Number(e.currentTarget.value), 0);
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
                          />

                          <label htmlFor={`item-list-slot-max-${slotIndex}`}>カテゴリ上限</label>
                          <input
                            id={`item-list-slot-max-${slotIndex}`}
                            type="number"
                            min={0}
                            step={1}
                            value={maxCount}
                            disabled={disabledSlot}
                            onChange={(e) => {
                              const rawMax = clampNonNegativeInteger(Number(e.currentTarget.value), 0);
                              const ensuredMax = Math.max(rawMax, categorySlotMinCounts[slotIndex] ?? 0);
                              setCategorySlotMaxCounts((current) => {
                                const next = [...current];
                                next[slotIndex] = ensuredMax;
                                return next;
                              });
                            }}
                          />

                          <label htmlFor={`item-list-slot-allow-dup-${slotIndex}`}>重複可否</label>
                          <label className="setting-checkbox" htmlFor={`item-list-slot-allow-dup-${slotIndex}`}>
                            <input
                              id={`item-list-slot-allow-dup-${slotIndex}`}
                              type="checkbox"
                              checked={allowDuplicates}
                              disabled={disabledSlot}
                              onChange={(e) => {
                                const checked = e.currentTarget.checked;
                                setCategorySlotAllowDuplicates((current) => {
                                  const next = [...current];
                                  next[slotIndex] = checked;
                                  return next;
                                });
                              }}
                            />
                            許可
                          </label>
                        </div>
                      </div>
                    );
                  })}

                  <div className="setting-row">
                    <p className="setting-row-title">アイテム全体選択</p>
                    <div className="setting-row-fields total">
                      <label htmlFor="total-item-min">下限</label>
                      <input
                        id="total-item-min"
                        type="number"
                        min={0}
                        step={1}
                        value={totalItemMinCount}
                        onChange={(e) => {
                          const nextMin = clampNonNegativeInteger(Number(e.currentTarget.value), 0);
                          setTotalItemMinCount(nextMin);
                          setTotalItemMaxCount((current) => Math.max(current, nextMin));
                        }}
                      />

                      <label htmlFor="total-item-max">上限</label>
                      <input
                        id="total-item-max"
                        type="number"
                        min={0}
                        step={1}
                        value={totalItemMaxCount}
                        onChange={(e) => {
                          const nextMax = clampNonNegativeInteger(Number(e.currentTarget.value), 0);
                          setTotalItemMaxCount(Math.max(nextMax, totalItemMinCount));
                        }}
                      />
                    </div>
                  </div>

                  <div className="setting-row save">
                    <button type="button" className="ghost" onClick={saveEventManagementSetting}>
                      大会設定を保存
                    </button>
                  </div>
                </div>
                <p className="meta">カテゴリは最大3つまで設定できます。カテゴリ重複は不可で、カテゴリごとの件数条件と全体件数条件を設定します。</p>

                {selectedEventEntrants.length === 0 ? (
                  <p className="meta" style={{ marginTop: "0.75rem" }}>参加者が見つかりません。</p>
                ) : (
                  <div className="tournament-manager-grid" style={{ marginTop: "0.8rem" }}>
                    <div className="tournament-manager-left-stack">
                      <section className="panel" style={{ padding: "0.75rem" }}>
                        <h3>プレイヤー一覧 (seed順)</h3>
                        <p className="meta">参加人数: {selectedEventEntrants.length}</p>
                        <p className="meta">メタ情報の保存数: {selectedEventMeta?.entrants.length ?? 0}</p>
                        <div className={`event-list player-list-scroll ${selectedEventEntrants.length > 8 ? "enabled" : ""}`}>
                          {selectedEventEntrants.map((entrant) => {
                            const isSelected = selectedTournamentEntrant?.entrantId === entrant.entrantId;
                            return (
                              <article
                                key={`${selectedEvent.eventId}-${entrant.entrantId}`}
                                className={`event-list-item ${isSelected ? "selected" : ""}`}
                                role="button"
                                tabIndex={0}
                                onClick={() => setSelectedTournamentEntrantId(entrant.entrantId)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" || e.key === " ") {
                                    e.preventDefault();
                                    setSelectedTournamentEntrantId(entrant.entrantId);
                                  }
                                }}
                              >
                                <h4>{entrant.entrantName}</h4>
                                <p className="meta">entrantId: {entrant.entrantId}</p>
                                {entrant.seedNum === null && <p className="meta error-text">⚠ seed未設定</p>}
                              </article>
                            );
                          })}
                        </div>
                      </section>

                      <section className="panel" style={{ padding: "0.75rem" }}>
                        <h3>使用率一覧</h3>
                        <div className="usage-board">
                          {configuredCategorySlots.length === 0 ? (
                            <p className="meta">カテゴリ設定後に表示されます。</p>
                          ) : (
                            <div className="usage-category-list">
                              {selectedCategoryUsageList.map((categoryUsage) => (
                                <article className="usage-category" key={`usage-${categoryUsage.slotIndex}`}>
                                  <p className="usage-category-title">
                                    {categoryUsage.categoryName} ({categoryUsage.listName})
                                  </p>

                                  {categoryUsage.entries.length === 0 ? (
                                    <p className="meta">このカテゴリの選択データはまだありません。</p>
                                  ) : (
                                    <ul className="usage-item-list">
                                      {categoryUsage.entries.map((entry) => {
                                        const rate = Math.max(0, Math.min(100, entry.rate));
                                        const rateText = `${rate.toFixed(1)}%`;
                                        const palette = categoryUsage.slotIndex % 3;
                                        const fillColor = palette === 0
                                          ? "#2563eb"
                                          : palette === 1
                                            ? "#16a34a"
                                            : "#d97706";
                                        const complementColor = palette === 0
                                          ? "#f59e0b"
                                          : palette === 1
                                            ? "#a855f7"
                                            : "#2563eb";

                                        return (
                                          <li className="usage-item-row" key={`usage-item-${categoryUsage.slotIndex}-${entry.itemName}`}>
                                            <span className="usage-item-name">{entry.itemName}</span>
                                            <div className="usage-bar-track">
                                              <div
                                                className="usage-bar-fill"
                                                style={{
                                                  width: `${rate}%`,
                                                  backgroundColor: fillColor,
                                                }}
                                              >
                                                {rate >= 50 && (
                                                  <span
                                                    className="usage-rate-text in-bar"
                                                    style={{ color: complementColor }}
                                                  >
                                                    {rateText}
                                                  </span>
                                                )}
                                              </div>
                                              {rate < 50 && (
                                                <span
                                                  className="usage-rate-text out-bar"
                                                  style={{
                                                    left: `calc(${rate}% + 0.35rem)`,
                                                    color: fillColor,
                                                  }}
                                                >
                                                  {rateText}
                                                </span>
                                              )}
                                            </div>
                                          </li>
                                        );
                                      })}
                                    </ul>
                                  )}
                                </article>
                              ))}
                            </div>
                          )}
                        </div>
                      </section>
                    </div>

                    <section className="panel" style={{ padding: "0.75rem" }}>
                      <h3>選択プレイヤー設定</h3>
                      {!selectedTournamentEntrant ? (
                        <p className="meta">プレイヤーを選択してください。</p>
                      ) : (
                        (() => {
                          const draft = getMetaDraft(selectedEvent.eventId, selectedTournamentEntrant.entrantId);
                          const validated = buildValidatedSelections(draft, configuredCategorySlots);

                          return (
                            <>
                              <p className="meta">{selectedTournamentEntrant.entrantName}</p>
                              <p className="meta">entrantId: {selectedTournamentEntrant.entrantId}</p>

                              {configuredCategorySlots.length === 0 ? (
                                <p className="meta">先に上部でカテゴリ(最大3つ)を選択してください。</p>
                              ) : (
                                <div className="entrant-meta-editor">
                                  {configuredCategorySlots.map((slot) => {
                                    const currentSelections = getDraftCategorySelections(draft, slot.slotIndex);
                                    const canAddMore = currentSelections.length < slot.maxCount;
                                    const selectableItems = slot.allowDuplicates
                                      ? slot.list.items
                                      : slot.list.items.filter((itemName) => !currentSelections.includes(itemName));

                                    return (
                                    <div key={`${selectedTournamentEntrant.entrantId}-${slot.list.id}-${slot.slotIndex}`} style={{ border: "1px solid var(--line)", borderRadius: "10px", padding: "0.55rem" }}>
                                      <p className="meta" style={{ marginBottom: "0.35rem" }}>
                                        {slot.list.categoryName} ({slot.list.name}) / {currentSelections.length} 件
                                        {` / 下限 ${slot.minCount} / 上限 ${slot.maxCount} / 重複 ${slot.allowDuplicates ? "可" : "不可"}`}
                                      </p>

                                      <select
                                        value=""
                                        disabled={!canAddMore || selectableItems.length === 0}
                                        onChange={(e) =>
                                          addDraftCategorySelection(
                                            selectedEvent.eventId,
                                            selectedTournamentEntrant.entrantId,
                                            slot.slotIndex,
                                            slot.list,
                                            slot.allowDuplicates,
                                            slot.maxCount,
                                            e.currentTarget.value,
                                          )
                                        }
                                      >
                                        <option value="">アイテムを追加</option>
                                        {selectableItems.map((itemName) => (
                                          <option key={`${slot.list.id}-${slot.slotIndex}-${itemName}`} value={itemName}>
                                            {itemName}
                                          </option>
                                        ))}
                                      </select>

                                      {currentSelections.length > 0 && (
                                        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem", marginTop: "0.45rem" }}>
                                          {currentSelections.map((itemName, index) => (
                                            <button
                                              key={`${slot.list.id}-${slot.slotIndex}-${itemName}-${index}`}
                                              type="button"
                                              className="ghost tiny"
                                              onClick={() =>
                                                removeDraftCategorySelection(
                                                  selectedEvent.eventId,
                                                  selectedTournamentEntrant.entrantId,
                                                  slot.slotIndex,
                                                  index,
                                                )
                                              }
                                            >
                                              {itemName} ×
                                            </button>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                    );
                                  })}
                                </div>
                              )}

                              {validated.errors.length > 0 && (
                                <p className="meta error-text" style={{ marginTop: "0.45rem" }}>
                                  {validated.errors.join(" ")}
                                </p>
                              )}

                              <div className="entrant-meta-actions" style={{ marginTop: "0.6rem" }}>
                                <button
                                  type="button"
                                  disabled={busy || toApiSlug(slug) === ""}
                                  onClick={() => savePlayerMeta(selectedEvent, selectedTournamentEntrant.entrantId, selectedTournamentEntrant.entrantName)}
                                >
                                  このプレイヤーを保存
                                </button>
                              </div>
                            </>
                          );
                        })()
                      )}
                    </section>
                  </div>
                )}
              </>
            ) : (
              <p className="meta">ホームの大会一覧からイベントを選択してください。</p>
            )}
          </section>
        </>
      )}

        {activeTab === "message" && (
        <>
          <section className="panel">
            <h2>メッセージ送信 (メールボックス)</h2>
            <p className="meta">ブロードキャスト送信と、送信先IP指定送信を切り替えられます。メッセージは選択中のローカルイベントに紐づく形で扱われます。</p>
            <p className="meta">
              現在の送信者: {senderProfile.senderName.trim() === "" ? "未設定" : senderProfile.senderName} / {isValidSenderUserId(senderProfile.senderUserId) ? senderProfile.senderUserId : "未設定"} / IP: {isValidIpv4(senderProfile.bindIp) ? senderProfile.bindIp : "未設定"}
            </p>
            <p className="meta">受信サービス: {mailboxServiceStarted ? "起動中" : "未起動"}</p>

            <div className="form" style={{ marginTop: "0.6rem" }}>
              <input
                value={getMailboxMethodLabel(mailboxMethodDraft)}
                placeholder="メッセージ属性"
                readOnly
              />
              <input
                value={mailboxSubjectDraft}
                onChange={(e) => setMailboxSubjectDraft(e.currentTarget.value)}
                placeholder="件名"
              />
            </div>
            <div className="form" style={{ marginTop: "0.6rem" }}>
              <select value={messageDeliveryMode} onChange={(e) => setMessageDeliveryMode(e.currentTarget.value as MailboxDeliveryMode)}>
                <option value="broadcast">ブロードキャスト</option>
                <option value="direct">送信先IP指定</option>
              </select>
              <input
                value={messageDeliveryIpDraft}
                onChange={(e) => setMessageDeliveryIpDraft(e.currentTarget.value)}
                placeholder="送信先IP (例: 192.168.1.20)"
                disabled={messageDeliveryMode !== "direct"}
              />
            </div>
            <p className="meta">返信は、スレッド主ならブロードキャスト、それ以外は返信先の送信者IPへ送信します。</p>
            <p className="meta">メッセージ属性は編集できません。汎用またはプレイヤー呼び出しとして自動設定されます。</p>

            {composeFixedBodyDraft && (
              <div style={{ marginTop: "0.6rem" }}>
                <p className="meta">固有メッセージ (自動生成 / 編集不可)</p>
                <textarea
                  value={composeFixedBodyDraft}
                  rows={6}
                  readOnly
                  style={{ width: "100%", background: "#f3f4f6" }}
                />
              </div>
            )}

            <div style={{ marginTop: "0.6rem" }}>
              <p className="meta">{composeFixedBodyDraft ? "補足メッセージ" : "メッセージ本文"}</p>
              <textarea
                value={genericMessageBodyDraft}
                onChange={(e) => setGenericMessageBodyDraft(e.currentTarget.value)}
                rows={5}
                placeholder={composeFixedBodyDraft ? "補足を入力" : "メッセージ本文"}
                style={{ width: "100%" }}
              />
            </div>

            <div className="panel-toolbar compact">
              <p className="meta">この送信で新規スレッドが作成されます。</p>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                {composeFixedBodyDraft && (
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => {
                      setComposeFixedBodyDraft(null);
                      setComposeMessageMeta(null);
                      setMailboxMethodDraft("generic");
                      setMailboxSubjectDraft("");
                      setMessageDeliveryMode("broadcast");
                      setMessageDeliveryIpDraft("");
                      setGenericMessageBodyDraft("");
                      setMessage("呼び出しメッセージをキャンセルしました。汎用メッセージ入力に戻りました。");
                    }}
                  >
                    呼び出しをキャンセル
                  </button>
                )}
                <button type="button" onClick={() => void postGenericMessage()} disabled={!canSendGenericMessage}>
                  スレッド開始
                </button>
              </div>
            </div>
          </section>

          <section className="panel">
            <h2>メールボックス</h2>
            <div className="panel-toolbar compact">
              <div style={{ display: "flex", gap: "0.8rem", flexWrap: "wrap" }}>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={mailboxFilterSetting.unresolvedOnly}
                    onChange={(e) => {
                      setSelectedThreadId("");
                      setMailboxFilterSetting((current) => ({ ...current, unresolvedOnly: e.currentTarget.checked }));
                    }}
                  />
                  未解決スレッドのみ
                </label>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={mailboxFilterSetting.unreadOnly}
                    onChange={(e) => {
                      setSelectedThreadId("");
                      setMailboxFilterSetting((current) => ({ ...current, unreadOnly: e.currentTarget.checked }));
                    }}
                  />
                  未読メッセージがあるスレッドのみ
                </label>
              </div>
            </div>
            <div className="mailbox-layout">
              <section className="mailbox-thread-list">
                <h3>スレッド ({mailboxThreads.length})</h3>
                {!hasMailboxThreads ? (
                  <p className="meta">まだスレッドはありません。</p>
                ) : (
                  <div className="event-list">
                    {mailboxThreads.map((thread) => {
                      const summary = mailboxThreadSummaries.find((item) => item.root.threadId === thread.threadId);
                      const unreadCount = summary?.unreadCount ?? 0;
                      const resolved = summary?.resolved ?? false;

                      return (
                        <article
                          key={thread.threadId}
                          className={`event-list-item mailbox-thread-item ${activeThread?.threadId === thread.threadId ? "selected" : ""}`}
                          role="button"
                          tabIndex={0}
                          onClick={() => setSelectedThreadId(thread.threadId)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              setSelectedThreadId(thread.threadId);
                            }
                          }}
                        >
                          <div className="event-list-head">
                            <div>
                              <h4>{thread.subject}</h4>
                              <p className="meta">属性: {getMailboxMethodLabel(thread.method)}</p>
                            </div>
                            <p className="meta">{new Date(thread.createdAt).toLocaleString()}</p>
                          </div>
                          <p className="meta">from: {thread.senderName} ({thread.senderUserId})</p>
                          <p className="meta">
                            {resolved ? "解決済み" : "未解決"}
                            {unreadCount > 0 ? ` / 未読 ${unreadCount}` : " / 未読 0"}
                          </p>
                        </article>
                      );
                    })}
                  </div>
                )}
              </section>

              <section className="mailbox-thread-view">
                {!activeThread ? (
                  <p className="meta">左のスレッドを選択してください。</p>
                ) : (
                  <>
                    <h3>{activeThread.subject}</h3>
                    <p className="meta">属性: {getMailboxMethodLabel(activeThread.method)} / threadId: {activeThread.threadId}</p>
                    <p className="meta">状態: {activeThreadResolved ? "解決済み" : "未解決"}</p>
                    <p className="meta">返信はこのスレッド配下に自動でまとまります。</p>

                    <div className="mailbox-message-list">
                      {activeThreadMessages.map((item) => (
                        <article key={item.messageId} className={`event-list-item mailbox-message ${item.parentMessageId ? "reply" : "root"}`}>
                          <div className="event-list-head">
                            <div>
                              <h4>{item.senderName}</h4>
                              <p className="meta">ID: {item.senderUserId} / IP: {item.senderIp || "-"}</p>
                            </div>
                            <p className="meta">{new Date(item.createdAt).toLocaleString()}</p>
                          </div>
                          {item.parentMessageId && <p className="meta">reply to: {item.parentMessageId}</p>}
                          <p className="meta">
                            type: {item.messageType === "resolve" ? "解決" : item.messageType === "dq_request" ? "DQ申請" : "通常"}
                          </p>
                          {item.messageType === "dq_request" && (
                            <div style={{ marginTop: "0.45rem", display: "flex", gap: "0.45rem", flexWrap: "wrap" }}>
                              <button
                                type="button"
                                className="ghost tiny"
                                onClick={() => processDqRequestFromMessage(item)}
                              >
                                DQ処理
                              </button>
                            </div>
                          )}
                          <p className="message-body">{item.body}</p>
                        </article>
                      ))}
                    </div>

                    <div className="panel-toolbar compact" style={{ marginTop: "0.6rem" }}>
                      <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                        <p className="meta">スレッド作成者は「解決」メッセージで完了通知できます。</p>
                        <p className="meta">削除すると、このスレッドのメッセージはすべて消えます。</p>
                      </div>
                      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                        <button type="button" className="ghost" onClick={() => void resolveActiveThread()} disabled={!canResolveActiveThread}>
                          解決
                        </button>
                        <button type="button" className="ghost" onClick={deleteActiveThread} disabled={!activeThread}>
                          スレッド削除
                        </button>
                      </div>
                    </div>

                    <div style={{ marginTop: "0.6rem" }}>
                      <textarea
                        value={replyBodyDraft}
                        onChange={(e) => setReplyBodyDraft(e.currentTarget.value)}
                        rows={4}
                        placeholder="このスレッドへの返信"
                        style={{ width: "100%" }}
                      />
                    </div>
                    <div className="panel-toolbar compact">
                      <p className="meta">返信メッセージはこのスレッドに集約されます。</p>
                      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                        <button type="button" onClick={() => void replyToThread()} disabled={!canReplyToThread}>
                          返信
                        </button>
                        <button type="button" className="ghost" onClick={openDqRequestDialog} disabled={!canOpenDqDialog}>
                          DQ申請
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </section>
            </div>
          </section>
        </>
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

              {dqCameraActive && (
                <div style={{ marginTop: "0.7rem" }}>
                  <p className="meta">カメラをコードに向けると、自動でPLAYER IDを入力します。</p>
                  <video
                    ref={dqCameraVideoRef}
                    autoPlay
                    playsInline
                    muted
                    style={{ width: "100%", maxWidth: "420px", borderRadius: "10px", border: "1px solid var(--line)", background: "#0f172a" }}
                  />
                </div>
              )}

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
        <>
          <section className="panel">
            <h2>アイテムリスト</h2>
            <p className="meta">大会管理タブで利用するアイテムリストを管理します。</p>

            <div className="form">
              <input
                value={itemListName}
                onChange={(e) => setItemListName(e.currentTarget.value)}
                placeholder="リスト名 (例: S4公式)"
              />
              <input
                value={itemCategoryName}
                onChange={(e) => setItemCategoryName(e.currentTarget.value)}
                placeholder="カテゴリ名 (例:キャラ)"
              />
            </div>
            <div style={{ marginTop: "0.6rem" }}>
              <textarea
                value={itemListText}
                onChange={(e) => setItemListText(e.currentTarget.value)}
                rows={12}
                placeholder="1行に1アイテム名"
                style={{ width: "100%", borderRadius: "10px", border: "1px solid var(--line)", padding: "0.62rem 0.75rem", fontFamily: "inherit", fontSize: "0.92rem" }}
              />
            </div>

            <div className="panel-toolbar compact">
              <p className="meta">重複・空行は保存時に自動整理されます。</p>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <button type="button" onClick={saveItemList}>
                  {editingItemListId ? "更新" : "作成"}
                </button>
                <button type="button" className="ghost" onClick={resetItemListEditor}>
                  クリア
                </button>
              </div>
            </div>
          </section>

          <section className="panel">
            <h2>登録済みリスト ({itemLists.length})</h2>

            {itemLists.length === 0 ? (
              <p className="meta">まだリストがありません。</p>
            ) : (
              <div className="event-list">
                {itemLists
                  .slice()
                  .sort((a, b) => a.name.localeCompare(b.name, "ja"))
                  .map((itemList) => (
                    <article className="event-list-item" key={itemList.id}>
                      <div className="event-list-head">
                        <div>
                          <h3>{itemList.name}</h3>
                          <p className="meta">{itemList.categoryName} / {itemList.items.length} 件</p>
                        </div>
                        <div style={{ display: "flex", gap: "0.45rem" }}>
                          <button type="button" className="ghost tiny" onClick={() => editItemList(itemList)}>
                            編集
                          </button>
                          <button
                            type="button"
                            className="ghost tiny"
                            onClick={() => {
                              if (window.confirm(`「${itemList.name}」を削除しますか？`)) {
                                deleteItemList(itemList.id);
                              }
                            }}
                          >
                            削除
                          </button>
                        </div>
                      </div>
                      {itemList.items.length > 0 && (
                        <ul>
                          {itemList.items.slice(0, 10).map((itemName) => (
                            <li key={`${itemList.id}-${itemName}`}>{itemName}</li>
                          ))}
                        </ul>
                      )}
                      {itemList.items.length > 10 && <p className="meta">+{itemList.items.length - 10} 件</p>}
                    </article>
                  ))}
              </div>
            )}
          </section>
        </>
      )}

        {activeTab === "settings" && (
        <>
          <section className="panel">
            <h2>送信者設定</h2>
            <p className="meta">各クライアントを識別するための送信者名と8桁ユーザーIDを設定します。</p>
            <p className="meta">ユーザーIDはクライアント間で重複しないよう運用してください。ランダム決定ボタンで簡単に採番できます。</p>

            <div className="form" style={{ marginTop: "0.65rem" }}>
              <label htmlFor="sender-name-input" style={{ display: "grid", gap: "0.3rem" }}>
                <span className="meta">送信者名</span>
                <input
                  id="sender-name-input"
                  value={senderNameDraft}
                  onChange={(e) => setSenderNameDraft(e.currentTarget.value)}
                  placeholder="例: 配信PC-A"
                />
              </label>
              <label htmlFor="sender-user-id-input" style={{ display: "grid", gap: "0.3rem" }}>
                <span className="meta">ユーザーID (8桁数字)</span>
                <input
                  id="sender-user-id-input"
                  value={senderUserIdDraft}
                  onChange={(e) => setSenderUserIdDraft(e.currentTarget.value.replace(/\D/g, "").slice(0, 8))}
                  placeholder="例: 12345678"
                  inputMode="numeric"
                  maxLength={8}
                />
              </label>
              <label htmlFor="sender-bind-ip-input" style={{ display: "grid", gap: "0.3rem" }}>
                <span className="meta">自分のIP (IPv4)</span>
                <input
                  id="sender-bind-ip-input"
                  value={senderBindIpDraft}
                  onChange={(e) => setSenderBindIpDraft(e.currentTarget.value)}
                  placeholder="例: 192.168.1.10"
                />
              </label>
              <label htmlFor="sender-broadcast-subnet-mask-input" style={{ display: "grid", gap: "0.3rem" }}>
                <span className="meta">ブロードキャスト用サブネットマスク (IPv4)</span>
                <input
                  id="sender-broadcast-subnet-mask-input"
                  value={senderBroadcastSubnetMaskDraft}
                  onChange={(e) => setSenderBroadcastSubnetMaskDraft(e.currentTarget.value)}
                  placeholder="例: 255.255.255.0"
                />
              </label>
            </div>

            <div className="panel-toolbar compact">
              <p className="meta">
                {senderIdCollision
                  ? "既存履歴で同一IDが別名義に使われています。"
                  : !isValidIpv4(normalizedSenderBindIpDraft)
                    ? "IPはIPv4形式で入力してください。"
                    : !isValidIpv4(normalizedBroadcastSubnetMaskDraft)
                      ? "サブネットマスクはIPv4形式で入力してください。"
                      : "例: 12345678 / 192.168.1.10 / 255.255.255.0"}
              </p>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <button type="button" className="ghost" onClick={fillRandomSenderUserId}>
                  ランダム決定
                </button>
                <button type="button" onClick={saveSenderProfileSettings} disabled={!canSaveSenderProfile}>
                  保存
                </button>
              </div>
            </div>
          </section>

          <section className="panel">
            <h2>メールボックス表示設定</h2>
            <p className="meta">メールボックスのスレッド一覧フィルタを設定できます。</p>

            <div style={{ display: "grid", gap: "0.5rem", marginTop: "0.6rem" }}>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={mailboxFilterSetting.unresolvedOnly}
                  onChange={(e) => setMailboxFilterSetting((current) => ({ ...current, unresolvedOnly: e.currentTarget.checked }))}
                />
                未解決スレッドのみ表示
              </label>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={mailboxFilterSetting.unreadOnly}
                  onChange={(e) => setMailboxFilterSetting((current) => ({ ...current, unreadOnly: e.currentTarget.checked }))}
                />
                未読メッセージがあるスレッドのみ表示
              </label>
            </div>

            <div className="panel-toolbar compact">
              <p className="meta">未読管理数: {mailboxReadMessageIds.length}</p>
              <button type="button" className="ghost" onClick={() => setMailboxReadMessageIds([])}>
                未読状態をリセット
              </button>
            </div>
          </section>
        </>
      )}

        {activeTab === "users" && (
        <>
          <section className="panel">
            <h2>プレイヤーリスト</h2>
            {!snapshot || !selectedEvent ? (
              <p className="meta">ホームの大会一覧からイベントを選択してください。</p>
            ) : (
              <>
                <p className="meta">暗号化プレイヤーIDは tournamentId + eventId + entrantId を元に生成します。</p>
                <p className="meta">管理者IDは発行しません。このアプリは管理者のみが操作し、プレイヤーIDを本人確認に利用します。</p>
                <p className="meta">対象イベント: {selectedEvent.name} / プレイヤー数: {userCardPlayers.length}</p>

                <div className="form" style={{ marginTop: "0.65rem" }}>
                  <button
                    type="button"
                    disabled={userCardBusy || !selectedUserCardPlayer}
                    onClick={() => void saveSelectedUserCardImage()}
                  >
                    選択カードを保存
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    disabled={userCardBusy || userCardPlayers.length === 0}
                    onClick={() => void exportAllPlayerCardsAsA4Pages()}
                  >
                    全カードをA4画像で出力
                  </button>
                </div>
              </>
            )}
          </section>

          {snapshot && selectedEvent && (
            <section className="panel users-grid-panel">
              <section className="users-player-list">
                <h3>プレイヤー一覧</h3>
                {userCardPlayers.length === 0 ? (
                  <p className="meta">プレイヤーが存在しません。</p>
                ) : (
                  <div className="event-list player-list-scroll enabled">
                    {userCardPlayers.map((player) => {
                      const selected = selectedUserCardPlayer?.playerId === player.playerId;
                      return (
                        <article
                          key={`${player.eventId}-${player.entrantId}`}
                          className={`event-list-item user-card-entry ${selected ? "selected" : ""}`}
                          role="button"
                          tabIndex={0}
                          onClick={() => setSelectedUserCardPlayerId(player.playerId)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              setSelectedUserCardPlayerId(player.playerId);
                            }
                          }}
                        >
                          <h4>{player.entrantName}</h4>
                          <p className="meta">entrantId: {player.entrantId}</p>
                          <p className="meta user-id">playerId: {player.playerId}</p>
                        </article>
                      );
                    })}
                  </div>
                )}
              </section>

              <section className="users-card-preview">
                <h3>プレイヤーカードプレビュー</h3>
                {!selectedUserCardPlayer || selectedUserCardPreviewUrl === "" ? (
                  <p className="meta">プレイヤーを選択してください。</p>
                ) : (
                  <>
                    <p className="meta">{selectedUserCardPlayer.entrantName} / {selectedUserCardPlayer.playerId}</p>
                    <img
                      className="player-card-preview-image"
                      src={selectedUserCardPreviewUrl}
                      alt={`${selectedUserCardPlayer.entrantName} player card`}
                    />
                  </>
                )}
              </section>
            </section>
          )}
        </>
      )}

        {activeTab === "bracket" && (
        <>
          <section className="panel">
            <h2>ブラケット管理</h2>
            <p className="meta">試合カードをクリックすると詳細ダイアログを開き、結果入力と 1P/2P 設定ができます。</p>
            <div className="panel-toolbar compact">
              <p className="meta">
                下書き: {draftSetResults.length} / 確定済み: {confirmedSetResults.length}
              </p>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <button type="button" className="ghost" disabled={busy || toApiSlug(slug) === ""} onClick={updateSnapshot}>
                  スナップショットを更新
                </button>
                <button
                  type="button"
                  disabled={busy || toApiSlug(slug) === "" || confirmedSetResults.length === 0}
                  onClick={reportConfirmedSetsFromBracket}
                >
                  結果を一括報告
                </button>
              </div>
            </div>
            <p className="meta">カード枠が黄色の試合は、現在のスナップショットからローカル変更があります。</p>
          </section>

          {snapshot && (
            <section className="panel">
              <h2>{snapshot.name}</h2>
              <p className="meta">
                slug: {snapshot.slug} / updatedAt: {new Date(snapshot.updatedAt).toLocaleString()}
              </p>
              <p className="meta">
                events: {snapshot.events.length} / sets: {allSets.length}
              </p>
              <p className="meta">
                local meta events: {localMeta?.events.length ?? 0} / updatedAt:{" "}
                {localMeta ? new Date(localMeta.updatedAt).toLocaleString() : "-"}
              </p>

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
              </div>

              {selectedEvent && (
                <p className="meta">
                  表示中: {selectedEvent.name} / sets: {selectedEvent.sets.length} / phase-pool groups: {phasePoolGroups.length}
                </p>
              )}

              <div className="phase-groups">
                {!selectedPhasePoolGroup ? (
                  <p className="meta">選択中イベントにフェーズ/プール情報がありません。</p>
                ) : (
                  <section className="phase-group" key={selectedPhasePoolGroup.key}>
                    <h3>
                      {selectedPhasePoolGroup.phaseName} / Pool {selectedPhasePoolGroup.phaseGroupName}
                    </h3>
                    <p className="meta">sets: {selectedPhasePoolGroup.sets.length}</p>

                    <div className="bracket-split-stack">
                      {selectedBracketSections.map((section) => (
                        <section className="bracket-subgroup" key={`${selectedPhasePoolGroup.key}-${section.key}`}>
                          <h4>{section.title}</h4>
                          <p className="meta">sets: {section.setCount}</p>
                          <div className="bracket-board">
                            {(section.key === "losers" ? [...section.columns].reverse() : section.columns).map((column) => (
                              <section className="bracket-column" key={`${selectedPhasePoolGroup.key}-${section.key}-${column.key}`}>
                                <h4>{column.title}</h4>
                                {column.round !== null && <p className="meta">round: {column.round}</p>}

                                <div className="column-sets">
                                  {column.sets.map((set) => (
                                    (() => {
                                      const pendingResult = pendingResultBySetId.get(set.setId);
                                      const changeClass = pendingResult
                                        ? (isConfirmedSetResult(pendingResult) ? "set-card-changed-confirmed" : "set-card-changed-draft")
                                        : "";

                                      return (
                                    <article
                                      className={`set-card simple-match-card ${changeClass}`}
                                      key={set.setId}
                                      role="button"
                                      tabIndex={0}
                                      onClick={() => openMatchDialog(set)}
                                      onKeyDown={(e) => {
                                        if (e.key === "Enter" || e.key === " ") {
                                          e.preventDefault();
                                          openMatchDialog(set);
                                        }
                                      }}
                                    >
                                      {set.slots.map((slot, idx) => {
                                        const entrantId = slot.entrantId;
                                        const setDisplay = getSetScoresForDisplay(set);
                                        const scoreMap = setDisplay.scores;
                                        const winnerId = setDisplay.winnerId ?? set.winnerId;
                                        const isWinner = entrantId && winnerId ? entrantId === winnerId : false;
                                        const sideLabel = getSetSlotSideLabel(set.setId, entrantId);
                                        const gameWins = slot.score !== null
                                          ? (isDqScoreValue(slot.score) ? "DQ" : formatScoreValue(slot.score))
                                          : entrantId
                                            ? (scoreMap[entrantId] ?? (winnerId ? (isWinner ? "✓" : "-") : "-"))
                                            : "-";
                                        const scoreClass = (isDqScoreValue(slot.score) || setDisplay.isDq)
                                          ? (isWinner ? "win" : "dq")
                                          : (isWinner ? "win" : "lose");

                                        return (
                                          <div className="simple-match-row" key={`${set.setId}-${idx}`}>
                                            <span className={`side-badge ${sideLabel === "1P" ? "side-1p" : sideLabel === "2P" ? "side-2p" : "side-none"}`}>
                                              {sideLabel}
                                            </span>
                                            <span className="simple-player-name">{slot.entrantName}</span>
                                            <span className={`simple-games ${scoreClass}`}>{gameWins}</span>
                                          </div>
                                        );
                                      })}
                                    </article>
                                      );
                                    })()
                                  ))}
                                </div>
                              </section>
                            ))}
                          </div>
                        </section>
                      ))}
                    </div>
                  </section>
                )}
              </div>
            </section>
          )}

          {activeMatch && selectedEvent && (
            <div className="dialog-backdrop" onClick={closeMatchDialog}> 
              <section
                className="dialog-panel"
                role="dialog"
                aria-modal="true"
                aria-label="試合詳細"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="dialog-head">
                  <h3>{activeMatch.fullRoundText}</h3>
                  <button type="button" className="ghost" onClick={closeMatchDialog}>閉じる</button>
                </div>
                <p className="meta">setId: {activeMatch.setId} / state: {activeMatch.state}</p>
                {!isMatchupReady(activeMatch) && <p className="meta">対戦カード確定後にプレイヤーサイドを変更できます。</p>}
                {matchSideRandomNotice && matchSideRandomNotice.setId === activeMatch.setId && (
                  <p className={`meta side-random-notice ${matchSideRandomNotice.changed ? "changed" : "unchanged"}`}>
                    ランダム実行済み ({new Date(matchSideRandomNotice.triggeredAt).toLocaleTimeString("ja-JP", { hour12: false })})
                    : 上段 {matchSideRandomNotice.upperEntrantName} = {matchSideRandomNotice.upperSide} / 下段 {matchSideRandomNotice.lowerEntrantName} = {matchSideRandomNotice.lowerSide}
                    {!matchSideRandomNotice.changed ? " (結果は変更なし)" : ""}
                  </p>
                )}

                <div className="dialog-players">
                  {activeMatch.slots.map((slot, idx) => {
                    const entrantId = slot.entrantId;
                    const entrantMeta = entrantId
                      ? selectedEventMeta?.entrants.find((entrant) => entrant.entrantId === entrantId)
                      : null;
                    const currentSide = entrantId
                      ? (activeMatchSideDrafts[entrantId] ?? getSetSlotSide(activeMatch.setId, entrantId))
                      : "";
                    const scoreValue = entrantId ? scoreDrafts[entrantId] ?? "" : "";
                    const otherEntrantId = activeMatch.slots.find(
                      (item) => item.entrantId !== null && item.entrantId !== entrantId,
                    )?.entrantId ?? null;

                    return (
                      <article
                        className={`dialog-player-card ${currentSide === "1P" ? "side-card-1p" : currentSide === "2P" ? "side-card-2p" : ""}`}
                        key={`${activeMatch.setId}-dialog-${idx}`}
                      >
                        <p className="dialog-player-name">{slot.entrantName}</p>
                        <p className="meta">entrantId: {entrantId ?? "-"}</p>
                        {entrantId && (
                          <>
                            <div className="side-toggle-row">
                              <button
                                type="button"
                                className={`ghost tiny side-choice side-choice-1p ${
                                  currentSide === "1P" ? "side-choice-enabled" : "side-choice-disabled"
                                }`}
                                disabled={busy || !isMatchupReady(activeMatch)}
                                onClick={() => {
                                  void togglePlaySide(entrantId, "1P");
                                }}
                              >
                                1P
                              </button>
                              <button
                                type="button"
                                className={`ghost tiny side-choice side-choice-2p ${
                                  currentSide === "2P" ? "side-choice-enabled" : "side-choice-disabled"
                                }`}
                                disabled={busy || !isMatchupReady(activeMatch)}
                                onClick={() => {
                                  void togglePlaySide(entrantId, "2P");
                                }}
                              >
                                2P
                              </button>
                              {idx === 0 && otherEntrantId && (
                                <button
                                  type="button"
                                  className="ghost tiny side-choice side-choice-random"
                                  disabled={busy || !isMatchupReady(activeMatch)}
                                  onClick={() => {
                                    void randomizeMatchSides(activeMatch);
                                  }}
                                >
                                  ランダム
                                </button>
                              )}
                            </div>
                            <label>
                              取得ゲーム数
                              <input
                                className="set-score-input"
                                type="text"
                                inputMode="numeric"
                                value={scoreValue}
                                onChange={(e) => {
                                  if (!entrantId) {
                                    return;
                                  }
                                  const nextValue = e.currentTarget.value;
                                  setScoreDrafts((current) => ({
                                    ...current,
                                    [entrantId]: nextValue,
                                  }));
                                }}
                              />
                            </label>
                            {entrantId && otherEntrantId && (
                              <button
                                type="button"
                                className="ghost tiny"
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
                            <p className="meta">authCode: {entrantMeta?.authCode ?? "-"}</p>
                          </>
                        )}
                      </article>
                    );
                  })}
                </div>

                <div className="dialog-actions">
                  <button
                    type="button"
                    disabled={busy || !isMatchupReady(activeMatch)}
                    onClick={() => {
                      void saveLocalResultForMatch(false);
                    }}
                  >
                    更新
                  </button>
                  <button
                    type="button"
                    disabled={busy || !isMatchupReady(activeMatch)}
                    onClick={() => {
                      void saveLocalResultForMatch(true);
                    }}
                  >
                    確定
                  </button>
                </div>
              </section>
            </div>
          )}
          {batchConflictDialog && (
            <div
              className="dialog-backdrop"
              onClick={() => {
                if (!busy) {
                  cancelBracketBatchConflict();
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
                  <button type="button" className="ghost" disabled={busy} onClick={cancelBracketBatchConflict}>中止</button>
                </div>

                <div className="dialog-body">
                  <div className="dialog-summary-box">
                    <p className="dialog-summary-title">対象set</p>
                    <p className="dialog-summary-value">{batchConflictDialog.conflict.fullRoundText}</p>
                    <p className="meta">{batchConflictDialog.conflict.entrantNames.filter((name) => name.trim() !== "").join(" vs ") || batchConflictDialog.conflict.setId}</p>
                    <p className="meta">remote state: {batchConflictDialog.conflict.remoteState} / remote winner: {batchConflictDialog.conflict.remoteWinnerId ?? "-"}</p>
                  </div>

                  <div className="dialog-summary-box">
                    <p className="dialog-summary-title">ここまでの進捗</p>
                    <p className="dialog-summary-value">
                      対象 {batchConflictDialog.progress.totalCount} 件 / 送信 {batchConflictDialog.progress.reportedCount} 件 / スキップ {batchConflictDialog.progress.skippedCount} 件
                    </p>
                  </div>

                  <label className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={batchForceOverwriteRemaining}
                      onChange={(event) => setBatchForceOverwriteRemaining(event.currentTarget.checked)}
                    />
                    この一括報告の残りでも、競合したsetは自動で reset して強制上書きする
                  </label>
                </div>

                <div className="dialog-actions dialog-actions-split">
                  <button type="button" className="ghost" disabled={busy} onClick={cancelBracketBatchConflict}>この時点で止める</button>
                  <button type="button" disabled={busy} onClick={() => void continueBracketBatchWithForceOverwrite()}>
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
