import type { KeyboardEvent, MouseEvent } from "react";

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
  resultStatus: "inprogress" | "draft" | "confirmed" | null;
  resultStatusLabel: string;
  isLiveOverlaySet: boolean;
  slots: BracketSetCardSlot[];
  onActivate: (event: MouseEvent<HTMLElement>) => void;
  onOpen: () => void;
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
      tabIndex={0}
      onClick={onActivate}
      onKeyDown={handleKeyDown}
    >
      {(displayCode || isLiveOverlaySet || resultStatusLabel !== "") && (
        <div className="set-header-row">
          {displayCode ? <p className="set-identifier">Set {displayCode}</p> : <span />}
          <div className="set-header-badges">
            {resultStatusLabel !== "" && resultStatus && (
              <span className={`set-status-badge status-${resultStatus}`}>
                {resultStatusLabel}
              </span>
            )}
            {isLiveOverlaySet && <span className="set-live-badge">配信中</span>}
          </div>
        </div>
      )}
      {slots.map((slot) => (
        <div className="simple-match-row" key={slot.key}>
          <span className={`side-badge ${slot.sideBadgeClass}`}>
            {slot.sideLabel}
          </span>
          <span className="simple-player-name">{slot.entrantName}</span>
          <span className={`simple-games ${slot.scoreClass}`}>{slot.gameWins}</span>
        </div>
      ))}
    </article>
  );
}
