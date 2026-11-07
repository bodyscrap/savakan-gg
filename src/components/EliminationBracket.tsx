import { t } from "../i18n";
import {
  useRef, useState, type CSSProperties, type MouseEvent,
  type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent,
} from "react";
import type { PhaseGroupSeedSnapshot, SetSnapshot } from "../domain/bracketProgression";
import { BracketSetCard } from "./BracketSetCard";
import type { PlayerSeedSwapControls } from "./PlayerSeedSwap";

export type EliminationBracketCardView = {
  set: SetSnapshot;
  positionY: number;
  displayCode?: string;
  changeClass: string;
  resultStatus: "inprogress" | "draft" | "confirmed" | "reset" | null;
  resultStatusLabel: string;
  isLiveOverlaySet: boolean;
  slots: {
    key: string;
    sideLabel: string;
    sideBadgeClass: string;
    entrantName: string;
    gameWins: string | number;
    scoreClass: string;
  }[];
};

export type EliminationBracketSectionView = {
  key: string;
  title: string;
  setCount: number;
  columns: {
    key: string;
    title: string;
    round: number | null;
    height: number;
    hidden: boolean;
    cards: EliminationBracketCardView[];
  }[];
};

type EliminationBracketProps = {
  seedSwap?: PlayerSeedSwapControls;
  scaleStyle: CSSProperties;
  phaseGroupKey: string;
  seeds: PhaseGroupSeedSnapshot[];
  seedMap: unknown;
  sections: EliminationBracketSectionView[];
  onActivateSet: (set: SetSnapshot, event: MouseEvent<HTMLElement>) => void;
  onOpenSet: (set: SetSnapshot) => void;
};

export function EliminationBracket({
  scaleStyle,
  phaseGroupKey,
  seeds,
  seedMap,
  sections,
  onActivateSet,
  onOpenSet,
  seedSwap,
}: EliminationBracketProps) {
  const [panningBoardKey, setPanningBoardKey] = useState<string | null>(null);
  const panRef = useRef<{
    pointerId: number; boardKey: string; startX: number; scrollLeft: number; moved: boolean;
  } | null>(null);
  const suppressClickRef = useRef(false);

  function startPan(event: ReactPointerEvent<HTMLDivElement>, boardKey: string) {
    if (
      event.button !== 0
      || event.pointerType !== "mouse"
      || seedSwap?.active
      || event.currentTarget.scrollWidth <= event.currentTarget.clientWidth
    ) return;
    panRef.current = {
      pointerId: event.pointerId,
      boardKey,
      startX: event.clientX,
      scrollLeft: event.currentTarget.scrollLeft,
      moved: false,
    };
  }

  function movePan(event: ReactPointerEvent<HTMLDivElement>) {
    const pan = panRef.current;
    if (!pan || pan.pointerId !== event.pointerId) return;

    const deltaX = event.clientX - pan.startX;
    if (!pan.moved && Math.abs(deltaX) < 4) return;
    if (!pan.moved) {
      pan.moved = true;
      setPanningBoardKey(pan.boardKey);
      event.currentTarget.setPointerCapture(event.pointerId);
    }

    event.preventDefault();
    event.currentTarget.scrollLeft = pan.scrollLeft - deltaX;
  }

  function stopPan(event: ReactPointerEvent<HTMLDivElement>) {
    const pan = panRef.current;
    if (!pan || pan.pointerId !== event.pointerId) return;
    panRef.current = null;
    setPanningBoardKey(null);
    if (pan.moved) {
      suppressClickRef.current = true;
      window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);
    }
  }

  function suppressDraggedClick(event: ReactMouseEvent<HTMLDivElement>) {
    if (!suppressClickRef.current) return;
    suppressClickRef.current = false;
    event.preventDefault();
    event.stopPropagation();
  }

  return (
    <div className="bracket-split-stack" style={scaleStyle}>
      <details className="meta bracket-debug-seeds">
        <summary>{t("対象PhaseGroup seeds / seedMapを確認")}</summary>
        <h4>seeds</h4>
        <pre style={{ whiteSpace: "pre-wrap", maxHeight: "16rem", overflow: "auto" }}>
          {JSON.stringify(seeds, null, 2)}
        </pre>
        <h4>seedMap</h4>
        <pre style={{ whiteSpace: "pre-wrap", maxHeight: "20rem", overflow: "auto" }}>
          {JSON.stringify(seedMap, null, 2)}
        </pre>
      </details>
      {sections.map((section) => (
        <section className="bracket-subgroup" key={`${phaseGroupKey}-${section.key}`}>
          <h4>{section.title}</h4>
          <p className="meta">sets: {section.setCount}</p>
          <div
            className={`bracket-board ${panningBoardKey === `${phaseGroupKey}-${section.key}` ? "bracket-board-panning" : ""}`}
            onPointerDown={(event) => startPan(event, `${phaseGroupKey}-${section.key}`)}
            onPointerMove={movePan}
            onPointerUp={stopPan}
            onPointerCancel={stopPan}
            onLostPointerCapture={stopPan}
            onClickCapture={suppressDraggedClick}
          >
            {section.columns.map((column) => (
              <section
                className={`bracket-column ${column.hidden ? "bracket-column-hidden" : ""}`}
                key={`${phaseGroupKey}-${section.key}-${column.key}`}
                aria-hidden={column.hidden}
              >
                <h4>{column.title}</h4>
                {column.round !== null && <p className="meta">round: {column.round}</p>}
                <div className="column-sets positioned" style={{ height: `${column.height}px` }}>
                  {column.cards.map((card) => (
                    <BracketSetCard
                      key={card.set.setId}
                      positionY={card.positionY}
                      displayCode={card.displayCode}
                      changeClass={card.changeClass}
                      resultStatus={card.resultStatus}
                      resultStatusLabel={card.resultStatusLabel}
                      isLiveOverlaySet={card.isLiveOverlaySet}
                      slots={card.slots}
                      seedSwap={seedSwap}
                      entrantIds={card.set.slots.map((slot) =>
                        seedSwap?.positions.some((position) => position.entrantId === slot.entrantId
                          && position.phaseGroupId === card.set.phaseGroupId)
                          ? slot.entrantId : null)}
                      onActivate={(event) => onActivateSet(card.set, event)}
                      onOpen={() => onOpenSet(card.set)}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}