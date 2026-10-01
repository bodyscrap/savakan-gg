import type { GenericMessage, MailboxFilterSetting } from "./MessageBox";
import { callElapsedSeconds, type CallListEventGroup } from "./StatusBoard";

export type MessageScope = {
  tournamentId: string;
  slug: string;
  eventId: string;
  phaseName: string;
  phaseGroupName: string;
};

export type SenderMessagingProfile = {
  senderName: string;
  senderUserId: string;
  bindIp: string;
  broadcastSubnetMask: string;
};

export function isSenderProfileReadyForMessaging(profile: SenderMessagingProfile): boolean {
  return profile.senderName.trim() !== ""
    && isValidSenderUserId(profile.senderUserId)
    && isValidIpv4(profile.bindIp);
}

export function canBroadcastCallListSync(
  profile: SenderMessagingProfile,
  communicationDisabled: boolean,
): boolean {
  return profile.senderName.trim() !== ""
    && !communicationDisabled
    && isValidSenderUserId(profile.senderUserId)
    && isValidIpv4(profile.bindIp)
    && isValidIpv4(profile.broadcastSubnetMask);
}

export function formatSenderProfileLabel(profile: SenderMessagingProfile): string {
  const senderName = profile.senderName.trim() || "未設定";
  const senderUserId = isValidSenderUserId(profile.senderUserId) ? profile.senderUserId : "未設定";
  const bindIp = isValidIpv4(profile.bindIp) ? profile.bindIp : "未設定";
  return `${senderName} / ${senderUserId} / IP: ${bindIp}`;
}

export function hasSenderIdCollision(
  messages: Array<Pick<GenericMessage, "senderName" | "senderUserId">>,
  senderUserId: string,
  senderName: string,
): boolean {
  return isValidSenderUserId(senderUserId)
    && messages.some((item) => item.senderUserId === senderUserId && item.senderName !== senderName);
}

export type CallThreadIdentity = {
  expectedPlayerId: string;
  callEntrantId: string;
  callEntrantName: string;
  setId: string;
};

export type CallTargetIdentity = {
  tournamentId: string;
  eventId: string;
  phaseName: string;
  phaseGroupName: string;
  setId: string;
  callEntrantId: string;
};

export type CallSyncStatusTarget = {
  threadId: string;
  senderUserId: string;
  tournamentId: string;
  eventId: string;
  phaseName: string;
  phaseGroupName: string;
  setId: string;
  callEntrantId: string;
};

