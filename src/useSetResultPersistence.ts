import { invoke } from "@tauri-apps/api/core";
import {
  isCompletedSet,
  isInactiveGrandFinalReset,
  type EventSnapshot,
} from "./bracketDisplay";
import type { SetSlot, SetSnapshot } from "./bracketProgression";
import type { SetResultDraftState, SetScoreDraft } from "./useSetResultDrafts";

type SlotScore = { entrantId: string; score: number };
type SideDrafts = Record<string, "1P" | "2P" | "">;

type SaveSetResultInput = {
  slug: string;
  event: EventSnapshot;
  setId: string;
  set: SetSnapshot;
  confirmed: boolean;
  directWinnerId: string | null;
  scoreDrafts: SetScoreDraft;
  sideDrafts: SideDrafts;
};

type SaveMatchResultInput = Omit<SaveSetResultInput, "event" | "setId" | "set"> & {
  event: EventSnapshot | null;
  set: SetSnapshot | null;
};

type ResetSetResultCascadeResult<TWorkspace> = {
  workspace: TWorkspace;
  affectedSetIds: string[];
  remoteResetApplied: boolean;
};

type UseSetResultPersistenceOptions<TWorkspace> = {
  setWorkspace: (workspace: TWorkspace) => void;
  setBusy: (busy: boolean) => void;
  setError: (error: string) => void;
  setMessage: (message: string) => void;
  saveSides: (
    event: EventSnapshot,
    set: SetSnapshot,
    sideDrafts: SideDrafts,
  ) => Promise<SideDrafts | void>;
  buildSlotScores: (set: SetSnapshot, drafts: SetScoreDraft) => SlotScore[];
  resolveWinnerId: (set: SetSnapshot, drafts: SetScoreDraft) => string;
  syncOverlayScores: (set: SetSnapshot, slotScores: SlotScore[], sideDrafts?: SideDrafts) => Promise<void>;
  saveSetDraft: (setId: string, draft: SetResultDraftState) => void;
  removeInterimDraft: (setId: string) => void;
  removeDraftsForSet: (setId: string) => void;
  clearAllDrafts: () => void;
  restoreSetDraftState: (workspace: TWorkspace, eventId: string, setId: string) => void;
  refreshSnapshotEvents: () => Promise<void>;
  closeMatchDialog: () => void;
};

