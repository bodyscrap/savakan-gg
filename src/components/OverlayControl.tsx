import { t } from "../i18n";
import { useState } from "react";

export type ObsOverlayState = {
  active: boolean;
  fullyStopped: boolean;
  currentSetId: string | null;
  eventName: string | null;
  eventAlias: string | null;
  roundText: string | null;
  redPlayerName: string;
  bluePlayerName: string;
  redSetWins: number;
  blueSetWins: number;
  fontScale: number;
  nameFitMode: "truncate" | "shrink";
  showSetInfo: boolean;
  showEventAlias: boolean;
  overlayUrl: string;
};

type OverlayControlProps = {
  overlayState: ObsOverlayState | null;
  isTestOverlayActive: boolean;
  activeSetLabel: string | null;
  busy: boolean;
  testEventAlias: string;
  testRedName: string;
  testBlueName: string;
  testRedWins: number;
  testBlueWins: number;
  previewWrapRef: { current: HTMLDivElement | null };
  previewIframeRef: { current: HTMLIFrameElement | null };
  onOpenUrl: (url: string) => void;
  onNameFitModeChange: (mode: "truncate" | "shrink") => void;
  onShowSetInfoChange: (checked: boolean) => void;
  onShowEventAliasChange: (checked: boolean) => void;
  onTestRedNameChange: (value: string) => void;
  onTestEventAliasChange: (value: string) => void;
  onTestBlueNameChange: (value: string) => void;
  onTestRedWinsChange: (value: number) => void;
  onTestBlueWinsChange: (value: number) => void;
  onToggleTestOverlay: (forceSwitch: boolean) => void;
  onFullyStop: () => void;
  onPreviewLoad: () => void;
};

