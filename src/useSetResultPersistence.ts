import { invoke } from "@tauri-apps/api/core";
import type { EventSnapshot } from "./bracketDisplay";
import type { SetSlot, SetSnapshot } from "./bracketProgression";
import type { SetResultDraftState, SetScoreDraft } from "./useSetResultDrafts";

type SlotScore = { entrantId: string; score: number };

type SaveSetResultInput = {
  slug: string;
  event: EventSnapshot;
  setId: string;
  set: SetSnapshot;
  confirmed: boolean;
  directWinnerId: string | null;
  scoreDrafts: SetScoreDraft;
  sideDrafts: Record<string, "1P" | "2P" | "">;
};

type UseSetResultPersistenceOptions<TWorkspace> = {
  setWorkspace: (workspace: TWorkspace) => void;
  setBusy: (busy: boolean) => void;
  setError: (error: string) => void;
  setMessage: (message: string) => void;
  saveSides: (
    event: EventSnapshot,
    set: SetSnapshot,
    sideDrafts: Record<string, "1P" | "2P" | "">,
  ) => Promise<void>;
  buildSlotScores: (set: SetSnapshot, drafts: SetScoreDraft) => SlotScore[];
  resolveWinnerId: (set: SetSnapshot, drafts: SetScoreDraft) => string;
  syncOverlayScores: (set: SetSnapshot, slotScores: SlotScore[]) => Promise<void>;
  saveSetDraft: (setId: string, draft: SetResultDraftState) => void;
  removeInterimDraft: (setId: string) => void;
  removeDraftsForSet: (setId: string) => void;
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
  closeMatchDialog,
}: UseSetResultPersistenceOptions<TWorkspace>) {
  async function saveLocalResult(input: SaveSetResultInput) {
    setBusy(true);
    setError("");
    setMessage("");

    try {
      await invoke("save_last_slug", { slug: input.slug });
      await saveSides(input.event, input.set, input.sideDrafts);

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

        try {
          await syncOverlayScores(input.set, slotScores);
        } catch {
          // オーバーレイ反映失敗は入力中の進行を止めない
        }

        setMessage("勝者未確定のため結果は確定せず、現在スコアを更新しました。オーバーレイへも同期済みです。");
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

      try {
        await syncOverlayScores(input.set, slotScores);
      } catch {
        // local結果保存は成功しているため、オーバーレイ反映失敗は致命扱いにしない
      }

      setMessage(
        input.confirmed
          ? "結果を確定しました。確定済みの試合だけが一括報告の対象になります。"
          : "入力を保存しました。確定すると一括報告の対象になります。",
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

  return { saveLocalResult };
}