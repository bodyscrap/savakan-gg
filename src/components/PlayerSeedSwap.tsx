import { useState, type ReactNode } from "react";
import { t } from "../i18n";

export type PlayerSeedSwapControls = {
  active: boolean;
  available: boolean;
  busy: boolean;
  eventId: string;
  requiresSeedReport?: boolean;
  positions: { entrantId: string; phaseGroupId: string; seedNum: number; poolName: string }[];
  onToggle: () => void;
  onSwap: (sourceEntrantId: string, targetEntrantId: string) => void;
};

const dragType = "application/x-savakan-player-seed";

export function PlayerSeedSwapToggle({ controls }: { controls?: PlayerSeedSwapControls }) {
  if (!controls) return null;
  return (
    <div className="seed-swap-toolbar">
      <button type="button" className="ghost" aria-pressed={controls.active}
        disabled={controls.busy || !controls.available} onClick={controls.onToggle}>
        {t("プレイヤー入替モード")}: {controls.active ? "ON" : "OFF"}
      </button>
      {controls.active && <p className="meta">{t("プレイヤーをドラッグして入れ替えます。入替中はスコアを編集できません。")}</p>}
      {!controls.active && <p className="meta">{controls.requiresSeedReport
        ? t("全setが未開始またはReset済みで、未報告の試合結果がない場合のみ入替できます。")
        : t("試合開始前の初期Phaseのみ入替できます。不戦勝は開始済みに含みません。")}</p>}
      {controls.requiresSeedReport && <p className="meta">{t("入替後は入替モードをOFFにし、結果報告でSeed変更をstart.ggへ反映してください。")}</p>}
    </div>
  );
}

export function PlayerSeedSwapTarget({
  controls, entrantId, samePoolOnly = false, children,
}: {
  controls?: PlayerSeedSwapControls;
  entrantId: string | null;
  samePoolOnly?: boolean;
  children: ReactNode;
}) {
  const [over, setOver] = useState(false);
  const position = controls?.positions.find((entry) => entry.entrantId === entrantId);
  const enabled = Boolean(controls?.active && !controls.busy && position);
  function sourceFromTransfer(transfer: DataTransfer): string | null {
    if (!controls) return null;
    const raw = transfer.getData(dragType);
    let payload: unknown;
    try { payload = JSON.parse(raw); } catch { return null; }
    if (!payload || typeof payload !== "object"
      || !("eventId" in payload) || payload.eventId !== controls?.eventId
      || !("entrantId" in payload) || typeof payload.entrantId !== "string"
      || payload.entrantId === entrantId) return null;
    const source = controls.positions.find((entry) => entry.entrantId === payload.entrantId);
    return source && (!samePoolOnly || source.phaseGroupId === position?.phaseGroupId)
      ? source.entrantId : null;
  }
  return (
    <div className={`${enabled ? "seed-swap-target" : ""} ${enabled && over ? "seed-swap-over" : ""}`}
      draggable={enabled}
      onDragStart={(event) => {
        if (!enabled || !controls) { event.preventDefault(); return; }
        event.stopPropagation();
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData(dragType, JSON.stringify({ eventId: controls.eventId, entrantId }));
      }}
      onDragOver={(event) => {
        if (enabled && event.dataTransfer.types.includes(dragType)) {
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          setOver(true);
        }
      }}
      onDragLeave={() => setOver(false)}
      onDragEnd={() => setOver(false)}
      onDrop={(event) => {
        setOver(false);
        if (!enabled || !controls || !entrantId) return;
        event.preventDefault();
        event.stopPropagation();
        const source = sourceFromTransfer(event.dataTransfer);
        if (source) controls.onSwap(source, entrantId);
      }}>
      {children}
    </div>
  );
}
