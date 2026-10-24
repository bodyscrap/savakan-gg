import { useEffect, useId, useMemo, useRef, useState, type DragEvent, type PointerEvent } from "react";
import { save as saveFile } from "@tauri-apps/plugin-dialog";
import { t } from "../i18n";
import {
  MAX_IMAGE_BYTES, MAX_LAYOUT_BYTES, builtInOverlayPreset, mergeOverlayLayouts,
  overlayPreviewTransform, overlayComponentSelection, overlayComponentDropIndex, overlayComponentBounds, overlayComponentsIntersecting, matchOverlayComponentSizes, centerOverlayComponents, moveOverlayComponents, overlayKindLabels, overlaySourceLabels, overlayTextSources, overlayNumberSources, overlayItemSources, parseOverlayLayouts, parseOverlayLayoutsFile,
  type OverlayCentering, type OverlayComponent, type OverlayLayouts, type OverlayPreset,
} from "../domain/overlayLayout";
import { renderOverlayPreset, resolveOverlayVerticalAlign, resolveOverlayTextOverflow, type OverlayRenderState } from "../domain/overlayRenderer.js";
import { writeSnapshotExportFile } from "../domain/tournamentWorkspaceRepository";
import { OverlayComponentDialog } from "./OverlayComponentDialog";
import { OverlayPresetCopyDialog } from "./OverlayPresetCopyDialog";
import { OverlayPresetCreateDialog } from "./OverlayPresetCreateDialog";
import { OverlayPresetSwitchDialog } from "./OverlayPresetSwitchDialog";
import { OverlayColorInput } from "./OverlayColorInput";
import { OverlayFontControls } from "./OverlayFontControls";

type Props = {
  state: OverlayRenderState;
  savedLayouts: OverlayLayouts;
  onSave: (layouts: OverlayLayouts) => Promise<OverlayLayouts>;
  disabled: boolean;
};

