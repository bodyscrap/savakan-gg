import type { CSSProperties, MouseEvent } from "react";
import type { PhaseGroupSeedSnapshot, SetSnapshot } from "./bracketProgression";
import { BracketSetCard } from "./BracketSetCard";

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
}: EliminationBracketProps) {
  return (
    <div className="bracket-split-stack" style={scaleStyle}>
      <details className="meta bracket-debug-seeds">
        <summary>対象PhaseGroup seeds / seedMapを確認</summary>
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
          <div className="bracket-board">
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