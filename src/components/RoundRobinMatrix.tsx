import type { MouseEvent } from "react";
import type { SetSnapshot } from "../domain/bracketProgression";

export type RoundRobinMatrixMatchView = {
  set: SetSnapshot;
  className: string;
  title: string;
  roundLabel: string;
  setLabel: string;
  resultStatus: "inprogress" | "draft" | "confirmed" | "reset" | null;
  resultStatusLabel: string;
  isLiveOverlaySet: boolean;
  rowGameScore: string;
  columnGameScore: string;
};

export type RoundRobinMatrixCellView = {
  key: string;
  kind: "diagonal" | "empty";
} | {
  key: string;
  kind: "match";
  match: RoundRobinMatrixMatchView;
};

export type RoundRobinMatrixRowView = {
  key: string;
  entrantName: string;
  cells: RoundRobinMatrixCellView[];
  setSummary: string;
  gameSummary: string;
};

type RoundRobinMatrixProps = {
  entrantNames: string[];
  rows: RoundRobinMatrixRowView[];
  onMatchClick: (set: SetSnapshot, event: MouseEvent<HTMLButtonElement>) => void;
};

export function RoundRobinMatrix({ entrantNames, rows, onMatchClick }: RoundRobinMatrixProps) {
  return (
    <div className="round-robin-matrix-wrap">
      <table className="round-robin-matrix">
        <thead>
          <tr>
            <th scope="col">対戦表</th>
            {entrantNames.map((entrantName, index) => (
              <th scope="col" key={`${index}-${entrantName}`} title={entrantName}>
                {entrantName || "-"}
              </th>
            ))}
            <th scope="col">set/game</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <th scope="row" title={row.entrantName}>{row.entrantName || "-"}</th>
              {row.cells.map((cell) => {
                if (cell.kind !== "match") {
                  return (
                    <td
                      className={`round-robin-cell ${cell.kind === "diagonal" ? "diagonal" : "empty"}`}
                      key={cell.key}
                    >
                      -
                    </td>
                  );
                }

                const { match } = cell;
                return (
                  <td key={cell.key} className="round-robin-cell">
                    <button
                      type="button"
                      className={match.className}
                      title={match.title}
                      onClick={(event) => onMatchClick(match.set, event)}
                    >
                      <span className="round-robin-match-code" title={match.roundLabel}>{match.roundLabel}</span>
                      <span className="round-robin-match-result">{match.setLabel}</span>
                      {(match.resultStatusLabel !== "" || match.isLiveOverlaySet) && (
                        <span className="round-robin-match-status">
                          {match.resultStatusLabel !== "" && match.resultStatus && (
                            <span className={`set-status-badge status-${match.resultStatus}`}>
                              {match.resultStatusLabel}
                            </span>
                          )}
                          {match.isLiveOverlaySet && <span className="set-live-badge">配信中</span>}
                        </span>
                      )}
                      <strong>{match.rowGameScore} - {match.columnGameScore}</strong>
                    </button>
                  </td>
                );
              })}
              <td className="round-robin-row-summary">
                <span>{row.setSummary}</span>
                <span>{row.gameSummary}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}