import type { BatchConflictDialogState } from "../hooks/useBracketReport";
import type { ResultConfirmationState } from "../hooks/useSetResultDrafts";

type OverlaySwitchView = {
  targetSetLabel: string;
  activeSetLabel: string;
  activeEntrantNames: string[];
};

type MobileInputCandidateView = {
  bindIp: string;
  interfaceName: string;
};

type BracketDialogsProps = {
  busy: boolean;
  resultConfirmation: ResultConfirmationState | null;
  activeSetId: string | null;
  onCancelResultConfirmation: () => void;
  onConfirmResult: () => void;
  restoreOpen: boolean;
  selectedEventName: string;
  canRestoreCurrentPool: boolean;
  canRestoreLockedPoolsInCurrentPhase: boolean;
  canRestoreAll: boolean;
  canUpdateSnapshot: boolean;
  canDiscardAllDrafts: boolean;
  onCloseRestore: () => void;
  onRestoreCurrentPool: () => void;
  onRestoreLockedPoolsInCurrentPhase: () => void;
  onRestoreAll: () => void;
  onUpdateSnapshot: () => void;
  onDiscardAllDrafts: () => void;
  overlaySwitch: OverlaySwitchView | null;
  overlayBusy: boolean;
  onCancelOverlaySwitch: () => void;
  onConfirmOverlaySwitch: () => void;
  mobileInputOpen: boolean;
  mobileInputCandidates: MobileInputCandidateView[];
  mobileInputBusy: boolean;
  issuedUrl: string;
  issuedUrlDisplayIp: string;
  issuedQrUrl: string;
  showIssuedUrl: boolean;
  onCloseMobileInput: () => void;
  onIssueMobileUrl: (bindIp: string) => void;
  onCopyMobileUrl: () => void;
  onRefreshMobileUrl: () => void;
  conflictDialog: BatchConflictDialogState | null;
  forceOverwriteRemaining: boolean;
  onCancelConflict: () => void;
  onForceOverwriteRemainingChange: (checked: boolean) => void;
  onContinueConflict: () => void;
};

