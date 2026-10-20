import { t } from "../i18n";
import type { Dispatch, SetStateAction } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { EventSnapshot } from "../domain/bracketDisplay";
import type { EventSnapshotProgress } from "../components/CreateSnapshot";
import type { EventManagementSetting } from "../domain/eventManagement";
import { sameSnapshotEventKey } from "../domain/snapshotDisplay";
import { removeSnapshotEvent, saveLastSlug, saveLastSnapshotSelection } from "../domain/tournamentWorkspaceRepository";
import type {
  LocalSnapshotEventListItem,
  RestoreEventGraphInput,
  RestoreEventGraphResult,
  SnapshotRestoreScope,
  TournamentWorkspace,
} from "../domain/tournamentWorkspaceRepository";
import { toApiSlug, toSlugInput } from "../domain/slugUtils";

type UseEventSnapshotMaintenanceOptions = {
  slug: string;
  selectedEventId: string;
  selectedEvent: Pick<EventSnapshot, "eventId"> | null;
  eventAliasDraft: string;
  perPage: number;
  setBusy: (busy: boolean) => void;
  setError: (error: string) => void;
  setMessage: (message: string) => void;
  setCreateSnapshotProgress: (progress: EventSnapshotProgress | null) => void;
  setRestoreDialogOpen: (open: boolean) => void;
  setSlug: (slug: string) => void;
  setSelectedEventId: (eventId: string) => void;
  setSelectedPhaseName: (phaseName: string) => void;
  setSelectedPhasePoolKey: (key: string) => void;
  setDeletingSnapshotKey: (key: string) => void;
  setWorkspace: (workspace: TournamentWorkspace | null) => void;
  setEventMgmtSettings: Dispatch<SetStateAction<Record<string, EventManagementSetting>>>;
  eventSettingKey: (slug: string, eventId: string) => string;
  snapshot: Pick<TournamentWorkspace["snapshot"], "slug"> | null;
  saveEventAlias: (slug: string, eventId: string, alias: string | null) => Promise<unknown>;
  refreshRemoteSnapshot: (slug: string, eventId: string, perPage: number) => Promise<unknown>;
  restoreWorkspaceGraph: (input: RestoreEventGraphInput) => Promise<RestoreEventGraphResult>;
  refreshLocalSnapshotEvents: () => Promise<void>;
  loadWorkspace: (slug: string, eventId: string) => Promise<unknown>;
  clearAllDrafts: () => void;
  closeMatchDialog: () => void;
  seedSnapshotRefreshRequired: boolean;
  onSeedSnapshotRefreshCompleted: () => void;
  onSeedStateRefreshRequested: () => void;
};

