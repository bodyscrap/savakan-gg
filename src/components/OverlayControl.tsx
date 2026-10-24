import { t } from "../i18n";
import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { builtInOverlayPreset, parseOverlayLayouts, parseOverlayTestItems, type OverlayLayouts, type OverlayTestItemInputs } from "../domain/overlayLayout";
import { OverlayLayoutEditor } from "./OverlayLayoutEditor";
import type { OverlayRenderState } from "../domain/overlayRenderer.js";

export type ObsOverlayState = OverlayRenderState & {
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
  testRedItems: OverlayTestItemInputs;
  testBlueItems: OverlayTestItemInputs;
  testRedWins: number;
  testBlueWins: number;
  previewWrapRef: { current: HTMLDivElement | null };
  previewIframeRef: { current: HTMLIFrameElement | null };
  onOpenUrl: (url: string) => void;
  onTestRedNameChange: (value: string) => void;
  onTestEventAliasChange: (value: string) => void;
  onTestBlueNameChange: (value: string) => void;
  onTestRedItemsChange: (value: OverlayTestItemInputs) => void;
  onTestBlueItemsChange: (value: OverlayTestItemInputs) => void;
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
  testRedItems,
  testBlueItems,
  testRedWins,
  testBlueWins,
  previewWrapRef,
  previewIframeRef,
  onOpenUrl,
  onTestRedNameChange,
  onTestEventAliasChange,
  onTestBlueNameChange,
  onTestRedItemsChange,
  onTestBlueItemsChange,
  onTestRedWinsChange,
  onTestBlueWinsChange,
  onToggleTestOverlay,
  onFullyStop,
  onPreviewLoad,
}: OverlayControlProps) {
  const [confirmTestOverlaySwitch, setConfirmTestOverlaySwitch] = useState(false);
  const [savedLayouts, setSavedLayouts] = useState<OverlayLayouts>();
  const [persisting, setPersisting] = useState(false);
  const [presetsError, setPresetsError] = useState("");
  const defaultPreset = useMemo(() => builtInOverlayPreset(), []);
  const activePreset = savedLayouts?.presets.find((preset) => preset.id === savedLayouts.activePresetId);
  const visibilityPreset = activePreset ?? defaultPreset;
  const resolution = activePreset ?? { width: 1920, height: 1080 };
  const visibilityControlIds = activePreset?.visibilityControlIds ?? savedLayouts?.defaultVisibilityControlIds ?? [];
  const visibilityOverridesKey = JSON.stringify(Object.entries(overlayState?.visibilityOverrides ?? {})
    .sort(([left], [right]) => left.localeCompare(right)));
  const [visibilityOverrides, setVisibilityOverrides] = useState<Record<string, boolean>>({});
  const isSwitchingFromLiveSet = Boolean(overlayState?.active && !isTestOverlayActive);
  const editorState = overlayState && !overlayState.active ? {
    ...overlayState,
    redItems: parseOverlayTestItems(testRedItems),
    blueItems: parseOverlayTestItems(testBlueItems),
  } : overlayState;

  useEffect(() => {
    let alive = true;
    void invoke<unknown>("get_overlay_layouts").then((value) => {
      if (alive) setSavedLayouts(parseOverlayLayouts(value));
    }).catch((cause) => { if (alive) setPresetsError(String(cause)); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    const entries = JSON.parse(visibilityOverridesKey) as [string, boolean][];
    setVisibilityOverrides(Object.fromEntries(entries));
  }, [visibilityOverridesKey]);

  async function saveLayouts(layouts: OverlayLayouts): Promise<OverlayLayouts> {
    setPersisting(true);
    try {
      const saved = parseOverlayLayouts(await invoke<unknown>("save_overlay_layouts", { layouts }));
      setSavedLayouts(saved);
      setPresetsError("");
      return saved;
    } finally { setPersisting(false); }
  }

  async function applyPreset(presetId: string) {
    setPersisting(true);
    setPresetsError("");
    try {
      setSavedLayouts(parseOverlayLayouts(await invoke<unknown>("apply_overlay_preset", { presetId: presetId || null })));
    } catch (cause) { setPresetsError(String(cause)); }
    finally { setPersisting(false); }
  }

  async function saveVisibilityControlIds(ids: string[]) {
    if (!savedLayouts) return;
    try {
      await saveLayouts(activePreset
        ? {
          ...savedLayouts,
          presets: savedLayouts.presets.map((preset) => preset.id === activePreset.id
            ? { ...preset, visibilityControlIds: ids } : preset),
        }
        : { ...savedLayouts, defaultVisibilityControlIds: ids });
    } catch (cause) {
      setPresetsError(String(cause));
    }
  }

  async function setVisibilityControl(componentId: string, initialVisible: boolean) {
    const nextVisible = !(visibilityOverrides[componentId] ?? initialVisible);
    try {
      const visible = await invoke<boolean>("set_overlay_component_visibility", {
        componentId, visible: nextVisible,
      });
      setVisibilityOverrides((current) => ({ ...current, [componentId]: visible }));
    } catch (cause) {
      setPresetsError(String(cause));
    }
  }

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
              <p className="meta">{t("配信設定")} {t("状態: {value1}", { value1: overlayState.active
                  ? (isTestOverlayActive ? t("テスト配信中") : t("配信中 ({setId})", { setId: overlayState.currentSetId ?? "-" }))
                  : (overlayState.fullyStopped ? t("完全停止中") : t("停止中")) })}</p>
              {activeSetLabel && <p className="meta">{t("配信中set: {value1}", { value1: activeSetLabel })}</p>}

              <div style={{ marginTop: "1rem", paddingTop: "1rem", borderTop: "1px solid var(--line)" }}>
                <label>{t("適用するプリセット")}<select value={savedLayouts?.activePresetId ?? ""}
                  disabled={busy || persisting || !savedLayouts} onChange={(event) => void applyPreset(event.target.value)}>
                  <option value="">{t("デフォルト")}</option>
                  {savedLayouts?.presets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
                </select></label>
                {presetsError && <p role="alert" className="error">{presetsError}</p>}
                {activePreset && <p className="meta">{t("録画・配信ソフト側のブラウザソースの幅・高さも {width} × {height} に設定してください。", { width: activePreset.width, height: activePreset.height })}</p>}
                {savedLayouts && <div className="overlay-visibility-control">
                  <strong>{t("表示切替コンポーネント")}</strong>
                  <p className="meta">{t("プリセット上の表示状態を初期値として、表示状態にかかわらずコンポーネントを選択できます。各枠が対応する番号のボタンに割り当てられ、押すたびに表示が切り替わります。")}</p>
                  <div className="overlay-visibility-slots">
                    {Array.from({ length: 6 }, (_, index) => {
                      const id = visibilityControlIds[index] ?? "";
                      const assignedElsewhere = new Set(visibilityControlIds
                        .filter((otherId, otherIndex) => otherIndex !== index && otherId !== ""));
                      return <label key={index}>{t("表示切替 {number}", { number: index + 1 })}
                        <select value={id} disabled={busy || persisting}
                          onChange={(event) => {
                            const next = Array.from({ length: 6 }, (_, slot) => visibilityControlIds[slot] ?? "");
                            next[index] = event.currentTarget.value;
                            void saveVisibilityControlIds(next);
                          }}>
                          <option value="">{t("未選択")}</option>
                          {visibilityPreset.components.map((component) => <option key={component.id} value={component.id}
                            disabled={assignedElsewhere.has(component.id)}>
                            {component.name}
                          </option>)}
                        </select>
                      </label>;
                    })}
                  </div>
                  <div className="overlay-visibility-buttons">
                    {Array.from({ length: 6 }, (_, index) => {
                      const id = visibilityControlIds[index];
                      if (!id) return <button key={index} type="button" disabled>{index + 1}</button>;
                      const component = visibilityPreset.components.find((item) => item.id === id);
                      if (!component) return null;
                      const visible = visibilityOverrides[id] ?? component.visible;
                      return <button key={id} type="button" className={!visible ? "ghost" : ""}
                        aria-pressed={visible} aria-label={t("{number}: {name}の表示切替", {
                          number: index + 1, name: component.name,
                        })}
                        title={component.name} disabled={busy || persisting}
                        onClick={() => void setVisibilityControl(id, component.visible)}>{index + 1}</button>;
                    })}
                  </div>
                </div>}
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
                <p className="meta">{t("ダミーアイテムリスト（スペース区切り）")}</p>
                <p className="meta">{t("テスト配信と停止中のカスタマイズプレビュー専用です。本配信では「スナップショット&メタデータ設定」で保存した各プレイヤーの選択内容を表示します。")}</p>
                <div className="obs-overlay-grid">
                  {[
                    { side: "1P", values: testRedItems, onChange: onTestRedItemsChange },
                    { side: "2P", values: testBlueItems, onChange: onTestBlueItemsChange },
                  ].map(({ side, values, onChange }) => ([0, 1, 2] as const).map((index) =>
                    <label key={`${side}-${index}`}>{t("{side} ダミーアイテム（カテゴリ{category}）", { side, category: index + 1 })}<input
                      type="text" value={values[index]} disabled={busy}
                      placeholder={t("アイテムA アイテムB")}
                      onChange={(event) => {
                        const next: OverlayTestItemInputs = [...values];
                        next[index] = event.currentTarget.value;
                        onChange(next);
                      }} />
                    </label>,
                  ))}
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
              <div className="overlay-preview-frame-wrap" ref={previewWrapRef} style={{ aspectRatio: `${resolution.width} / ${resolution.height}` }}>
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

      {editorState && savedLayouts && <OverlayLayoutEditor state={editorState} savedLayouts={savedLayouts}
        onSave={saveLayouts} disabled={persisting} />}

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