export function BracketDialogs({
  busy,
  resultConfirmation,
  activeSetId,
  onCancelResultConfirmation,
  onConfirmResult,
  restoreOpen,
  selectedEventName,
  canRestoreCurrentPool,
  canRestoreLockedPoolsInCurrentPhase,
  canRestoreAll,
  canUpdateSnapshot,
  canDiscardAllDrafts,
  onCloseRestore,
  onRestoreCurrentPool,
  onRestoreLockedPoolsInCurrentPhase,
  onRestoreAll,
  onUpdateSnapshot,
  onDiscardAllDrafts,
  overlaySwitch,
  overlayBusy,
  onCancelOverlaySwitch,
  onConfirmOverlaySwitch,
  mobileInputOpen,
  mobileInputCandidates,
  mobileInputBusy,
  issuedUrl,
  issuedUrlDisplayIp,
  issuedQrUrl,
  showIssuedUrl,
  onCloseMobileInput,
  onIssueMobileUrl,
  onCopyMobileUrl,
  onRefreshMobileUrl,
  conflictDialog,
  forceOverwriteRemaining,
  onCancelConflict,
  onForceOverwriteRemainingChange,
  onContinueConflict,
}: BracketDialogsProps) {
  return (
    <>
      {resultConfirmation && resultConfirmation.match.setId === activeSetId && (
        <div className="dialog-backdrop" onClick={onCancelResultConfirmation}>
          <section
            className="dialog-panel"
            role="dialog"
            aria-modal="true"
            aria-label="結果確定確認"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="dialog-head">
              <div>
                <h3>結果を確定しますか？</h3>
                <p className="meta">確定後は通常の下書き破棄では取り消せません。</p>
              </div>
            </div>
            <div className="dialog-body">
              <div className="dialog-summary-box">
                <p className="dialog-summary-title">{resultConfirmation.match.fullRoundText}</p>
                {resultConfirmation.match.slots
                  .filter((slot) => slot.entrantId)
                  .map((slot) => (
                    <p className="meta" key={`result-confirm-${resultConfirmation.match.setId}-${slot.entrantId}`}>
                      {slot.entrantName}: {resultConfirmation.scoreDrafts[slot.entrantId ?? ""] || "未入力"}
                    </p>
                  ))}
              </div>
              <p className="meta">内容を確認し、正しければ確定してください。修正する場合はキャンセルしてください。</p>
            </div>
            <div className="dialog-actions dialog-actions-split" style={{ justifyContent: "flex-end" }}>
              <button type="button" className="ghost" onClick={onCancelResultConfirmation}>キャンセル</button>
              <button type="button" disabled={busy} onClick={onConfirmResult}>
                この結果を確定
              </button>
            </div>
          </section>
        </div>
      )}

      {restoreOpen && (
        <div className="dialog-backdrop" onClick={onCloseRestore}>
          <section
            className="dialog-panel"
            role="dialog"
            aria-modal="true"
            aria-label="復元方法"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="dialog-head">
              <div>
                <h3>復元方法</h3>
                <p className="meta">対象: {selectedEventName}</p>
              </div>
              <button type="button" className="ghost" onClick={onCloseRestore}>閉じる</button>
            </div>
            <div className="dialog-body" style={{ display: "grid", gap: "0.5rem" }}>
              <p className="meta">
                選択範囲のスコアを、最後に取得したスナップショット時点に戻します。範囲内の未報告結果も破棄されます。
              </p>
              <button type="button" className="ghost" disabled={!canRestoreCurrentPool} onClick={onRestoreCurrentPool}>
                スナップショットから復元(現在Pool)
              </button>
              <button
                type="button"
                className="ghost"
                disabled={!canRestoreLockedPoolsInCurrentPhase}
                onClick={onRestoreLockedPoolsInCurrentPhase}
              >
                スナップショットから復元(現在Phaseのロック中Pool)
              </button>
              <button type="button" className="ghost" disabled={!canRestoreAll} onClick={onRestoreAll}>
                スナップショットから復元(全体)
              </button>
              <button type="button" className="ghost" disabled={!canDiscardAllDrafts} onClick={onDiscardAllDrafts}>
                全下書きの破棄
              </button>
              <button type="button" className="ghost" disabled={!canUpdateSnapshot} onClick={onUpdateSnapshot}>
                スナップショットの更新(全体)
              </button>
            </div>
          </section>
        </div>
      )}

      {overlaySwitch && (
        <div className="dialog-backdrop" onClick={onCancelOverlaySwitch}>
          <section
            className="dialog-panel"
            role="dialog"
            aria-modal="true"
            aria-label="配信切替確認"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="dialog-head">
              <div>
                <h3>配信先の切り替え確認</h3>
                <p className="meta">他のセットが配信中です。</p>
              </div>
            </div>
            <div className="dialog-body">
              <div className="dialog-summary-box">
                <p className="dialog-summary-title">現在の配信中セット</p>
                <p className="dialog-summary-value">{overlaySwitch.activeSetLabel}</p>
                <p className="meta">{overlaySwitch.activeEntrantNames.join(" vs ") || "対戦カード未確定"}</p>
              </div>
              <p className="meta">「{overlaySwitch.targetSetLabel}」へ切り替えますか？</p>
            </div>
            <div className="dialog-actions dialog-actions-split" style={{ justifyContent: "flex-end" }}>
              <button type="button" className="ghost" onClick={onCancelOverlaySwitch}>キャンセル</button>
              <button type="button" disabled={busy || overlayBusy} onClick={onConfirmOverlaySwitch}>
                強制切り替え
              </button>
            </div>
          </section>
        </div>
      )}

      {mobileInputOpen && (
        <div className="dialog-backdrop" onClick={onCloseMobileInput}>
          <section
            className="dialog-panel mobile-input-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="スマホ入力URL"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="dialog-head">
              <div>
                <h3>スマートフォンでアクセス</h3>
                <p className="meta">同一LAN内の端末に共有してください。</p>
              </div>
              <button type="button" className="ghost" onClick={onCloseMobileInput}>閉じる</button>
            </div>
            <div className="dialog-body">
              <div className="dialog-summary-box">
                <p className="dialog-summary-title">アクセス候補</p>
                <div className="mobile-url-list">
                  {mobileInputCandidates.map((item) => (
                    <article className="mobile-url-item" key={`${item.bindIp}::${item.interfaceName}`}>
                      <span className="mobile-url-text">{item.bindIp}</span>
                      <button type="button" className="ghost tiny" onClick={() => onIssueMobileUrl(item.bindIp)}>
                        URL発行
                      </button>
                    </article>
                  ))}
                </div>
              </div>

              {issuedUrl.trim() !== "" && showIssuedUrl && (
                <>
                  <div className="mobile-input-qr-wrap">
                    {issuedQrUrl === "" ? (
                      <p className="meta">2次元コードを生成中です...</p>
                    ) : (
                      <img className="mobile-input-qr" src={issuedQrUrl} alt="スマホ入力URLの2次元コード" />
                    )}
                  </div>
                  <div className="dialog-summary-box">
                    <p className="dialog-summary-title">発行中のURL</p>
                    <p className="dialog-summary-value mobile-url-text">{issuedUrlDisplayIp}</p>
                    <p className="meta mobile-url-full">{issuedUrl}</p>
                    <div className="mobile-url-actions">
                      <button
                        type="button"
                        className="ghost"
                        disabled={mobileInputBusy || issuedUrl.trim() === ""}
                        onClick={onCopyMobileUrl}
                      >
                        URLをコピー
                      </button>
                      <button type="button" className="ghost" disabled={mobileInputBusy} onClick={onRefreshMobileUrl}>
                        {mobileInputBusy ? "更新中..." : "URLを更新"}
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </section>
        </div>
      )}

      {conflictDialog && (
        <div
          className="dialog-backdrop"
          onClick={() => {
            if (!busy) {
              onCancelConflict();
            }
          }}
        >
          <section
            className="dialog-panel conflict-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="一括報告の競合確認"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="dialog-head">
              <div>
                <h3>一括報告の競合</h3>
                <p className="meta">このsetは start.gg 側の状態が進んでいるため、そのままでは更新できません。</p>
              </div>
              <button type="button" className="ghost" disabled={busy} onClick={onCancelConflict}>中止</button>
            </div>
            <div className="dialog-body">
              <div className="dialog-summary-box">
                <p className="dialog-summary-title">対象set</p>
                <p className="dialog-summary-value">{conflictDialog.conflict.fullRoundText}</p>
                <p className="meta">
                  {conflictDialog.conflict.entrantNames.filter((name) => name.trim() !== "").join(" vs ") || conflictDialog.conflict.setId}
                </p>
                <p className="meta">
                  remote state: {conflictDialog.conflict.remoteState} / remote winner: {conflictDialog.conflict.remoteWinnerId ?? "-"}
                </p>
              </div>
              <div className="dialog-summary-box">
                <p className="dialog-summary-title">ここまでの進捗</p>
                <p className="dialog-summary-value">
                  対象 {conflictDialog.progress.totalCount} 件 / 送信 {conflictDialog.progress.reportedCount} 件 / スキップ {conflictDialog.progress.skippedCount} 件
                </p>
              </div>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={forceOverwriteRemaining}
                  onChange={(event) => onForceOverwriteRemainingChange(event.currentTarget.checked)}
                />
                この一括報告の残りでも、競合したsetは自動で reset して強制上書きする
              </label>
            </div>
            <div className="dialog-actions dialog-actions-split">
              <button type="button" className="ghost" disabled={busy} onClick={onCancelConflict}>この時点で止める</button>
              <button type="button" disabled={busy} onClick={onContinueConflict}>
                このsetを reset して続行
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