export function useSetResultPersistence<TWorkspace>({
  setWorkspace,
  setBusy,
  setError,
  setMessage,
  saveSides,
  buildSlotScores,
  resolveWinnerId,
  syncOverlayScores,
  saveSetDraft,
  removeInterimDraft,
  removeDraftsForSet,
  clearAllDrafts,
  restoreSetDraftState,
  refreshSnapshotEvents,
  closeMatchDialog,
}: UseSetResultPersistenceOptions<TWorkspace>) {
  async function saveLocalResult(input: SaveSetResultInput) {
    setBusy(true);
    setError("");
    setMessage("");

    try {
      await invoke("save_last_slug", { slug: input.slug });
      const savedSideDrafts = await saveSides(input.event, input.set, input.sideDrafts);
      const overlaySideDrafts = savedSideDrafts ?? input.sideDrafts;

      const directWin = input.directWinnerId !== null;
      const slotScores = directWin
        ? input.set.slots
          .filter((slot): slot is SetSlot & { entrantId: string } => slot.entrantId !== null)
          .map((slot) => ({ entrantId: slot.entrantId, score: 0 }))
        : buildSlotScores(input.set, input.scoreDrafts);
      const winnerId = input.directWinnerId ?? resolveWinnerId(input.set, input.scoreDrafts);

      if (winnerId === "") {
        if (input.confirmed) {
          setError("スコアから勝者を特定できませんでした。入力を確認してください。");
          return;
        }

        const workspace = await invoke<TWorkspace>("save_local_set_scores", {
          input: {
            slug: input.slug,
            eventId: input.event.eventId,
            setId: input.setId,
            slotScores,
          },
        });
        setWorkspace(workspace);
        removeDraftsForSet(input.setId);

        let overlaySyncFailed = false;
        try {
          await syncOverlayScores(input.set, slotScores, overlaySideDrafts);
        } catch {
          overlaySyncFailed = true;
        }

        setMessage(
          overlaySyncFailed
            ? "勝者未確定のため結果は確定せず、現在スコアを更新しました。オーバーレイ同期には失敗しましたが、ローカル保存は維持されています。"
            : "勝者未確定のため結果は確定せず、現在スコアを更新しました。オーバーレイへも同期済みです。",
        );
        return;
      }

      const workspace = await invoke<TWorkspace>("save_local_set_result", {
        input: {
          slug: input.slug,
          eventId: input.event.eventId,
          setId: input.setId,
          winnerId,
          confirmed: input.confirmed,
          directWin,
          slotScores,
        },
      });
      setWorkspace(workspace);
      saveSetDraft(input.setId, {
        winnerId,
        scoreDrafts: input.scoreDrafts,
        directWin,
      });
      removeInterimDraft(input.setId);

      let overlaySyncFailed = false;
      try {
        await syncOverlayScores(input.set, slotScores, overlaySideDrafts);
      } catch {
        overlaySyncFailed = true;
      }

      const saveMessage =
        input.confirmed
          ? "結果を確定しました。確定済みの試合だけが一括報告の対象になります。"
          : "入力を保存しました。確定すると一括報告の対象になります。";
      setMessage(
        overlaySyncFailed
          ? `${saveMessage} オーバーレイ同期には失敗しましたが、ローカル保存は維持されています。`
          : saveMessage,
      );
      if (input.confirmed) {
        closeMatchDialog();
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  async function saveMatchResult(input: SaveMatchResultInput) {
    const event = input.event;
    const set = input.set;
    if (!event) {
      setError("イベントが選択されていません。");
      return;
    }
    if (!set) {
      setError("試合が選択されていません。");
      return;
    }
    if (isCompletedSet(set)) {
      setError("確定済みsetの結果は変更できません。修正する場合は「影響setを取消」からやり直してください。");
      return;
    }
    if (isInactiveGrandFinalReset(set, event)) {
      setError("Winners側のプレイヤーがGrand Finalに勝利したため、Grand Final Resetは行われません。");
      return;
    }

    await saveLocalResult({ ...input, event, set, setId: set.setId });
  }

  async function discardAllLocalDrafts(input: { slug: string; eventId: string }) {
    setBusy(true);
    setError("");
    setMessage("");

    try {
      const workspace = await invoke<TWorkspace>("clear_local_set_result_drafts", {
        slug: input.slug,
        eventId: input.eventId,
      });
      setWorkspace(workspace);
      clearAllDrafts();
      closeMatchDialog();
      await refreshSnapshotEvents();
      setMessage("全下書きを破棄しました。スナップショットの内容に戻しました。");
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  async function discardLocalDraftForSet(input: { slug: string; eventId: string; setId: string }) {
    setBusy(true);
    setError("");
    setMessage("");

    try {
      const workspace = await invoke<TWorkspace>("clear_local_set_result_draft_for_set", {
        input,
      });
      setWorkspace(workspace);
      removeDraftsForSet(input.setId);
      restoreSetDraftState(workspace, input.eventId, input.setId);
      await refreshSnapshotEvents();
      setMessage("このsetの下書きを破棄しました。保存用スナップショットの内容に戻しました。");
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  async function discardDraftsForEvent(slug: string, event: EventSnapshot | null) {
    if (!event) {
      return;
    }

    await discardAllLocalDrafts({ slug, eventId: event.eventId });
  }

  async function discardDraftForMatch(
    slug: string,
    event: EventSnapshot | null,
    set: SetSnapshot | null,
  ) {
    if (!event) {
      setError("先にイベントを選択してください。");
      return;
    }
    if (!set) {
      setError("試合が選択されていません。");
      return;
    }

    await discardLocalDraftForSet({ slug, eventId: event.eventId, setId: set.setId });
  }

  async function resetLocalSetResultCascade(input: {
    slug: string;
    eventId: string;
    setId: string;
    perPage: number;
  }) {
    setBusy(true);
    setError("");
    setMessage("");

    try {
      const result = await invoke<ResetSetResultCascadeResult<TWorkspace>>(
        "reset_set_result_cascade",
        { input: { ...input, resetRemote: false } },
      );
      setWorkspace(result.workspace);
      closeMatchDialog();
      setMessage(`結果をローカルで取り消しました。${result.affectedSetIds.length} 件のsetを更新しています。`);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  async function resetMatchResultCascade(input: {
    slug: string;
    event: EventSnapshot | null;
    set: SetSnapshot | null;
    perPage: number;
  }) {
    if (!input.event) {
      setError("先にイベントを選択してください。");
      return;
    }
    if (!input.set) {
      setError("試合が選択されていません。");
      return;
    }

    const confirmed = window.confirm("このsetと影響するsetの結果をローカルで取り消します。実行しますか？");
    if (!confirmed) {
      return;
    }

    await resetLocalSetResultCascade({
      slug: input.slug,
      eventId: input.event.eventId,
      setId: input.set.setId,
      perPage: input.perPage,
    });
  }

  return {
    saveLocalResult,
    saveMatchResult,
    discardAllLocalDrafts,
    discardLocalDraftForSet,
    discardDraftsForEvent,
    discardDraftForMatch,
    resetLocalSetResultCascade,
    resetMatchResultCascade,
  };
}