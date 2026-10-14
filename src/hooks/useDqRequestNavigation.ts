import type { AppTab } from "../components/AppShell";
import type { EventSnapshot } from "../domain/bracketDisplay";
import type { FeatureMessage } from "../domain/messages";
import { extractMetaString } from "../domain/messageUtils";
import type { SetSnapshot } from "../domain/bracketProgression";
import { buildDqDraftStateForEntrant } from "../domain/setResultDrafts";
import type { SetResultDraftState } from "./useSetResultDrafts";

type UseDqRequestNavigationOptions = {
  event: EventSnapshot | null;
  resolvedSetsById: Map<string, SetSnapshot>;
  setSelectedPhaseName: (phaseName: string) => void;
  setSelectedPhasePoolKey: (phasePoolKey: string) => void;
  setActiveTab: (tab: AppTab) => void;
  openMatchDialog: (set: SetSnapshot, draftState: SetResultDraftState) => void;
  onError: (error: string) => void;
  onMessage: (message: string) => void;
};

type DqRequestContext = {
  setId: string;
  dqEntrantId: string;
};

function resolveDqRequestContext(
  message: FeatureMessage,
): DqRequestContext | null {
  const directSetId = extractMetaString(message.messageMeta, "dqSetId");
  const directEntrantId = extractMetaString(message.messageMeta, "dqCallEntrantId");

  if (directSetId !== "" && directEntrantId !== "") {
    return { setId: directSetId, dqEntrantId: directEntrantId };
  }

  return null;
}

export function useDqRequestNavigation({
  event,
  resolvedSetsById,
  setSelectedPhaseName,
  setSelectedPhasePoolKey,
  setActiveTab,
  openMatchDialog,
  onError,
  onMessage,
}: UseDqRequestNavigationOptions) {
  function processDqRequestFromMessage(message: FeatureMessage) {
    onError("");
    onMessage("");

    if (!event) {
      onError("先にイベントを選択してください。DQ処理先を開けません。");
      return;
    }
    if (extractMetaString(message.messageMeta, "scopeEventId") !== event.eventId) {
      onError("DQ申請のイベントが現在のイベントと一致しません。");
      return;
    }

    const context = resolveDqRequestContext(message);
    if (!context) {
      onError("DQ申請メッセージから対象setを特定できませんでした。");
      return;
    }

    const targetSet = event.sets.find((set) => set.setId === context.setId);
    if (!targetSet) {
      onError(`対象setが現在のイベント内に見つかりません: ${context.setId}`);
      return;
    }
    if (extractMetaString(message.messageMeta, "phaseGroupId") !== targetSet.phaseGroupId) {
      onError("DQ申請のPoolが対象の試合と一致しません。");
      return;
    }

    const resolvedTargetSet = resolvedSetsById.get(targetSet.setId) ?? targetSet;
    const draftState = buildDqDraftStateForEntrant(resolvedTargetSet, context.dqEntrantId);
    if (!draftState) {
      onError("DQ入力の自動設定に失敗しました。対象プレイヤーまたは対戦カードを確認してください。");
      return;
    }

    const phaseName = targetSet.phaseName && targetSet.phaseName.trim() !== "" ? targetSet.phaseName : "Phase 未設定";
    const phaseGroupName = targetSet.phaseGroupName && targetSet.phaseGroupName.trim() !== "" ? targetSet.phaseGroupName : "Pool 未設定";
    setSelectedPhaseName(phaseName);
    setSelectedPhasePoolKey(targetSet.phaseGroupId ? `id:${targetSet.phaseGroupId}` : `${phaseName}::${phaseGroupName}`);
    setActiveTab("bracket");
    openMatchDialog(targetSet, draftState);
    onMessage("DQ申請から対象setを開きました。DQ入力済みなので「確定」を押すと反映できます。");
  }

  return { processDqRequestFromMessage };
}
