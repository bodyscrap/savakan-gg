import type { CSSProperties, MouseEvent } from "react";
import type {
  PhaseGroupProgressionSnapshot,
  PhaseGroupSeedSnapshot,
  RoundRobinStanding,
  RoundRobinTieBreakRule,
  SetSnapshot,
} from "./bracketProgression";
import { RoundRobinMatrix, type RoundRobinMatrixRowView } from "./RoundRobinMatrix";
import { RoundRobinStandings } from "./RoundRobinStandings";

type RoundRobinBracketProps = {
  scaleStyle: CSSProperties;
  setCount: number;
  phaseGroupId: string | null;
  seeds: PhaseGroupSeedSnapshot[];
  progressionsOut: PhaseGroupProgressionSnapshot[];
  entrantNames: string[];
  rows: RoundRobinMatrixRowView[];
  standings: RoundRobinStanding[];
  tieBreakRules: RoundRobinTieBreakRule[];
  qualifyingCount: number;
  diagnostics: {
    candidateSetCount: number;
    twoSlotSetCount: number;
    resolvedSetCount: number;
    registeredSetCount: number;
    unresolvedSetIds: string[];
    unresolvedSetReasons: string[];
  };
  onMatchClick: (set: SetSnapshot, event: MouseEvent<HTMLButtonElement>) => void;
};

export function RoundRobinBracket({
  scaleStyle,
  setCount,
  phaseGroupId,
  seeds,
  progressionsOut,
  entrantNames,
  rows,
  standings,
  tieBreakRules,
  qualifyingCount,
  diagnostics,
  onMatchClick,
}: RoundRobinBracketProps) {
  return (
    <div className="round-robin-board" style={scaleStyle}>
      <div className="round-robin-board-header">
        <div>
          <h3>Round Robin</h3>
          <p className="meta">set間の接続を持たないため、ラウンド順に一覧表示しています。</p>
          {seeds.length > 0 && (
            <details className="meta">
              <summary>対象PhaseGroup seedsを確認</summary>
              <div>phaseGroupId: {phaseGroupId ?? "-"}</div>
              <div>progressionsOut: {progressionsOut.length}</div>
              <pre style={{ whiteSpace: "pre-wrap", maxHeight: "12rem", overflow: "auto" }}>
                {JSON.stringify(progressionsOut, null, 2)}
              </pre>
              <pre style={{ whiteSpace: "pre-wrap", maxHeight: "16rem", overflow: "auto" }}>
                {JSON.stringify(seeds, null, 2)}
              </pre>
            </details>
          )}
        </div>
        <span className="round-robin-set-count">{setCount} sets</span>
      </div>
      <div className="round-robin-layout">
        <RoundRobinMatrix
          entrantNames={entrantNames}
          rows={rows}
          onMatchClick={onMatchClick}
        />
        <details className="meta">
          <summary>ROUND ROBIN set解決状況</summary>
          <div>
            <div>phaseGroup set: {diagnostics.candidateSetCount}</div>
            <div>2 slot: {diagnostics.twoSlotSetCount}</div>
            <div>entrant pair解決: {diagnostics.resolvedSetCount}</div>
            <div>表示登録: {diagnostics.registeredSetCount}</div>
            {diagnostics.unresolvedSetIds.length > 0 && (
              <div>
                未解決set:
                <pre style={{ whiteSpace: "pre-wrap", margin: 0 }}>
                  {diagnostics.unresolvedSetReasons.join("\n")}
                </pre>
              </div>
            )}
          </div>
        </details>
        <RoundRobinStandings
          standings={standings}
          tieBreakRules={tieBreakRules}
          qualifyingCount={qualifyingCount}
        />
      </div>
    </div>
  );
}