export function OverlayControl({
  overlayState,
  isTestOverlayActive,
  activeSetLabel,
  busy,
  testEventAlias,
  testRedName,
  testBlueName,
  testRedWins,
  testBlueWins,
  previewWrapRef,
  previewIframeRef,
  onOpenUrl,
  onNameFitModeChange,
  onShowSetInfoChange,
  onShowEventAliasChange,
  onTestRedNameChange,
  onTestEventAliasChange,
  onTestBlueNameChange,
  onTestRedWinsChange,
  onTestBlueWinsChange,
  onToggleTestOverlay,
  onFullyStop,
  onPreviewLoad,
}: OverlayControlProps) {
  const [confirmTestOverlaySwitch, setConfirmTestOverlaySwitch] = useState(false);
  const isSwitchingFromLiveSet = Boolean(overlayState?.active && !isTestOverlayActive);

  return (
    <>
      <section className="panel">
        <h2>{t("オーバーレイ")}</h2>
        <p className="meta">{t("配信中セット、またはテスト表示を オーバーレイ画面に出力します。")}</p>
        <p className="meta">
          URL: {overlayState?.overlayUrl
            ? (
                <a
                  href={overlayState.overlayUrl}
                  onClick={(event) => {
                    event.preventDefault();
                    onOpenUrl(overlayState.overlayUrl);
                  }}
                >
                  {overlayState.overlayUrl}
                </a>
              )
            : t("読み込み中...")}
        </p>
      </section>

      <section className="panel overlay-preview-panel">
        {!overlayState ? (
          <p className="meta">{t("オーバーレイ状態を読み込んでいます...")}</p>
        ) : (
          <>
            <div className="overlay-preview-controls">
              <p className="meta">{t("状態: {value1}", { value1: overlayState.active
                  ? (isTestOverlayActive ? t("テスト配信中") : t("配信中 ({setId})", { setId: overlayState.currentSetId ?? "-" }))
                  : (overlayState.fullyStopped ? t("完全停止中") : t("停止中")) })}</p>
              {activeSetLabel && <p className="meta">{t("配信中set: {value1}", { value1: activeSetLabel })}</p>}

              <div className="obs-overlay-grid">
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={overlayState.nameFitMode === "shrink"}
                    onChange={(e) => onNameFitModeChange(e.currentTarget.checked ? "shrink" : "truncate")}
                    disabled={busy}
                  />{t("プレイヤー名を縮小表示")}</label>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={overlayState.showSetInfo}
                    onChange={(e) => onShowSetInfoChange(e.currentTarget.checked)}
                    disabled={busy}
                  />{t("中央のセット情報を表示")}</label>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={overlayState.showEventAlias}
                    onChange={(e) => onShowEventAliasChange(e.currentTarget.checked)}
                    disabled={busy}
                  />{t("下部中央にイベントエイリアスを表示")}</label>
              </div>

              <div style={{ marginTop: "1rem", paddingTop: "1rem", borderTop: "1px solid var(--line)" }}>
                <p className="meta">{t("テスト配信（タブ離脱で自動停止）")}</p>
                <div className="obs-overlay-grid">
                  <label>{t("ダミーイベントエイリアス")}<input
                      type="text"
                      value={testEventAlias}
                      onChange={(e) => onTestEventAliasChange(e.currentTarget.value)}
                      disabled={busy}
                    />
                  </label>
                  <label>{t("1P プレイヤー名")}<input
                      type="text"
                      value={testRedName}
                      onChange={(e) => onTestRedNameChange(e.currentTarget.value)}
                      disabled={busy}
                    />
                  </label>
                  <label>{t("1P 取得ゲーム数")}<input
                      type="number"
                      min={0}
                      value={testRedWins}
                      onChange={(e) => onTestRedWinsChange(Number(e.currentTarget.value))}
                      disabled={busy}
                    />
                  </label>
                  <label>{t("2P プレイヤー名")}<input
                      type="text"
                      value={testBlueName}
                      onChange={(e) => onTestBlueNameChange(e.currentTarget.value)}
                      disabled={busy}
                    />
                  </label>
                  <label>{t("2P 取得ゲーム数")}<input
                      type="number"
                      min={0}
                      value={testBlueWins}
                      onChange={(e) => onTestBlueWinsChange(Number(e.currentTarget.value))}
                      disabled={busy}
                    />
                  </label>
                </div>
                <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
                  <button
                    type="button"
                    onClick={() => {
                      if (isTestOverlayActive) {
                        onToggleTestOverlay(false);
                      } else if (isSwitchingFromLiveSet) {
                        setConfirmTestOverlaySwitch(true);
                      } else {
                        onToggleTestOverlay(false);
                      }
                    }}
                    disabled={busy}
                  >
                    {isTestOverlayActive ? t("テスト配信停止") : t("テスト配信開始")}
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    onClick={onFullyStop}
                    disabled={busy || overlayState.fullyStopped}
                  >{t("完全停止")}</button>
                </div>
              </div>
            </div>

            {(overlayState.active || isTestOverlayActive) && (
              <div className="overlay-preview-frame-wrap" ref={previewWrapRef}>
                <iframe
                  ref={previewIframeRef}
                  className="overlay-preview-frame"
                  title={t("オーバーレイプレビュー")}
                  src={`${overlayState.overlayUrl}?preview=1`}
                  onLoad={onPreviewLoad}
                />
              </div>
            )}
          </>
        )}
      </section>

      {confirmTestOverlaySwitch && (
        <div className="dialog-backdrop" onClick={() => setConfirmTestOverlaySwitch(false)}>
          <section
            className="dialog-panel"
            role="dialog"
            aria-modal="true"
            aria-label={t("テスト配信への切り替え確認")}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="dialog-head">
              <div>
                <h3>{t("テスト配信への切り替え確認")}</h3>
                <p className="meta">{t("現在の配信を停止して、テスト配信に切り替えます。")}</p>
              </div>
            </div>
            <div className="dialog-body">
              <div className="dialog-summary-box">
                <p className="dialog-summary-title">{t("現在の配信中セット")}</p>
                <p className="dialog-summary-value">
                  {activeSetLabel ?? overlayState?.currentSetId ?? t("配信中のセット")}
                </p>
                <p className="meta">
                  {[overlayState?.redPlayerName, overlayState?.bluePlayerName].filter(Boolean).join(" vs ")}
                </p>
              </div>
              <p className="meta">{t("テスト配信に切り替えてよろしいですか？")}</p>
            </div>
            <div className="dialog-actions dialog-actions-split" style={{ justifyContent: "flex-end" }}>
              <button
                type="button"
                className="ghost"
                onClick={() => setConfirmTestOverlaySwitch(false)}
              >{t("キャンセル")}</button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setConfirmTestOverlaySwitch(false);
                  onToggleTestOverlay(true);
                }}
              >{t("テスト配信に切り替え")}</button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}