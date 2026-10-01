import { useEffect, useMemo, useState, type FormEvent } from "react";
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
  resolveCreatePreviewSelection,
} from "../domain/snapshotDisplay";
import { listLocalSnapshotEvents, persistEventSnapshot, saveLastSlug } from "../domain/tournamentWorkspaceRepository";
import { toApiSlug, toEventApiSlug, toEventSlugInput } from "../domain/slugUtils";

const EVENT_SNAPSHOT_PROGRESS_EVENT = "event_snapshot_progress";

type UseTournamentCreationOptions = {
  slug: string;
  perPage: number;
  setCreateBusy: (busy: boolean) => void;
  setBusy: (busy: boolean) => void;
  setError: (error: string) => void;
  setMessage: (message: string) => void;
  onSnapshotCreated: () => Promise<void>;
};

export function useTournamentCreation({
  slug,
  perPage,
  setCreateBusy,
  setBusy,
  setError,
  setMessage,
  onSnapshotCreated,
}: UseTournamentCreationOptions) {
  const [token, setToken] = useState("");
  const [createPreview, setCreatePreview] = useState<TournamentPreview | null>(null);
  const [createPreviewLoadFailed, setCreatePreviewLoadFailed] = useState(false);
  const [createSelectedEventId, setCreateSelectedEventId] = useState("");
  const [createEventSearchInput, setCreateEventSearchInput] = useState("");
  const [createEventSlugInput, setCreateEventSlugInput] = useState("");
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
    setCreateEventSlugInput(toEventSlugInput(selected?.eventSlug ?? ""));
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
      setMessage("start.ggトークンを保存しました。");
    } catch (error) {
      setError(String(error));
    } finally {
      setBusy(false);
    }
  }

  function applyCreateEventSelection(event: TournamentEventPreviewItem | null, resetAlias = false) {
    setCreateSelectedEventId(event?.eventId ?? "");
    setCreateEventSlugInput(toEventSlugInput(event?.eventSlug ?? ""));
    if (resetAlias) {
      setCreateEventAlias("");
    }
  }

  async function loadCreatePreview(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    const apiSlug = toApiSlug(slug);
    if (apiSlug === "") {
      setError("大会IDを入力してください。");
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
      const preview = await invoke<TournamentPreview>("preview_tournament", { slug: apiSlug });
      setCreatePreview(preview);
      applyCreateEventSelection(resolveCreatePreviewSelection(preview.events, previousSelectedEventId));
      setMessage("tournamentのイベント一覧を取得しました。");
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
    applyCreateEventSelection(selected, true);
  }

  const createFilteredEvents = useMemo(
    () => filterCreatePreviewEvents(createPreview?.events ?? [], createEventSearchInput),
    [createPreview, createEventSearchInput],
  );

  async function createEventSnapshotBySlug() {
    const tournamentSlug = toApiSlug(slug);
    const eventSlug = toEventApiSlug(slug, createEventSlugInput);
    if (tournamentSlug === "" || eventSlug === "") {
      setError("大会IDとevent ID(またはevent slug)を入力してください。");
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
          `このeventのスナップショットは既に存在します。上書きして再取得しますか？\n${existing.slug}`,
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
      await saveLastSlug(tournamentSlug);
      await persistEventSnapshot({
        tournamentSlug,
        eventSlug,
        eventAlias: createEventAlias.trim() === "" ? null : createEventAlias.trim(),
        perPage,
      });
      await onSnapshotCreated();
      setMessage("eventのローカルスナップショットを作成しました。");
    } catch (error) {
      setError(String(error));
    } finally {
      setCreateSnapshotProgress(null);
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
      return createSnapshotProgress.currentSetId
        ? `${details} / set ${createSnapshotProgress.currentSetId} を取得中`
        : details;
    }
    if (createSnapshotProgress.phase === "completed") {
      return "取得完了";
    }
    return "取得中...";
  }, [createSnapshotProgress]);

  return {
    token,
    setToken,
    createPreview,
    createPreviewLoadFailed,
    createSelectedEventId,
    createEventSearchInput,
    setCreateEventSearchInput,
    createEventSlugInput,
    setCreateEventSlugInput,
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
  };
}