import { t } from "../i18n";
import { useState } from "react";
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
  seedSnapshotPromptOpen: boolean;
  canReportWithoutSnapshot: boolean;
  onCloseSeedSnapshotPrompt: () => void;
  onUpdateSeedSnapshot: () => void;
  onReportWithoutSnapshot: () => void;
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
  onRestoreAll: (discardSeedShuffle: boolean) => void;
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
  seedSnapshotPromptOpen,
  canReportWithoutSnapshot,
  onCloseSeedSnapshotPrompt,
  onUpdateSeedSnapshot,
  onReportWithoutSnapshot,
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
  const [restoreAllConfirmationOpen, setRestoreAllConfirmationOpen] = useState(false);

  function closeRestore() {
    setRestoreAllConfirmationOpen(false);
    onCloseRestore();
  }

  return (
    <>
      {resultConfirmation && resultConfirmation.match.setId === activeSetId && (
        <div className="dialog-backdrop" onClick={onCancelResultConfirmation}>
          <section
            className="dialog-panel"
            role="dialog"
            aria-modal="true"
            aria-label={t("結果確定確認")}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="dialog-head">
              <div>
                <h3>{t("結果を確定しますか？")}</h3>
                <p className="meta">{t("確定後は通常の下書き破棄では取り消せません。")}</p>
              </div>
            </div>
            <div className="dialog-body">
              <div className="dialog-summary-box">
                <p className="dialog-summary-title">{resultConfirmation.match.fullRoundText}</p>
                {resultConfirmation.match.slots
                  .filter((slot) => slot.entrantId)
                  .map((slot) => (
                    <p className="meta" key={`result-confirm-${resultConfirmation.match.setId}-${slot.entrantId}`}>
                      {slot.entrantName}: {resultConfirmation.scoreDrafts[slot.entrantId ?? ""] || t("未入力")}
                    </p>
                  ))}
              </div>
              <p className="meta">{t("内容を確認し、正しければ確定してください。修正する場合はキャンセルしてください。")}</p>
            </div>
            <div className="dialog-actions dialog-actions-split" style={{ justifyContent: "flex-end" }}>
              <button type="button" className="ghost" onClick={onCancelResultConfirmation}>{t("キャンセル")}</button>
              <button type="button" disabled={busy} onClick={onConfirmResult}>{t("この結果を確定")}</button>
            </div>
          </section>
        </div>
      )}

      {seedSnapshotPromptOpen && (
        <div
          className="dialog-backdrop"
          onClick={() => {
            if (!busy) {
              onCloseSeedSnapshotPrompt();
            }
          }}
        >
          <section
            className="dialog-panel"
            role="dialog"
            aria-modal="true"
            aria-label={t("Seed反映後のスナップショット更新")}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="dialog-head">
              <div>
                <h3>{t("Seedをstart.ggへ反映しました")}</h3>
                <p className="meta">{t("次にstart.ggでブラケットをStartしてください。")}</p>
              </div>
              <button
                type="button"
                className="ghost"
                disabled={busy}
                onClick={onCloseSeedSnapshotPrompt}
              >{t("後で")}</button>
            </div>
            <div className="dialog-body">
              <p className="meta">{t("推奨手順は、ブラケットStart後にスナップショットを更新してから結果を報告することです。更新するとローカル状態がstart.gg側に置き換わり、未報告結果や途中経過が失われることがあります。")}</p>
              {canReportWithoutSnapshot && (
                <p className="meta">{t("すでにローカルで進行済みの場合は、更新せずに報告する方法もありますが、Setの対応付けに失敗して報告が停止する可能性がある上級者向けの手順です。")}</p>
              )}
            </div>
            <div className="dialog-actions dialog-actions-split">
              {canReportWithoutSnapshot && (
                <button
                  type="button"
                  className="ghost"
                  disabled={busy}
                  onClick={onReportWithoutSnapshot}
                >{t("更新せずに結果を報告（上級者向け）")}</button>
              )}
              <button type="button" disabled={busy} onClick={onUpdateSeedSnapshot}>{t("Start後にスナップショットを更新")}</button>
            </div>
          </section>
        </div>
      )}

      {restoreOpen && restoreAllConfirmationOpen && (
        <RestoreAllSeedsDialog
          busy={busy}
          selectedEventName={selectedEventName}
          onCancel={() => setRestoreAllConfirmationOpen(false)}
          onRestore={(discardSeedShuffle) => {
            setRestoreAllConfirmationOpen(false);
            onRestoreAll(discardSeedShuffle);
          }}
        />
      )}
      {restoreOpen && !restoreAllConfirmationOpen && (
        <div className="dialog-backdrop" onClick={closeRestore}>
          <section
            className="dialog-panel"
            role="dialog"
            aria-modal="true"
            aria-label={t("復元方法")}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="dialog-head">
              <div>
                <h3>{t("復元方法")}</h3>
                <p className="meta">{t("対象: {value1}", { value1: selectedEventName })}</p>
              </div>
              <button type="button" className="ghost" onClick={closeRestore}>{t("閉じる")}</button>
            </div>
            <div className="dialog-body" style={{ display: "grid", gap: "0.5rem" }}>
              <p className="meta">{t("選択範囲のスコアを、最後に取得したスナップショット時点に戻します。範囲内の未報告結果も破棄されます。Seedの並び順は維持します。全体を復元する場合のみ、Seedの並び替えを破棄するか選択できます。")}</p>
              <button type="button" className="ghost" disabled={!canRestoreCurrentPool} onClick={onRestoreCurrentPool}>{t("スナップショットから復元(現在Pool)")}</button>
              <button
                type="button"
                className="ghost"
                disabled={!canRestoreLockedPoolsInCurrentPhase}
                onClick={onRestoreLockedPoolsInCurrentPhase}
              >{t("スナップショットから復元(現在Phaseのロック中Pool)")}</button>
              <button type="button" className="ghost" disabled={!canRestoreAll} onClick={() => setRestoreAllConfirmationOpen(true)}>{t("スナップショットから復元(全体)")}</button>
              <button type="button" className="ghost" disabled={!canDiscardAllDrafts} onClick={onDiscardAllDrafts}>{t("全下書きの破棄")}</button>
              <button type="button" className="ghost" disabled={!canUpdateSnapshot} onClick={onUpdateSnapshot}>{t("スナップショットの更新(全体)")}</button>
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
            aria-label={t("配信切替確認")}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="dialog-head">
              <div>
                <h3>{t("配信先の切り替え確認")}</h3>
                <p className="meta">{t("他のセットが配信中です。")}</p>
              </div>
            </div>
            <div className="dialog-body">
              <div className="dialog-summary-box">
                <p className="dialog-summary-title">{t("現在の配信中セット")}</p>
                <p className="dialog-summary-value">{overlaySwitch.activeSetLabel}</p>
                <p className="meta">{overlaySwitch.activeEntrantNames.join(" vs ") || t("対戦カード未確定")}</p>
              </div>
              <p className="meta">{t("「{value1}」へ切り替えますか？", { value1: overlaySwitch.targetSetLabel })}</p>
            </div>
            <div className="dialog-actions dialog-actions-split" style={{ justifyContent: "flex-end" }}>
              <button type="button" className="ghost" onClick={onCancelOverlaySwitch}>{t("キャンセル")}</button>
              <button type="button" disabled={busy || overlayBusy} onClick={onConfirmOverlaySwitch}>{t("強制切り替え")}</button>
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
            aria-label={t("スマートフォン入力URL")}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="dialog-head">
              <div>
                <h3>{t("スマートフォンでアクセス")}</h3>
                <p className="meta">{t("同一LAN内の端末に共有してください。")}</p>
              </div>
              <button type="button" className="ghost" onClick={onCloseMobileInput}>{t("閉じる")}</button>
            </div>
            <div className="dialog-body">
              <div className="dialog-summary-box">
                <p className="dialog-summary-title">{t("アクセス候補")}</p>
                <div className="mobile-url-list">
                  {mobileInputCandidates.map((item) => (
                    <article className="mobile-url-item" key={`${item.bindIp}::${item.interfaceName}`}>
                      <span className="mobile-url-text">{item.bindIp}</span>
                      <button type="button" className="ghost tiny" onClick={() => onIssueMobileUrl(item.bindIp)}>{t("URL発行")}</button>
                    </article>
                  ))}
                </div>
              </div>

              {issuedUrl.trim() !== "" && showIssuedUrl && (
                <>
                  <div className="mobile-input-qr-wrap">
                    {issuedQrUrl === "" ? (
                      <p className="meta">{t("2次元コードを生成中です...")}</p>
                    ) : (
                      <img className="mobile-input-qr" src={issuedQrUrl} alt={t("スマートフォン入力URLの2次元コード")} />
                    )}
                  </div>
                  <div className="dialog-summary-box">
                    <p className="dialog-summary-title">{t("発行中のURL")}</p>
                    <p className="dialog-summary-value mobile-url-text">{issuedUrlDisplayIp}</p>
                    <p className="meta mobile-url-full">{issuedUrl}</p>
                    <div className="mobile-url-actions">
                      <button
                        type="button"
                        className="ghost"
                        disabled={mobileInputBusy || issuedUrl.trim() === ""}
                        onClick={onCopyMobileUrl}
                      >{t("URLをコピー")}</button>
                      <button type="button" className="ghost" disabled={mobileInputBusy} onClick={onRefreshMobileUrl}>
                        {mobileInputBusy ? t("更新中...") : t("URLを更新")}
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
            aria-label={t("一括報告の競合確認")}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="dialog-head">
              <div>
                <h3>{t("一括報告の競合")}</h3>
                <p className="meta">{t("このsetは start.gg 側の状態が進んでいるため、そのままでは更新できません。")}</p>
              </div>
              <button type="button" className="ghost" disabled={busy} onClick={onCancelConflict}>{t("中止")}</button>
            </div>
            <div className="dialog-body">
              <div className="dialog-summary-box">
                <p className="dialog-summary-title">{t("対象set")}</p>
                <p className="dialog-summary-value">{conflictDialog.conflict.fullRoundText}</p>
                <p className="meta">
                  {conflictDialog.conflict.entrantNames.filter((name) => name.trim() !== "").join(" vs ") || conflictDialog.conflict.setId}
                </p>
                <p className="meta">
                  remote state: {conflictDialog.conflict.remoteState} / remote winner: {conflictDialog.conflict.remoteWinnerId ?? "-"}
                </p>
              </div>
              <div className="dialog-summary-box">
                <p className="dialog-summary-title">{t("ここまでの進捗")}</p>
                <p className="dialog-summary-value">{t("対象 {value1} 件 / 送信 {value2} 件 / スキップ {value3} 件", { value1: conflictDialog.progress.totalCount, value2: conflictDialog.progress.reportedCount, value3: conflictDialog.progress.skippedCount })}</p>
              </div>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={forceOverwriteRemaining}
                  onChange={(event) => onForceOverwriteRemainingChange(event.currentTarget.checked)}
                />{t("この一括報告の残りでも、競合したsetは自動で reset して強制上書きする")}</label>
            </div>
            <div className="dialog-actions dialog-actions-split">
              <button type="button" className="ghost" disabled={busy} onClick={onCancelConflict}>{t("この時点で止める")}</button>
              <button type="button" disabled={busy} onClick={onContinueConflict}>{t("このsetを reset して続行")}</button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}

export function RestoreAllSeedsDialog({
  busy,
  selectedEventName,
  onCancel,
  onRestore,
}: {
  busy: boolean;
  selectedEventName: string;
  onCancel: () => void;
  onRestore: (discardSeedShuffle: boolean) => void;
}) {
  return (
    <div className="dialog-backdrop" onClick={() => { if (!busy) onCancel(); }}>
      <section
        className="dialog-panel"
        role="dialog"
        aria-modal="true"
        aria-label={t("全体復元時のSeedの扱い")}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="dialog-head">
          <div>
            <h3>{t("全体復元時のSeedの扱い")}</h3>
            <p className="meta">{t("対象: {value1}", { value1: selectedEventName })}</p>
          </div>
        </div>
        <div className="dialog-body">
          <p className="meta">{t("全体のスコアをスナップショット時点に戻し、未報告結果を破棄します。 Seedの並び順を維持するか、並び替えも破棄してスナップショット時点に戻すかを選択してください。")}</p>
        </div>
        <div className="dialog-actions dialog-actions-split">
          <button type="button" className="ghost" disabled={busy} onClick={onCancel}>{t("キャンセル")}</button>
          <button type="button" className="ghost" disabled={busy} onClick={() => onRestore(true)}>{t("Seedの並び替えも破棄して復元")}</button>
          <button type="button" disabled={busy} onClick={() => onRestore(false)}>{t("Seedの並び順を維持して復元")}</button>
        </div>
      </section>
    </div>
  );
}
