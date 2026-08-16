import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
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

type AppTab = "home" | "create" | "tournament" | "bracket" | "item-list" | "users";

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

const APP_TABS: Array<{ id: AppTab; label: string; icon: string; implemented: boolean }> = [
  { id: "create", label: "新規作成", icon: "➕", implemented: true },
  { id: "home", label: "大会一覧", icon: "🏠", implemented: true },
  { id: "tournament", label: "大会管理", icon: "⚙", implemented: true },
  { id: "bracket", label: "ブラケット", icon: "🏆", implemented: true },
  { id: "item-list", label: "アイテムリスト", icon: "📚", implemented: true },
  { id: "users", label: "ユーザーリスト", icon: "👥", implemented: false },
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
  const [sideDecisionMethod, setSideDecisionMethod] = useState<EventManagementSetting["sideDecisionMethod"]>("upper_1p");
  const [matchSideRandomNotice, setMatchSideRandomNotice] = useState<MatchSideRandomNotice | null>(null);
  const [categorySlotListIds, setCategorySlotListIds] = useState<string[]>(["", "", ""]);
  const [categorySlotMinCounts, setCategorySlotMinCounts] = useState<number[]>([0, 0, 0]);
  const [categorySlotMaxCounts, setCategorySlotMaxCounts] = useState<number[]>([1, 1, 1]);
  const [categorySlotAllowDuplicates, setCategorySlotAllowDuplicates] = useState<boolean[]>([false, false, false]);
  const [totalItemMinCount, setTotalItemMinCount] = useState(0);
  const [totalItemMaxCount, setTotalItemMaxCount] = useState(3);
  const [selectedTournamentEntrantId, setSelectedTournamentEntrantId] = useState("");
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
          const normalizedSavedSlug = toSlugInput(savedSelection.slug);
          startupSavedSlugRef.current = normalizedSavedSlug;
          startupSavedEventIdRef.current = savedSelection.eventId.trim();
          setSlug(normalizedSavedSlug);
        }

        const savedSlug = await invoke<string | null>("load_last_slug");
        if (
          alive
          && startupSavedSlugRef.current === ""
          && savedSlug
          && savedSlug.trim() !== ""
        ) {
          const normalizedSavedSlug = toSlugInput(savedSlug);
          startupSavedSlugRef.current = normalizedSavedSlug;
          setSlug(normalizedSavedSlug);
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

    const savedSlug = startupSavedSlugRef.current;
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
          // Fallback to list-based restore below when list loading completes.
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
      matched = localSnapshotEvents.find((item) => toSlugInput(item.slug) === savedSlug) ?? null;
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

    return snapshot?.name ?? "未選択";
  }, [selectedEventMeta, selectedEvent, snapshot]);

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
      setSelectedEventId("");
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

  function openMatchDialog(set: SetSnapshot) {
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
                  const isSelected =
                    snapshot
                    && selectedEvent
                    ? sameSnapshotEventKey(snapshot.slug, selectedEvent.eventId, item.slug, item.eventId)
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
