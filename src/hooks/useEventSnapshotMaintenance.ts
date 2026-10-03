import type { Dispatch, SetStateAction } from "react";
import type { EventSnapshot } from "../domain/bracketDisplay";
import type { EventSnapshotProgress } from "../components/CreateSnapshot";
import type { EventManagementSetting } from "../domain/eventManagement";
import { sameSnapshotEventKey } from "../domain/snapshotDisplay";
import { removeSnapshotEvent, saveLastSlug, saveLastSnapshotSelection } from "../domain/tournamentWorkspaceRepository";
import type { LocalSnapshotEventListItem, TournamentWorkspace } from "../domain/tournamentWorkspaceRepository";
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
  restoreWorkspaceGraph: (slug: string, eventId: string) => Promise<TournamentWorkspace>;
  refreshLocalSnapshotEvents: () => Promise<void>;
  loadWorkspace: (slug: string, eventId: string) => Promise<unknown>;
  clearAllDrafts: () => void;
  closeMatchDialog: () => void;
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
      await saveEventAlias(
        normalizedSlug,
        selectedEvent.eventId,
        trimmed === "" ? null : trimmed,
      );
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
      await refreshRemoteSnapshot(normalizedSlug, eventId, perPage);
      clearAllDrafts();
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

  async function restoreGraphFromSnapshot(): Promise<TournamentWorkspace | null> {
    const normalizedSlug = toApiSlug(slug);
    const eventId = selectedEvent?.eventId ?? selectedEventId;
    if (normalizedSlug === "" || eventId === "") {
      setError("先にイベントを選択してください。");
      return null;
    }

    setRestoreDialogOpen(false);
    setBusy(true);
    setError("");
    setMessage("");

    try {
      const restoredWorkspace = await restoreWorkspaceGraph(normalizedSlug, eventId);
      clearAllDrafts();
      closeMatchDialog();
      setMessage("最後に取得したスナップショット時点に復元しました。対象eventの未報告結果は破棄されました。");
      return restoredWorkspace;
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