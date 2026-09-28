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
  onTestBlueNameChange: (value: string) => void;
  onTestRedWinsChange: (value: number) => void;
  onTestBlueWinsChange: (value: number) => void;
  onToggleTestOverlay: () => void;
  onFullyStop: () => void;
  onPreviewLoad: () => void;
};

export function OverlayControl({
  overlayState,
  isTestOverlayActive,
  activeSetLabel,
  busy,
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
  onTestBlueNameChange,
  onTestRedWinsChange,
  onTestBlueWinsChange,
  onToggleTestOverlay,
  onFullyStop,
  onPreviewLoad,
}: OverlayControlProps) {
  return (
    <>
      <section className="panel">
        <h2>オーバーレイ</h2>
        <p className="meta">配信中セット、またはテスト表示を オーバーレイ画面に出力します。</p>
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
            : "読み込み中..."}
        </p>
      </section>

      <section className="panel overlay-preview-panel">
        {!overlayState ? (
          <p className="meta">オーバーレイ状態を読み込んでいます...</p>
        ) : (
          <>
            <div className="overlay-preview-controls">
              <p className="meta">
                状態: {overlayState.active
                  ? (isTestOverlayActive ? "テスト配信中" : `配信中 (${overlayState.currentSetId ?? "-"})`)
                  : (overlayState.fullyStopped ? "完全停止中" : "停止中")}
              </p>
              {activeSetLabel && <p className="meta">配信中set: {activeSetLabel}</p>}

              <div className="obs-overlay-grid">
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={overlayState.nameFitMode === "shrink"}
                    onChange={(e) => onNameFitModeChange(e.currentTarget.checked ? "shrink" : "truncate")}
                    disabled={busy}
                  />
                  プレイヤー名を縮小表示
                </label>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={overlayState.showSetInfo}
                    onChange={(e) => onShowSetInfoChange(e.currentTarget.checked)}
                    disabled={busy}
                  />
                  中央のセット情報を表示
                </label>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={overlayState.showEventAlias}
                    onChange={(e) => onShowEventAliasChange(e.currentTarget.checked)}
                    disabled={busy}
                  />
                  下部中央にイベントエイリアスを表示
                </label>
              </div>

              <div style={{ marginTop: "1rem", paddingTop: "1rem", borderTop: "1px solid var(--line)" }}>
                <p className="meta">テスト配信（タブ離脱で自動停止）</p>
                <div className="obs-overlay-grid">
                  <label>
                    1P プレイヤー名
                    <input
                      type="text"
                      value={testRedName}
                      onChange={(e) => onTestRedNameChange(e.currentTarget.value)}
                      disabled={busy}
                    />
                  </label>
                  <label>
                    1P 取得ゲーム数
                    <input
                      type="number"
                      min={0}
                      value={testRedWins}
                      onChange={(e) => onTestRedWinsChange(Number(e.currentTarget.value))}
                      disabled={busy}
                    />
                  </label>
                  <label>
                    2P プレイヤー名
                    <input
                      type="text"
                      value={testBlueName}
                      onChange={(e) => onTestBlueNameChange(e.currentTarget.value)}
                      disabled={busy}
                    />
                  </label>
                  <label>
                    2P 取得ゲーム数
                    <input
                      type="number"
                      min={0}
                      value={testBlueWins}
                      onChange={(e) => onTestBlueWinsChange(Number(e.currentTarget.value))}
                      disabled={busy}
                    />
                  </label>
                </div>
                <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
                  <button type="button" onClick={onToggleTestOverlay} disabled={busy}>
                    {isTestOverlayActive ? "テスト配信停止" : "テスト配信開始"}
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    onClick={onFullyStop}
                    disabled={busy || overlayState.fullyStopped}
                  >
                    完全停止
                  </button>
                </div>
              </div>
            </div>

            {(overlayState.active || isTestOverlayActive) && (
              <div className="overlay-preview-frame-wrap" ref={previewWrapRef}>
                <iframe
                  ref={previewIframeRef}
                  className="overlay-preview-frame"
                  title="オーバーレイプレビュー"
                  src={`${overlayState.overlayUrl}?preview=1`}
                  onLoad={onPreviewLoad}
                />
              </div>
            )}
          </>
        )}
      </section>
    </>
  );
}