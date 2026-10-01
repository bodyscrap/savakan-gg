import type { Ref } from "react";
import type { DqRequestDialogState } from "../hooks/useMailbox";

type DqRequestDialogProps = {
  dialog: DqRequestDialogState;
  playerIdDraft: string;
  onPlayerIdChange: (value: string) => void;
  reasonDraft: string;
  onReasonChange: (value: string) => void;
  error: string;
  submitting: boolean;
  cameraActive: boolean;
  videoRef: Ref<HTMLVideoElement>;
  canvasRef: Ref<HTMLCanvasElement>;
  onStartCameraScan: () => void;
  onStopCameraScan: () => void;
  onClose: () => void;
  onSubmit: () => void;
};

export function DqRequestDialog({
  dialog,
  playerIdDraft,
  onPlayerIdChange,
  reasonDraft,
  onReasonChange,
  error,
  submitting,
  cameraActive,
  videoRef,
  canvasRef,
  onStartCameraScan,
  onStopCameraScan,
  onClose,
  onSubmit,
}: DqRequestDialogProps) {
  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <section
        className="dialog-panel conflict-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="DQ申請認証"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="dialog-head">
          <div>
            <h3>DQ申請認証</h3>
            <p className="meta">呼び出しプレイヤー本人確認のため、PLAYER IDを入力してください。</p>
          </div>
          <button type="button" className="ghost" disabled={submitting} onClick={onClose}>閉じる</button>
        </div>

        <div className="dialog-body">
          <p className="meta">対象: {dialog.callEntrantName || dialog.callEntrantId}</p>
          <label>
            PLAYER ID (伏字入力)
            <input
              type="password"
              value={playerIdDraft}
              onChange={(event) => onPlayerIdChange(event.currentTarget.value)}
              placeholder="PG-..."
              autoComplete="off"
            />
          </label>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginTop: "0.55rem" }}>
            <button type="button" className="ghost" disabled={submitting} onClick={onStartCameraScan}>
              カメラで2次元コードを読む
            </button>
            <button type="button" className="ghost" disabled={submitting || !cameraActive} onClick={onStopCameraScan}>
              カメラ停止
            </button>
          </div>

          <div style={{ marginTop: "0.7rem" }}>
            <p className="meta">
              {cameraActive
                ? "カメラをコードに向けると、自動でPLAYER IDを入力します。"
                : "「カメラで2次元コードを読む」を押すとプレビューが起動します。"}
            </p>
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              style={{
                width: "100%",
                maxWidth: "420px",
                borderRadius: "10px",
                border: "1px solid var(--line)",
                background: "#0f172a",
                display: cameraActive ? "block" : "none",
              }}
            />
            <canvas ref={canvasRef} style={{ display: "none" }} />
          </div>

          <label style={{ marginTop: "0.7rem" }}>
            申請理由 (任意)
            <textarea
              value={reasonDraft}
              onChange={(event) => onReasonChange(event.currentTarget.value)}
              rows={3}
              placeholder="理由を補足する場合に入力"
              style={{ width: "100%" }}
            />
          </label>

          {error !== "" && <p className="message error">{error}</p>}
        </div>

        <div className="dialog-actions dialog-actions-split">
          <button type="button" className="ghost" disabled={submitting} onClick={onClose}>キャンセル</button>
          <button type="button" disabled={submitting} onClick={onSubmit}>
            {submitting ? "申請中..." : "認証してDQ申請"}
          </button>
        </div>
      </section>
    </div>
  );
}
