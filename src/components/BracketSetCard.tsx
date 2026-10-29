import { t } from "../i18n";
import type { KeyboardEvent, MouseEvent } from "react";
import { PlayerSeedSwapTarget, type PlayerSeedSwapControls } from "./PlayerSeedSwap";

type BracketSetCardSlot = {
  key: string;
  sideLabel: string;
  sideBadgeClass: string;
  entrantName: string;
  gameWins: string | number;
  scoreClass: string;
};

type BracketSetCardProps = {
  positionY: number;
  displayCode?: string;
  changeClass: string;
  resultStatus: "inprogress" | "draft" | "confirmed" | "reset" | null;
  resultStatusLabel: string;
  isLiveOverlaySet: boolean;
  slots: BracketSetCardSlot[];
  onActivate: (event: MouseEvent<HTMLElement>) => void;
  onOpen: () => void;
  seedSwap?: PlayerSeedSwapControls;
  entrantIds?: (string | null)[];
};

export function BracketSetCard({
  positionY,
  displayCode,
  changeClass,
  resultStatus,
  resultStatusLabel,
  isLiveOverlaySet,
  slots,
  onActivate,
  onOpen,
  seedSwap,
  entrantIds,
}: BracketSetCardProps) {
  const resultStatusClass = resultStatus ? `set-card-status-${resultStatus}` : "";

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onOpen();
    }
  }

  return (
    <article
      className={`set-card simple-match-card ${changeClass} ${resultStatusClass} ${isLiveOverlaySet ? "set-card-live" : ""}`}
      style={{ top: `${Math.round(positionY)}px` }}
      role="button"
      aria-disabled={seedSwap?.active || undefined}
      tabIndex={seedSwap?.active ? -1 : 0}
      onClick={seedSwap?.active ? undefined : onActivate}
      onKeyDown={seedSwap?.active ? undefined : handleKeyDown}
    >
      {(displayCode || isLiveOverlaySet || resultStatusLabel !== "") && (
        <div className="set-header-row">
          {displayCode ? <p className="set-identifier">Set {displayCode}</p> : <span />}
          <div className="set-header-badges">
            {resultStatusLabel !== "" && resultStatus && (
              <span className={`set-status-badge status-${resultStatus}`}>
                {t(resultStatusLabel)}
              </span>
            )}
            {isLiveOverlaySet && <span className="set-live-badge">{t("配信中")}</span>}
          </div>
        </div>
      )}
      {slots.map((slot, index) => (
        <PlayerSeedSwapTarget key={slot.key} controls={seedSwap} entrantId={entrantIds?.[index] ?? null} samePoolOnly>
        <div className="simple-match-row" key={slot.key}>
          <span className={`side-badge ${slot.sideBadgeClass}`}>
            {slot.sideLabel}
          </span>
          <span className="simple-player-name">{slot.entrantName}</span>
          <span className={`simple-games ${slot.scoreClass}`}>{slot.gameWins}</span>
        </div>
        </PlayerSeedSwapTarget>
      ))}
    </article>
  );
}
