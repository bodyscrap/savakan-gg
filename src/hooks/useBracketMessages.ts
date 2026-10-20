import { t } from "../i18n";
import { useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { FeatureMessage } from "../domain/messages";
import {
  buildScopedMessageMeta, getExternalEditRequest, isDqRequestMessage, isSenderProfileReadyForMessaging,
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

  async function markProcessed(messageId: string) {
    await invoke("mark_bracket_message_processed", { messageId });
    await refresh();
  }

  async function discardDqRequest(request: FeatureMessage): Promise<boolean> {
    onError("");
    onMessage("");
    if (!isDqRequestMessage(request)) {
      onError(t("破棄するDQ申請の情報が不正です。"));
      return false;
    }
    try {
      await markProcessed(request.messageId);
      onMessage(t("DQ申請を破棄しました。呼び出しと試合結果は変更していません。"));
      return true;
    } catch (error) {
      onError(t("DQ申請の破棄に失敗しました: {p0}", { p0: String(error) }));
      return false;
    }
  }

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
      onError(t("ローカル通信を有効にし、設定タブで送信者情報とネットワークデバイスを保存してください。"));
      return false;
    }
    if (!scope || input.eventId !== scope.eventId || input.tournamentId !== scope.tournamentId) {
      onError(t("申請対象イベントが現在のイベント選択と一致しません。"));
      return false;
    }
    if ([
      input.tournamentId, input.slug, input.eventId, input.eventName,
      input.phaseName, input.phaseGroupId, input.phaseGroupName,
    ].some((value) => value.trim() === "") || !isValidSenderUserId(senderProfile.senderUserId)) {
      onError(t("外部報告申請に必要なイベント・プール・送信者情報が不足しています。"));
      return false;
    }
    try {
      await send({
        method: "external_edit_request",
        subject: t("外部報告申請: {p0} / {p1} / {p2}", { p0: input.eventName, p1: input.phaseName, p2: input.phaseGroupName }),
        body: t("{p0} ({p1}) から外部報告申請が届きました。 対象: {p2} / {p3} / {p4}", { p0: senderProfile.senderName.trim(), p1: senderProfile.senderUserId.trim(), p2: input.eventName, p3: input.phaseName, p4: input.phaseGroupName }),
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
      onMessage(t("外部報告申請をブロードキャストしました: {p0} / {p1}", { p0: input.phaseName, p1: input.phaseGroupName }));
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
      onError(t("外部報告申請への応答に必要な申請情報、送信者情報、または返信先がありません。"));
      return false;
    }
    try {
      await send({
        method: "external_edit_request_response",
        subject: `Re: ${message.subject}`,
        body: accepted
          ? t("外部報告申請を受理しました。対象フェーズ/プールのスコア編集をロックし、申請者を外部報告者に設定しました。")
          : t("外部報告申請を拒否しました。"),
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
      onMessage(accepted ? t("外部報告申請を受理し、応答しました。") : t("外部報告申請を拒否し、応答しました。"));
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
      throw new Error(t("外部報告の送信には有効な送信者情報とローカル通信設定が必要です。"));
    }
    if (reports.length === 0) {
      throw new Error(t("送信する外部報告がありません。"));
    }
    if (deliveryTargetIp !== null && !isValidIpv4(deliveryTargetIp)) {
      throw new Error(t("外部報告の返信先IPが不正です。"));
    }
    const first = reports[0];
    await send({
      method: "external_score_report",
      subject: t("外部報告: {p0} / {p1} / {p2} ({p3}件)", { p0: first.eventName, p1: first.phaseName, p2: first.phaseGroupName, p3: reports.length }),
      body: [
        t("外部報告者 {p0} ({p1}) から確定スコアが届きました。", { p0: senderProfile.senderName.trim(), p1: senderProfile.senderUserId.trim() }),
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
      throw new Error(t("外部報告の同期要求に必要な送信者情報、ローカル通信設定、または外部報告者のIPが不正です。"));
    }
    await send({
      method: "external_score_sync_request",
      subject: request.resetPool ? t("外部報告の全同期要求") : t("外部報告の欠番再送要求"),
      body: request.resetPool ? t("対象プールのすべての確定情報を送信してください。")
        : t("対象プールの確定情報を #{p0} から再送してください。", { p0: request.fromSequence }),
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
      onError(t("外部報告への自動応答に必要な送信者情報または返信先がありません。"));
      return false;
    }
    try {
      await send({
        method: "external_score_report_response",
        subject: `Re: ${message.subject}`,
        body: accepted ? t("外部報告を受理し、結果をブラケットに自動適用しました。")
          : t("外部報告を拒否しました。{p0}", { p0: rejectionReason }),
        messageMeta: buildScopedMessageMeta({
          requestMessageId: message.messageId,
          externalScoreReportResponse: accepted ? "accepted" : "rejected",
        }, scope),
        deliveryTargetMode: "direct",
        deliveryTargetIp: message.senderIp,
      });
      onMessage(accepted ? t("外部報告を適用し、送信者へ自動応答しました。")
        : t("適用できない外部報告を拒否し、送信者へ自動応答しました。"));
      return true;
    } catch (error) {
      onError(String(error));
      return false;
    }
  }

  return {
    markProcessed, discardDqRequest,
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
  return { messages: data.messages, senderContacts: data.senderContacts, ready, ...actions };
}
