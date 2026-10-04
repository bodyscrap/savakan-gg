import type { ExternalEditRequest, ExternalScoreReport } from "../domain/messageUtils";

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
};

export type MailboxThreadSummary = {
  root: GenericMessage;
  messages: GenericMessage[];
  resolved: boolean;
  unreadCount: number;
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
  const isResolutionOwner = (thread: GenericMessage | null) => (
    normalizedSenderUserId !== ""
    && thread?.senderUserId.trim() === normalizedSenderUserId
  );

  return (
    <>
      <section className="panel">
        <h2>メッセージ送信 (メールボックス)</h2>
        <p className="meta">現在の送信者: {senderLabel}</p>
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
        <p className="meta">受信サービス: {mailboxServiceStarted ? "起動中" : "未起動"}</p>

        <div className="form" style={{ marginTop: "0.6rem" }}>
          <input value={getMailboxMethodLabel(mailboxMethodDraft)} placeholder="メッセージ属性" readOnly />
          <input
            value={mailboxSubjectDraft}
            onChange={(e) => onMailboxSubjectChange(e.currentTarget.value)}
            placeholder="件名"
            disabled={disableLocalCommunication}
          />
        </div>
        <div className="form" style={{ marginTop: "0.6rem" }}>
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
        </div>
        <p className="meta">返信は、スレッド主ならブロードキャスト、それ以外は返信先の送信者IPへ送信します。</p>

        {composeFixedBodyDraft && (
          <div style={{ marginTop: "0.6rem" }}>
            <p className="meta">固有メッセージ (自動生成 / 編集不可)</p>
            <textarea value={composeFixedBodyDraft} rows={6} readOnly style={{ width: "100%", background: "#f3f4f6" }} />
          </div>
        )}

        <div style={{ marginTop: "0.6rem" }}>
          <p className="meta">{composeFixedBodyDraft ? "補足メッセージ" : "メッセージ本文"}</p>
          <textarea
            value={genericMessageBodyDraft}
            onChange={(e) => onGenericMessageBodyChange(e.currentTarget.value)}
            rows={5}
            placeholder={composeFixedBodyDraft ? "補足を入力" : "メッセージ本文"}
            style={{ width: "100%" }}
            disabled={disableLocalCommunication}
          />
        </div>

        <div className="panel-toolbar compact">
          <p className="meta">この送信で新規スレッドが作成されます。</p>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            {composeFixedBodyDraft && (
              <button type="button" className="ghost" onClick={onCancelFixedMessage} disabled={disableLocalCommunication}>
                呼び出しをキャンセル
              </button>
            )}
            <button type="button" onClick={onPostGenericMessage} disabled={!canSendGenericMessage}>
              スレッド開始
            </button>
          </div>
        </div>
      </section>

      <section className="panel">
        <h2>メールボックス</h2>
        <div className="panel-toolbar compact">
          <div style={{ display: "flex", gap: "0.8rem", flexWrap: "wrap" }}>
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
          </div>
        </div>
        <p className="meta">
          「自分起点・解決担当」の表示があるスレッドは、自分が開始し、解決処理を担当するスレッドです。
        </p>
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
                          <div className="mailbox-thread-heading">
                            <h4>{thread.subject}</h4>
                            {ownsResolutionResponsibility && (
                              <span className="mailbox-resolution-owner-badge">自分起点・解決担当</span>
                            )}
                          </div>
                          <p className="meta">属性: {getMailboxMethodLabel(thread.method)}</p>
                        </div>
                        <p className="meta">{new Date(thread.createdAt).toLocaleString()}</p>
                      </div>
                      <p className="meta">from: {thread.senderName} ({thread.senderUserId})</p>
                      <p className="meta">
                        {resolved ? "解決済み" : "未解決"}
                        {unreadCount > 0 ? ` / 未読 ${unreadCount}` : " / 未読 0"}
                      </p>
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
                    <span className="mailbox-resolution-owner-badge">自分起点・解決担当</span>
                  )}
                </div>
                <p className="meta">属性: {getMailboxMethodLabel(activeThread.method)} / threadId: {activeThread.threadId}</p>
                <p className="meta">状態: {activeThreadResolved ? "解決済み" : "未解決"}</p>

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
                        <div>
                          <h4>{item.senderName}</h4>
                          <p className="meta">ID: {item.senderUserId} / IP: {item.senderIp || "-"}</p>
                        </div>
                        <p className="meta">{new Date(item.createdAt).toLocaleString()}</p>
                      </div>
                      {item.parentMessageId && <p className="meta">reply to: {item.parentMessageId}</p>}
                      <p className="meta">
                        type: {item.messageType === "resolve" ? "解決" : item.messageType === "dq_request" ? "DQ申請" : "通常"}
                      </p>
                      {isResolutionOwnerRoot && (
                        <span className="mailbox-resolution-owner-badge">自分起点・解決担当</span>
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
                            外部編集申請: {externalEditRequest.eventName} / {externalEditRequest.phaseName}
                            {" / Pool "}{externalEditRequest.phaseGroupName}
                          </p>
                          <p className="meta">
                            受理は申請元イベントのスナップショット選択時のみ可能です。受理すると対象プールをロックし、申請者を外部編集者に設定します。
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
                        <button
                          type="button"
                          className="ghost"
                          onClick={onOpenDqDialog}
                          disabled={!canOpenDqDialog}
                        >
                          DQ申請
                        </button>
                      </div>
                    </div>
                  </>
                )}
                {activeThreadExternalEditRequest && isResolutionOwner(activeThread) && (
                  <div className="panel-toolbar compact" style={{ marginTop: "0.6rem" }}>
                    <p className="meta">外部編集申請の発信者は、申請スレッドを解決または削除できます。</p>
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