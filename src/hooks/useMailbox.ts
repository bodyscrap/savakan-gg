import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { GenericMessage, MailboxDeliveryMode, MailboxFilterSetting, MailboxThreadSummary } from "../components/MessageBox";
import {
  buildScopedMessageMeta,
  extractCallTargetIdentityFromMeta,
  extractCallThreadIdentity,
  hasSameGenericMessageOrder,
  isLikelyPlayerId,
  isMessageForScope,
  isSameCallTargetIdentity,
  isSameGenericMessageIdentity,
  isValidIpv4List,
	isSenderProfileReadyForMessaging,
  normalizeGenericMessages,
  normalizeGenericMessage,
  normalizeMailboxFilterSetting,
  normalizePlayerId,
  isValidIpv4,
  isValidSenderUserId,
  splitIpv4List,
  type ExternalEditRequest,
  type MessageScope,
} from "../domain/messageUtils";

const GENERIC_MESSAGE_STORAGE_KEY = "savakan-gg.generic-messages.v1";
const MAILBOX_FILTER_STORAGE_KEY = "savakan-gg.mailbox-filter.v1";
const MAILBOX_READ_IDS_STORAGE_KEY = "savakan-gg.mailbox-read-ids.v1";

type MailboxSenderProfile = {
  senderName: string;
  senderUserId: string;
  bindIp: string;
  broadcastSubnetMask: string;
};

type ExternalEditRequestInput = ExternalEditRequest;

type UseMailboxOptions = {
  activeTab: string;
  scope: MessageScope | null;
  senderProfile: MailboxSenderProfile;
  senderProfileReady: boolean;
  disableLocalCommunication: boolean;
  onError: (error: string) => void;
  onMessage: (message: string) => void;
  onStopDqCameraScan: () => void;
  onForceClearComplete: () => void;
};

export type DqRequestDialogState = {
  threadId: string;
  parentMessageId: string;
  method: string;
  subject: string;
  replyTargetMode: MailboxDeliveryMode;
  replyTargetIp: string;
  expectedPlayerId: string;
  callEntrantId: string;
  callEntrantName: string;
  setId: string;
};

