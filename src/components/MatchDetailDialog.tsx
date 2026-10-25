import { t } from "../i18n";
import type { SetSlot, SetSnapshot } from "../domain/bracketProgression";
import { OverlayVisibilityButtons } from "./OverlayVisibilityButtons";

export type MatchSideRandomNotice = {
  setId: string;
  upperEntrantName: string;
  lowerEntrantName: string;
  upperSide: "1P" | "2P";
  lowerSide: "1P" | "2P";
  changed: boolean;
  triggeredAt: number;
};

export type MatchDialogPlayerView = {
  key: string;
  slot: SetSlot;
  entrantId: string | null;
  entrantName: string;
  side: string;
  scoreValue: string;
  otherEntrantId: string | null;
};

export type MatchCallNotice = {
  messageId: string;
  entrantName: string;
  calledAt: string;
};

type MatchDetailDialogProps = {
  match: SetSnapshot;
  setCode?: string;
  isLive: boolean;
  completed: boolean;
  matchupReady: boolean;
  busy: boolean;
  overlayBusy: boolean;
  scoreInputDisabled: boolean;
  scoreEditLocked: boolean;
  directWinnerId: string | null;
  displayPlayersBySide: boolean;
  onDisplayPlayersBySideChange: (checked: boolean) => void;
  randomNotice: MatchSideRandomNotice | null;
  players: MatchDialogPlayerView[];
  callNotices: MatchCallNotice[];
  calledEntrantIds: Array<string | null>;
  hasUnresolvedCalls: boolean;
  canResolveCalls: boolean;
  callingEntrantId: string;
  isDqDraft: boolean;
  overlayActive: boolean;
  overlayVisibilityOverrides: Record<string, boolean>;
  onClose: () => void;
  onSwapSides: () => void;
  onRandomizeSides: () => void;
  onScoreAdjust: (entrantId: string, delta: number) => void;
  onScoreChange: (entrantId: string, value: string) => void;
  onToggleWinner: (entrantId: string, otherEntrantId: string) => void;
  onSetDq: (entrantId: string, otherEntrantId: string) => void;
  onCall: (slot: SetSlot, entrantId: string) => void;
  onDiscardDraft: () => void;
  onResetSet: () => void;
  onSaveDraft: () => void;
  onResolveCalls: () => void;
  onToggleOverlay: () => void;
  onConfirm: () => void;
};