export function useEventSnapshotMaintenance({
  slug,
  selectedEventId,
  selectedEvent,
  eventAliasDraft,
  perPage,
  setBusy,
  setError,
  setMessage,
  setCreateSnapshotProgress,
  setRestoreDialogOpen,
  setSlug,
  setSelectedEventId,
  setSelectedPhaseName,
  setSelectedPhasePoolKey,
  setDeletingSnapshotKey,
  setWorkspace,
  setEventMgmtSettings,
  eventSettingKey,
  snapshot,
  saveEventAlias,
  refreshRemoteSnapshot,
  restoreWorkspaceGraph,
  refreshLocalSnapshotEvents,
  loadWorkspace,
  clearAllDrafts,
  closeMatchDialog,
  seedSnapshotRefreshRequired,
  onSeedSnapshotRefreshCompleted,
  onSeedStateRefreshRequested,
}: UseEventSnapshotMaintenanceOptions) {
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
      await saveLastSlug(item.slug);
      await saveLastSnapshotSelection({
        slug: item.slug,
        eventId: item.eventId,
        phaseName: savedPhaseName === "" ? null : savedPhaseName,
        phaseGroupName: savedPhaseGroupName === "" ? null : savedPhaseGroupName,
      });
      await loadWorkspace(item.slug, item.eventId);

      setSlug(toSlugInput(item.slug));
      setSelectedEventId(item.eventId);
      if (savedPhaseName !== "" && savedPhaseGroupName !== "") {
        setSelectedPhaseName(savedPhaseName);
        setSelectedPhasePoolKey(`${savedPhaseName}::${savedPhaseGroupName}`);
      } else {
        setSelectedPhaseName("");
        setSelectedPhasePoolKey("");
      }
      onSeedStateRefreshRequested();
      closeMatchDialog();
      setMessage(t("イベントを読み込みました: {p0} / {p1}", { p0: item.tournamentName, p1: item.eventName }));
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
      t("このローカルスナップショットを削除しますか？\n{p0} / {p1}", { p0: item.tournamentName, p1: displayEventName }),
    );
    if (!confirmed) {
      return;
    }

    setDeletingSnapshotKey(`${item.slug}:${item.eventId}`);
    setError("");
    setMessage("");

    try {
      await removeSnapshotEvent(item.slug, item.eventId);

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
      setMessage(t("削除しました: {p0} / {p1}", { p0: item.tournamentName, p1: displayEventName }));
    } catch (err) {
      setError(String(err));
    } finally {
      setDeletingSnapshotKey("");
    }
  }

  async function saveSelectedEventAlias() {
    if (!selectedEvent) {
      setError(t("先にイベントを選択してください。"));
      return;
    }

    const normalizedSlug = toApiSlug(slug);
    if (normalizedSlug === "") {
      setError(t("大会slugが確認できません。イベントを選択してください。"));
      return;
    }

    const trimmed = eventAliasDraft.trim();
    setBusy(true);
    setError("");
    setMessage("");

    try {
      await saveEventAlias(
        normalizedSlug,
        selectedEvent.eventId,
        trimmed === "" ? null : trimmed,
      );
      await refreshLocalSnapshotEvents();
      setMessage(trimmed === "" ? t("エイリアス名を未設定にしました。") : t("エイリアス名を保存しました: {p0}", { p0: trimmed }));
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
      setError(t("先にイベントを選択してください。"));
      return;
    }

    setError("");
    setMessage("");
    if (seedSnapshotRefreshRequired && !window.confirm(
      t("Seed反映直後はstart.ggのブラケットが未Startのため、まだスナップショットを更新できません。start.ggでブラケットをStartした後であることを確認しましたか？"),
    )) {
      setMessage(t("start.ggでブラケットをStartしてから、スナップショットを更新してください。"));
      return;
    }

    setBusy(true);

    try {
      const hasUnreportedSeedShuffle = await invoke<boolean>(
        "has_unreported_initial_phase_seed_shuffle",
        { slug: normalizedSlug, eventId },
      );
      if (hasUnreportedSeedShuffle && !window.confirm(
        t("未報告の初期Seed入替があります。スナップショットを更新するとローカルのSeed入替とブラケット表示が失われ、start.gg側の状態に置き換わります。更新を続行しますか？"),
      )) {
        setMessage(t("スナップショットの更新をキャンセルしました。"));
        return;
      }
      setCreateSnapshotProgress({
        phase: "starting",
        completedSets: 0,
        totalSets: null,
        currentPage: null,
        currentSetId: null,
      });
      await refreshRemoteSnapshot(normalizedSlug, eventId, perPage);
      clearAllDrafts();
      closeMatchDialog();
      setCreateSnapshotProgress(null);
      await refreshLocalSnapshotEvents();
      onSeedSnapshotRefreshCompleted();
      setMessage(seedSnapshotRefreshRequired
        ? t("ブラケットStart後のスナップショットを更新しました。確定済みSetの結果を報告できます。")
        : t("スナップショットを更新しました。未報告のローカル結果・途中経過は破棄され、start.gg状態に合わせました。"));
    } catch (err) {
      setError(String(err));
    } finally {
      setCreateSnapshotProgress(null);
      setBusy(false);
    }
  }

  async function restoreGraphFromSnapshot(
    scope: SnapshotRestoreScope,
    phaseGroupId: string | null,
    phaseName: string | null,
    discardSeedShuffle = false,
  ): Promise<RestoreEventGraphResult | null> {
    const normalizedSlug = toApiSlug(slug);
    const eventId = selectedEvent?.eventId ?? selectedEventId;
    if (normalizedSlug === "" || eventId === "") {
      setError(t("先にイベントを選択してください。"));
      return null;
    }

    setRestoreDialogOpen(false);
    setBusy(true);
    setError("");
    setMessage("");

    try {
      const restoredResult = await restoreWorkspaceGraph({
        slug: normalizedSlug,
        eventId,
        scope,
        phaseGroupId,
        phaseName,
        discardSeedShuffle,
      });
      onSeedStateRefreshRequested();
      if (scope === "all") {
        clearAllDrafts();
      }
      closeMatchDialog();
      setMessage(scope === "all"
        ? t("最後に取得したスナップショット時点に全体を復元しました。{p0}対象eventの未報告結果は破棄されました。", { p0: discardSeedShuffle ? t("Seedの並び替えを破棄しました。") : t("Seedの並び順は維持しました。") })
        : t("最後に取得したスナップショット時点に復元しました。影響set: {p0}件", { p0: restoredResult.affectedSetIds.length }));
      return restoredResult;
    } catch (err) {
      setError(String(err));
      return null;
    } finally {
      setBusy(false);
    }
  }

  return {
    selectLocalSnapshotEvent,
    deleteLocalSnapshotEvent,
    saveSelectedEventAlias,
    updateSnapshot,
    restoreGraphFromSnapshot,
  };
}