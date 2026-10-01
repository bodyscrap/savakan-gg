import type { RoundRobinStanding, RoundRobinTieBreakRule } from "../domain/bracketProgression";

type RoundRobinStandingsProps = {
  standings: RoundRobinStanding[];
  tieBreakRules: RoundRobinTieBreakRule[];
  qualifyingCount: number;
};

function gameWinPercentage(standing: RoundRobinStanding): number {
  const totalGames = standing.gameWins + standing.gameLosses;
  return totalGames > 0 ? standing.gameWins / totalGames : 0;
}

function setWinPercentage(standing: RoundRobinStanding): number {
  const totalSets = standing.wins + standing.losses;
  return totalSets > 0 ? standing.wins / totalSets : 0;
}

function tieBreakRuleLabel(rule: RoundRobinTieBreakRule): string {
  if (rule === "total_sets_won") {
    return "Total sets won";
  }
  if (rule === "game_wins") {
    return "Game wins";
  }
  if (rule === "game_win_percentage") {
    return "Game win %";
  }
  return "Head-to-head";
}

function tieBreakRuleValue(
  standing: RoundRobinStanding,
  rule: RoundRobinTieBreakRule,
): string {
  if (rule === "total_sets_won") {
    return `${standing.wins}-${standing.losses}(${(setWinPercentage(standing) * 100).toFixed(2)}%)`;
  }
  if (rule === "game_wins" || rule === "game_win_percentage") {
    return `${standing.gameWins}-${standing.gameLosses}(${(gameWinPercentage(standing) * 100).toFixed(2)}%)`;
  }
  return String(standing.h2hPoints);
}

export function RoundRobinStandings({
  standings,
  tieBreakRules,
  qualifyingCount,
}: RoundRobinStandingsProps) {
  return (
    <aside className="round-robin-standings">
      <div className="round-robin-standings-head">
        <h4>現在順位</h4>
        <span>{qualifyingCount > 0 ? `${qualifyingCount}位まで次フェーズ` : "次フェーズ枠未取得"}</span>
      </div>
      <table>
        <thead>
          <tr>
            <th>順位</th>
            <th className="round-robin-player-column">プレイヤー</th>
            {tieBreakRules.map((rule, index) => (
              <th key={rule}>{index + 1}. {tieBreakRuleLabel(rule)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {standings.map((standing, index) => {
            if (standing.isPlaceholder) {
              return null;
            }

            return (
              <tr className={standing.qualified ? "round-robin-qualified" : ""} key={standing.entrantId}>
                <th scope="row">{index + 1}</th>
                <td className="round-robin-player-column" title={standing.entrantName}>{standing.entrantName}</td>
                {tieBreakRules.map((rule) => (
                  <td key={rule}>{tieBreakRuleValue(standing, rule)}</td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </aside>
  );
}