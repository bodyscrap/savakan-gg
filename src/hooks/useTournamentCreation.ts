import { t, useLanguage } from "../i18n";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  type EventSnapshotProgress,
  type TournamentEventPreviewItem,
  type TournamentPreview,
} from "../components/CreateSnapshot";
import {
  filterCreatePreviewEvents,
  findCreatePreviewEvent,
  formatDefaultSnapshotName,
  resolveCreatePreviewSelection,
} from "../domain/snapshotDisplay";
import {
  listLocalSnapshotEvents,
  persistEventSnapshot,
  persistLocalEventSnapshot,
  loadStartggCreateSlug,
  saveStartggCreateSlug,
  type CreateLocalEventSnapshotInput,
} from "../domain/tournamentWorkspaceRepository";
import { toApiSlug, toEventApiSlug, toSlugInput } from "../domain/slugUtils";

const EVENT_SNAPSHOT_PROGRESS_EVENT = "event_snapshot_progress";

type UseTournamentCreationOptions = {
  perPage: number;
  setCreateBusy: (busy: boolean) => void;
  setBusy: (busy: boolean) => void;
  setError: (error: string) => void;
  setMessage: (message: string) => void;
  onSnapshotCreated: () => Promise<void>;
};

export function useTournamentCreation({
  perPage,
  setCreateBusy,
  setBusy,
  setError,
  setMessage,
  onSnapshotCreated,
}: UseTournamentCreationOptions) {
  const [token, setToken] = useState("");
  const [createTournamentSlug, setCreateTournamentSlug] = useState("");
  const createTournamentSlugEditedRef = useRef(false);
  const [createPreview, setCreatePreview] = useState<TournamentPreview | null>(null);
  const [createPreviewLoadFailed, setCreatePreviewLoadFailed] = useState(false);
  const [createSelectedEventId, setCreateSelectedEventId] = useState("");
  const [createEventSearchInput, setCreateEventSearchInput] = useState("");
  const [createEventAlias, setCreateEventAlias] = useState("");
  const [createSnapshotProgress, setCreateSnapshotProgress] = useState<EventSnapshotProgress | null>(null);

  useEffect(() => {
    let alive = true;
    void invoke<string | null>("load_saved_startgg_token")
      .then((savedToken) => {
        if (alive && savedToken?.trim()) {
          setToken(savedToken);
        }
      })
      .catch(() => {
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    void loadStartggCreateSlug()
      .then((savedSlug) => {
        if (alive && !createTournamentSlugEditedRef.current && savedSlug?.trim()) {
          setCreateTournamentSlug(toSlugInput(savedSlug));
        }
      })
      .catch((error) => {
        if (alive) {
          setError(String(error));
        }
      });
    return () => {
      alive = false;
    };
  }, [setError]);

  function handleCreateTournamentSlugChange(value: string) {
    createTournamentSlugEditedRef.current = true;
    setCreateTournamentSlug(value);
  }

  useEffect(() => {
    let alive = true;
    let unlisten: (() => void) | null = null;
    void (async () => {
      try {
        const off = await listen<EventSnapshotProgress>(EVENT_SNAPSHOT_PROGRESS_EVENT, (event) => {
          if (!alive) {
            return;
          }
          setCreateSnapshotProgress(event.payload.phase === "completed" ? null : event.payload);
        });
        unlisten = off;
      } catch {
      }
    })();
    return () => {
      alive = false;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    if (!createPreview) {
      return;
    }
    const selected = resolveCreatePreviewSelection(createPreview.events, createSelectedEventId);
    if (selected?.eventId === createSelectedEventId) {
      return;
    }
    setCreateSelectedEventId(selected?.eventId ?? "");
    setCreateEventAlias(selected ? formatDefaultSnapshotName(createPreview.name, selected.eventName) : "");
  }, [createPreview, createSelectedEventId]);

  async function saveStartggToken() {
    await invoke("save_startgg_token", { token });
  }

  async function saveToken(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await saveStartggToken();
      setMessage(t("start.ggトークンを保存しました。"));
    } catch (error) {
      setError(String(error));
    } finally {
      setBusy(false);
    }
  }

  function applyCreateEventSelection(event: TournamentEventPreviewItem | null, tournamentName: string) {
    setCreateSelectedEventId(event?.eventId ?? "");
    setCreateEventAlias(event ? formatDefaultSnapshotName(tournamentName, event.eventName) : "");
  }

  async function loadCreatePreview(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    const apiSlug = toApiSlug(createTournamentSlug);
    if (apiSlug === "") {
      setError(t("大会IDを入力してください。"));
      return;
    }
    const previousSelectedEventId = createSelectedEventId;
    setCreateBusy(true);
    setError("");
    setMessage("");
    setCreateSnapshotProgress(null);
    setCreatePreview(null);
    setCreatePreviewLoadFailed(false);
    setCreateEventSearchInput("");
    try {
      await saveStartggToken();
      await saveStartggCreateSlug(createTournamentSlug.trim());
      const preview = await invoke<TournamentPreview>("preview_tournament", { slug: apiSlug });
      setCreatePreview(preview);
      applyCreateEventSelection(resolveCreatePreviewSelection(preview.events, previousSelectedEventId), preview.name);
      setMessage(t("tournamentのevent一覧を取得しました。"));
    } catch (error) {
      setCreatePreviewLoadFailed(true);
      setError(String(error));
    } finally {
      setCreateBusy(false);
    }
  }

  function handleCreateEventDropdownChange(nextEventId: string) {
    if (!createPreview) {
      return;
    }
    const selected = findCreatePreviewEvent(createPreview.events, nextEventId);
    if (!selected || selected.eventId === createSelectedEventId) {
      return;
    }
    applyCreateEventSelection(selected, createPreview.name);
  }

  const createFilteredEvents = useMemo(
    () => filterCreatePreviewEvents(createPreview?.events ?? [], createEventSearchInput),
    [createPreview, createEventSearchInput],
  );

  async function createEventSnapshotBySlug() {
    const tournamentSlug = toApiSlug(createTournamentSlug);
    const selectedEvent = findCreatePreviewEvent(createPreview?.events ?? [], createSelectedEventId);
    const eventSlug = selectedEvent ? toEventApiSlug(createTournamentSlug, selectedEvent.eventSlug ?? "") : "";
    if (tournamentSlug === "" || eventSlug === "") {
      setError(t("大会IDを入力し、event一覧からeventを選択してください。"));
      return;
    }

    if (createSelectedEventId !== "") {
      try {
        const existingItems = await listLocalSnapshotEvents();
        const existing = existingItems.find((item) =>
          toApiSlug(item.slug) === tournamentSlug
          && item.eventId === createSelectedEventId,
        );
        if (existing && !window.confirm(
          t("このeventのスナップショットは既に存在します。上書きして再取得しますか？\n{p0}", { p0: existing.slug }),
        )) {
          return;
        }
      } catch (error) {
        setError(String(error));
        return;
      }
    }

    setCreateBusy(true);
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
      await saveStartggToken();
      await saveStartggCreateSlug(createTournamentSlug.trim());
      await persistEventSnapshot({
        tournamentSlug,
        eventSlug,
        eventAlias: createEventAlias.trim() === "" ? null : createEventAlias.trim(),
        perPage,
      });
      await onSnapshotCreated();
      setMessage(t("eventのローカルスナップショットを作成しました。"));
    } catch (error) {
      setError(String(error));
    } finally {
      setCreateSnapshotProgress(null);
      setCreateBusy(false);
    }
  }

  async function createLocalEventSnapshot(input: CreateLocalEventSnapshotInput) {
    setCreateBusy(true);
    setError("");
    setMessage("");
    try {
      const existingItems = await listLocalSnapshotEvents();
      const matches = existingItems.filter((item) => item.origin === "local"
        && item.tournamentName.trim() === input.tournamentName.trim()
        && item.eventName.trim() === input.eventName.trim());
      if (matches.length > 1) {
        throw new Error(t("同じ大会名・イベント名のローカルイベントが複数あります。不要なイベントを削除してから作成してください。"));
      }
      const existing = matches[0];
      if (existing && !window.confirm(t(
        "同じ大会名・イベント名のローカルイベントが既に存在します。\n{p0} / {p1}\n\n上書き作成すると、既存の参加者・ブラケット・試合結果・配信開始記録を置き換えます。この操作は元に戻せません。上書き作成しますか？",
        { p0: existing.tournamentName, p1: existing.eventName },
      ))) return;
      await persistLocalEventSnapshot({ ...input, overwriteEventId: existing?.eventId });
      await onSnapshotCreated();
      setMessage(t("ローカルeventのスナップショットを作成しました。"));
    } catch (error) {
      setError(String(error));
    } finally {
      setCreateBusy(false);
    }
  }

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
    return Math.max(0, Math.min(100, (createSnapshotProgress.completedSets / createSnapshotProgress.totalSets) * 100));
  }, [createSnapshotProgress]);

  const language = useLanguage();
  const createSnapshotProgressLabel = useMemo(() => {
    if (!createSnapshotProgress) {
      return "";
    }
    if (createSnapshotProgress.phase === "starting") {
      return t("開始準備中...");
    }
    if (createSnapshotProgress.phase === "requestingEventPage") {
      return t("ページ{p0}を取得中", { p0: createSnapshotProgress.currentPage ?? 1 });
    }
    if (createSnapshotProgress.phase === "requestingTournamentPreview") {
      return t("大会event一覧を取得中");
    }
    if (createSnapshotProgress.phase === "requestingTournamentSnapshot") {
      return t("大会snapshotへ切替えて取得中");
    }
    if (createSnapshotProgress.phase === "discovering") {
      const pageText = createSnapshotProgress.currentPage !== null
        ? t("ページ{p0}を確認済み", { p0: createSnapshotProgress.currentPage })
        : t("ページを確認中");
      return t("{p0}（対象set数を確認中）", { p0: pageText });
    }
    if (createSnapshotProgress.phase === "requestingSetDetails") {
      const total = createSnapshotProgress.totalSets ?? 0;
      const details = total > 0
        ? t("{p0}/{p1} set処理済み", { p0: createSnapshotProgress.completedSets, p1: total })
        : t("{p0} set処理済み", { p0: createSnapshotProgress.completedSets });
      const currentSet = createSnapshotProgress.currentSetId
        ? t("set {p0} を含むbatch", { p0: createSnapshotProgress.currentSetId })
        : t("set詳細batch");
      return t("{p0} / {p1}を取得中", { p0: details, p1: currentSet });
    }
    if (createSnapshotProgress.phase === "fetchingSetDetails") {
      const total = createSnapshotProgress.totalSets ?? 0;
      const details = total > 0
        ? t("{p0}/{p1} set処理済み", { p0: createSnapshotProgress.completedSets, p1: total })
        : t("{p0} set処理済み", { p0: createSnapshotProgress.completedSets });
      return createSnapshotProgress.currentSetId
        ? t("{p0} / set {p1} を取得中", { p0: details, p1: createSnapshotProgress.currentSetId })
        : details;
    }
    if (createSnapshotProgress.phase === "completed") {
      return t("取得完了");
    }
    return t("取得中...");
  }, [createSnapshotProgress, language]);

  return {
    token,
    setToken,
    createTournamentSlug,
    handleCreateTournamentSlugChange,
    createPreview,
    createPreviewLoadFailed,
    createSelectedEventId,
    createEventSearchInput,
    setCreateEventSearchInput,
    createEventAlias,
    setCreateEventAlias,
    createSnapshotProgress,
    setCreateSnapshotProgress,
    createFilteredEvents,
    createSnapshotProgressPercent,
    createSnapshotProgressLabel,
    saveToken,
    loadCreatePreview,
    handleCreateEventDropdownChange,
    createEventSnapshotBySlug,
    createLocalEventSnapshot,
  };
}