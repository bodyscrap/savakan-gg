import {
  getExternalEditRequestStatus,
  type ExternalEditRequest,
  type ExternalEditRequestStatus,
  type ExternalScoreReport,
} from "../domain/messageUtils";

export type GenericMessage = {
  messageId: string;
  threadId: string;
  parentMessageId: string | null;
  messageType: "normal" | "resolve" | "dq_request";
  messageMeta: Record<string, unknown> | null;
  method: string;
  subject: string;
  senderName: string;
  senderUserId: string;
  senderIp: string;
  body: string;
  createdAt: string;
};

export type MailboxDeliveryMode = "broadcast" | "direct";

export type MailboxFilterSetting = {
  unresolvedOnly: boolean;
  unreadOnly: boolean;
  externalEditRequestsOnly: boolean;
};

export type MailboxThreadSummary = {
  root: GenericMessage;
  messages: GenericMessage[];
  resolved: boolean;
  unreadCount: number;
};

const externalEditRequestStatusLabels: Record<ExternalEditRequestStatus, string> = {
  pending: "未処理",
  accepted: "受理",
  rejected: "却下",
};

type MessageBoxProps = {
  senderLabel: string;
  senderUserId: string;
  senderProfileReady: boolean;
  disableLocalCommunication: boolean;
  mailboxServiceStarted: boolean;
  mailboxMethodDraft: string;
  getMailboxMethodLabel: (method: string) => string;
  mailboxSubjectDraft: string;
  onMailboxSubjectChange: (value: string) => void;
  messageDeliveryMode: MailboxDeliveryMode;
  onMessageDeliveryModeChange: (mode: MailboxDeliveryMode) => void;
  messageDeliveryIpDraft: string;
  onMessageDeliveryIpChange: (value: string) => void;
  composeFixedBodyDraft: string | null;
  genericMessageBodyDraft: string;
  onGenericMessageBodyChange: (value: string) => void;
  onCancelFixedMessage: () => void;
  canSendGenericMessage: boolean;
  onPostGenericMessage: () => void;
  mailboxFilterSetting: MailboxFilterSetting;
  onMailboxFilterChange: (key: keyof MailboxFilterSetting, checked: boolean) => void;
  mailboxThreads: GenericMessage[];
  mailboxThreadSummaries: MailboxThreadSummary[];
  activeThread: GenericMessage | null;
  activeThreadMessages: GenericMessage[];
  activeThreadResolved: boolean;
  onSelectThread: (threadId: string) => void;
  onProcessDqRequest: (message: GenericMessage) => void;
  isDqRequestMessage: (message: GenericMessage) => boolean;
  getExternalEditRequest: (message: GenericMessage) => ExternalEditRequest | null;
  canAcceptExternalEditRequest: (message: GenericMessage) => boolean;
  onAcceptExternalEditRequest: (message: GenericMessage) => void;
  canReplyToExternalEditRequest: (message: GenericMessage) => boolean;
  onRejectExternalEditRequest: (message: GenericMessage) => void;
  getExternalScoreReport: (message: GenericMessage) => ExternalScoreReport | null;
  canResolveActiveThread: boolean;
  onResolveActiveThread: () => void;
  canDeleteActiveThread: boolean;
  onDeleteActiveThread: () => void;
  replyBodyDraft: string;
  onReplyBodyChange: (value: string) => void;
  canReplyToThread: boolean;
  onReplyToThread: () => void;
  canOpenDqDialog: boolean;
  onOpenDqDialog: () => void;
};

