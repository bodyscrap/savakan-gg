import { invoke } from "@tauri-apps/api/core";
import type { AppTab } from "../components/AppShell";
import type { EventSnapshot } from "../domain/bracketDisplay";
import type { MailboxDeliveryMode } from "../components/MessageBox";
import { isValidIpv4, isValidSenderUserId, normalizeCallPhaseGroupName, normalizeCallPhaseName } from "../domain/messageUtils";
import type { SetSlot, SetSnapshot } from "../domain/bracketProgression";
import type { SenderProfile } from "./useSenderProfile";

type UseCallMessageDraftOptions = {
  tournament: { tournamentId: string; name: string } | null;
  event: EventSnapshot | null;
  activeMatch: SetSnapshot | null;
  eventAlias: string;
  senderProfile: SenderProfile;
  communicationDisabled: boolean;
  setCallingEntrantId: (entrantId: string) => void;
  setComposeMessageMeta: (meta: Record<string, unknown> | null) => void;
  setMailboxMethodDraft: (method: string) => void;
  setMailboxSubjectDraft: (subject: string) => void;
  setMessageDeliveryMode: (mode: MailboxDeliveryMode) => void;
  setMessageDeliveryIpDraft: (ip: string) => void;
  setComposeFixedBodyDraft: (body: string | null) => void;
  setGenericMessageBodyDraft: (body: string) => void;
  closeMatchDialog: () => void;
  setActiveTab: (tab: AppTab) => void;
  onError: (error: string) => void;
  onMessage: (message: string) => void;
};

export function resolveCallPhaseName(event: EventSnapshot | null, rawValue: string, phaseOrder: number | null): string {
  const normalized = normalizeCallPhaseName(rawValue);
  const orderMatch = /^order:(\d+)$/.exec(normalized);
  const resolvedPhaseOrder = phaseOrder ?? (orderMatch ? Number(orderMatch[1]) : null);
  if (!orderMatch || resolvedPhaseOrder === null || !event) {
    return normalized;
  }

  const phase = event.phaseGroups?.find((group) => group.phaseOrder === resolvedPhaseOrder);
  if (phase?.phaseName?.trim()) {
    return phase.phaseName.trim();
  }

  const set = event.sets.find(
    (candidate) => candidate.phaseOrder === resolvedPhaseOrder && candidate.phaseName?.trim(),
  );
  return set?.phaseName?.trim() || normalized;
}

export function useCallMessageDraft({
  tournament,
  event,
  activeMatch,
  eventAlias: rawEventAlias,
  senderProfile,
  communicationDisabled,
  setCallingEntrantId,
  setComposeMessageMeta,
  setMailboxMethodDraft,
  setMailboxSubjectDraft,
  setMessageDeliveryMode,
  setMessageDeliveryIpDraft,
  setComposeFixedBodyDraft,
  setGenericMessageBodyDraft,
  closeMatchDialog,
  setActiveTab,
  onError,
  onMessage,
}: UseCallMessageDraftOptions) {
  async function sendCallMessageFromMatch(slot: SetSlot, entrantId: string) {
    onError("");
    onMessage("");

    if (communicationDisabled) {
      onError("ローカル通信を行わない設定のため、プレイヤー呼び出しメッセージは作成できません。設定タブで解除してください。");
      return;
    }

    if (!tournament || !event || !activeMatch) {
      onError("呼び出し元の試合情報が見つかりません。もう一度試してください。");
      return;
    }

    setCallingEntrantId(entrantId);

    try {
      const targetSetId = activeMatch.setId;
      const [playerId] = await invoke<string[]>("derive_player_ids", {
        tournamentId: tournament.tournamentId,
        eventId: event.eventId,
        entrantIds: [entrantId],
      });
      if (!playerId) {
        throw new Error("選手IDを生成できませんでした。");
      }
      const eventAlias = rawEventAlias.trim() || event.name;
      const phaseName = resolveCallPhaseName(event, activeMatch.phaseName ?? "", activeMatch.phaseOrder);
      const phaseGroupName = normalizeCallPhaseGroupName(activeMatch.phaseGroupName ?? "");
      const senderLine = senderProfile.senderName.trim() !== ""
        && isValidSenderUserId(senderProfile.senderUserId)
        && isValidIpv4(senderProfile.bindIp)
        ? `${senderProfile.senderName} (${senderProfile.senderUserId}) / ${senderProfile.bindIp}`
        : "未設定 (設定タブで送信者情報を設定してください)";

      const fixedBody = [
        "【呼び出しメッセージ】",
        `送信者: ${senderLine}`,
        `呼び出しプレイヤー: ${slot.entrantName}`,
        `entrantID: ${entrantId}`,
        `イベントエイリアス: ${eventAlias}`,
        `呼び出し元 tournament/event: ${tournament.name} / ${event.name}`,
        `呼び出し元 phase/pool: ${phaseName} / ${phaseGroupName}`,
      ].join("\n");

      setComposeMessageMeta({
        callId: `${tournament.tournamentId}:${event.eventId}:${phaseName}:${phaseGroupName}:${targetSetId}:${entrantId}`,
        playerId,
        callEntrantId: entrantId,
        callEntrantName: slot.entrantName,
        tournamentId: tournament.tournamentId,
        tournamentName: tournament.name,
        eventId: event.eventId,
        eventName: event.name,
        eventAlias,
        phaseName,
        phaseGroupName,
        setId: targetSetId,
      });
      setMailboxMethodDraft("call_player");
      setMailboxSubjectDraft(`${slot.entrantName}(${eventAlias})`);
      setComposeFixedBodyDraft(fixedBody);
      setGenericMessageBodyDraft("");
      closeMatchDialog();
      setActiveTab("message");
      onMessage(`呼び出しメッセージの下書きを作成しました: ${slot.entrantName} / 補足入力後に「スレッド開始」で送信してください。`);
    } catch (error) {
      onError(String(error));
    } finally {
      setCallingEntrantId("");
    }
  }

  function cancelCallMessageDraft() {
    setComposeFixedBodyDraft(null);
    setComposeMessageMeta(null);
    setMailboxMethodDraft("generic");
    setMailboxSubjectDraft("");
    setMessageDeliveryMode("broadcast");
    setMessageDeliveryIpDraft("");
    setGenericMessageBodyDraft("");
    onMessage("呼び出しメッセージをキャンセルしました。汎用メッセージ入力に戻りました。");
  }

  return { sendCallMessageFromMatch, cancelCallMessageDraft };
}
