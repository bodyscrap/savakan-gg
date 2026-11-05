import type { OverlayRenderState } from "./overlayRenderer.js";

type TestFirstToNWinsData = NonNullable<OverlayRenderState["firstToNWins"]> & {
  winnerName: string | null;
};

export type OverlayTestFirstToNWinsInput = {
  playerOneName: string;
  playerTwoName: string;
  winsRequired: number;
  drawCountsAsWin: boolean;
  history: string;
};

export function buildOverlayTestDisplayParts(
  phaseName: string,
  poolName: string,
  setName: string,
): { phaseName: string; poolName: string; setLabel: string } {
  const phase = phaseName.trim() || "-";
  const pool = poolName.trim() || "-";
  const set = setName.trim() || "-";
  return {
    phaseName: phase,
    poolName: `Pool ${pool}`,
    setLabel: `Set ${set}`,
  };
}

export function isValidOverlayTestFirstToNWinsHistory(history: string): boolean {
  return /^[12d\s]*$/i.test(history);
}

export function buildOverlayTestFirstToNWins(
  input: OverlayTestFirstToNWinsInput,
): TestFirstToNWinsData {
  const winsRequired = Math.max(1, Number.isFinite(input.winsRequired)
    ? Math.trunc(input.winsRequired)
    : 1);
  const outcomes = input.history.toLowerCase().replace(/\s/g, "").match(/[12d]/g) ?? [];
  let playerOneWins = 0;
  let playerTwoWins = 0;
  let winnerName: string | null = null;
  const playerOneResults: boolean[] = [];
  const playerTwoResults: boolean[] = [];

  for (const outcome of outcomes) {
    if (outcome === "1") {
      playerOneWins += 1;
      playerOneResults.push(true);
      playerTwoResults.push(false);
    } else if (outcome === "2") {
      playerTwoWins += 1;
      playerOneResults.push(false);
      playerTwoResults.push(true);
    } else {
      if (input.drawCountsAsWin) {
        playerOneWins += 1;
        playerTwoWins += 1;
        playerOneResults.push(true);
        playerTwoResults.push(true);
      } else {
        playerOneResults.push(false);
        playerTwoResults.push(false);
      }
    }

    if (winnerName === null
      && playerOneWins >= winsRequired
      && playerOneWins > playerTwoWins) {
      winnerName = input.playerOneName;
    } else if (winnerName === null
      && playerTwoWins >= winsRequired
      && playerTwoWins > playerOneWins) {
      winnerName = input.playerTwoName;
    }
  }

  return {
    playerOneName: input.playerOneName,
    playerTwoName: input.playerTwoName,
    winnerName,
    winsRequired,
    playerOneWins,
    playerTwoWins,
    setNumbers: outcomes.map((_outcome, index) => index + 1),
    setCompleted: outcomes.map(() => true),
    playerOneResults,
    playerTwoResults,
  };
}
