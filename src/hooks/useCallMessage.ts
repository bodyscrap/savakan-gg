import { invoke } from "@tauri-apps/api/core";
import type { EventSnapshot } from "../domain/bracketDisplay";
import { canBroadcastCallListSync, normalizeCallPhaseGroupName, normalizeCallPhaseName } from "../domain/messageUtils";
import type { SetSlot, SetSnapshot } from "../domain/bracketProgression";
import type { SenderProfile } from "./useSenderProfile";

type UseCallMessageOptions = {
  tournament: { tournamentId: string; name: string } | null;
  event: EventSnapshot | null;
  activeMatch: SetSnapshot | null;
  eventAlias: string;
  senderProfile: SenderProfile;
  communicationDisabled: boolean;
  setCallingEntrantId: (entrantId: string) => void;
  refreshCalls: () => Promise<void>;
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

export function useCallMessage({
  tournament,
  event,
  activeMatch,
  eventAlias: rawEventAlias,
  senderProfile,
  communicationDisabled,
  setCallingEntrantId,
  refreshCalls,
  onError,
  onMessage,
}: UseCallMessageOptions) {
  async function sendCallMessageFromMatch(slot: SetSlot, entrantId: string) {
    onError("");
    onMessage("");

    if (communicationDisabled) {
      onError("ローカル通信を行わない設定のため、プレイヤー呼び出しは送信できません。設定タブで解除してください。");
      return;
    }

    if (!tournament || !event || !activeMatch) {
      onError("呼び出し元の試合情報が見つかりません。もう一度試してください。");
      return;
    }

    if (!canBroadcastCallListSync(senderProfile, communicationDisabled)) {
      onError("設定タブで送信者名・8桁ユーザーID・ネットワークデバイスを保存してから送信してください。");
      return;
    }
    if (!window.confirm(`${slot.entrantName} を呼び出しますか？\n宛先機能: 呼び出しリスト\n送信先: ブロードキャスト`)) {
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
      const phase = event.phases?.find((candidate) => candidate.name === phaseName)
        ?? event.phases?.find((candidate) => activeMatch.phaseOrder !== null
          && candidate.phaseOrder === activeMatch.phaseOrder);
      const group = event.phaseGroups?.find((candidate) =>
        candidate.phaseGroupId === activeMatch.phaseGroupId || candidate.setIds?.includes(targetSetId));
      const senderLine = `${senderProfile.senderName} (${senderProfile.senderUserId}) / ${senderProfile.bindIp}`;

      const fixedBody = [
        "【呼び出しメッセージ】",
        `送信者: ${senderLine}`,
        `呼び出しプレイヤー: ${slot.entrantName}`,
        `entrantID: ${entrantId}`,
        `イベントエイリアス: ${eventAlias}`,
        `呼び出し元 tournament/event: ${tournament.name} / ${event.name}`,
        `呼び出し元 phase/pool: ${phaseName} / ${phaseGroupName}`,
      ].join("\n");

      await invoke("send_mailbox_message", {
        input: {
          destination: "call_list",
          profile: senderProfile,
          messageType: "normal",
          method: "call_player",
          subject: `${slot.entrantName}(${eventAlias})`,
          body: fixedBody,
          messageMeta: {
            playerId,
            callEntrantId: entrantId,
            callEntrantName: slot.entrantName,
            tournamentId: tournament.tournamentId,
            tournamentName: tournament.name,
            eventId: event.eventId,
            eventName: event.name,
            eventAlias,
            phaseId: phase?.phaseId ?? "",
            phaseName,
            phaseGroupId: activeMatch.phaseGroupId ?? group?.phaseGroupId ?? "",
            phaseGroupName,
            setId: targetSetId,
          },
          deliveryTargetMode: "broadcast",
          deliveryTargetIp: null,
          threadId: null,
          parentMessageId: null,
        },
      });
      await refreshCalls();
      onMessage(`プレイヤー呼び出しを送信しました: ${slot.entrantName}`);
    } catch (error) {
      onError(String(error));
    } finally {
      setCallingEntrantId("");
    }
  }

  return { sendCallMessageFromMatch };
}