export function useMailbox({
  activeTab,
  scope,
  senderProfile,
  senderProfileReady,
  disableLocalCommunication,
  onError,
  onMessage,
  onStopDqCameraScan,
  onForceClearComplete,
}: UseMailboxOptions) {
  const [genericMessages, setGenericMessages] = useState<GenericMessage[]>([]);
  const [genericMessagesReady, setGenericMessagesReady] = useState(false);
  const [mailboxMethodDraft, setMailboxMethodDraft] = useState("generic");
  const [mailboxSubjectDraft, setMailboxSubjectDraft] = useState("");
  const [messageDeliveryMode, setMessageDeliveryMode] = useState<"broadcast" | "direct">("broadcast");
  const [messageDeliveryIpDraft, setMessageDeliveryIpDraft] = useState("");
  const [composeFixedBodyDraft, setComposeFixedBodyDraft] = useState<string | null>(null);
  const [genericMessageBodyDraft, setGenericMessageBodyDraft] = useState("");
  const [replyBodyDraft, setReplyBodyDraft] = useState("");
  const [selectedThreadId, setSelectedThreadId] = useState("");
  const [mailboxServiceStarted, setMailboxServiceStarted] = useState(false);
  const [composeMessageMeta, setComposeMessageMeta] = useState<Record<string, unknown> | null>(null);
  const [mailboxFilterSetting, setMailboxFilterSetting] = useState<MailboxFilterSetting>({
    unresolvedOnly: false,
    unreadOnly: false,
  });
  const [mailboxReadMessageIds, setMailboxReadMessageIds] = useState<string[]>([]);
  const [dqDialog, setDqDialog] = useState<DqRequestDialogState | null>(null);
  const [dqPlayerIdDraft, setDqPlayerIdDraft] = useState("");
  const [dqReasonDraft, setDqReasonDraft] = useState("");
  const [dqDialogError, setDqDialogError] = useState("");
  const [dqSubmitting, setDqSubmitting] = useState(false);

  useEffect(() => {
    if (dqDialog) {
      return;
    }

    onStopDqCameraScan();
  }, [dqDialog]);

  useEffect(() => {
    return () => {
      onStopDqCameraScan();
    };
  }, []);

  useEffect(() => {
    try {
      const rawFilter = window.localStorage.getItem(MAILBOX_FILTER_STORAGE_KEY);
      if (rawFilter) {
        setMailboxFilterSetting(normalizeMailboxFilterSetting(JSON.parse(rawFilter) as unknown));
      }
    } catch {
      // Ignore malformed local settings.
    }

    try {
      const rawReadIds = window.localStorage.getItem(MAILBOX_READ_IDS_STORAGE_KEY);
      if (rawReadIds) {
        const parsed: unknown = JSON.parse(rawReadIds);
        if (Array.isArray(parsed)) {
          const normalized = parsed
            .filter((item): item is string => typeof item === "string")
            .map((item) => item.trim())
            .filter((item) => item !== "");
          setMailboxReadMessageIds([...new Set(normalized)]);
        }
      }
    } catch {
      // Ignore malformed local settings.
    }
  }, []);

  useEffect(() => {
    let alive = true;

    void (async () => {
      try {
        const fromRust = await invoke<GenericMessage[] | null>("load_generic_messages");
        if (!alive) {
          return;
        }

        if (fromRust) {
          setGenericMessages(normalizeGenericMessages(fromRust));
          return;
        }

        const raw = window.localStorage.getItem(GENERIC_MESSAGE_STORAGE_KEY);
        if (raw) {
          setGenericMessages(normalizeGenericMessages(JSON.parse(raw) as unknown));
        }
      } catch {
        // Ignore storage read failures and keep the in-memory mailbox empty.
      } finally {
        if (alive) {
          setGenericMessagesReady(true);
        }
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!genericMessagesReady) {
      return;
    }

    try {
      window.localStorage.setItem(GENERIC_MESSAGE_STORAGE_KEY, JSON.stringify(genericMessages));
    } catch {
      // Ignore local storage failures; Tauri storage remains available.
    }

    void invoke("save_generic_messages", { messages: genericMessages }).catch((error) => {
      onError(String(error));
    });
  }, [genericMessages, genericMessagesReady, onError]);

  useEffect(() => {
    try {
      window.localStorage.setItem(MAILBOX_FILTER_STORAGE_KEY, JSON.stringify(mailboxFilterSetting));
    } catch {
      // Ignore local storage failures.
    }
  }, [mailboxFilterSetting]);

  useEffect(() => {
    try {
      window.localStorage.setItem(MAILBOX_READ_IDS_STORAGE_KEY, JSON.stringify(mailboxReadMessageIds));
    } catch {
      // Ignore local storage failures.
    }
  }, [mailboxReadMessageIds]);

  useEffect(() => {
    setMailboxReadMessageIds((current) => {
      const known = new Set(genericMessages.map((item) => item.messageId));
      const next = current.filter((id) => known.has(id));
      return next.length === current.length ? current : next;
    });
  }, [genericMessages]);

  useEffect(() => {
    if (!senderProfileReady) {
      return;
    }

    if (disableLocalCommunication) {
      setMailboxServiceStarted(false);
      void invoke("stop_udp_mailbox_service").catch(() => {
        // Ignore service shutdown failures.
      });
      return;
    }

    if (!isValidSenderUserId(senderProfile.senderUserId) || !isValidIpv4(senderProfile.bindIp)) {
      return;
    }

    void invoke("start_udp_mailbox_service", { profile: senderProfile })
      .then(() => {
        setMailboxServiceStarted(true);
      })
      .catch((error) => {
        setMailboxServiceStarted(false);
        onError(String(error));
      });
  }, [disableLocalCommunication, onError, senderProfile, senderProfileReady]);

  useEffect(() => {
    if (!genericMessagesReady) {
      return;
    }

    let disposed = false;
    const timer = window.setInterval(() => {
      void invoke<GenericMessage[] | null>("load_generic_messages")
        .then((rows) => {
          if (disposed || !rows) {
            return;
          }

          const normalized = normalizeGenericMessages(rows);
          setGenericMessages((current) =>
            hasSameGenericMessageOrder(current, normalized) ? current : normalized,
          );
        })
        .catch(() => {
          // Ignore transient polling failures.
        });
    }, 1200);

    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [genericMessagesReady]);

  const scopedGenericMessages = useMemo(
    () => genericMessages.filter((message) => isMessageForScope(message, scope)),
    [genericMessages, scope],
  );

  const mailboxThreadSummaries = useMemo<MailboxThreadSummary[]>(() => {
    const roots = scopedGenericMessages.filter((item) => item.parentMessageId === null);

    return roots
      .map((root) => {
        const messages = scopedGenericMessages
          .filter((item) => item.threadId === root.threadId)
          .slice()
          .sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime());
        const resolved = messages.some((item) => item.messageType === "resolve");
        const unreadCount = messages.filter(
          (item) => item.senderUserId !== senderProfile.senderUserId
            && !mailboxReadMessageIds.includes(item.messageId),
        ).length;

        return { root, messages, resolved, unreadCount };
      })
      .sort((left, right) => new Date(right.root.createdAt).getTime() - new Date(left.root.createdAt).getTime());
  }, [mailboxReadMessageIds, scopedGenericMessages, senderProfile.senderUserId]);

  const unreadMessageCount = useMemo(
    () => mailboxThreadSummaries
      .filter((summary) => summary.root.method !== "call_player")
      .reduce((total, summary) => total + summary.unreadCount, 0),
    [mailboxThreadSummaries],
  );

  const mailboxThreads = useMemo(() => mailboxThreadSummaries
    .filter((summary) => {
      if (mailboxFilterSetting.unresolvedOnly && summary.resolved) {
        return false;
      }
      if (mailboxFilterSetting.unreadOnly && summary.unreadCount === 0) {
        return false;
      }
      return true;
    })
    .map((summary) => summary.root), [mailboxFilterSetting, mailboxThreadSummaries]);

  const activeThread = useMemo(() => {
    if (selectedThreadId.trim() === "") {
      return mailboxThreads[0] ?? null;
    }
    return mailboxThreads.find((item) => item.threadId === selectedThreadId) ?? mailboxThreads[0] ?? null;
  }, [mailboxThreads, selectedThreadId]);

  const activeThreadMessages = useMemo(() => {
    if (!activeThread) {
      return [] as GenericMessage[];
    }
    return mailboxThreadSummaries.find((summary) => summary.root.threadId === activeThread.threadId)?.messages ?? [];
  }, [activeThread, mailboxThreadSummaries]);

  const activeThreadResolved = useMemo(
    () => activeThreadMessages.some((item) => item.messageType === "resolve"),
    [activeThreadMessages],
  );
  const canResolveActiveThread = !!activeThread
    && !activeThreadResolved
    && !disableLocalCommunication
    && activeThread.senderUserId === senderProfile.senderUserId;
  const activeCallThreadIdentity = useMemo(() => extractCallThreadIdentity(activeThread), [activeThread]);
  const canOpenDqDialog = !!activeThread
    && !activeThreadResolved
    && !disableLocalCommunication
    && activeThread.senderUserId !== senderProfile.senderUserId
    && !!activeCallThreadIdentity;

  const normalizedMailboxMethod = mailboxMethodDraft.trim().toLowerCase();
  const normalizedMailboxSubject = mailboxSubjectDraft.trim();
  const normalizedMessageDeliveryIp = messageDeliveryIpDraft.trim();
  const normalizedComposeFixedBody = composeFixedBodyDraft?.trim() ?? "";
  const normalizedGenericMessageBody = genericMessageBodyDraft.trim();
  const normalizedReplyBody = replyBodyDraft.trim();
  const composedMessageBody = normalizedComposeFixedBody === ""
    ? normalizedGenericMessageBody
    : (normalizedGenericMessageBody === ""
      ? normalizedComposeFixedBody
      : `${normalizedComposeFixedBody}\n\n補足:\n${normalizedGenericMessageBody}`);
  const senderProfileReadyForMessaging = isSenderProfileReadyForMessaging(senderProfile);
  const canSendGenericMessage = senderProfileReadyForMessaging
    && !disableLocalCommunication
    && isValidIpv4(senderProfile.broadcastSubnetMask)
    && normalizedMailboxMethod !== ""
    && normalizedMailboxSubject !== ""
    && composedMessageBody !== ""
    && (messageDeliveryMode === "broadcast" || isValidIpv4List(normalizedMessageDeliveryIp));
  const canReplyToThread = !!activeThread
    && !activeThreadResolved
    && !disableLocalCommunication
    && senderProfileReadyForMessaging
    && normalizedReplyBody !== "";
  const isOwnActiveThread = !!activeThread
    && activeThread.senderUserId.trim() === senderProfile.senderUserId.trim();
  const canDeleteActiveThread = !!activeThread
    && !disableLocalCommunication
    && (!isOwnActiveThread || activeThreadResolved);

  function addMailboxMessage(rawMessage: GenericMessage) {
    const normalized = normalizeGenericMessage(rawMessage);
    if (!normalized) {
      return;
    }

    setGenericMessages((current) => {
      const next = [normalized, ...current.filter((item) => !isSameGenericMessageIdentity(item, normalized))];
      return next.sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
    });
    return normalized;
  }

  async function postGenericMessage() {
    onError("");
    onMessage("");

    if (disableLocalCommunication) {
      onError("ローカル通信を行わない設定のため、メッセージ送信は無効です。設定タブで解除してください。");
      return;
    }
    if (!senderProfileReadyForMessaging) {
      onError("設定タブで送信者名・8桁ユーザーID・自分のIPを保存してから送信してください。");
      return;
    }
    if (normalizedMailboxMethod === "") {
      onError("メソッド名を入力してください。");
      return;
    }
    if (normalizedMailboxSubject === "") {
      onError("件名を入力してください。");
      return;
    }
    if (messageDeliveryMode === "direct" && !isValidIpv4List(normalizedMessageDeliveryIp)) {
      onError("送信先IPはIPv4形式で複数指定できます。例: 192.168.1.20, 192.168.1.21");
      return;
    }
    if (composedMessageBody === "") {
      onError("メッセージ本文または補足を入力してください。");
      return;
    }

    const scopedMeta = buildScopedMessageMeta(composeMessageMeta, scope);
    try {
      if (normalizedMailboxMethod === "call_player") {
        const targetIdentity = extractCallTargetIdentityFromMeta(scopedMeta);
        if (targetIdentity) {
          const duplicateRoots = genericMessages
            .filter((item) => item.parentMessageId === null
              && item.messageType === "normal"
              && item.method === "call_player")
            .filter((root) => {
              const rootIdentity = extractCallTargetIdentityFromMeta(root.messageMeta);
              if (!rootIdentity) {
                return false;
              }
              const threadResolved = genericMessages.some(
                (item) => item.threadId === root.threadId && item.messageType === "resolve",
              );
              return !threadResolved && isSameCallTargetIdentity(rootIdentity, targetIdentity);
            });

          for (const root of duplicateRoots) {
            const resolved = await invoke<GenericMessage>("send_mailbox_message", {
              input: {
                profile: senderProfile,
                messageType: "resolve",
                method: root.method,
                subject: `Resolved: ${root.subject}`,
                body: "同一セット・同一プレイヤーの再呼び出し前に自動解決しました。",
                messageMeta: root.messageMeta,
                deliveryTargetMode: "broadcast",
                deliveryTargetIp: null,
                threadId: root.threadId,
                parentMessageId: root.messageId,
              },
            });
            addMailboxMessage(resolved);
          }
        }
      }

      const sent = await invoke<GenericMessage>("send_mailbox_message", {
        input: {
          profile: senderProfile,
          messageType: "normal",
          messageMeta: scopedMeta,
          method: normalizedMailboxMethod,
          subject: normalizedMailboxSubject,
          body: composedMessageBody,
          deliveryTargetMode: messageDeliveryMode,
          deliveryTargetIp: messageDeliveryMode === "direct" ? splitIpv4List(normalizedMessageDeliveryIp).join(",") : null,
          threadId: null,
          parentMessageId: null,
        },
      });
      const normalized = addMailboxMessage(sent);
      if (normalized) {
        setSelectedThreadId(normalized.threadId);
      }
      setGenericMessageBodyDraft("");
      setMailboxSubjectDraft("");
      setComposeFixedBodyDraft(null);
      setComposeMessageMeta(null);
      onMessage(`メソッド ${normalizedMailboxMethod} でスレッドを開始しました。`);
    } catch (error) {
      onError(String(error));
    }
  }

  async function sendExternalEditRequest(input: ExternalEditRequestInput) {
    onError("");
    onMessage("");
    if (disableLocalCommunication) {
      onError("ローカル通信を行わない設定のため、外部編集申請は送信できません。設定タブで解除してください。");
      return;
    }
    if (!senderProfileReadyForMessaging) {
      onError("設定タブで送信者名・8桁ユーザーID・自分のIPを保存してから申請してください。");
      return;
    }
    if (!isValidIpv4(senderProfile.broadcastSubnetMask)) {
      onError("ブロードキャスト先のサブネットマスクが不正です。設定タブを確認してください。");
      return;
    }
    if (!scope || input.eventId !== scope.eventId || input.tournamentId !== scope.tournamentId) {
      onError("申請対象イベントが現在のイベント選択と一致しません。");
      return;
    }
    if (
      [
        input.tournamentId,
        input.slug,
        input.eventId,
        input.eventName,
        input.phaseName,
        input.phaseGroupId,
        input.phaseGroupName,
      ].some((value) => value.trim() === "")
      || !isValidSenderUserId(senderProfile.senderUserId)
    ) {
      onError("外部編集申請に必要なイベント・プール・送信者情報が不足しています。");
      return;
    }

    const messageMeta = {
      ...(buildScopedMessageMeta(null, scope) ?? {}),
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
    };

    try {
      const sent = await invoke<GenericMessage>("send_mailbox_message", {
        input: {
          profile: senderProfile,
          messageType: "normal",
          messageMeta,
          method: "external_edit_request",
          subject: `外部編集申請: ${input.eventName} / ${input.phaseName} / ${input.phaseGroupName}`,
          body: `${senderProfile.senderName.trim()} (${senderProfile.senderUserId.trim()}) から外部編集申請が届きました。\n対象: ${input.eventName} / ${input.phaseName} / ${input.phaseGroupName}`,
          deliveryTargetMode: "broadcast",
          deliveryTargetIp: null,
          threadId: null,
          parentMessageId: null,
        },
      });
      const normalized = addMailboxMessage(sent);
      if (normalized) {
        setSelectedThreadId(normalized.threadId);
      }
      onMessage(`外部編集申請をブロードキャストしました: ${input.phaseName} / ${input.phaseGroupName}`);
    } catch (error) {
      onError(String(error));
    }
  }

  async function replyToThread() {
    onError("");
    onMessage("");
    if (disableLocalCommunication) {
      onError("ローカル通信を行わない設定のため、返信は無効です。設定タブで解除してください。");
      return;
    }
    if (!activeThread) {
      onError("返信先スレッドを選択してください。");
      return;
    }
    if (activeThreadResolved) {
      onError("解決済みスレッドには返信できません。必要な連絡は汎用メッセージで送信してください。");
      return;
    }
    if (!senderProfileReadyForMessaging) {
      onError("設定タブで送信者名・8桁ユーザーID・自分のIPを保存してから返信してください。");
      return;
    }
    if (normalizedReplyBody === "") {
      onError("返信本文を入力してください。");
      return;
    }

    const replyTargetMode: MailboxDeliveryMode = activeThread.senderUserId === senderProfile.senderUserId
      ? "broadcast"
      : "direct";
    const replyTargetIp = activeThread.senderIp.trim();
    if (replyTargetMode === "direct" && !isValidIpv4(replyTargetIp)) {
      onError("返信先メッセージの送信者IPが不正です。");
      return;
    }

    try {
      const sent = await invoke<GenericMessage>("send_mailbox_message", {
        input: {
          profile: senderProfile,
          messageType: "normal",
          method: activeThread.method,
          subject: `Re: ${activeThread.subject}`,
          body: normalizedReplyBody,
          messageMeta: buildScopedMessageMeta(null, scope),
          deliveryTargetMode: replyTargetMode,
          deliveryTargetIp: replyTargetMode === "direct" ? replyTargetIp : null,
          threadId: activeThread.threadId,
          parentMessageId: activeThread.messageId,
        },
      });
      addMailboxMessage(sent);
      setReplyBodyDraft("");
      onMessage("返信を送信しました。スレッドに追加されます。");
    } catch (error) {
      onError(String(error));
    }
  }

  function openDqRequestDialog() {
    onError("");
    onMessage("");
    if (disableLocalCommunication) {
      onError("ローカル通信を行わない設定のため、DQ申請は無効です。設定タブで解除してください。");
      return;
    }
    if (!activeThread || !activeCallThreadIdentity) {
      onError("プレイヤー呼び出しスレッドを選択してください。");
      return;
    }
    if (activeThreadResolved) {
      onError("解決済みスレッドではDQ申請できません。必要な連絡は汎用メッセージで送信してください。");
      return;
    }

    const replyTargetMode: MailboxDeliveryMode = activeThread.senderUserId === senderProfile.senderUserId
      ? "broadcast"
      : "direct";
    const replyTargetIp = activeThread.senderIp.trim();
    if (replyTargetMode === "direct" && !isValidIpv4(replyTargetIp)) {
      onError("返信先メッセージの送信者IPが不正です。DQ申請を開始できません。");
      return;
    }

    setDqDialog({
      threadId: activeThread.threadId,
      parentMessageId: activeThread.messageId,
      method: activeThread.method,
      subject: activeThread.subject,
      replyTargetMode,
      replyTargetIp,
      expectedPlayerId: activeCallThreadIdentity.expectedPlayerId,
      callEntrantId: activeCallThreadIdentity.callEntrantId,
      callEntrantName: activeCallThreadIdentity.callEntrantName,
      setId: activeCallThreadIdentity.setId,
    });
    setDqPlayerIdDraft("");
    setDqReasonDraft("");
    setDqDialogError("");
  }

  function resetDqRequestDialog() {
    onStopDqCameraScan();
    setDqDialog(null);
    setDqPlayerIdDraft("");
    setDqReasonDraft("");
    setDqDialogError("");
  }

  function closeDqRequestDialog() {
    if (dqSubmitting) {
      return;
    }
    resetDqRequestDialog();
  }

  async function submitDqRequest() {
    onError("");
    onMessage("");
    if (disableLocalCommunication) {
      setDqDialogError("ローカル通信を行わない設定のため、DQ申請は無効です。設定タブで解除してください。");
      return;
    }
    if (!dqDialog) {
      setDqDialogError("DQ申請対象が見つかりません。再度開き直してください。");
      return;
    }
    if (!senderProfileReadyForMessaging) {
      setDqDialogError("設定タブで送信者名・8桁ユーザーID・自分のIPを保存してから申請してください。");
      return;
    }

    const normalizedPlayerId = normalizePlayerId(dqPlayerIdDraft);
    if (!isLikelyPlayerId(normalizedPlayerId)) {
      setDqDialogError("PLAYER IDを入力してください。プレイヤーカードの2次元コード読取にも対応しています。");
      return;
    }
    if (normalizedPlayerId !== dqDialog.expectedPlayerId) {
      setDqDialogError("入力したPLAYER IDが呼び出し対象と一致しません。なりすまし防止のため申請できません。");
      return;
    }

    const reasonText = dqReasonDraft.trim();
    const body = reasonText === ""
      ? `DQ申請\n対象: ${dqDialog.callEntrantName || dqDialog.callEntrantId}`
      : `DQ申請\n対象: ${dqDialog.callEntrantName || dqDialog.callEntrantId}\n理由: ${reasonText}`;
    const messageMeta = buildScopedMessageMeta({
      dqPlayerId: normalizedPlayerId,
      dqCallEntrantId: dqDialog.callEntrantId,
      dqCallEntrantName: dqDialog.callEntrantName,
      dqSetId: dqDialog.setId,
      dqRequestedByUserId: senderProfile.senderUserId,
      dqRequestedAt: new Date().toISOString(),
    }, scope);

    setDqSubmitting(true);
    setDqDialogError("");
    try {
      const sent = await invoke<GenericMessage>("send_mailbox_message", {
        input: {
          profile: senderProfile,
          messageType: "dq_request",
          method: dqDialog.method,
          subject: `DQ申請: ${dqDialog.subject}`,
          body,
          messageMeta,
          deliveryTargetMode: dqDialog.replyTargetMode,
          deliveryTargetIp: dqDialog.replyTargetMode === "direct" ? dqDialog.replyTargetIp : null,
          threadId: dqDialog.threadId,
          parentMessageId: dqDialog.parentMessageId,
        },
      });
      addMailboxMessage(sent);
      closeDqRequestDialog();
      onMessage("DQ申請を送信しました。認証済みのPLAYER IDでのみ送信可能です。");
    } catch (error) {
      setDqDialogError(String(error));
    } finally {
      setDqSubmitting(false);
    }
  }

  async function resolveActiveThread() {
    onError("");
    onMessage("");
    if (disableLocalCommunication) {
      onError("ローカル通信を行わない設定のため、解決メッセージ送信は無効です。設定タブで解除してください。");
      return;
    }
    if (!activeThread) {
      onError("解決するスレッドを選択してください。");
      return;
    }
    if (!canResolveActiveThread) {
      onError("スレッド作成者のみが解決メッセージを送信できます。未解決スレッドを選択してください。");
      return;
    }

    try {
      const sent = await invoke<GenericMessage>("send_mailbox_message", {
        input: {
          profile: senderProfile,
          messageType: "resolve",
          method: activeThread.method,
          subject: `Resolved: ${activeThread.subject}`,
          body: "解決",
          messageMeta: activeThread.messageMeta,
          deliveryTargetMode: "broadcast",
          deliveryTargetIp: null,
          threadId: activeThread.threadId,
          parentMessageId: activeThread.messageId,
        },
      });
      addMailboxMessage(sent);
      onMessage("解決メッセージを送信しました。スレッドは完了扱いになります。");
    } catch (error) {
      onError(String(error));
    }
  }

  function deleteActiveThread() {
    if (disableLocalCommunication) {
      onError("ローカル通信を行わない設定のため、スレッド削除は無効です。必要な場合は設定タブの強制クリアを利用してください。");
      return;
    }
    if (!activeThread) {
      onError("削除するスレッドを選択してください。");
      return;
    }
    if (activeThread.senderUserId.trim() === senderProfile.senderUserId.trim() && !activeThreadResolved) {
      const warningMessage = "自分が発行した未解決スレッドは削除できません。先に「解決」を送信してください。";
      window.alert(warningMessage);
      onError(warningMessage);
      return;
    }
    if (!window.confirm(`「${activeThread.subject}」のスレッドを削除しますか？\nこのスレッド内の全メッセージが削除されます。`)) {
      return;
    }

    const targetThreadId = activeThread.threadId;
    const deletedMessageIds = genericMessages
      .filter((item) => item.threadId === targetThreadId)
      .map((item) => item.messageId);
    onError("");
    onMessage("");
    setGenericMessages((current) => current.filter((item) => item.threadId !== targetThreadId));
    setMailboxReadMessageIds((current) => current.filter((messageId) => !deletedMessageIds.includes(messageId)));
    setReplyBodyDraft("");
    setSelectedThreadId("");
    onMessage("スレッドを削除しました。");
  }

  function forceClearMessages() {
    if (genericMessages.length === 0) {
      onError("");
      onMessage("削除対象のメッセージはありません。");
      return;
    }

    const firstConfirmed = window.confirm(
      `危険: メッセージボックス内の全メッセージ ${genericMessages.length} 件を強制削除します。\nこの操作は元に戻せません。続行しますか？`,
    );
    if (!firstConfirmed) {
      return;
    }

    const guardWord = window.prompt("最終確認: 強制削除を実行するには DELETE と入力してください。", "");
    if ((guardWord ?? "").trim() !== "DELETE") {
      onError("確認文字列が一致しなかったため、メッセージボックスの強制クリアを中止しました。");
      return;
    }

    onError("");
    onMessage("");
    setGenericMessages([]);
    setMailboxReadMessageIds([]);
    setSelectedThreadId("");
    setReplyBodyDraft("");
    resetDqRequestDialog();
    onForceClearComplete();
    onMessage(`メッセージボックスを強制クリアしました（${genericMessages.length} 件削除）。`);
  }

  useEffect(() => {
    if (mailboxThreads.length === 0) {
      setSelectedThreadId((current) => (current === "" ? current : ""));
      return;
    }

    setSelectedThreadId((current) => {
      if (current !== "" && mailboxThreads.some((item) => item.threadId === current)) {
        return current;
      }
      return mailboxThreads[0].threadId;
    });
  }, [mailboxThreads]);

  useEffect(() => {
    if (activeTab !== "message" || !activeThread) {
      return;
    }

    const incomingIds = activeThreadMessages
      .filter((item) => item.senderUserId !== senderProfile.senderUserId)
      .map((item) => item.messageId);
    if (incomingIds.length === 0) {
      return;
    }

    setMailboxReadMessageIds((current) => {
      const next = new Set(current);
      for (const messageId of incomingIds) {
        next.add(messageId);
      }
      return next.size === current.length ? current : [...next];
    });
  }, [activeTab, activeThread, activeThreadMessages, senderProfile.senderUserId]);

  function updateMailboxFilter(key: keyof MailboxFilterSetting, checked: boolean) {
    setSelectedThreadId("");
    setMailboxFilterSetting((current) => ({ ...current, [key]: checked }));
  }

  return {
    genericMessages,
    setGenericMessages,
    genericMessagesReady,
    mailboxMethodDraft,
    setMailboxMethodDraft,
    mailboxSubjectDraft,
    setMailboxSubjectDraft,
    messageDeliveryMode,
    setMessageDeliveryMode,
    messageDeliveryIpDraft,
    setMessageDeliveryIpDraft,
    composeFixedBodyDraft,
    setComposeFixedBodyDraft,
    genericMessageBodyDraft,
    setGenericMessageBodyDraft,
    replyBodyDraft,
    setReplyBodyDraft,
    selectedThreadId,
    setSelectedThreadId,
    mailboxServiceStarted,
    composeMessageMeta,
    setComposeMessageMeta,
    mailboxFilterSetting,
    updateMailboxFilter,
    mailboxReadMessageIds,
    setMailboxReadMessageIds,
    scopedGenericMessages,
    mailboxThreadSummaries,
    unreadMessageCount,
    mailboxThreads,
    hasMailboxThreads: mailboxThreads.length > 0,
    activeThread,
    activeThreadMessages,
    activeThreadResolved,
    canResolveActiveThread,
    activeCallThreadIdentity,
    canSendGenericMessage,
    canReplyToThread,
    canDeleteActiveThread,
    canOpenDqDialog,
    postGenericMessage,
    sendExternalEditRequest,
    replyToThread,
    openDqRequestDialog,
    closeDqRequestDialog,
    resetDqRequestDialog,
    submitDqRequest,
    resolveActiveThread,
    deleteActiveThread,
    forceClearMessages,
    dqDialog,
    dqPlayerIdDraft,
    setDqPlayerIdDraft,
    dqReasonDraft,
    setDqReasonDraft,
    dqDialogError,
    setDqDialogError,
    dqSubmitting,
  };
}