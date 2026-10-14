import { useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { FeatureMessage } from "../domain/messages";
import {
  buildScopedMessageMeta, getExternalEditRequest, isSenderProfileReadyForMessaging,
  isValidIpv4, isValidSenderUserId,
  type ExternalEditRequest, type ExternalScoreReport, type ExternalScoreSyncRequest,
  type MessageScope, type SenderMessagingProfile,
} from "../domain/messageUtils";
import { useFeatureInbox } from "./useFeatureInbox";

type BracketInbox = {
  messages: FeatureMessage[];
  processedMessageIds: string[];
  senderContacts: Array<{ senderUserId: string; senderName: string; senderIp: string }>;
};

type MessagingOptions = {
  senderProfile: SenderMessagingProfile;
  scope: MessageScope | null;
  communicationDisabled: boolean;
  refresh: () => Promise<void>;
  onError: (error: string) => void;
  onMessage: (message: string) => void;
};

export function createBracketMessaging({
  senderProfile, scope, communicationDisabled, refresh, onError, onMessage,
}: MessagingOptions) {
  const senderReady = isSenderProfileReadyForMessaging(senderProfile);

  async function send(input: {
    method: string;
    subject: string;
    body: string;
    messageMeta: Record<string, unknown> | null;
    deliveryTargetMode: "broadcast" | "direct";
    deliveryTargetIp: string | null;
  }) {
    await invoke<FeatureMessage>("send_mailbox_message", {
      input: {
        ...input,
        destination: "bracket",
        profile: senderProfile,
        messageType: "normal",
        threadId: null,
        parentMessageId: null,
      },
    });
    await refresh();
  }

  async function sendExternalEditRequest(input: ExternalEditRequest): Promise<boolean> {
    onError("");
    onMessage("");
    if (communicationDisabled || !senderReady || !isValidIpv4(senderProfile.broadcastSubnetMask)) {
      onError("ローカル通信を有効にし、設定タブで送信者情報とネットワークデバイスを保存してください。");
      return false;
    }
    if (!scope || input.eventId !== scope.eventId || input.tournamentId !== scope.tournamentId) {
      onError("申請対象イベントが現在のイベント選択と一致しません。");
      return false;
    }
    if ([
      input.tournamentId, input.slug, input.eventId, input.eventName,
      input.phaseName, input.phaseGroupId, input.phaseGroupName,
    ].some((value) => value.trim() === "") || !isValidSenderUserId(senderProfile.senderUserId)) {
      onError("外部報告申請に必要なイベント・プール・送信者情報が不足しています。");
      return false;
    }
    try {
      await send({
        method: "external_edit_request",
        subject: `外部報告申請: ${input.eventName} / ${input.phaseName} / ${input.phaseGroupName}`,
        body: `${senderProfile.senderName.trim()} (${senderProfile.senderUserId.trim()}) から外部報告申請が届きました。 対象: ${input.eventName} / ${input.phaseName} / ${input.phaseGroupName}`,
        messageMeta: buildScopedMessageMeta({
          externalEditRequest: true,
          externalEditTournamentId: input.tournamentId,
          externalEditSlug: input.slug,
          externalEditEventId: input.eventId,
          externalEditEventName: input.eventName,
          externalEditPhaseName: input.phaseName,
          externalEditPhaseGroupId: input.phaseGroupId,
          externalEditPhaseGroupName: input.phaseGroupName,
          externalEditPhaseGroupDisplayIdentifier: input.phaseGroupDisplayIdentifier ?? "",
          externalEditorName: senderProfile.senderName.trim(),
          externalEditorSenderUserId: senderProfile.senderUserId.trim(),
        }, scope),
        deliveryTargetMode: "broadcast",
        deliveryTargetIp: null,
      });
      onMessage(`外部報告申請をブロードキャストしました: ${input.phaseName} / ${input.phaseGroupName}`);
      return true;
    } catch (error) {
      onError(String(error));
      return false;
    }
  }

  function canReplyToExternalEditRequest(message: FeatureMessage) {
    return getExternalEditRequest(message) !== null
      && !communicationDisabled && senderReady
      && message.senderUserId !== senderProfile.senderUserId
      && isValidIpv4(message.senderIp.trim());
  }

  async function replyToExternalEditRequest(message: FeatureMessage, accepted: boolean): Promise<boolean> {
    onError("");
    onMessage("");
    const request = getExternalEditRequest(message);
    if (!request || !canReplyToExternalEditRequest(message)) {
      onError("外部報告申請への応答に必要な申請情報、送信者情報、または返信先がありません。");
      return false;
    }
    try {
      await send({
        method: "external_edit_request_response",
        subject: `Re: ${message.subject}`,
        body: accepted
          ? "外部報告申請を受理しました。対象フェーズ/プールのスコア編集をロックし、申請者を外部報告者に設定しました。"
          : "外部報告申請を拒否しました。",
        messageMeta: buildScopedMessageMeta({
          requestMessageId: message.messageId,
          externalEditRequestResponse: accepted ? "accepted" : "rejected",
          externalEditTournamentId: request.tournamentId,
          externalEditEventId: request.eventId,
          externalEditPhaseGroupId: request.phaseGroupId,
        }, {
          tournamentId: request.tournamentId, slug: request.slug, eventId: request.eventId,
          phaseName: request.phaseName, phaseGroupName: request.phaseGroupName,
        }),
        deliveryTargetMode: "direct",
        deliveryTargetIp: message.senderIp.trim(),
      });
      onMessage(accepted ? "外部報告申請を受理し、応答しました。" : "外部報告申請を拒否し、応答しました。");
      return true;
    } catch (error) {
      onError(String(error));
      return false;
    }
  }

  async function sendExternalScoreReports(
    reports: ExternalScoreReport[], deliveryTargetIp: string | null = null, resetPool = false,
  ) {
    if (communicationDisabled || !senderReady || !isValidIpv4(senderProfile.broadcastSubnetMask)) {
      throw new Error("外部報告の送信には有効な送信者情報とローカル通信設定が必要です。");
    }
    if (reports.length === 0) {
      throw new Error("送信する外部報告がありません。");
    }
    if (deliveryTargetIp !== null && !isValidIpv4(deliveryTargetIp)) {
      throw new Error("外部報告の返信先IPが不正です。");
    }
    const first = reports[0];
    await send({
      method: "external_score_report",
      subject: `外部報告: ${first.eventName} / ${first.phaseName} / ${first.phaseGroupName} (${reports.length}件)`,
      body: [
        `外部報告者 ${senderProfile.senderName.trim()} (${senderProfile.senderUserId.trim()}) から確定スコアが届きました。`,
        ...reports.map((item) => (
          `#${item.sequence ?? "-"} ${item.setId}: ${item.winnerId} (${item.slotScores.map((score) => `${score.entrantId}=${score.score < 0 ? "DQ" : score.score}`).join(" / ")})`
        )),
      ].join("\n"),
      messageMeta: buildScopedMessageMeta({
        externalScoreReport: true, externalScoreReports: reports,
        externalScoreReportResetPool: resetPool,
        externalScoreReportResend: deliveryTargetIp !== null,
      }, {
        tournamentId: first.tournamentId, slug: first.slug, eventId: first.eventId,
        phaseName: first.phaseName, phaseGroupName: first.phaseGroupName,
      }),
      deliveryTargetMode: deliveryTargetIp === null ? "broadcast" : "direct",
      deliveryTargetIp,
    });
  }

  async function sendExternalScoreReport(report: ExternalScoreReport) {
    await sendExternalScoreReports([report]);
  }

  async function sendExternalScoreSyncRequest(request: ExternalScoreSyncRequest, deliveryTargetIp: string) {
    if (communicationDisabled || !senderReady || !isValidIpv4(deliveryTargetIp)) {
      throw new Error("外部報告の同期要求に必要な送信者情報、ローカル通信設定、または外部報告者のIPが不正です。");
    }
    await send({
      method: "external_score_sync_request",
      subject: request.resetPool ? "外部報告の全同期要求" : "外部報告の欠番再送要求",
      body: request.resetPool ? "対象プールのすべての確定情報を送信してください。"
        : `対象プールの確定情報を #${request.fromSequence} から再送してください。`,
      messageMeta: buildScopedMessageMeta({
        externalScoreSyncRequest: true,
        externalScoreSyncTournamentId: request.tournamentId,
        externalScoreSyncSlug: request.slug,
        externalScoreSyncEventId: request.eventId,
        externalScoreSyncPhaseGroupId: request.phaseGroupId,
        externalScoreSyncFromSequence: request.fromSequence,
        externalScoreSyncResetPool: request.resetPool,
      }, scope),
      deliveryTargetMode: "direct",
      deliveryTargetIp,
    });
  }

  async function replyToExternalScoreReport(message: FeatureMessage, accepted: boolean, rejectionReason = ""): Promise<boolean> {
    if (communicationDisabled || !senderReady || !isValidIpv4(message.senderIp)
      || message.senderUserId === senderProfile.senderUserId) {
      onError("外部報告への自動応答に必要な送信者情報または返信先がありません。");
      return false;
    }
    try {
      await send({
        method: "external_score_report_response",
        subject: `Re: ${message.subject}`,
        body: accepted ? "外部報告を受理し、結果をブラケットに自動適用しました。"
          : `外部報告を拒否しました。${rejectionReason}`,
        messageMeta: buildScopedMessageMeta({
          requestMessageId: message.messageId,
          externalScoreReportResponse: accepted ? "accepted" : "rejected",
        }, scope),
        deliveryTargetMode: "direct",
        deliveryTargetIp: message.senderIp,
      });
      onMessage(accepted ? "外部報告を適用し、送信者へ自動応答しました。"
        : "適用できない外部報告を拒否し、送信者へ自動応答しました。");
      return true;
    } catch (error) {
      onError(String(error));
      return false;
    }
  }

  return {
    sendExternalEditRequest, canReplyToExternalEditRequest, replyToExternalEditRequest,
    sendExternalScoreReport, sendExternalScoreReports, sendExternalScoreSyncRequest, replyToExternalScoreReport,
  };
}

export function useBracketMessages(options: Omit<MessagingOptions, "refresh">) {
  const { data, ready, refresh } = useFeatureInbox<BracketInbox>(
    "load_bracket_messages", "bracket_messages_changed",
    { messages: [], processedMessageIds: [], senderContacts: [] }, options.onError,
  );
  const actions = useMemo(() => createBracketMessaging({ ...options, refresh }), [
    options.senderProfile, options.scope, options.communicationDisabled, options.onError, options.onMessage, refresh,
  ]);
  const markProcessed = useCallback(async (messageId: string) => {
    await invoke("mark_bracket_message_processed", { messageId });
    await refresh();
  }, [refresh]);
  return { messages: data.messages, senderContacts: data.senderContacts, ready, markProcessed, ...actions };
}