export function normalizeGenericMessage(rawValue: unknown): GenericMessage | null {
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

export function normalizeMailboxFilterSetting(rawValue: unknown): MailboxFilterSetting {
  const source = rawValue && typeof rawValue === "object"
    ? (rawValue as Partial<MailboxFilterSetting>)
    : {};

  return {
    unresolvedOnly: Boolean(source.unresolvedOnly),
    unreadOnly: Boolean(source.unreadOnly),
  };
}

export function normalizeGenericMessages(rawValue: unknown): GenericMessage[] {
  if (!Array.isArray(rawValue)) {
    return [];
  }

  return rawValue
    .map((item) => normalizeGenericMessage(item))
    .filter((item): item is GenericMessage => item !== null)
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
}

export function hasSameGenericMessageOrder(left: GenericMessage[], right: GenericMessage[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    if (left[index].messageId !== right[index].messageId) {
      return false;
    }
  }

  return true;
}

export function normalizeSenderUserId(value: string): string {
  return value.replace(/\D/g, "").slice(0, 8);
}

export function isValidSenderUserId(value: string): boolean {
  return /^\d{8}$/.test(value.trim());
}

export function isValidIpv4(value: string): boolean {
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

export function splitIpv4List(value: string): string[] {
  return value
    .split(/[\s,;\n\r]+/)
    .map((item) => item.trim())
    .filter((item) => item !== "");
}

export function isValidIpv4List(value: string): boolean {
  const values = splitIpv4List(value);
  return values.length > 0 && values.every((item) => isValidIpv4(item));
}

export function getMailboxMethodLabel(method: string): string {
  const normalized = method.trim().toLowerCase();
  if (normalized === "generic") {
    return "汎用";
  }
  if (normalized === "call_player") {
    return "プレイヤー呼び出し";
  }
  if (normalized === "call_player_sync" || normalized === "call_player_sync_request") {
    return "呼び出しの同期";
  }
  return normalized === "" ? "不明" : normalized;
}

export function buildScopedMessageMeta(
  baseMeta: Record<string, unknown> | null,
  scope: MessageScope | null,
): Record<string, unknown> | null {
  const merged: Record<string, unknown> = { ...(baseMeta ?? {}) };

  if (scope) {
    merged.scopeTournamentId = scope.tournamentId;
    merged.scopeSlug = scope.slug;
    merged.scopeEventId = scope.eventId;
    merged.scopePhaseName = scope.phaseName;
    merged.scopePhaseGroupName = scope.phaseGroupName;
  }

  return Object.keys(merged).length > 0 ? merged : null;
}

export function isMessageForScope(message: GenericMessage, scope: MessageScope | null): boolean {
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
  const scopePhaseName = typeof source.scopePhaseName === "string"
    ? source.scopePhaseName.trim()
    : (typeof source.phaseName === "string" ? source.phaseName.trim() : "");
  const scopePhaseGroupName = typeof source.scopePhaseGroupName === "string"
    ? source.scopePhaseGroupName.trim()
    : (typeof source.phaseGroupName === "string" ? source.phaseGroupName.trim() : "");

  const hasScopePhase = scope.phaseName.trim() !== "";
  const hasScopePhaseGroup = scope.phaseGroupName.trim() !== "";
  const phaseMatches = !hasScopePhase || scopePhaseName === "" || scopePhaseName === scope.phaseName;
  const phaseGroupMatches = !hasScopePhaseGroup || scopePhaseGroupName === "" || scopePhaseGroupName === scope.phaseGroupName;

  if (
    scopeEventId !== ""
    && scopeEventId === scope.eventId
    && (scopeTournamentId === "" || scopeTournamentId === scope.tournamentId)
    && (scopeSlug === "" || scopeSlug === scope.slug)
  ) {
    return phaseMatches && phaseGroupMatches;
  }

  const legacyTournamentId = typeof source.tournamentId === "string" ? source.tournamentId.trim() : "";
  const legacyEventId = typeof source.eventId === "string" ? source.eventId.trim() : "";

  if (legacyEventId !== "" && legacyEventId === scope.eventId) {
    return (legacyTournamentId === "" || legacyTournamentId === scope.tournamentId)
      && phaseMatches
      && phaseGroupMatches;
  }

  if (scopeEventId !== "" || legacyEventId !== "") {
    return false;
  }

  return true;
}

export function normalizePlayerId(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, "");
}

export function isLikelyPlayerId(value: string): boolean {
  return /^PG-[A-Z2-7]+$/.test(normalizePlayerId(value));
}

export function extractMetaString(meta: Record<string, unknown> | null, key: string): string {
  if (!meta) {
    return "";
  }

  const value = meta[key];
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeCallPhaseName(rawValue: string): string {
  const trimmed = rawValue.trim();
  return trimmed === "" ? "Phase 未設定" : trimmed;
}

export function normalizeCallPhaseGroupName(rawValue: string): string {
  const trimmed = rawValue.trim();
  return trimmed === "" ? "Pool 未設定" : trimmed;
}

export function parsePhasePoolKey(rawKey: string): { phaseName: string; phaseGroupName: string } | null {
  const trimmed = rawKey.trim();
  if (trimmed === "") {
    return null;
  }

  const separatorIndex = trimmed.indexOf("::");
  if (separatorIndex < 0) {
    return null;
  }

  const phaseName = trimmed.slice(0, separatorIndex).trim();
  const phaseGroupName = trimmed.slice(separatorIndex + 2).trim();
  if (phaseName === "" || phaseGroupName === "") {
    return null;
  }

  return { phaseName, phaseGroupName };
}

export function extractCallPhasePoolMeta(meta: Record<string, unknown> | null): {
  phaseName: string;
  phaseGroupName: string;
} {
  const phaseName = extractMetaString(meta, "scopePhaseName") || extractMetaString(meta, "phaseName");
  const phaseGroupName = extractMetaString(meta, "scopePhaseGroupName") || extractMetaString(meta, "phaseGroupName");

  return {
    phaseName: normalizeCallPhaseName(phaseName),
    phaseGroupName: normalizeCallPhaseGroupName(phaseGroupName),
  };
}

export function extractCallThreadIdentity(rootMessage: GenericMessage | null): CallThreadIdentity | null {
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

  return { expectedPlayerId, callEntrantId, callEntrantName, setId };
}

export function extractCallEventMeta(rootMessage: GenericMessage): {
  tournamentId: string;
  tournamentName: string;
  eventId: string;
  eventName: string;
  eventAlias: string;
  phaseName: string;
  phaseGroupName: string;
} {
  const tournamentId = extractMetaString(rootMessage.messageMeta, "scopeTournamentId") || extractMetaString(rootMessage.messageMeta, "tournamentId");
  const tournamentName = extractMetaString(rootMessage.messageMeta, "tournamentName");
  const eventId = extractMetaString(rootMessage.messageMeta, "scopeEventId") || extractMetaString(rootMessage.messageMeta, "eventId");
  const eventName = extractMetaString(rootMessage.messageMeta, "eventName");
  const eventAlias = extractMetaString(rootMessage.messageMeta, "eventAlias");
  const { phaseName, phaseGroupName } = extractCallPhasePoolMeta(rootMessage.messageMeta);

  return { tournamentId, tournamentName, eventId, eventName, eventAlias, phaseName, phaseGroupName };
}

export function buildCallListDedupKey(rootMessage: GenericMessage): string {
  const targetIdentity = extractCallTargetIdentityFromMeta(rootMessage.messageMeta);
  if (!targetIdentity) {
    return rootMessage.threadId;
  }

  return `${targetIdentity.tournamentId}::${targetIdentity.eventId}::${targetIdentity.phaseName}::${targetIdentity.phaseGroupName}::${targetIdentity.setId}::${targetIdentity.callEntrantId}`;
}

export function extractCallTargetIdentityFromMeta(meta: Record<string, unknown> | null): CallTargetIdentity | null {
  const callEntrantId = extractMetaString(meta, "callEntrantId");
  const setId = extractMetaString(meta, "setId");
  const eventId = extractMetaString(meta, "scopeEventId") || extractMetaString(meta, "eventId");
  const tournamentId = extractMetaString(meta, "scopeTournamentId") || extractMetaString(meta, "tournamentId");
  const { phaseName, phaseGroupName } = extractCallPhasePoolMeta(meta);

  if (tournamentId === "" || eventId === "" || callEntrantId === "" || setId === "") {
    return null;
  }

  return { tournamentId, eventId, phaseName, phaseGroupName, setId, callEntrantId };
}

export function buildCallSyncStatusTargets(
  displayGroups: CallListEventGroup[],
  messages: GenericMessage[],
): CallSyncStatusTarget[] {
  const rootByThreadId = new Map(
    messages
      .filter((item) => item.parentMessageId === null && item.method === "call_player" && item.messageType === "normal")
      .map((item) => [item.threadId, item] as const),
  );
  const dedupMap = new Map<string, CallSyncStatusTarget>();

  for (const group of displayGroups) {
    for (const player of group.players) {
      const root = rootByThreadId.get(player.threadId);
      if (!root) {
        continue;
      }

      const identity = extractCallTargetIdentityFromMeta(root.messageMeta);
      if (!identity) {
        continue;
      }

      const dedupKey = `${root.senderUserId}::${identity.tournamentId}::${identity.eventId}::${identity.phaseName}::${identity.phaseGroupName}::${identity.setId}::${identity.callEntrantId}`;
      if (dedupMap.has(dedupKey)) {
        continue;
      }

      dedupMap.set(dedupKey, {
        threadId: root.threadId,
        senderUserId: root.senderUserId,
        ...identity,
      });
    }
  }

  return [...dedupMap.values()];
}

export function isSameCallTargetIdentity(left: CallTargetIdentity, right: CallTargetIdentity): boolean {
  return left.tournamentId === right.tournamentId
    && left.eventId === right.eventId
    && left.phaseName === right.phaseName
    && left.phaseGroupName === right.phaseGroupName
    && left.setId === right.setId
    && left.callEntrantId === right.callEntrantId;
}

export function compareCallListEventGroup(left: CallListEventGroup, right: CallListEventGroup): number {
  const byAlias = left.eventAlias.localeCompare(right.eventAlias, "ja");
  if (byAlias !== 0) {
    return byAlias;
  }

  const byEventName = left.eventName.localeCompare(right.eventName, "ja");
  if (byEventName !== 0) {
    return byEventName;
  }

  const byPhaseName = left.phaseName.localeCompare(right.phaseName, "ja");
  if (byPhaseName !== 0) {
    return byPhaseName;
  }

  const byPhaseGroupName = left.phaseGroupName.localeCompare(right.phaseGroupName, "ja");
  if (byPhaseGroupName !== 0) {
    return byPhaseGroupName;
  }

  return left.tournamentName.localeCompare(right.tournamentName, "ja");
}

export function compareCallListEventGroupByMaxElapsed(
  left: CallListEventGroup,
  right: CallListEventGroup,
  referenceMs: number,
): number {
  const leftMaxElapsed = left.players.reduce(
    (maxElapsed, player) => Math.max(maxElapsed, callElapsedSeconds(player.createdAt, referenceMs)),
    0,
  );
  const rightMaxElapsed = right.players.reduce(
    (maxElapsed, player) => Math.max(maxElapsed, callElapsedSeconds(player.createdAt, referenceMs)),
    0,
  );

  if (leftMaxElapsed !== rightMaxElapsed) {
    return rightMaxElapsed - leftMaxElapsed;
  }

  return compareCallListEventGroup(left, right);
}

export function isDqRequestMessage(message: GenericMessage): boolean {
  if (message.messageType === "dq_request") {
    return true;
  }

  if (message.method !== "call_player") {
    return false;
  }

  const hasLegacyMeta = extractMetaString(message.messageMeta, "dqCallEntrantId") !== ""
    || extractMetaString(message.messageMeta, "dqSetId") !== "";
  if (hasLegacyMeta) {
    return true;
  }

  return message.body.includes("DQ申請");
}

export function extractPlayerIdFromQrRawValue(rawValue: string): string {
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
    return normalizePlayerId(trimmed);
  }

  return normalizePlayerId(trimmed);
}

export function extractPlayerIdFromBarcodeResults(results: Array<{ rawValue?: string }>): string {
  for (const result of results) {
    const rawValue = typeof result.rawValue === "string" ? result.rawValue : "";
    const playerId = extractPlayerIdFromQrRawValue(rawValue);
    if (isLikelyPlayerId(playerId)) {
      return playerId;
    }
  }

  return "";
}

export function isSameGenericMessageIdentity(left: GenericMessage, right: GenericMessage): boolean {
  return left.messageId === right.messageId;
}