export function MessageBox({
  senderLabel,
  senderUserId,
  senderProfileReady,
  disableLocalCommunication,
  mailboxServiceStarted,
  mailboxMethodDraft,
  getMailboxMethodLabel,
  mailboxSubjectDraft,
  onMailboxSubjectChange,
  messageDeliveryMode,
  onMessageDeliveryModeChange,
  messageDeliveryIpDraft,
  onMessageDeliveryIpChange,
  composeFixedBodyDraft,
  genericMessageBodyDraft,
  onGenericMessageBodyChange,
  onCancelFixedMessage,
  canSendGenericMessage,
  onPostGenericMessage,
  mailboxFilterSetting,
  onMailboxFilterChange,
  mailboxThreads,
  mailboxThreadSummaries,
  activeThread,
  activeThreadMessages,
  activeThreadResolved,
  onSelectThread,
  onProcessDqRequest,
  isDqRequestMessage,
  getExternalEditRequest,
  canAcceptExternalEditRequest,
  onAcceptExternalEditRequest,
  canReplyToExternalEditRequest,
  onRejectExternalEditRequest,
  getExternalScoreReport,
  canResolveActiveThread,
  onResolveActiveThread,
  canDeleteActiveThread,
  onDeleteActiveThread,
  replyBodyDraft,
  onReplyBodyChange,
  canReplyToThread,
  onReplyToThread,
  canOpenDqDialog,
  onOpenDqDialog,
}: MessageBoxProps) {
  const normalizedSenderUserId = senderUserId.trim();
  const activeThreadExternalEditRequest = activeThread
    ? getExternalEditRequest(activeThread)
    : null;
  const activeThreadRequestStatus = activeThread
    ? getExternalEditRequestStatus(activeThread, activeThreadMessages)
    : null;
  const isResolutionOwner = (thread: GenericMessage | null) => (
    normalizedSenderUserId !== ""
    && thread?.senderUserId.trim() === normalizedSenderUserId
  );

  return (
    <>
      <section className="panel">
        <div className="mailbox-compose-heading">
          <span className={`mailbox-service-badge ${mailboxServiceStarted ? "mailbox-service-badge--started" : "mailbox-service-badge--stopped"}`}>
            {mailboxServiceStarted ? "起動中" : "停止中"}
          </span>
          <h2>
            送信 <span className="mailbox-compose-sender">({senderLabel})</span>
          </h2>
        </div>
        {!senderProfileReady && (
          <p className="meta meta-attention">
            送信不可: 設定タブで「送信者名」「8桁ユーザーID」「自分のIP」を保存すると、スレッド開始・返信・DQ申請が可能になります。
          </p>
        )}
        {disableLocalCommunication && (
          <p className="meta meta-attention">
            ローカル通信OFF: 閲覧のみ可能です（スレッド開始・返信・DQ申請・解決・削除は無効）。
          </p>
        )}

        <div className="mailbox-compose-row">
          <input value={getMailboxMethodLabel(mailboxMethodDraft)} placeholder="メッセージ属性" readOnly />
          <input
            value={mailboxSubjectDraft}
            onChange={(e) => onMailboxSubjectChange(e.currentTarget.value)}
            placeholder="件名"
            disabled={disableLocalCommunication}
          />
          <select
            value={messageDeliveryMode}
            onChange={(e) => onMessageDeliveryModeChange(e.currentTarget.value as MailboxDeliveryMode)}
            disabled={disableLocalCommunication}
          >
            <option value="broadcast">ブロードキャスト</option>
            <option value="direct">送信先IP指定</option>
          </select>
          <input
            value={messageDeliveryIpDraft}
            onChange={(e) => onMessageDeliveryIpChange(e.currentTarget.value)}
            placeholder="送信先IP (例: 192.168.1.20)"
            disabled={disableLocalCommunication || messageDeliveryMode !== "direct"}
          />
          <button type="button" onClick={onPostGenericMessage} disabled={!canSendGenericMessage}>
            スレッド開始
          </button>
        </div>
        <p className="meta">返信は、スレッド主ならブロードキャスト、それ以外は返信先の送信者IPへ送信します。</p>

        {composeFixedBodyDraft && (
          <div style={{ marginTop: "0.6rem" }}>
            <p className="meta">固有メッセージ (自動生成 / 編集不可)</p>
            <textarea value={composeFixedBodyDraft} rows={6} readOnly style={{ width: "100%", background: "#f3f4f6" }} />
          </div>
        )}

        <div style={{ marginTop: "0.6rem" }}>
          {composeFixedBodyDraft && <p className="meta">補足メッセージ</p>}
          <textarea
            value={genericMessageBodyDraft}
            onChange={(e) => onGenericMessageBodyChange(e.currentTarget.value)}
            rows={4}
            placeholder={composeFixedBodyDraft ? "補足を入力" : "メッセージ本文"}
            style={{ width: "100%" }}
            disabled={disableLocalCommunication}
          />
        </div>

        {composeFixedBodyDraft && (
          <div className="panel-toolbar compact">
              <button type="button" className="ghost" onClick={onCancelFixedMessage} disabled={disableLocalCommunication}>
                呼び出しをキャンセル
              </button>
          </div>
        )}
      </section>

      <section className="panel">
        <h2>受信</h2>
        <div className="panel-toolbar compact">
          <div className="mailbox-filter-row">
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={mailboxFilterSetting.unresolvedOnly}
                onChange={(e) => onMailboxFilterChange("unresolvedOnly", e.currentTarget.checked)}
              />
              未解決スレッドのみ
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={mailboxFilterSetting.unreadOnly}
                onChange={(e) => onMailboxFilterChange("unreadOnly", e.currentTarget.checked)}
              />
              未読メッセージがあるスレッドのみ
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={mailboxFilterSetting.externalEditRequestsOnly}
                onChange={(e) => onMailboxFilterChange("externalEditRequestsOnly", e.currentTarget.checked)}
              />
              外部報告申請スレッドのみ
            </label>
          </div>
        </div>
        <div className="mailbox-layout">
          <section className="mailbox-thread-list">
            <h3>スレッド ({mailboxThreads.length})</h3>
            {mailboxThreads.length === 0 ? (
              <p className="meta">まだスレッドはありません。</p>
            ) : (
              <div className="event-list">
                {mailboxThreads.map((thread) => {
                  const summary = mailboxThreadSummaries.find((item) => item.root.threadId === thread.threadId);
                  const unreadCount = summary?.unreadCount ?? 0;
                  const resolved = summary?.resolved ?? false;
                  const ownsResolutionResponsibility = isResolutionOwner(thread);
                  const requestStatus = getExternalEditRequestStatus(thread, summary?.messages ?? []);

                  return (
                    <article
                      key={thread.threadId}
                      className={`event-list-item mailbox-thread-item ${ownsResolutionResponsibility ? "mailbox-thread-item--resolution-owner" : ""} ${activeThread?.threadId === thread.threadId ? "selected" : ""}`}
                      role="button"
                      tabIndex={0}
                      onClick={() => onSelectThread(thread.threadId)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onSelectThread(thread.threadId);
                        }
                      }}
                    >
                      <div className="event-list-head">
                        <div>
                          <div className="mailbox-thread-heading mailbox-thread-list-heading">
                            <h4>{thread.subject}</h4>
                            {(ownsResolutionResponsibility || requestStatus) && (
                              <div className="mailbox-thread-list-status">
                                {ownsResolutionResponsibility && (
                                  <span className="mailbox-resolution-owner-badge">スレッド主</span>
                                )}
                                {requestStatus && (
                                  <span className={`mailbox-request-status mailbox-request-status--${requestStatus}`}>
                                    {externalEditRequestStatusLabels[requestStatus]}
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                      <p className="meta">from: {thread.senderName} ({thread.senderUserId})</p>
                      <div className="mailbox-thread-time-status">
                        <p className="meta">{new Date(thread.createdAt).toLocaleString()}</p>
                        <p className="meta">
                          {resolved ? "解決済み" : "未解決"}
                          {unreadCount > 0 ? ` / 未読 ${unreadCount}` : " / 未読 0"}
                        </p>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>

          <section className="mailbox-thread-view">
            {!activeThread ? (
              <p className="meta">左のスレッドを選択してください。</p>
            ) : (
              <>
                <div className="mailbox-thread-heading">
                  <h3>{activeThread.subject}</h3>
                  {isResolutionOwner(activeThread) && (
                    <span className="mailbox-resolution-owner-badge">スレッド主</span>
                  )}
                  {activeThreadRequestStatus && (
                    <span className={`mailbox-request-status mailbox-request-status--${activeThreadRequestStatus}`}>
                      {externalEditRequestStatusLabels[activeThreadRequestStatus]}
                    </span>
                  )}
                </div>
                <div className="mailbox-thread-detail-meta">
                  <p className="meta">状態: {activeThreadResolved ? "解決済み" : "未解決"}</p>
                  <p className="meta">属性: {getMailboxMethodLabel(activeThread.method)} / threadId: {activeThread.threadId}</p>
                </div>

                <div className="mailbox-message-list">
                  {activeThreadMessages.map((item) => {
                    const isResolutionOwnerRoot = isResolutionOwner(activeThread) && item.parentMessageId === null;
                    const externalEditRequest = getExternalEditRequest(item);
                    const externalScoreReport = getExternalScoreReport(item);
                    return (
                    <article
                      key={item.messageId}
                      className={`event-list-item mailbox-message ${item.parentMessageId ? "reply" : "root"} ${isResolutionOwnerRoot ? "mailbox-message--resolution-owner" : ""}`}
                    >
                      <div className="event-list-head">
                        <div className="mailbox-message-sender-line">
                          <h4>
                            {item.senderName}{" "}
                            <span className="mailbox-message-sender-info">
                              (ID: {item.senderUserId} / IP: {item.senderIp || "-"})
                            </span>
                          </h4>
                          <p className="meta mailbox-message-type">
                            type: {item.messageType === "resolve" ? "解決" : item.messageType === "dq_request" ? "DQ申請" : "通常"}
                          </p>
                        </div>
                        <p className="meta">{new Date(item.createdAt).toLocaleString()}</p>
                      </div>
                      {item.parentMessageId && <p className="meta">reply to: {item.parentMessageId}</p>}
                      {isResolutionOwnerRoot && (
                        <span className="mailbox-resolution-owner-badge">スレッド主</span>
                      )}
                      {isDqRequestMessage(item) && (
                        <div style={{ marginTop: "0.45rem", display: "flex", gap: "0.45rem", flexWrap: "wrap" }}>
                          <button type="button" className="ghost tiny" onClick={() => onProcessDqRequest(item)} disabled={disableLocalCommunication}>
                            DQ処理
                          </button>
                        </div>
                      )}
                      {externalEditRequest && (
                        <div style={{ marginTop: "0.45rem" }}>
                          <p className="meta">
                            外部報告申請: {externalEditRequest.eventName} / {externalEditRequest.phaseName}
                            {" / Pool "}{externalEditRequest.phaseGroupName}
                          </p>
                          {activeThreadRequestStatus && (
                            <span className={`mailbox-request-status mailbox-request-status--${activeThreadRequestStatus}`}>
                              処理状態: {externalEditRequestStatusLabels[activeThreadRequestStatus]}
                            </span>
                          )}
                          <p className="meta">
                            受理は申請元イベントのスナップショット選択時のみ可能です。受理すると対象プールをロックし、申請者を外部報告者に設定します。
                          </p>
                          <div style={{ display: "flex", gap: "0.45rem", flexWrap: "wrap" }}>
                            <button
                              type="button"
                              className="ghost tiny"
                              disabled={!canAcceptExternalEditRequest(item) || !canReplyToExternalEditRequest(item)}
                              onClick={() => onAcceptExternalEditRequest(item)}
                            >
                              受理
                            </button>
                            <button
                              type="button"
                              className="ghost tiny"
                              disabled={!canReplyToExternalEditRequest(item)}
                              onClick={() => onRejectExternalEditRequest(item)}
                            >
                              却下
                            </button>
                          </div>
                        </div>
                      )}
                      {externalScoreReport && (
                        <div style={{ marginTop: "0.45rem" }}>
                          <p className="meta">
                            外部報告: {externalScoreReport.eventName || externalScoreReport.eventId}
                            {externalScoreReport.phaseName && ` / ${externalScoreReport.phaseName}`}
                            {externalScoreReport.phaseGroupName && ` / Pool ${externalScoreReport.phaseGroupName}`}
                            {" / Set "}{externalScoreReport.setId}
                          </p>
                          <p className="meta">外部報告は受信時に自動で適用されます。</p>
                        </div>
                      )}
                      <p className="message-body">{item.body}</p>
                    </article>
                    );
                  })}
                </div>

                {!activeThreadExternalEditRequest && (
                  <>
                    <div className="panel-toolbar compact" style={{ marginTop: "0.6rem" }}>
                      <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                        <p className="meta">スレッド作成者は「解決」メッセージで完了通知できます。</p>
                        <p className="meta">削除すると、このスレッドのメッセージはすべて消えます。</p>
                      </div>
                      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                        <button type="button" className="ghost" onClick={onResolveActiveThread} disabled={!canResolveActiveThread}>
                          解決
                        </button>
                        <button type="button" className="ghost" onClick={onDeleteActiveThread} disabled={!canDeleteActiveThread}>
                          スレッド削除
                        </button>
                      </div>
                    </div>

                    <div style={{ marginTop: "0.6rem" }}>
                      <textarea
                        value={replyBodyDraft}
                        onChange={(e) => onReplyBodyChange(e.currentTarget.value)}
                        rows={4}
                        placeholder="このスレッドへの返信"
                        style={{ width: "100%" }}
                        disabled={disableLocalCommunication}
                      />
                    </div>
                    <div className="panel-toolbar compact">
                      <p className="meta">返信メッセージはこのスレッドに集約されます。</p>
                      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                        <button type="button" onClick={onReplyToThread} disabled={!canReplyToThread}>
                          返信
                        </button>
                        {activeThread.method === "call_player" && !isResolutionOwner(activeThread) && (
                          <button
                            type="button"
                            className="ghost"
                            onClick={onOpenDqDialog}
                            disabled={!canOpenDqDialog}
                          >
                            DQ申請
                          </button>
                        )}
                      </div>
                    </div>
                  </>
                )}
                {activeThreadExternalEditRequest && isResolutionOwner(activeThread) && (
                  <div className="panel-toolbar compact" style={{ marginTop: "0.6rem" }}>
                    <p className="meta">外部報告申請の発信者は、申請スレッドを解決または削除できます。</p>
                    <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                      <button type="button" className="ghost" onClick={onResolveActiveThread} disabled={!canResolveActiveThread}>
                        解決
                      </button>
                      <button type="button" className="ghost" onClick={onDeleteActiveThread} disabled={!canDeleteActiveThread}>
                        スレッド削除
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </section>
        </div>
      </section>
    </>
  );
}