import type { SetSlot, SetSnapshot } from "./bracketProgression";

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

type MatchDetailDialogProps = {
  match: SetSnapshot;
  setCode?: string;
  isLive: boolean;
  completed: boolean;
  matchupReady: boolean;
  busy: boolean;
  overlayBusy: boolean;
  scoreInputDisabled: boolean;
  directWinnerId: string | null;
  displayPlayersBySide: boolean;
  onDisplayPlayersBySideChange: (checked: boolean) => void;
  randomNotice: MatchSideRandomNotice | null;
  players: MatchDialogPlayerView[];
  callingEntrantId: string;
  isDqDraft: boolean;
  overlayActive: boolean;
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
  directWinnerId,
  displayPlayersBySide,
  onDisplayPlayersBySideChange,
  randomNotice,
  players,
  callingEntrantId,
  isDqDraft,
  overlayActive,
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
  onToggleOverlay,
  onConfirm,
}: MatchDetailDialogProps) {
  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <section
        className="dialog-panel"
        role="dialog"
        aria-modal="true"
        aria-label="試合詳細"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="dialog-head">
          <div className="dialog-head-summary">
            <h3>{match.fullRoundText}</h3>
            <div className="dialog-set-meta">
              <span className="set-identifier">Set {setCode ?? "-"}</span>
              {isLive && <span className="set-live-badge">配信中</span>}
            </div>
          </div>
          <button type="button" className="ghost" onClick={onClose}>閉じる</button>
        </div>
        <p className="meta">setId: {match.setId} / state: {match.state}</p>
        {completed && (
          <p className="meta">確定済みsetのスコアは変更できません。修正する場合は「影響setを取消」からやり直してください。</p>
        )}
        {!matchupReady && <p className="meta">対戦カード確定後にプレイヤーサイドを変更できます。</p>}
        {randomNotice && randomNotice.setId === match.setId && (
          <p className={`meta side-random-notice ${randomNotice.changed ? "changed" : "unchanged"}`}>
            ランダム実行済み ({new Date(randomNotice.triggeredAt).toLocaleTimeString("ja-JP", { hour12: false })})
            : 上段 {randomNotice.upperEntrantName} = {randomNotice.upperSide} / 下段 {randomNotice.lowerEntrantName} = {randomNotice.lowerSide}
            {!randomNotice.changed ? " (結果は変更なし)" : ""}
          </p>
        )}
        <label className="checkbox-row" style={{ marginTop: "0.4rem" }}>
          <input
            type="checkbox"
            checked={displayPlayersBySide}
            onChange={(event) => onDisplayPlayersBySideChange(event.currentTarget.checked)}
          />
          プレイヤーサイドに合わせて表示 (1Pが左 / 2Pが右)
        </label>
        <div className="side-toggle-row" style={{ marginTop: "0.45rem" }}>
          <button
            type="button"
            className="ghost tiny"
            disabled={busy || !matchupReady}
            onClick={onSwapSides}
          >
            1P/2P入替
          </button>
          <button
            type="button"
            className="ghost tiny side-choice side-choice-random"
            disabled={busy || !matchupReady}
            onClick={onRandomizeSides}
          >
            1P/2Pランダム決定
          </button>
        </div>

        <div className="dialog-players">
          {players.map((player) => {
            const { slot, entrantId, otherEntrantId } = player;

            return (
              <article
                className={`dialog-player-card ${player.side === "1P" ? "side-card-1p" : player.side === "2P" ? "side-card-2p" : ""}`}
                key={player.key}
              >
                <p className="dialog-player-name">{player.entrantName}</p>
                <p className="meta">entrantId: {entrantId ?? "-"}</p>
                {entrantId && (
                  <>
                    <p className="meta">プレイヤーサイド: {player.side === "" ? "-" : player.side}</p>
                    <label>
                      取得ゲーム数
                      <div className="set-score-stepper">
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
                        disabled={busy || completed}
                        onClick={() => onToggleWinner(entrantId, otherEntrantId)}
                      >
                        {directWinnerId === entrantId ? "解除" : "Win"}
                      </button>
                    )}
                    {otherEntrantId && (
                      <button
                        type="button"
                        className="ghost tiny"
                        disabled={busy || completed}
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
                      {callingEntrantId === entrantId ? "送信中..." : "呼び出し"}
                    </button>
                  </>
                )}
              </article>
            );
          })}
        </div>

        <div className="dialog-actions dialog-actions-split match-dialog-actions">
          <div className="dialog-danger-actions">
            <button type="button" className="ghost" disabled={busy || completed} onClick={onDiscardDraft}>
              下書きの破棄
            </button>
            <button type="button" className="ghost" disabled={busy} onClick={onResetSet}>
              setの取り消し
            </button>
          </div>
          <div className="dialog-primary-actions">
            <button
              type="button"
              disabled={busy || completed || !matchupReady || isDqDraft}
              onClick={onSaveDraft}
            >
              更新
            </button>
            <button type="button" className="ghost" disabled={busy || overlayBusy} onClick={onToggleOverlay}>
              {overlayActive ? "配信停止" : "配信開始"}
            </button>
            <button type="button" disabled={busy || completed || !matchupReady} onClick={onConfirm}>
              確定
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
