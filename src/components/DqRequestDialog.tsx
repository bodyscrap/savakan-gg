import { t } from "../i18n";
import type { Ref } from "react";
import type { DqRequestDialogState } from "../hooks/usePlayerDqRequest";

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
  const entrantName = dialog.callEntrantName || dialog.callEntrantId;

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <section
        className="dialog-panel conflict-dialog dq-request-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t("DQ申請({value1})", { value1: entrantName })}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="dialog-head">
          <div>
            <h3>{t("DQ申請({value1})", { value1: entrantName })}</h3>
            <p className="meta">{t("呼び出しプレイヤー本人確認のため、PLAYER IDを入力してください。")}</p>
          </div>
        </div>

        <div className="dialog-body">
          <label className="dq-request-field">
            PLAYER ID
            <input
              type="password"
              value={playerIdDraft}
              onChange={(event) => onPlayerIdChange(event.currentTarget.value)}
              placeholder="PG-..."
              autoComplete="off"
            />
          </label>
          <div className="dq-request-camera">
            <button
              type="button"
              className="ghost"
              disabled={submitting}
              onClick={cameraActive ? onStopCameraScan : onStartCameraScan}
            >
              {cameraActive ? t("カメラ停止") : t("カメラ入力")}
            </button>
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="dq-request-camera-preview"
              style={{ display: cameraActive ? "block" : "none" }}
            />
            <canvas ref={canvasRef} style={{ display: "none" }} />
          </div>

          <label className="dq-request-field">{t("申請理由 (任意)")}<textarea
              value={reasonDraft}
              onChange={(event) => onReasonChange(event.currentTarget.value)}
              rows={3}
              placeholder={t("理由を補足する場合に入力")}
            />
          </label>

          {error !== "" && <p className="message error">{error}</p>}
        </div>

        <div className="dialog-actions dialog-actions-split">
          <button type="button" className="ghost" disabled={submitting} onClick={onClose}>{t("キャンセル")}</button>
          <button type="button" disabled={submitting} onClick={onSubmit}>
            {submitting ? t("申請中...") : t("認証してDQ申請")}
          </button>
        </div>
      </section>
    </div>
  );
}
