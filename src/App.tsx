import { FormEvent, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";

type SetSlot = {
  entrantId: string | null;
  entrantName: string;
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
  entrants: EventEntrantMeta[];
};

type LocalSetResultMeta = {
  eventId: string;
  eventName: string;
  setId: string;
  winnerId: string;
  scoreCsv: string;
  forceOverwrite: boolean;
  recordedAt: string;
};

type TournamentLocalMeta = {
  tournamentId: string;
  slug: string;
  events: EventLocalMeta[];
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

type OwnedTournamentListItem = {
  tournamentId: string;
  name: string;
  slug: string;
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

type BatchReportResolution = "local" | "remote";

type BatchReportPlanItem = {
  eventId: string;
  eventName: string;
  setId: string;
  fullRoundText: string;
  round: number | null;
  localWinnerId: string;
  localScoreCsv: string;
  localForceOverwrite: boolean;
  localState: number;
  localSnapshotWinnerId: string | null;
  remoteState: number | null;
  remoteWinnerId: string | null;
  conflictReason: string | null;
};

type BatchReportPlan = {
  snapshot: TournamentSnapshot;
  localMeta: TournamentLocalMeta;
  items: BatchReportPlanItem[];
};

type PlayerMetaDraft = {
  playSide: PlaySide | "";
  characterNames: string;
  notes: string;
};

type AppTab = "home" | "create" | "tournament" | "bracket" | "item-list" | "users";

type ItemListConfig = {
  id: string;
  name: string;
  categoryName: string;
  items: string[];
};

type EventManagementSetting = {
  sideDecisionMethod: "upper_1p" | "upper_2p" | "random";
  itemListIds: string[];
};

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
  return `${slug}::${eventId}`;
}

function isMatchupReady(set: SetSnapshot): boolean {
  if (set.slots.length < 2) {
    return false;
  }

  return set.slots.every((slot) => slot.entrantId !== null && slot.entrantName !== "TBD");
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

function App() {
  const [activeTab, setActiveTab] = useState<AppTab>("home");
  const [token, setToken] = useState("");
  const [slug, setSlug] = useState("");
  const [perPage, setPerPage] = useState("50");
  const [createPreview, setCreatePreview] = useState<TournamentPreview | null>(null);
  const [ownedTournaments, setOwnedTournaments] = useState<OwnedTournamentListItem[]>([]);
  const [loadingOwnedTournaments, setLoadingOwnedTournaments] = useState(false);
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
  const [winnerId, setWinnerId] = useState("");
  const [scoreCsv, setScoreCsv] = useState("2-0");
  const [forceOverwrite, setForceOverwrite] = useState(false);
  const [metaDrafts, setMetaDrafts] = useState<Record<string, PlayerMetaDraft>>({});
  const [batchPlan, setBatchPlan] = useState<BatchReportPlan | null>(null);
  const [batchDecisions, setBatchDecisions] = useState<Record<string, BatchReportResolution | "">>({});
  const [localSnapshotEvents, setLocalSnapshotEvents] = useState<LocalSnapshotEventListItem[]>([]);
  const [loadingLocalSnapshotEvents, setLoadingLocalSnapshotEvents] = useState(false);
  const [deletingSnapshotKey, setDeletingSnapshotKey] = useState("");
  const [itemLists, setItemLists] = useState<ItemListConfig[]>([]);
  const [editingItemListId, setEditingItemListId] = useState<string | null>(null);
  const [itemListName, setItemListName] = useState("");
  const [itemCategoryName, setItemCategoryName] = useState("");
  const [itemListText, setItemListText] = useState("");
  const [eventMgmtSettings, setEventMgmtSettings] = useState<Record<string, EventManagementSetting>>({});
  const [sideDecisionMethod, setSideDecisionMethod] = useState<EventManagementSetting["sideDecisionMethod"]>("upper_1p");
  const [categorySlotListIds, setCategorySlotListIds] = useState<string[]>(["", "", ""]);
  const [selectedTournamentEntrantId, setSelectedTournamentEntrantId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        const savedToken = await invoke<string | null>("load_saved_startgg_token");
        if (alive && savedToken && savedToken.trim() !== "") {
          setToken(savedToken);
        }

        const savedSlug = await invoke<string | null>("load_last_slug");
        if (alive && savedSlug && savedSlug.trim() !== "") {
          setSlug(toSlugInput(savedSlug));
        }
      } catch (err) {
        if (alive) {
          setError(String(err));
        }
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
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

    try {
      const raw = window.localStorage.getItem(EVENT_MGMT_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, EventManagementSetting>;
        if (parsed && typeof parsed === "object") {
          setEventMgmtSettings(parsed);
        }
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(ITEM_LIST_STORAGE_KEY, JSON.stringify(itemLists));
    } catch {
      // ignore
    }
  }, [itemLists]);

  useEffect(() => {
    try {
      window.localStorage.setItem(EVENT_MGMT_STORAGE_KEY, JSON.stringify(eventMgmtSettings));
    } catch {
      // ignore
    }
  }, [eventMgmtSettings]);

  useEffect(() => {
    if (activeTab !== "home") {
      return;
    }

    void refreshLocalSnapshotEvents();
  }, [activeTab]);

  useEffect(() => {
    if (activeTab !== "create" || token.trim() === "") {
      return;
    }

    void loadOwnedTournaments();
  }, [activeTab, token]);

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
  const pendingSetResults = localMeta?.pendingSetResults ?? [];

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

  const selectedEventSettingKey = useMemo(() => {
    if (!snapshot || !selectedEvent) {
      return "";
    }
    return eventSettingKey(snapshot.slug, selectedEvent.eventId);
  }, [snapshot, selectedEvent]);

  const selectedCategoryLists = useMemo(() => {
    const ids = categorySlotListIds.filter((id) => id.trim() !== "");
    return ids
      .map((id) => itemLists.find((item) => item.id === id) ?? null)
      .filter((item): item is ItemListConfig => item !== null)
      .slice(0, 3);
  }, [categorySlotListIds, itemLists]);

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

  const selectedEventCharacterUsage = useMemo(() => {
    if (!selectedEventMeta) {
      return [] as Array<{ name: string; count: number }>;
    }

    const usage = new Map<string, number>();
    for (const entrant of selectedEventMeta.entrants) {
      const uniqueCharacters = new Set(
        entrant.characterNames.map((characterName) => characterName.trim()).filter((characterName) => characterName !== ""),
      );

      for (const characterName of uniqueCharacters) {
        usage.set(characterName, (usage.get(characterName) ?? 0) + 1);
      }
    }

    return [...usage.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name, "ja"))
      .slice(0, 5);
  }, [selectedEventMeta]);

  const selectedEventEntrants = useMemo(() => {
    if (!selectedEvent) {
      return [] as Array<{ entrantId: string; entrantName: string }>;
    }

    const seen = new Set<string>();
    const entrants: Array<{ entrantId: string; entrantName: string }> = [];

    for (const set of selectedEvent.sets) {
      for (const slot of set.slots) {
        if (!slot.entrantId || seen.has(slot.entrantId)) {
          continue;
        }

        seen.add(slot.entrantId);
        entrants.push({
          entrantId: slot.entrantId,
          entrantName: slot.entrantName,
        });
      }
    }

    return entrants;
  }, [selectedEvent]);

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
        if (next[key]) {
          continue;
        }

        const existingMeta = selectedEventMeta?.entrants.find(
          (item) => item.entrantId === entrant.entrantId,
        );

        next[key] = {
          playSide: existingMeta?.playSide ?? "",
          characterNames: existingMeta?.characterNames.join(", ") ?? "",
          notes: existingMeta?.notes ?? "",
        };
      }

      return next;
    });
  }, [selectedEvent, selectedEventEntrants, selectedEventMeta]);

  useEffect(() => {
    if (selectedEventSettingKey === "") {
      return;
    }

    const setting = eventMgmtSettings[selectedEventSettingKey];
    if (!setting) {
      setSideDecisionMethod("upper_1p");
      setCategorySlotListIds(["", "", ""]);
      return;
    }

    const nextSideMethod = setting.sideDecisionMethod === "upper_2p" || setting.sideDecisionMethod === "random"
      ? setting.sideDecisionMethod
      : "upper_1p";
    const nextIds = (setting.itemListIds ?? []).slice(0, 3);
    while (nextIds.length < 3) {
      nextIds.push("");
    }

    setSideDecisionMethod(nextSideMethod);
    setCategorySlotListIds(nextIds);
  }, [eventMgmtSettings, selectedEventSettingKey]);

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

  function getMetaDraftKey(eventId: string, entrantId: string): string {
    return `${eventId}:${entrantId}`;
  }

  function getMetaDraft(eventId: string, entrantId: string): PlayerMetaDraft {
    const key = getMetaDraftKey(eventId, entrantId);
    const existingMeta = localMeta?.events
      .find((event) => event.eventId === eventId)
      ?.entrants.find((entrant) => entrant.entrantId === entrantId);

    return (
      metaDrafts[key] ?? {
        playSide: existingMeta?.playSide ?? "",
        characterNames: existingMeta?.characterNames.join(", ") ?? "",
        notes: existingMeta?.notes ?? "",
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
        characterNames: existingMeta?.characterNames.join(", ") ?? "",
        notes: existingMeta?.notes ?? "",
      };

      return {
        ...current,
        [key]: {
          ...baseDraft,
          ...patch,
        },
      };
    });
  }

  function parseCharacterNames(rawValue: string): string[] {
    return rawValue
      .split(/[\n,]/)
      .map((value) => value.trim())
      .filter((value) => value !== "");
  }

  function getDraftSelectionsForCategories(draft: PlayerMetaDraft, lists: ItemListConfig[]): string[] {
    const remaining = [...parseCharacterNames(draft.characterNames)];
    return lists.map((list) => {
      const index = remaining.findIndex((name) => list.items.includes(name));
      if (index < 0) {
        return "";
      }

      const [picked] = remaining.splice(index, 1);
      return picked;
    });
  }

  function updateDraftCategorySelection(
    eventId: string,
    entrantId: string,
    lists: ItemListConfig[],
    categoryIndex: number,
    itemName: string,
  ) {
    const draft = getMetaDraft(eventId, entrantId);
    const selections = getDraftSelectionsForCategories(draft, lists);
    if (categoryIndex < 0 || categoryIndex >= selections.length) {
      return;
    }

    if (itemName !== "") {
      const duplicateIndex = selections.findIndex((value, idx) => idx !== categoryIndex && value === itemName);
      if (duplicateIndex >= 0) {
        selections[duplicateIndex] = "";
      }
    }

    selections[categoryIndex] = itemName;
    const normalized = selections.map((value) => value.trim()).filter((value) => value !== "");
    setMetaDraft(eventId, entrantId, {
      characterNames: normalized.join(", "),
    });
  }

  function setCategoryListSlot(slotIndex: number, itemListId: string) {
    setCategorySlotListIds((current) => {
      const next = [...current];
      while (next.length < 3) {
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
      return next.slice(0, 3);
    });
  }

  function toNullableText(rawValue: string): string | null {
    const trimmed = rawValue.trim();
    return trimmed === "" ? null : trimmed;
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
    if (editingItemListId === itemListId) {
      resetItemListEditor();
    }
    setEventMgmtSettings((current) => {
      const next: Record<string, EventManagementSetting> = {};
      for (const [key, value] of Object.entries(current)) {
        const ids = (value.itemListIds ?? [])
          .filter((id) => id !== itemListId)
          .slice(0, 3);
        next[key] = {
          sideDecisionMethod:
            value.sideDecisionMethod === "upper_2p" || value.sideDecisionMethod === "random"
              ? value.sideDecisionMethod
              : "upper_1p",
          itemListIds: ids,
        };
      }
      return next;
    });
    setMessage("アイテムリストを削除しました。");
  }

  function saveEventManagementSetting() {
    if (selectedEventSettingKey === "") {
      setError("先にイベントを選択してください。");
      return;
    }

    const itemListIds = categorySlotListIds
      .map((id) => id.trim())
      .filter((id, index, source) => id !== "" && source.indexOf(id) === index)
      .slice(0, 3);

    setEventMgmtSettings((current) => ({
      ...current,
      [selectedEventSettingKey]: {
        sideDecisionMethod,
        itemListIds,
      },
    }));
    setMessage("大会管理設定を保存しました。");
  }

  function parseScoreCsv(rawScoreCsv: string): { winnerWins: number; loserWins: number } | null {
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

  function isDqScoreCsv(rawScoreCsv: string): boolean {
    const normalized = rawScoreCsv.trim().toLowerCase().replace(/\s+/g, "");
    return normalized === "dq" || /^\d+-dq$/.test(normalized);
  }

  function formatScoreValue(value: number): string {
    return Number.isInteger(value) ? String(value) : value.toFixed(1);
  }

  function deriveScoreCsvFromSet(set: SetSnapshot): string | null {
    if (set.winnerId) {
      const winnerSlot = set.slots.find((slot) => slot.entrantId === set.winnerId);
      const loserSlot = set.slots.find((slot) => slot.entrantId !== null && slot.entrantId !== set.winnerId);
      const winnerScore = winnerSlot ? toIntegerScore(winnerSlot.score) : null;
      const loserScore = loserSlot ? toIntegerScore(loserSlot.score) : null;
      const loserIsDq = loserSlot ? isDqScoreValue(loserSlot.score) : false;

      if (winnerScore !== null && (loserScore === null || loserIsDq)) {
        return `${winnerScore}-DQ`;
      }
    }

    const scored = set.slots
      .map((slot) => ({
        entrantId: slot.entrantId,
        score: toIntegerScore(slot.score),
      }))
      .filter((slot) => slot.entrantId !== null && slot.score !== null) as Array<{
      entrantId: string;
      score: number;
    }>;

    if (scored.length < 2) {
      return null;
    }

    const winnerId = set.winnerId;
    if (winnerId) {
      const winner = scored.find((slot) => slot.entrantId === winnerId);
      const loser = scored.find((slot) => slot.entrantId !== winnerId);
      if (winner && loser) {
        return `${winner.score}-${loser.score}`;
      }
    }

    const [high, low] = [...scored].sort((a, b) => b.score - a.score);
    if (high && low) {
      return `${high.score}-${low.score}`;
    }

    return null;
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

  async function loadOwnedTournaments() {
    if (token.trim() === "") {
      setError("APIキーを入力してください。");
      return;
    }

    setLoadingOwnedTournaments(true);
    setError("");
    setMessage("");

    try {
      await invoke("save_startgg_token", { token });
      const items = await invoke<OwnedTournamentListItem[]>("list_owned_tournaments", {
        perPage: 50,
      });
      setOwnedTournaments(items);
      setMessage(
        items.length === 0
          ? "作成した大会が見つかりませんでした。"
          : `作成した大会を ${items.length} 件取得しました。`,
      );
    } catch (err) {
      setError(String(err));
    } finally {
      setLoadingOwnedTournaments(false);
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
      setLoadingLocalSnapshotEvents(false);
    }
  }

  async function selectLocalSnapshotEvent(item: LocalSnapshotEventListItem) {
    setBusy(true);
    setError("");
    setMessage("");

    try {
      await invoke("save_last_slug", { slug: item.slug });
      const result = await invoke<TournamentWorkspace>("load_local_tournament_workspace", {
        slug: item.slug,
        eventId: item.eventId,
      });

      setSlug(toSlugInput(item.slug));
      setSelectedEventId(item.eventId);
      setWorkspace(result);
      setBatchPlan(null);
      setBatchDecisions({});
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

      if (snapshot?.slug === item.slug && selectedEvent?.eventId === item.eventId) {
        setWorkspace(null);
        setSelectedEventId("");
        setBatchPlan(null);
        setBatchDecisions({});
      }

      await refreshLocalSnapshotEvents();
      setMessage(`削除しました: ${item.tournamentName} / ${displayEventName}`);
    } catch (err) {
      setError(String(err));
    } finally {
      setDeletingSnapshotKey("");
    }
  }

  async function refreshSnapshotFromRemote() {
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
      setBatchPlan(null);
      setBatchDecisions({});
      setActiveMatchSetId("");
      await refreshLocalSnapshotEvents();
      setMessage("リモート情報でローカルスナップショットを更新しました。");
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  function getSlotSideLabel(eventId: string, entrantId: string | null): string {
    if (!entrantId || !localMeta) {
      return "-";
    }

    const side = localMeta.events
      .find((event) => event.eventId === eventId)
      ?.entrants.find((entrant) => entrant.entrantId === entrantId)
      ?.playSide;

    return side ?? "-";
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

    if (isDqScoreCsv(result.scoreCsv)) {
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

    const parsed = parseScoreCsv(result.scoreCsv);
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

    const pending = pendingResultBySetId.get(set.setId);
    if (pending) {
      setWinnerId(pending.winnerId);
      setScoreCsv(pending.scoreCsv);
      setForceOverwrite(pending.forceOverwrite);
      return;
    }

    setWinnerId(set.winnerId ?? "");
    setScoreCsv(deriveScoreCsvFromSet(set) ?? "2-0");
    setForceOverwrite(false);
  }

  async function saveLocalResultForMatch() {
    if (!selectedEvent) {
      setError("イベントが選択されていません。");
      return;
    }

    if (setId.trim() === "" || winnerId.trim() === "") {
      setError("winner を選択してください。");
      return;
    }

    setBusy(true);
    setError("");
    setMessage("");

    try {
      const normalizedSlug = toApiSlug(slug);
      await invoke("save_last_slug", { slug: normalizedSlug });

      const result = await invoke<TournamentWorkspace>("save_local_set_result", {
        input: {
          slug: normalizedSlug,
          eventId: selectedEvent.eventId,
          setId,
          winnerId,
          scoreCsv,
          forceOverwrite,
        },
      });
      setWorkspace(result);
      setBatchPlan(null);
      setBatchDecisions({});
      setMessage("結果をローカルに記録しました。必要なタイミングで一括反映できます。");
      setActiveMatchSetId("");
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  async function buildBatchReportPlan() {
    setBusy(true);
    setError("");
    setMessage("");

    try {
      const normalizedSlug = toApiSlug(slug);
      await invoke("save_last_slug", { slug: normalizedSlug });

      const result = await invoke<BatchReportPlan>("build_batch_report_plan", {
        slug: normalizedSlug,
        eventId: selectedEvent?.eventId ?? selectedEventId,
        perPage: Number(perPage),
      });

      setBatchPlan(result);
      setBatchDecisions(
        Object.fromEntries(
          result.items.map((item) => [item.setId, item.conflictReason ? "" : "local"]),
        ) as Record<string, BatchReportResolution | "">,
      );
      setMessage(
        result.items.length === 0
          ? "一括反映の対象はありません。"
          : `一括反映の候補を ${result.items.length} 件読み込みました。`,
      );
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  async function applyBatchReportPlan() {
    if (!batchPlan) {
      setError("一括反映の差分を先に確認してください。");
      return;
    }

    const unresolved = batchPlan.items.filter(
      (item) => item.conflictReason !== null && batchDecisions[item.setId] !== "local" && batchDecisions[item.setId] !== "remote",
    );
    if (unresolved.length > 0) {
      setError("コンフリクト項目の選択が完了していません。");
      return;
    }

    setBusy(true);
    setError("");
    setMessage("");

    try {
      const normalizedSlug = toApiSlug(slug);
      const decisions = batchPlan.items.map((item) => {
        const resolution = batchDecisions[item.setId];
        if (resolution !== "local" && resolution !== "remote") {
          throw new Error(`set ${item.setId} の解決方針が未選択です。`);
        }

        return {
          setId: item.setId,
          resolution,
        };
      });

      const result = await invoke<TournamentWorkspace>("apply_batch_report_plan", {
        input: {
          slug: normalizedSlug,
          eventId: selectedEvent?.eventId ?? selectedEventId,
          perPage: Number(perPage),
          decisions,
        },
      });

      setWorkspace(result);
      setBatchPlan(null);
      setBatchDecisions({});
      setMessage("一括反映を完了しました。");
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  async function savePlayerMeta(eventSnapshot: EventSnapshot, entrantId: string, entrantName: string) {
    const normalizedSlug = toApiSlug(slug);
    const draft = getMetaDraft(eventSnapshot.eventId, entrantId);

    setBusy(true);
    setError("");
    setMessage("");

    try {
      const result = await invoke<TournamentWorkspace>("save_local_player_meta", {
        input: {
          slug: normalizedSlug,
          eventId: eventSnapshot.eventId,
          eventName: eventSnapshot.name,
          entrantId,
          entrantName,
          playSide: draft.playSide === "" ? null : draft.playSide,
          characterNames: parseCharacterNames(draft.characterNames),
          notes: toNullableText(draft.notes),
        },
      });

      setWorkspace(result);
      setMessage("ローカルメタを保存しました。");
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
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
                    snapshot?.slug === item.slug &&
                    selectedEvent?.eventId === item.eventId;
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
                <p className="meta">自分が作成した大会から選択するか、直接大会IDを入力できます。</p>
              </div>

              {loadingOwnedTournaments && <p className="meta">自分が作成した大会一覧を取得中...</p>}

              {ownedTournaments.length > 0 && (
                <div className="event-list owned-tournament-list">
                  {ownedTournaments.map((item) => {
                    const normalizedSlug = toSlugInput(item.slug);
                    const selected = normalizedSlug === toSlugInput(slug);

                    return (
                      <article
                        key={item.tournamentId}
                        className={`event-list-item ${selected ? "selected" : ""}`}
                      >
                        <div className="event-list-head">
                          <h3>{item.name}</h3>
                          <span className="meta">id: {item.tournamentId}</span>
                        </div>
                        <p className="meta">大会ID: {normalizedSlug}</p>
                        <button
                          type="button"
                          className="ghost"
                          onClick={() => {
                            setSlug(normalizedSlug);
                            setCreatePreview(null);
                            setCreateSelectedEventId("");
                            setCreateEventAlias("");
                          }}
                        >
                          この大会を選択
                        </button>
                      </article>
                    );
                  })}
                </div>
              )}

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
            <h2>大会管理</h2>
            <p className="meta">
              参加者一覧、1P/2P決定方式、使用アイテム設定を管理します。
            </p>
            {selectedEvent ? (
              <>
                <div className="stats-grid">
                  <article className="stat-card">
                    <p className="meta">イベント</p>
                    <h3>{selectedEvent.name}</h3>
                  </article>
                  <article className="stat-card">
                    <p className="meta">参加プレイヤー</p>
                    <h3>{selectedEventEntrants.length}</h3>
                  </article>
                  <article className="stat-card">
                    <p className="meta">メタ保存済み</p>
                    <h3>{selectedEventMeta?.entrants.length ?? 0}</h3>
                  </article>
                  <article className="stat-card">
                    <p className="meta">使用アイテム上位</p>
                    {selectedEventCharacterUsage.length === 0 ? (
                      <p className="meta">未入力</p>
                    ) : (
                      <ul>
                        {selectedEventCharacterUsage.map((item) => (
                          <li key={item.name}>
                            {item.name} / {item.count}
                          </li>
                        ))}
                      </ul>
                    )}
                  </article>
                </div>

                <div className="event-toolbar" style={{ marginTop: "0.9rem" }}>
                  <label htmlFor="side-method">1P/2P決定方法</label>
                  <select
                    id="side-method"
                    value={sideDecisionMethod}
                    onChange={(e) => setSideDecisionMethod(e.currentTarget.value as EventManagementSetting["sideDecisionMethod"])}
                  >
                    <option value="upper_1p">上側を1P</option>
                    <option value="upper_2p">上側を2P</option>
                    <option value="random">ランダム</option>
                  </select>

                  <label htmlFor="item-list-slot-0">カテゴリ1</label>
                  <select
                    id="item-list-slot-0"
                    value={categorySlotListIds[0] ?? ""}
                    onChange={(e) => setCategoryListSlot(0, e.currentTarget.value)}
                  >
                    <option value="">未選択</option>
                    {itemLists
                      .slice()
                      .sort((a, b) => a.name.localeCompare(b.name, "ja"))
                      .map((itemList) => (
                        <option key={itemList.id} value={itemList.id}>
                          {itemList.name} / {itemList.categoryName} ({itemList.items.length})
                        </option>
                      ))}
                  </select>

                  <label htmlFor="item-list-slot-1">カテゴリ2</label>
                  <select
                    id="item-list-slot-1"
                    value={categorySlotListIds[1] ?? ""}
                    onChange={(e) => setCategoryListSlot(1, e.currentTarget.value)}
                  >
                    <option value="">未選択</option>
                    {itemLists
                      .slice()
                      .sort((a, b) => a.name.localeCompare(b.name, "ja"))
                      .map((itemList) => (
                        <option key={`slot1-${itemList.id}`} value={itemList.id}>
                          {itemList.name} / {itemList.categoryName} ({itemList.items.length})
                        </option>
                      ))}
                  </select>

                  <label htmlFor="item-list-slot-2">カテゴリ3</label>
                  <select
                    id="item-list-slot-2"
                    value={categorySlotListIds[2] ?? ""}
                    onChange={(e) => setCategoryListSlot(2, e.currentTarget.value)}
                  >
                    <option value="">未選択</option>
                    {itemLists
                      .slice()
                      .sort((a, b) => a.name.localeCompare(b.name, "ja"))
                      .map((itemList) => (
                        <option key={`slot2-${itemList.id}`} value={itemList.id}>
                          {itemList.name} / {itemList.categoryName} ({itemList.items.length})
                        </option>
                      ))}
                  </select>

                  <button type="button" className="ghost" onClick={saveEventManagementSetting}>
                    大会管理設定を保存
                  </button>
                </div>
                <p className="meta">カテゴリは最大3つまで設定できます。プレイヤー選択後、各カテゴリで1つずつ選択します。</p>

                {selectedEventEntrants.length === 0 ? (
                  <p className="meta" style={{ marginTop: "0.75rem" }}>参加者が見つかりません。</p>
                ) : (
                  <div className="tournament-manager-grid" style={{ marginTop: "0.8rem" }}>
                    <section className="panel" style={{ padding: "0.75rem" }}>
                      <h3>プレイヤー一覧</h3>
                      <div className="event-list">
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
                            </article>
                          );
                        })}
                      </div>
                    </section>

                    <section className="panel" style={{ padding: "0.75rem" }}>
                      <h3>選択プレイヤー設定</h3>
                      {!selectedTournamentEntrant ? (
                        <p className="meta">プレイヤーを選択してください。</p>
                      ) : (
                        (() => {
                          const draft = getMetaDraft(selectedEvent.eventId, selectedTournamentEntrant.entrantId);
                          const categorySelections = getDraftSelectionsForCategories(draft, selectedCategoryLists);

                          return (
                            <>
                              <p className="meta">{selectedTournamentEntrant.entrantName}</p>
                              <p className="meta">entrantId: {selectedTournamentEntrant.entrantId}</p>

                              {selectedCategoryLists.length === 0 ? (
                                <p className="meta">先に上部でカテゴリ(最大3つ)を選択してください。</p>
                              ) : (
                                <div className="entrant-meta-editor">
                                  {selectedCategoryLists.map((list, index) => (
                                    <label key={`${selectedTournamentEntrant.entrantId}-${list.id}`}>
                                      {list.categoryName} ({list.name})
                                      <select
                                        value={categorySelections[index] ?? ""}
                                        onChange={(e) =>
                                          updateDraftCategorySelection(
                                            selectedEvent.eventId,
                                            selectedTournamentEntrant.entrantId,
                                            selectedCategoryLists,
                                            index,
                                            e.currentTarget.value,
                                          )
                                        }
                                      >
                                        <option value="">未選択</option>
                                        {list.items.map((itemName) => (
                                          <option key={`${list.id}-${itemName}`} value={itemName}>
                                            {itemName}
                                          </option>
                                        ))}
                                      </select>
                                    </label>
                                  ))}
                                </div>
                              )}

                              <label className="entrant-meta-editor" style={{ marginTop: "0.4rem" }}>
                                メモ
                                <input
                                  value={draft.notes}
                                  onChange={(e) => setMetaDraft(selectedEvent.eventId, selectedTournamentEntrant.entrantId, { notes: e.currentTarget.value })}
                                  placeholder="自由メモ"
                                />
                              </label>

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
              <p className="meta">保留中のローカル結果: {pendingSetResults.length}</p>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <button type="button" className="ghost" disabled={busy || toApiSlug(slug) === ""} onClick={refreshSnapshotFromRemote}>
                  リモート情報で更新
                </button>
                <button type="button" disabled={busy || toApiSlug(slug) === ""} onClick={buildBatchReportPlan}>
                  start.ggとの差分を確認
                </button>
              </div>
            </div>
          </section>

          {batchPlan && (
            <section className="panel">
              <h2>一括反映の確認</h2>
              <p className="meta">
                保留中のローカル結果: {pendingSetResults.length} / 差分候補: {batchPlan.items.length}
              </p>

              {batchPlan.items.length === 0 ? (
                <p className="meta">start.gg に送る保留結果はありません。</p>
              ) : (
                <div className="batch-plan-list">
                  {batchPlan.items.map((item) => {
                    const decision = batchDecisions[item.setId] ?? "";
                    const needsConfirmation = item.conflictReason !== null;

                    return (
                      <article className="batch-plan-item" key={item.setId}>
                        <h3>
                          {item.eventName} / {item.fullRoundText}
                        </h3>
                        <p className="meta">setId: {item.setId} / round: {item.round ?? "-"}</p>
                        <p className="meta">
                          local winner: {item.localWinnerId} / remote winner: {item.remoteWinnerId ?? "-"}
                        </p>
                        <p className="meta">
                          local state: {item.localState} / remote state: {item.remoteState ?? "-"}
                        </p>
                        {item.conflictReason && <p className="meta error-text">コンフリクト: {item.conflictReason}</p>}
                        {needsConfirmation && (
                          <div className="batch-decision-row">
                            <label>
                              <input
                                type="radio"
                                name={`decision-${item.setId}`}
                                checked={decision === "local"}
                                onChange={() =>
                                  setBatchDecisions((current) => ({
                                    ...current,
                                    [item.setId]: "local",
                                  }))
                                }
                              />
                              ローカルを優先して送信
                            </label>
                            <label>
                              <input
                                type="radio"
                                name={`decision-${item.setId}`}
                                checked={decision === "remote"}
                                onChange={() =>
                                  setBatchDecisions((current) => ({
                                    ...current,
                                    [item.setId]: "remote",
                                  }))
                                }
                              />
                              リモートを優先して破棄
                            </label>
                          </div>
                        )}
                        {!needsConfirmation && <p className="meta">コンフリクトなし。ローカルを送信対象にします。</p>}
                      </article>
                    );
                  })}
                </div>
              )}

              <button type="button" disabled={busy || batchPlan.items.length === 0} onClick={applyBatchReportPlan}>
                一括反映を実行
              </button>
            </section>
          )}

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
                                    <article
                                      className="set-card simple-match-card"
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
                                        const sideLabel = selectedEvent ? getSlotSideLabel(selectedEvent.eventId, entrantId) : "-";
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
            <div className="dialog-backdrop" onClick={() => setActiveMatchSetId("")}> 
              <section
                className="dialog-panel"
                role="dialog"
                aria-modal="true"
                aria-label="試合詳細"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="dialog-head">
                  <h3>{activeMatch.fullRoundText}</h3>
                  <button type="button" className="ghost" onClick={() => setActiveMatchSetId("")}>閉じる</button>
                </div>
                <p className="meta">setId: {activeMatch.setId} / state: {activeMatch.state}</p>

                <div className="dialog-players">
                  {activeMatch.slots.map((slot, idx) => {
                    const entrantId = slot.entrantId;
                    const entrantMeta = entrantId
                      ? selectedEventMeta?.entrants.find((entrant) => entrant.entrantId === entrantId)
                      : null;
                    const draft = entrantId ? getMetaDraft(selectedEvent.eventId, entrantId) : null;

                    return (
                      <article className="dialog-player-card" key={`${activeMatch.setId}-dialog-${idx}`}>
                        <p className="dialog-player-name">{slot.entrantName}</p>
                        <p className="meta">entrantId: {entrantId ?? "-"}</p>
                        {entrantId && draft && (
                          <>
                            <div className="side-toggle-row">
                              <button
                                type="button"
                                className={`ghost tiny ${draft.playSide === "1P" ? "active-side" : ""}`}
                                onClick={() => setMetaDraft(selectedEvent.eventId, entrantId, { playSide: "1P" })}
                              >
                                1P
                              </button>
                              <button
                                type="button"
                                className={`ghost tiny ${draft.playSide === "2P" ? "active-side" : ""}`}
                                onClick={() => setMetaDraft(selectedEvent.eventId, entrantId, { playSide: "2P" })}
                              >
                                2P
                              </button>
                              <button
                                type="button"
                                className="ghost tiny"
                                onClick={() => setMetaDraft(selectedEvent.eventId, entrantId, { playSide: "" })}
                              >
                                解除
                              </button>
                            </div>
                            <div className="entrant-meta-actions">
                              <button
                                type="button"
                                className="ghost tiny"
                                onClick={() => {
                                  setWinnerId(entrantId);
                                }}
                              >
                                勝者に設定
                              </button>
                              <button
                                type="button"
                                className="ghost tiny"
                                disabled={busy || toApiSlug(slug) === ""}
                                onClick={() => savePlayerMeta(selectedEvent, entrantId, slot.entrantName)}
                              >
                                サイド保存
                              </button>
                            </div>
                            <p className="meta">authCode: {entrantMeta?.authCode ?? "-"}</p>
                          </>
                        )}
                      </article>
                    );
                  })}
                </div>

                <div className="dialog-result-form">
                  <label>
                    winner
                    <select value={winnerId} onChange={(e) => setWinnerId(e.currentTarget.value)}>
                      <option value="">選択してください</option>
                      {activeMatch.slots
                        .filter((slot) => slot.entrantId)
                        .map((slot) => (
                          <option key={slot.entrantId ?? "unknown"} value={slot.entrantId ?? ""}>
                            {slot.entrantName}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label>
                    scoreCsv
                    <input value={scoreCsv} onChange={(e) => setScoreCsv(e.currentTarget.value)} placeholder="例: 3-1" />
                  </label>
                  <label className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={forceOverwrite}
                      onChange={(e) => setForceOverwrite(e.currentTarget.checked)}
                    />
                    必要なら start.gg 側で reset 前提を保持
                  </label>
                </div>

                <div className="dialog-actions">
                  <button
                    type="button"
                    disabled={busy || winnerId.trim() === "" || !isMatchupReady(activeMatch)}
                    onClick={saveLocalResultForMatch}
                  >
                    ローカルに記録
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
