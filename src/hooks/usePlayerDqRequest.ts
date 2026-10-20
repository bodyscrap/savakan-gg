import { t } from "../i18n";
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { FeatureMessage } from "../domain/messages";
import {
  extractPlayerCallIdentity, extractCallEventMeta, isLikelyPlayerId, isSenderProfileReadyForMessaging,
  isValidIpv4, normalizePlayerId, type SenderMessagingProfile,
} from "../domain/messageUtils";

export type DqRequestDialogState = {
  call: FeatureMessage;
  expectedPlayerId: string;
  callEntrantId: string;
  callEntrantName: string;
};

export async function sendPlayerDqRequest(
  profile: SenderMessagingProfile, call: FeatureMessage, rawPlayerId: string, reason: string,
  communicationDisabled = false,
) {
  if (communicationDisabled) throw new Error(t("ローカル通信を有効にしてください。"));
  const identity = extractPlayerCallIdentity(call);
  const playerId = normalizePlayerId(rawPlayerId);
  if (!identity || call.senderUserId === profile.senderUserId || !isValidIpv4(call.senderIp)) {
    throw new Error(t("DQ申請先の他端末の呼び出し情報が不正です。"));
  }
  if (!isSenderProfileReadyForMessaging(profile)) {
    throw new Error(t("設定タブで送信者情報とネットワークデバイスを保存してください。"));
  }
  if (!isLikelyPlayerId(playerId) || playerId !== identity.expectedPlayerId) {
    throw new Error(t("入力したPLAYER IDが呼び出し対象と一致しません。"));
  }
  await invoke("send_mailbox_message", {
    input: {
      destination: "bracket",
      profile,
      messageType: "dq_request",
      method: "player_dq_request",
      subject: t("DQ申請: {p0}", { p0: call.subject }),
      body: t("DQ申請\n対象: {p0}{p1}", { p0: identity.callEntrantName || identity.callEntrantId, p1: reason.trim() ? t("\n理由: {p0}", { p0: reason.trim() }) : "" }),
      messageMeta: {
        ...call.messageMeta,
        scopeEventId: extractCallEventMeta(call).eventId,
        dqCallMessageId: call.messageId,
        dqCallerSenderUserId: call.senderUserId,
        dqPlayerId: playerId,
        dqCallEntrantId: identity.callEntrantId,
        dqCallEntrantName: identity.callEntrantName,
        dqSetId: identity.setId,
        dqReason: reason.trim(),
      },
      deliveryTargetMode: "direct",
      deliveryTargetIp: call.senderIp,
      threadId: null,
      parentMessageId: null,
    },
  });
}

export function usePlayerDqRequest({
  calls, senderProfile, communicationDisabled, onError, onMessage, stopCamera,
}: {
  calls: FeatureMessage[];
  senderProfile: SenderMessagingProfile;
  communicationDisabled: boolean;
  onError: (error: string) => void;
  onMessage: (message: string) => void;
  stopCamera: () => void;
}) {
  const [dqDialog, setDqDialog] = useState<DqRequestDialogState | null>(null);
  const [dqPlayerIdDraft, setDqPlayerIdDraft] = useState("");
  const [dqReasonDraft, setDqReasonDraft] = useState("");
  const [dqDialogError, setDqDialogError] = useState("");
  const [dqSubmitting, setDqSubmitting] = useState(false);

  useEffect(() => {
    if (!dqDialog) stopCamera();
    return () => stopCamera();
  }, [dqDialog, stopCamera]);

  function openDqRequestDialog(messageId: string) {
    onError("");
    const call = calls.find((item) => item.messageId === messageId);
    const identity = extractPlayerCallIdentity(call ?? null);
    if (communicationDisabled || !isSenderProfileReadyForMessaging(senderProfile) || !call || !identity
      || call.senderUserId === senderProfile.senderUserId || !isValidIpv4(call.senderIp)) {
      onError(t("ローカル通信と送信者設定を確認し、他端末からの未解決の呼び出しを選択してください。"));
      return;
    }
    setDqDialog({ call, ...identity });
    setDqPlayerIdDraft("");
    setDqReasonDraft("");
    setDqDialogError("");
  }
  function closeDqRequestDialog() {
    if (!dqSubmitting) setDqDialog(null);
  }
  async function submitDqRequest() {
    if (dqSubmitting) return;
    if (communicationDisabled || !dqDialog) {
      setDqDialogError(t("DQ申請対象またはローカル通信設定を確認してください。"));
      return;
    }
    const current = calls.find((call) => call.messageId === dqDialog.call.messageId);
    if (!current) {
      setDqDialogError(t("この呼び出しは解決または更新されています。呼び出しリストから開き直してください。"));
      return;
    }
    setDqSubmitting(true);
    setDqDialogError("");
    try {
      await sendPlayerDqRequest(senderProfile, current, dqPlayerIdDraft, dqReasonDraft, communicationDisabled);
      setDqDialog(null);
      onMessage(t("呼び出し元の端末へDQ申請を送信しました。"));
    } catch (error) {
      setDqDialogError(String(error));
    } finally {
      setDqSubmitting(false);
    }
  }
  return {
    dqDialog, dqPlayerIdDraft, setDqPlayerIdDraft, dqReasonDraft, setDqReasonDraft,
    dqDialogError, setDqDialogError, dqSubmitting, openDqRequestDialog, closeDqRequestDialog, submitDqRequest,
  };
}