export function MatchDetailDialog({
  match,
  setCode,
  isLive,
  completed,
  matchupReady,
  busy,
  overlayBusy,
  scoreInputDisabled,
  scoreEditLocked,
  directWinnerId,
  displayPlayersBySide,
  onDisplayPlayersBySideChange,
  randomNotice,
  players,
  callNotices,
  calledEntrantIds,
  hasUnresolvedCalls,
  canResolveCalls,
  callingEntrantId,
  isDqDraft,
  overlayActive,
  overlayVisibilityOverrides,
  onClose,
  onSwapSides,
  onRandomizeSides,
  onScoreAdjust,
  onScoreChange,
  onToggleWinner,
  onSetDq,
  onCall,
  onDiscardDraft,
  onResetSet,
  onSaveDraft,
  onResolveCalls,
  onToggleOverlay,
  onConfirm,
}: MatchDetailDialogProps) {
  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <section
        className="dialog-panel"
        role="dialog"
        aria-modal="true"
        aria-label={t("試合詳細")}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="dialog-head">
          <div className="dialog-head-summary">
            <h3>{match.fullRoundText}</h3>
            <div className="dialog-set-meta">
              <span className="set-identifier">Set {setCode ?? "-"}</span>
              {isLive && <span className="set-live-badge">{t("配信中")}</span>}
            </div>
          </div>
          <button type="button" className="ghost" onClick={onClose}>{t("閉じる")}</button>
        </div>
        <p className="meta">setId: {match.setId} / state: {match.state}</p>
        {completed && (
          <p className="meta">{t("確定済みsetのスコアは変更できません。修正する場合は「影響setを取消」からやり直してください。")}</p>
        )}
        {scoreEditLocked && (
          <p className="score-lock-notice match-score-lock-notice" role="status" aria-live="polite">
            <strong>{t("このプールはスコア入力がロックされています")}</strong>
            <span>{t("スコアを入力するには、ブラケット画面で「スコア編集のロック」を解除してください。")}</span>
          </p>
        )}
        {!matchupReady && <p className="meta">{t("対戦カード確定後にプレイヤーサイドを変更できます。")}</p>}
        {randomNotice && randomNotice.setId === match.setId && (
          <p className={`meta side-random-notice ${randomNotice.changed ? "changed" : "unchanged"}`}>{t("ランダム実行済み ({value1}) : 上段 {value2} = {value3} / 下段 {value4} = {value5}{value6}", { value1: new Date(randomNotice.triggeredAt).toLocaleTimeString("ja-JP", { hour12: false }), value2: randomNotice.upperEntrantName, value3: randomNotice.upperSide, value4: randomNotice.lowerEntrantName, value5: randomNotice.lowerSide, value6: !randomNotice.changed ? t(" (結果は変更なし)") : "" })}</p>
        )}
        {callNotices.map((notice) => (
          <p className="meta match-call-notice" key={notice.messageId}>{t("{value1}の呼び出しを行いました（{value2}）", { value1: notice.entrantName, value2: new Date(notice.calledAt).toLocaleTimeString("ja-JP", { hour12: false }) })}</p>
        ))}
        {hasUnresolvedCalls && (
          <p className="meta">
            {completed
              ? t("確定済みSetの呼び出しは呼び出しリストから解決してください。")
              : t("このSetでは呼び出し中のプレイヤーがいるため、呼び出しを解決するまでスコア入力・DQ・確定はできません。")}
          </p>
        )}
        <label className="checkbox-row" style={{ marginTop: "0.4rem" }}>
          <input
            type="checkbox"
            checked={displayPlayersBySide}
            onChange={(event) => onDisplayPlayersBySideChange(event.currentTarget.checked)}
          />{t("プレイヤーサイドに合わせて表示 (1Pが左 / 2Pが右)")}</label>
        <div className="side-toggle-row" style={{ marginTop: "0.45rem" }}>
          <button
            type="button"
            className="ghost tiny"
            disabled={busy || !matchupReady || hasUnresolvedCalls}
            onClick={onSwapSides}
          >{t("1P/2P入替")}</button>
          <button
            type="button"
            className="ghost tiny side-choice side-choice-random"
            disabled={busy || !matchupReady || hasUnresolvedCalls}
            onClick={onRandomizeSides}
          >{t("1P/2Pランダム決定")}</button>
        </div>

        <div className="dialog-players">
          {players.map((player) => {
            const { slot, entrantId, otherEntrantId } = player;

            return (
              <article
                className={`dialog-player-card ${entrantId && calledEntrantIds.includes(entrantId) ? "call-active" : ""} ${player.side === "1P" ? "side-card-1p" : player.side === "2P" ? "side-card-2p" : ""}`}
                key={player.key}
              >
                <p className="dialog-player-name">{player.entrantName}</p>
                <p className="meta">entrantId: {entrantId ?? "-"}</p>
                {entrantId && (
                  <>
                    <p className="meta">{t("プレイヤーサイド: {value1}", { value1: player.side === "" ? "-" : player.side })}</p>
                    <label>{t("取得ゲーム数")}<div className="set-score-stepper">
                        <button
                          type="button"
                          className="ghost tiny"
                          disabled={scoreInputDisabled}
                          onClick={() => onScoreAdjust(entrantId, -1)}
                        >
                          -
                        </button>
                        <input
                          className="set-score-input"
                          type="text"
                          inputMode="numeric"
                          value={player.scoreValue}
                          disabled={scoreInputDisabled}
                          onChange={(event) => onScoreChange(entrantId, event.currentTarget.value)}
                        />
                        <button
                          type="button"
                          className="ghost tiny"
                          disabled={scoreInputDisabled}
                          onClick={() => onScoreAdjust(entrantId, 1)}
                        >
                          +
                        </button>
                      </div>
                    </label>
                    {otherEntrantId && (
                      <button
                        type="button"
                        className="ghost tiny"
                        disabled={scoreInputDisabled}
                        onClick={() => onToggleWinner(entrantId, otherEntrantId)}
                      >
                        {directWinnerId === entrantId ? t("解除") : "Win"}
                      </button>
                    )}
                    {otherEntrantId && (
                      <button
                        type="button"
                        className="ghost tiny"
                        disabled={
                          scoreInputDisabled || scoreEditLocked
                        }
                        onClick={() => onSetDq(entrantId, otherEntrantId)}
                      >
                        DQ
                      </button>
                    )}
                    <button
                      type="button"
                      className="ghost tiny"
                      disabled={busy || callingEntrantId === entrantId}
                      onClick={() => onCall(slot, entrantId)}
                    >
                      {callingEntrantId === entrantId ? t("送信中...") : t("呼び出し")}
                    </button>
                  </>
                )}
              </article>
            );
          })}
        </div>

        <div className="dialog-actions dialog-actions-split match-dialog-actions">
          <div className="dialog-danger-actions">
            <button type="button" className="ghost" disabled={busy || completed || scoreEditLocked || hasUnresolvedCalls} onClick={onDiscardDraft}>{t("下書きの破棄")}</button>
            <button type="button" className="ghost" disabled={busy || scoreEditLocked || hasUnresolvedCalls} onClick={onResetSet}>{t("setの取り消し")}</button>
          </div>
          <div className="dialog-primary-actions">
            <button
              type="button"
              disabled={busy || completed || !matchupReady || isDqDraft || hasUnresolvedCalls}
              onClick={onSaveDraft}
            >{t("更新")}</button>
            {hasUnresolvedCalls && !completed && (
              <button
                type="button"
                className="ghost"
                disabled={busy || !canResolveCalls}
                onClick={onResolveCalls}
                title={canResolveCalls ? undefined : t("他端末発行の呼び出しは発行端末で解決してください。")}
              >{t("呼び出しを解決")}</button>
            )}
            <button
              type="button"
              className="ghost"
              disabled={busy || overlayBusy || (!overlayActive && hasUnresolvedCalls)}
              onClick={onToggleOverlay}
              title={!overlayActive && hasUnresolvedCalls ? t("呼び出しを解決してから配信を開始してください。") : undefined}
            >
              {overlayActive ? t("配信停止") : hasUnresolvedCalls ? t("未解決呼び出しあり") : t("配信開始")}
            </button>
            <button type="button" disabled={busy || completed || !matchupReady || hasUnresolvedCalls} onClick={onConfirm}>{t("確定")}</button>
          </div>
        </div>
        <OverlayVisibilityButtons
          visibilityOverrides={overlayVisibilityOverrides}
          disabled={overlayBusy}
        />
      </section>
    </div>
  );
}