export function OverlayLayoutEditor({ state, savedLayouts, onSave, disabled }: Props) {
  const [draftLayouts, setLayouts] = useState<OverlayLayouts>(savedLayouts);
  const layouts: OverlayLayouts = {
    ...draftLayouts, activePresetId: draftLayouts.presets.some((item) => item.id === savedLayouts.activePresetId)
      ? savedLayouts.activePresetId : null,
  };
  const [selectedId, setSelectedId] = useState(savedLayouts.activePresetId ?? savedLayouts.presets[0]?.id ?? "");
  const [selectedComponentIds, setSelectedComponentIds] = useState<string[]>([]);
  const componentId = selectedComponentIds[0] ?? "";
  const [componentUndoSnapshots, setComponentUndoSnapshots] = useState<Record<string, OverlayComponent>>({});
  const [pendingPresetSelection, setPendingPresetSelection] = useState<string | null>(null);
  const [draggedRowId, setDraggedRowId] = useState("");
  const [rowDrop, setRowDrop] = useState<{ id: string; position: "above" | "below" } | null>(null);
  const orderHelpId = useId();
  const centeringName = useId();
  const [centering, setCentering] = useState<OverlayCentering>("horizontal");
  const [working, setBusy] = useState(false);
  const busy = working || disabled;
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const [viewport, setViewport] = useState({ width: 1, height: 1 });
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [panMode, setPanMode] = useState(false);
  const [panning, setPanning] = useState(false);
  const [marquee, setMarquee] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const active = savedLayouts.presets.find((item) => item.id === savedLayouts.activePresetId);
  const [showPresetDialog, setShowPresetDialog] = useState(false);
  const [copySource, setCopySource] = useState<OverlayPreset | null>(null);
  const [showComponentDialog, setShowComponentDialog] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const handlesRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    pointerId: number; x: number; y: number; originals: OverlayComponent[];
    resize: boolean; scale: number; moved: boolean; primaryClickId?: string;
    axis?: "horizontal" | "vertical";
  } | null>(null);
  const panDrag = useRef<{ pointerId: number; x: number; y: number; original: { x: number; y: number } } | null>(null);
  const selectionDrag = useRef<{
    pointerId: number; x: number; y: number; clientX: number; clientY: number;
    moved: boolean; additive: boolean;
  } | null>(null);
  const preset = layouts.presets.find((item) => item.id === selectedId);
  const builtInPreset = useMemo(() => builtInOverlayPreset(), []);
  const canvasPreset = preset ?? builtInPreset;
  const savedComponent = preset?.components.find((item) => item.id === componentId);
  const component = savedComponent;
  const hasComponentUndo = Object.keys(componentUndoSnapshots).length > 0;
  const previewPreset = canvasPreset;
  const selectedComponents = selectedComponentIds.flatMap((id) => {
    const item = previewPreset.components.find((entry) => entry.id === id);
    return item ? [item] : [];
  });
  const selectionBounds = preset ? overlayComponentBounds(selectedComponents) : null;
  const transform = overlayPreviewTransform(canvasPreset, viewport, zoom, pan);
  const { scale } = transform;

  useEffect(() => {
    if (!previewPreset || !stageRef.current) return;
    return renderOverlayPreset(stageRef.current, previewPreset, state.active ? { ...state, fullyStopped: false } : {
      active: true, fullyStopped: false, redPlayerName: t("テストプレイヤー1"),
      bluePlayerName: t("テストプレイヤー2"), redSetWins: 2, blueSetWins: 1,
      redItems: state.redItems ?? [],
      blueItems: state.blueItems ?? [],
      roundText: "Phase / Pool A / Set 1\nGrand Finals", eventName: t("テスト大会"), eventAlias: t("テスト大会"),
    });
  }, [previewPreset, state]);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const resize = () => {
      if (wrap.clientWidth > 0 && wrap.clientHeight > 0) {
        setViewport({ width: wrap.clientWidth, height: wrap.clientHeight });
      }
    };
    const observer = new ResizeObserver(resize);
    observer.observe(wrap);
    resize();
    return () => observer.disconnect();
  }, [canvasPreset.id]);

  useEffect(() => {
    resetView();
    setPanMode(false);
    setCentering("horizontal");
    drag.current = null;
    panDrag.current = null;
    selectionDrag.current = null;
    setPanning(false);
    setMarquee(null);
    setSelectedComponentIds([]);
    setComponentUndoSnapshots({});
    endRowDrag();
  }, [canvasPreset.id]);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      if (busy || drag.current || panDrag.current) return;
      const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? wrap.clientHeight : 1;
      const delta = event.deltaY * unit;
      setZoom((current) => Math.round(Math.max(25, Math.min(400, current * 100 * Math.exp(-delta / 500)))) / 100);
    };
    wrap.addEventListener("wheel", onWheel, { passive: false });
    return () => wrap.removeEventListener("wheel", onWheel);
  }, [busy, canvasPreset.id]);

  function resetView() {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }

  function canvasPoint(clientX: number, clientY: number, clamp = false) {
    const rect = handlesRef.current?.getBoundingClientRect();
    if (!rect || !preset || scale <= 0) return null;
    const x = (clientX - rect.left) / scale;
    const y = (clientY - rect.top) / scale;
    if (!clamp && (x < 0 || y < 0 || x > preset.width || y > preset.height)) return null;
    return {
      x: Math.max(0, Math.min(preset.width, x)),
      y: Math.max(0, Math.min(preset.height, y)),
    };
  }

  function startPan(event: PointerEvent<HTMLDivElement>) {
    if (busy) return;
    if (event.button === 1 || (panMode && event.button === 0)) {
      event.preventDefault();
      event.currentTarget.focus();
      event.currentTarget.setPointerCapture(event.pointerId);
      panDrag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, original: pan };
      setPanning(true);
      return;
    }
    if (event.button !== 0 || panMode || !preset) return;
    if (event.target instanceof Element && event.target.closest(".overlay-layout-hit")) return;
    const start = canvasPoint(event.clientX, event.clientY);
    if (!start) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    selectionDrag.current = {
      pointerId: event.pointerId, x: start.x, y: start.y,
      clientX: event.clientX, clientY: event.clientY, moved: false,
      additive: event.ctrlKey || event.metaKey,
    };
    setMarquee({ x: start.x, y: start.y, width: 0, height: 0 });
  }

  function movePan(event: PointerEvent<HTMLDivElement>) {
    const current = panDrag.current;
    if (current?.pointerId === event.pointerId) {
      setPan({
        x: current.original.x + event.clientX - current.x,
        y: current.original.y + event.clientY - current.y,
      });
      return;
    }
    const selection = selectionDrag.current;
    if (!selection || selection.pointerId !== event.pointerId) return;
    if (!selection.moved && Math.hypot(event.clientX - selection.clientX, event.clientY - selection.clientY) < 3) return;
    selection.moved = true;
    const point = canvasPoint(event.clientX, event.clientY, true);
    if (!point) return;
    setMarquee({
      x: Math.min(selection.x, point.x), y: Math.min(selection.y, point.y),
      width: Math.abs(point.x - selection.x), height: Math.abs(point.y - selection.y),
    });
  }

  function stopPan(event: PointerEvent<HTMLDivElement>) {
    if (panDrag.current?.pointerId === event.pointerId) {
      panDrag.current = null;
      setPanning(false);
      return;
    }
    const selection = selectionDrag.current;
    if (!selection || selection.pointerId !== event.pointerId) return;
    selectionDrag.current = null;
    setMarquee(null);
    if (event.type !== "pointerup") return;
    const moved = Math.hypot(event.clientX - selection.clientX, event.clientY - selection.clientY) >= 3;
    if (!moved) {
      if (!selection.additive) setSelectedComponentIds([]);
      return;
    }
    const point = canvasPoint(event.clientX, event.clientY, true);
    if (!point || !preset) return;
    const bounds = {
      x: Math.min(selection.x, point.x), y: Math.min(selection.y, point.y),
      width: Math.abs(point.x - selection.x), height: Math.abs(point.y - selection.y),
    };
    const hits = overlayComponentsIntersecting(
      preset.components.slice().reverse().filter((item) => item.visible),
      bounds,
    );
    setSelectedComponentIds(selection.additive
      ? [...selectedComponentIds, ...hits.filter((id) => !selectedComponentIds.includes(id))]
      : hits);
  }

  function change(next: OverlayLayouts) {
    setLayouts(next);
    setDirty(JSON.stringify(next) !== JSON.stringify(savedLayouts));
    setError("");
  }
  function updatePreset(patch: Partial<Pick<OverlayPreset, "name" | "components">>) {
    change({ ...layouts, presets: layouts.presets.map((item) => item.id === selectedId ? { ...item, ...patch } : item) });
  }
  function updateComponents(components: OverlayComponent[]) {
    if (!preset || components.length === 0) return;
    const updatedById = new Map(components.map((item) => [item.id, item]));
    const snapshots = Object.fromEntries(components.flatMap((item) => {
      const original = preset.components.find((entry) => entry.id === item.id);
      return original && !componentUndoSnapshots[item.id] ? [[item.id, original]] : [];
    }));
    if (Object.keys(snapshots).length > 0) {
      setComponentUndoSnapshots((current) => ({ ...current, ...snapshots }));
    }
    updatePreset({ components: preset.components.map((item) => updatedById.get(item.id) ?? item) });
  }
  function updateComponent(patch: Partial<OverlayComponent>, id = componentId) {
    const original = preset?.components.find((item) => item.id === id);
    if (original) updateComponents([{ ...original, ...patch }]);
  }
  function undoComponentChanges() {
    if (!preset || !hasComponentUndo) return;
    updatePreset({
      components: preset.components.map((item) => componentUndoSnapshots[item.id] ?? item),
    });
    setComponentUndoSnapshots({});
  }
  function setComponentVisibility(id: string, visible: boolean) {
    if (!preset || busy) return;
    updateComponent({ visible }, id);
  }
  function applyComponentSelection(next: string[]) {
    setSelectedComponentIds(next);
  }
  function selectComponent(id: string, mode: "replace" | "add" | "toggle" = "replace"): string[] {
    const next = overlayComponentSelection(selectedComponentIds, id, mode);
    if (next.length === selectedComponentIds.length && next.every((item, index) => item === selectedComponentIds[index])) return next;
    applyComponentSelection(next);
    return next;
  }
  function setComponentBase(id: string) {
    const next = overlayComponentSelection(selectedComponentIds, id, "primary");
    if (next.every((item, index) => item === selectedComponentIds[index])) return;
    setSelectedComponentIds(next);
  }
  function requestPresetSelection(id: string) {
    if (id === selectedId) return;
    if (dirty) {
      setPendingPresetSelection(id);
      return;
    }
    setSelectedId(id);
    applyComponentSelection([]);
  }
  async function confirmAndSwitchPreset() {
    if (pendingPresetSelection === null) return;
    setBusy(true);
    try {
      const saved = await onSave(parseOverlayLayouts(layouts));
      setLayouts(saved);
      setDirty(false);
      setComponentUndoSnapshots({});
      setSelectedId(pendingPresetSelection);
      setSelectedComponentIds([]);
      setPendingPresetSelection(null);
      setError("");
    } catch (cause) {
      setPendingPresetSelection(null);
      setError(String(cause));
    } finally { setBusy(false); }
  }
  function discardAndSwitchPreset() {
    if (pendingPresetSelection === null) return;
    const nextId = pendingPresetSelection === "" || savedLayouts.presets.some((item) => item.id === pendingPresetSelection)
      ? pendingPresetSelection
      : savedLayouts.activePresetId ?? savedLayouts.presets[0]?.id ?? "";
    setLayouts(savedLayouts);
    setDirty(false);
    setComponentUndoSnapshots({});
    setSelectedComponentIds([]);
    setSelectedId(nextId);
    setPendingPresetSelection(null);
    setError("");
  }
  async function deletePreset() {
    if (!preset || !window.confirm(t("このプリセットを削除しますか？"))) return;
    const next = parseOverlayLayouts({
      ...layouts,
      activePresetId: layouts.activePresetId === preset.id ? null : layouts.activePresetId,
      presets: layouts.presets.filter((item) => item.id !== preset.id),
    });
    const isSavedPreset = savedLayouts.presets.some((item) => item.id === preset.id);
    if (!isSavedPreset) {
      change(next);
      setSelectedId("");
      applyComponentSelection([]);
      return;
    }
    setBusy(true);
    try {
      const saved = await onSave(next);
      setLayouts(saved);
      setDirty(false);
      setComponentUndoSnapshots({});
      setSelectedId("");
      applyComponentSelection([]);
      setError("");
    } catch (cause) {
      setLayouts(next);
      setDirty(true);
      setComponentUndoSnapshots({});
      setSelectedId("");
      applyComponentSelection([]);
      setError(String(cause));
    } finally { setBusy(false); }
  }
  async function save() {
    setBusy(true);
    try {
      const next = parseOverlayLayouts(layouts);
      const saved = await onSave(next);
      setLayouts(saved);
      setDirty(false); setComponentUndoSnapshots({}); setError("");
    } catch (cause) { setError(String(cause)); }
    finally { setBusy(false); }
  }
  function addPreset(next: OverlayPreset): boolean {
    if (layouts.presets.length >= 64) { setError(t("プリセットは64件まで、コンポーネントは128件までです。")); return false; }
    change({ ...layouts, presets: [...layouts.presets, next] });
    requestPresetSelection(next.id);
    return true;
  }
  function addComponent(next: OverlayComponent): boolean {
    if (!preset || preset.components.length >= 128) {
      setError(t("プリセットは64件まで、コンポーネントは128件までです。"));
      return false;
    }
    updatePreset({ components: [...preset.components, next] }); selectComponent(next.id);
    return true;
  }
  async function importFile(file: File) {
    setBusy(true);
    try {
      if (file.size > MAX_LAYOUT_BYTES) throw new Error(t("プリセットファイルは32MB以下にしてください。"));
      const merged = mergeOverlayLayouts(layouts, parseOverlayLayoutsFile(await file.text()));
      change(merged);
      const importedPresetId = merged.presets[layouts.presets.length]?.id;
      if (importedPresetId) requestPresetSelection(importedPresetId);
    } catch (cause) { setError(String(cause)); }
    finally { setBusy(false); }
  }
  async function exportFile(selectedOnly: boolean) {
    setBusy(true);
    try {
      const exported = selectedOnly && preset
        ? { version: 1, activePresetId: preset.id, presets: [preset] }
        : layouts;
      const data = JSON.stringify(parseOverlayLayouts(exported));
      if (new TextEncoder().encode(data).length > MAX_LAYOUT_BYTES) throw new Error(t("プリセットファイルは32MB以下にしてください。"));
      const path = await saveFile({
        title: t(selectedOnly ? "エクスポート(単体)" : "エクスポート(全体)"),
        defaultPath: selectedOnly ? "overlay-preset.json" : "overlay-presets.json",
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (!path) return;
      await writeSnapshotExportFile(path, data);
      setError("");
    } catch (cause) { setError(String(cause)); }
    finally { setBusy(false); }
  }
  async function importImage(file: File) {
    const id = componentId;
    setBusy(true);
    try {
      if (!["image/png", "image/jpeg", "image/gif", "image/webp"].includes(file.type) || file.size > MAX_IMAGE_BYTES) {
        throw new Error(t("画像は4MB以下のPNG・JPEG・GIF・WebPを選択してください。"));
      }
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error(t("画像を読み込めませんでした。")));
        reader.onerror = () => reject(reader.error ?? new Error(t("画像を読み込めませんでした。")));
        reader.readAsDataURL(file);
      });
      const image = new Image(); image.src = data; await image.decode();
      updateComponent({ image: data, imageFileName: file.name }, id);
    } catch (cause) { setError(String(cause)); }
    finally { setBusy(false); }
  }
  function startDrag(event: PointerEvent<HTMLDivElement>, item: OverlayComponent, resize: boolean) {
    if (!preset || busy || panMode || event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    wrapRef.current?.focus();
    if (event.ctrlKey || event.metaKey) { selectComponent(item.id, "toggle"); return; }
    if (resize && selectedComponentIds.length > 1) return;
    const alreadySelected = selectedComponentIds.includes(item.id);
    const ids = event.shiftKey
      ? selectComponent(item.id, "add")
      : alreadySelected ? selectedComponentIds : selectComponent(item.id);
    const originals = ids.flatMap((id) => {
      const original = previewPreset.components.find((entry) => entry.id === id);
      return original ? [original] : [];
    });
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      pointerId: event.pointerId, x: event.clientX, y: event.clientY, originals, resize, scale, moved: false,
      primaryClickId: !event.shiftKey && alreadySelected && ids.length > 1 ? item.id : undefined,
    };
  }
  function move(event: PointerEvent<HTMLDivElement>) {
    const current = drag.current;
    if (!current || !preset || busy || panMode || current.pointerId !== event.pointerId) return;
    const screenX = event.clientX - current.x, screenY = event.clientY - current.y;
    if (!current.moved && (screenX === 0 && screenY === 0 || current.originals.length > 1 && Math.hypot(screenX, screenY) < 3)) return;
    if (!current.resize && event.shiftKey && !current.axis) {
      if (Math.hypot(screenX, screenY) < 3) return;
      current.axis = Math.abs(screenX) >= Math.abs(screenY) ? "horizontal" : "vertical";
    }
    if (!event.shiftKey) current.axis = undefined;
    current.moved = true;
    const dx = (event.clientX - current.x) / current.scale, dy = (event.clientY - current.y) / current.scale;
    const original = current.originals[0];
    if (!original) return;
    try {
      if (current.resize) {
        updateComponent({
          width: Math.round(Math.max(1, Math.min(16384, original.width + dx))),
          height: Math.round(Math.max(1, Math.min(16384, original.height + dy))),
        }, original.id);
      } else {
        const moved = moveOverlayComponents(current.originals,
          current.axis === "vertical" ? 0 : dx, current.axis === "horizontal" ? 0 : dy, preset);
        updateComponents(moved);
      }
    } catch (cause) { setError(String(cause)); }
  }
  function stopDrag(event: PointerEvent<HTMLDivElement>, cancelled = false) {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    drag.current = null;
    if (cancelled || current.moved) return;
    if (current.primaryClickId) setComponentBase(current.primaryClickId);
  }
  function reorderRow(id: string, targetId: string, position: "above" | "below") {
    if (!preset || busy) return;
    try {
      const components = [...preset.components];
      const index = overlayComponentDropIndex(components, id, targetId, position);
      const originalIndex = components.findIndex((item) => item.id === id);
      if (index === originalIndex) return;
      components.splice(index, 0, components.splice(originalIndex, 1)[0]);
      selectComponent(id);
      updatePreset({ components });
    } catch (cause) { setError(String(cause)); }
  }
  function endRowDrag() {
    setDraggedRowId("");
    setRowDrop(null);
  }
  function rowDropPosition(event: DragEvent<HTMLTableRowElement>): "above" | "below" {
    const rect = event.currentTarget.getBoundingClientRect();
    return event.clientY < rect.top + rect.height / 2 ? "above" : "below";
  }
  function adjustSelection(action: "size" | "center") {
    if (!preset || busy || selectedComponents.length === 0) return;
    try {
      const adjusted = action === "size" ? matchOverlayComponentSizes(selectedComponents)
        : centerOverlayComponents(selectedComponents, preset, centering);
      const changed = adjusted.filter((item, index) => {
        const original = selectedComponents[index];
        return item.x !== original.x || item.y !== original.y || item.width !== original.width || item.height !== original.height;
      });
      if (changed.length > 0) {
        updateComponents(changed);
      }
    } catch (cause) { setError(String(cause)); }
  }

  return <section className="panel overlay-layout-editor" onKeyDown={(event) => {
    if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey || event.key.toLowerCase() !== "z"
      || !hasComponentUndo) return;
    const target = event.target;
    if (target instanceof HTMLInputElement && ["text", "number", "search", "email", "url", "tel", "password"].includes(target.type)
      || target instanceof HTMLTextAreaElement
      || target instanceof HTMLElement && target.isContentEditable) return;
    event.preventDefault();
    event.stopPropagation();
    undoComponentChanges();
  }}>
    <h2>{t("オーバーレイのカスタマイズ")}</h2>
    {error && <p role="alert" className="error">{error}</p>}
    <fieldset disabled={busy}>
      <p className="meta">{t("編集後に保存してください。出力の切り替えはテスト配信設定の「適用するプリセット」を使います。画像はエクスポートに含まれます。")}</p>
      <div className="overlay-layout-toolbar">
        <label>{t("編集するプリセット")}<select value={selectedId} onChange={(e) => requestPresetSelection(e.target.value)}>
          <option value="">{t("デフォルト")}</option>
          {layouts.presets.map((item) => {
            const saved = savedLayouts.presets.find((entry) => entry.id === item.id);
            const unsaved = JSON.stringify(item) !== JSON.stringify(saved);
            return <option key={item.id} value={item.id}>{unsaved ? "*" : ""}{item.name}</option>;
          })}
        </select></label>
        <button type="button" onClick={() => setShowPresetDialog(true)}>{t("新規作成")}</button>
        <button type="button" onClick={() => setCopySource(canvasPreset)}>{t("複製")}</button>
        <button type="button" disabled={!preset} onClick={() => void deletePreset()}>{t("削除")}</button>
        <button type="button" onClick={() => void save()} disabled={!dirty}>{t("保存")}</button>
        <button type="button" disabled={!preset} onClick={() => void exportFile(true)}>{t("エクスポート(単体)")}</button>
        <button type="button" onClick={() => void exportFile(false)}>{t("エクスポート(全体)")}</button>
        <label>{t("プリセットをインポート")}<input type="file" accept=".json,application/json" onChange={(e) => {
          const file = e.target.files?.[0]; e.target.value = ""; if (file) void importFile(file);
        }} /></label>
      </div>
      <p className="meta">{t("適用中: {name}", { name: active?.name ?? t("デフォルト") })} {dirty && t("（未保存）")}</p>
      {active && <p className="meta">{t("録画・配信ソフト側のブラウザソースの幅・高さも {width} × {height} に設定してください。", { width: active.width, height: active.height })}</p>}
      <div className="obs-overlay-grid">
        {preset && <label>{t("プリセット名")}<input value={preset.name} maxLength={256} onChange={(e) => updatePreset({ name: e.target.value })} /></label>}
      </div>
      {!preset && <p className="meta">{t("デフォルトは閲覧専用です。編集するには「複製」でプリセットを作成してください。")}</p>}
      <div className="overlay-layout-toolbar">
          <label>{t("プレビュー倍率")}<input type="range" min={25} max={400} step={1} value={Math.round(zoom * 100)}
            onChange={(event) => setZoom(event.target.valueAsNumber / 100)} /></label>
          <output aria-live="polite">{Math.round(zoom * 100)}%</output>
          <button type="button" onClick={resetView}>{t("全体に合わせる")}</button>
          <label className="checkbox-row"><input type="checkbox" checked={panMode}
            onChange={(event) => setPanMode(event.target.checked)} />{t("キャンバスを移動")}</label>
        </div>
        <p className="meta">{t("100%は全体表示です。「キャンバスを移動」がONのときだけ左ドラッグで表示位置を移動できます。マウス中ボタンは常にキャンバス移動です。表示倍率と表示位置はオーバーレイ出力に影響しません。")}</p>
        <p className="meta">{t("プレビュー上でCtrl＋マウスホイールを操作すると25〜400%で拡大縮小します。通常のホイールはページスクロールです。ドラッグ中は倍率を変更しません。")}</p>
        <div className="overlay-layout-workspace">
        <div className={`overlay-layout-viewport${panMode ? " pan-mode" : ""}${panning ? " panning" : ""}`} ref={wrapRef}
          aria-label={t("カスタマイズプレビュー")} tabIndex={0}
          onPointerDown={startPan} onPointerMove={movePan} onPointerUp={stopPan}
          onPointerCancel={stopPan} onLostPointerCapture={stopPan}>
          <div className="overlay-layout-canvas" style={{
            width: canvasPreset.width, height: canvasPreset.height,
            transform: `translate(${transform.x}px, ${transform.y}px) scale(${scale})`,
          }}>
          <div ref={stageRef} />
          {preset && <div ref={handlesRef} className="overlay-layout-handles" style={{ width: preset.width, height: preset.height }}>
            {previewPreset?.components.filter((item) => item.visible).map((item) => <div key={item.id}
              className={`overlay-layout-hit${selectedComponentIds.includes(item.id) ? " selected" : ""}${item.id === componentId ? " primary" : ""}`}
              data-component-id={item.id}
              style={{ left: item.x, top: item.y, width: item.width, height: item.height, borderWidth: 1 / scale }}
              onPointerDown={(e) => startDrag(e, item, false)} onPointerMove={move}
              onPointerUp={stopDrag} onPointerCancel={(event) => stopDrag(event, true)}
              onLostPointerCapture={(event) => stopDrag(event, true)}>
              {item.id === componentId && selectedComponentIds.length === 1 && <div className="overlay-layout-resize" style={{ width: 12 / scale, height: 12 / scale }}
                onPointerDown={(e) => startDrag(e, item, true)} />}
            </div>)}
            {selectionBounds && <div className="overlay-selection-bounds"
              role="img" aria-label={t("{count}件のコンポーネントの選択範囲", { count: selectedComponentIds.length })}
              style={{
                left: selectionBounds.x, top: selectionBounds.y, width: selectionBounds.width, height: selectionBounds.height,
                borderWidth: 1 / scale, outlineWidth: 1 / scale, outlineOffset: 1 / scale,
              }} />}
            {marquee && <div className="overlay-marquee" aria-hidden="true" style={{
              left: marquee.x, top: marquee.y, width: marquee.width, height: marquee.height,
              borderWidth: 1 / scale,
            }} />}
          </div>}
          </div>
        </div>
        <aside className="overlay-component-sidebar" aria-label={t("コンポーネント一覧")}>
          <h3>{t("コンポーネント一覧")}</h3>
          {preset && <p id={orderHelpId} className="meta overlay-component-order-help">{t("Alt＋↑/↓でも表示順変更可。")}</p>}
          <div className="overlay-component-list" onDragLeave={(event) => {
            if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setRowDrop(null);
          }}>
            <table className={`overlay-component-table${preset ? "" : " read-only"}`} aria-label={t("コンポーネント一覧")}>
              <thead><tr>
                <th scope="col">{t("表示")}</th>
                <th scope="col">{t("名称")}</th>
                <th scope="col">{t("タイプ")}</th>
                <th scope="col">{t("表示情報")}</th>
              </tr></thead>
              <tbody>{previewPreset.components.slice().reverse().map((item) => {
                const source = item.kind === "image"
                  ? (item.image && item.imageFileName) || "-"
                  : item.kind === "item"
                  ? `${t(overlaySourceLabels[item.source])} / ${t("カテゴリ{p0}", { p0: item.itemCategory ?? 1 })}`
                  : t(overlaySourceLabels[item.source]);
                return <tr key={item.id}
                  className={[
                    selectedComponentIds.includes(item.id) ? "selected" : "",
                    item.id === componentId ? "primary" : "",
                    draggedRowId === item.id ? "row-dragging" : "",
                    rowDrop?.id === item.id ? `drop-${rowDrop.position}` : "",
                  ].filter(Boolean).join(" ")}
                  draggable={!!preset && !busy}
                  onDragStart={(event) => {
                    if (!preset || busy) { event.preventDefault(); return; }
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("text/plain", item.id);
                    setDraggedRowId(item.id);
                    setRowDrop(null);
                  }}
                  onDragOver={(event) => {
                    if (!preset || busy || !draggedRowId) return;
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                    const position = rowDropPosition(event);
                    setRowDrop(draggedRowId === item.id ? null : { id: item.id, position });
                  }}
                  onDrop={(event) => {
                    if (!preset || busy || !draggedRowId) return;
                    event.preventDefault();
                    reorderRow(draggedRowId, item.id, rowDropPosition(event));
                    endRowDrag();
                  }}
                  onDragEnd={endRowDrag}
                  onClick={(event) => {
                    if (!preset || busy) return;
                    if (event.ctrlKey || event.metaKey) selectComponent(item.id, "toggle");
                    else if (event.shiftKey) selectComponent(item.id, "add");
                    else if (selectedComponentIds.length > 1 && selectedComponentIds.includes(item.id)) setComponentBase(item.id);
                    else selectComponent(item.id);
                  }}>
                  <td onClick={(event) => event.stopPropagation()}><input type="checkbox"
                    aria-label={t("{name}を表示", { name: item.name })} checked={item.visible} disabled={!preset}
                    onChange={(event) => setComponentVisibility(item.id, event.target.checked)} /></td>
                  <td><button type="button" disabled={!preset} aria-pressed={selectedComponentIds.includes(item.id)} title={item.name}
                    aria-describedby={preset ? orderHelpId : undefined}
                    aria-keyshortcuts={preset ? "Alt+ArrowUp Alt+ArrowDown" : undefined}
                    onKeyDown={(event) => {
                      if (!preset || busy || !event.altKey || event.ctrlKey || event.metaKey
                        || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
                      event.preventDefault();
                      const components = item.id === componentId ? previewPreset.components : preset.components;
                      const index = components.findIndex((entry) => entry.id === item.id);
                      const above = event.key === "ArrowUp";
                      const target = components[index + (above ? 1 : -1)];
                      if (!target) return;
                      reorderRow(item.id, target.id, above ? "above" : "below");
                      const button = event.currentTarget;
                      requestAnimationFrame(() => button.focus());
                    }}>
                    {item.name}
                  </button></td>
                  <td>{t(overlayKindLabels[item.kind])}</td>
                  <td title={source}>{source}</td>
                </tr>;
              })}</tbody>
            </table>
          </div>
          <div className="overlay-component-actions">
          <button type="button" disabled={!preset} onClick={() => setShowComponentDialog(true)}>{t("新規追加")}</button>
          <button type="button" disabled={!savedComponent} onClick={() => savedComponent && addComponent({
            ...savedComponent, id: crypto.randomUUID(), name: `${savedComponent.name.slice(0, 240)} (${t("複製")})`,
          })}>{t("複製")}</button>
          <button type="button" disabled={!component} onClick={() => {
            if (!preset) return;
            updatePreset({ components: preset.components.filter((item) => item.id !== componentId) });
            setComponentUndoSnapshots((current) => Object.fromEntries(
              Object.entries(current).filter(([id]) => id !== componentId),
            ));
            applyComponentSelection([]);
          }}>{t("削除")}</button>
          <button type="button" disabled={busy || selectedComponents.length < 2}
            title={t("最初に選択したコンポーネントの幅・高さに合わせます。")}
            onClick={() => adjustSelection("size")}>{t("サイズ統一")}</button>
          <button type="button" disabled={busy || !hasComponentUndo} onClick={undoComponentChanges}>{t("アンドゥ")}</button>
          </div>
          <fieldset className="overlay-centering-options" disabled={busy || !component}
            aria-label={t("センタリング種別")}
            title={t("選択枠の中心を画面の中心に移動します。")}>
            <div className="overlay-component-actions">
              {(["horizontal", "vertical", "both"] as const).map((mode) => <label key={mode}>
                <input type="radio" name={centeringName} value={mode} checked={centering === mode}
                  onChange={() => setCentering(mode)} />
                {t({ horizontal: "水平", vertical: "垂直", both: "両方" }[mode])}
              </label>)}
              <button type="button" disabled={busy || !component} onClick={() => adjustSelection("center")}>{t("センタリング")}</button>
            </div>
          </fieldset>
          {component && selectedComponents.length > 1 && <p className="meta">{t("{count}件を選択中。編集欄・複製・削除は基準コンポーネント「{name}」が対象です。一括調整は即時反映されます。", {
            count: selectedComponents.length, name: component.name,
          })}</p>}
        </aside>
        </div>
        {component && <div>
        <p className="meta">{t("パラメータ変更は即時反映されます。アンドゥで保存または前回のアンドゥ以降のコンポーネント編集を元に戻せます。ファイルへの保存は上部の「保存」を使ってください。")}</p>
        <div className="obs-overlay-grid">
          <div className="overlay-component-geometry">
          <label className="overlay-component-name">{t("コンポーネント名")}<input required maxLength={256} value={component.name}
            onChange={(event) => updateComponent({ name: event.target.value })} /></label>
          {component.kind === "item" && <label className="overlay-component-source">{t("表示情報")}<select value={component.itemCategory} onChange={(event) => {
            const itemCategory = Number(event.target.value);
            if (itemCategory === 1 || itemCategory === 2 || itemCategory === 3) updateComponent({ itemCategory });
          }}>{([1, 2, 3] as const).map((category) => <option key={category} value={category}>{t("カテゴリ{p0}", { p0: category })}</option>)}</select></label>}
          {(component.kind === "text" || component.kind === "number") && <label className="overlay-component-source">{t("表示情報")}<select value={component.source} onChange={(event) => {
            const source = (component.kind === "number" ? overlayNumberSources : overlayTextSources).find((item) => item === event.target.value);
            if (source) updateComponent({ source, ...(source === "number" ? { numberValue: component.numberValue ?? 0 } : {}) });
          }}>{(component.kind === "number" ? overlayNumberSources : overlayTextSources).map((source) => <option key={source} value={source}>{t(overlaySourceLabels[source])}</option>)}</select></label>}
          {(["x", "y", "width", "height"] as const).map((key) => <label key={key}>{t({ x: "X座標", y: "Y座標", width: "幅", height: "高さ" }[key])}<input
            type="number" required min={key === "x" || key === "y" ? 0 : 1} max={16384} value={component[key]}
            onChange={(e) => { const value = e.target.valueAsNumber; if (Number.isFinite(value)) updateComponent({ [key]: value }); }} /></label>)}
          <OverlayColorInput label="背景色" value={component.background} disabled={busy} onChange={(background) => updateComponent({ background })} />
          {component.kind !== "image" && <label className="overlay-component-style">{t("装飾スタイル")}<select value={component.frame === "glass" ? "glass" : component.frame ? "builtin" : "none"}
            onChange={(event) => {
              if (event.target.value === "none") updateComponent({ frame: undefined });
              else if (event.target.value === "glass") updateComponent({ frame: "glass" });
              else if (event.target.value === "builtin") updateComponent({
                frame: component.source === "eventAlias" ? "eventAlias"
                  : component.source === "setName" ? "setMain" : component.source === "roundName" ? "setSub" : "plate",
              });
            }}>
            <option value="none">{t("装飾なし")}</option>
            <option value="builtin">{t("プレート")}</option>
            <option value="glass">{t("グラス")}</option>
          </select></label>}
          </div>
          {component.kind !== "image" ? <>
            {component.kind === "clock" ? <>
              <div className="overlay-clock-format">
              <label>{t("表示フォーマット")}<input required minLength={1} maxLength={256} value={component.clockFormat}
                onChange={(event) => updateComponent({ clockFormat: event.target.value })} /></label>
              <p className="meta">{t("表示端末のローカル時刻を毎秒更新します。例: YYYY-MM-DD HH:mm:ss。YYYY/YY=年、\nMM/M=月、DD/D=日、HH/H=24時間、hh/h=12時間、mm/m=分、ss/s=秒、A/a=AM/PM、dddd/ddd=英語の曜日、d=曜日番号（日曜0）。[]内はそのまま表示します。")}</p>
              </div>
            </> : component.kind === "item" ? <>
              <label>{t("対象プレイヤー")}<select value={component.source} onChange={(event) => {
                const source = overlayItemSources.find((item) => item === event.target.value);
                if (source) updateComponent({ source });
              }}>{overlayItemSources.map((source, index) => <option key={source} value={source}>{index === 0 ? "1P" : "2P"}</option>)}</select></label>
              <label>{t("区切り文字")}<textarea maxLength={256} rows={2} value={component.delimiter}
                onChange={(event) => updateComponent({ delimiter: event.target.value })} /></label>
              <p className="meta">{t("選択順に表示します。区切り文字は空欄や改行も指定できます。未選択のカテゴリは何も表示しません。")}</p>
            </> : <>
            {component.source === "number" && <label>{t("固定数値")}<input type="number" step="any" required value={component.numberValue ?? 0}
              onChange={(event) => { const value = event.target.valueAsNumber; if (Number.isFinite(value)) updateComponent({ numberValue: value }); }} /></label>}
            {component.source === "text" && <label>{t("固定テキスト")}<textarea maxLength={10000} value={component.text} onChange={(e) => updateComponent({ text: e.target.value })} /></label>}
            </>}
            <OverlayFontControls disabled={busy} fontFamily={component.fontFamily} fontSize={component.fontSize}
              onFontFamilyChange={(fontFamily) => updateComponent({ fontFamily })}
              onFontSizeChange={(fontSize) => updateComponent({ fontSize })}>
            <OverlayColorInput label="文字色" value={component.color} disabled={busy} onChange={(color) => updateComponent({ color })} />
            <label className="overlay-font-align">{t("水平揃え")}<select value={component.align} onChange={(e) => {
              const value = e.target.value; if (value === "left" || value === "center" || value === "right") updateComponent({ align: value });
            }}><option value="left">{t("左")}</option><option value="center">{t("中央")}</option><option value="right">{t("右")}</option></select></label>
            <label className="overlay-font-align">{t("垂直揃え")}<select value={resolveOverlayVerticalAlign(component)} onChange={(event) => {
              const verticalAlign = event.target.value;
              if (verticalAlign === "top" || verticalAlign === "center" || verticalAlign === "bottom") updateComponent({ verticalAlign });
            }}><option value="top">{t("上")}</option><option value="center">{t("中央")}</option><option value="bottom">{t("下")}</option></select></label>
            <label className="checkbox-row overlay-font-bold"><input type="checkbox" checked={component.bold} onChange={(e) => updateComponent({ bold: e.target.checked })} />{t("太字")}</label>
            </OverlayFontControls>
            {component.kind !== "clock" && <div className="overlay-text-overflow">
              <label className="checkbox-row"><input type="checkbox" checked={resolveOverlayTextOverflow(component).wrap}
                onChange={(event) => updateComponent({ wrapText: event.target.checked })} />{t("はみ出たら改行")}</label>
              <label className="checkbox-row"><input type="checkbox" checked={resolveOverlayTextOverflow(component).shrink}
                onChange={(event) => updateComponent({ shrinkText: event.target.checked })} />{t("はみ出たら縮小")}</label>
              <p className="meta">{t("改行→縮小の順で適用します。縮小は元の文字サイズの50%までで、収まらない場合は末尾を「…」にします。")}</p>
            </div>}
          </> : <label>{t("画像ファイル")}<input type="file" accept="image/png,image/jpeg,image/gif,image/webp" onChange={(e) => {
            const file = e.target.files?.[0]; e.target.value = ""; if (file) void importImage(file);
          }} /></label>}
        </div>
        </div>}
        <p className="meta">{t("フォントは録画・配信ソフトを動かす端末にもインストールしてください。カスタム表示は各コンポーネントの表示設定を使います。")}</p>
    </fieldset>
    {showComponentDialog && preset && <OverlayComponentDialog
      onCreate={(next) => addComponent({
        ...next,
        x: Math.max(0, Math.round((preset.width - next.width) / 2)),
        y: Math.max(0, Math.round((preset.height - next.height) / 2)),
      })} onClose={() => setShowComponentDialog(false)} />}
    {pendingPresetSelection !== null && <OverlayPresetSwitchDialog
      onConfirm={() => void confirmAndSwitchPreset()}
      onDiscard={discardAndSwitchPreset}
      onCancel={() => setPendingPresetSelection(null)} />}
    {showPresetDialog && <OverlayPresetCreateDialog
      onCreate={addPreset} onClose={() => setShowPresetDialog(false)} />}
    {copySource && <OverlayPresetCopyDialog source={copySource}
      onCopy={addPreset} onClose={() => setCopySource(null)} />}
  </section>;
}
