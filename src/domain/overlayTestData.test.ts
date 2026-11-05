import { describe, expect, it } from "vitest";
import {
  buildOverlayTestDisplayParts,
  buildOverlayTestFirstToNWins,
  isValidOverlayTestFirstToNWinsHistory,
} from "./overlayTestData";

describe("overlay test display parts", () => {
  it("uses the configured dummy Phase, Pool, and Set names independently", () => {
    expect(buildOverlayTestDisplayParts("Main", "A", "W-Final")).toEqual({
      phaseName: "Main",
      poolName: "Pool A",
      setLabel: "Set W-Final",
    });
  });

  it("uses visible fallback labels for blank dummy names", () => {
    expect(buildOverlayTestDisplayParts(" ", "", " ")).toEqual({
      phaseName: "-",
      poolName: "Pool -",
      setLabel: "Set -",
    });
  });
});

describe("overlay test First to N wins data", () => {
  it("builds scores and history from compact outcomes", () => {
    expect(buildOverlayTestFirstToNWins({
      playerOneName: "1P",
      playerTwoName: "2P",
      winsRequired: 3,
      drawCountsAsWin: false,
      history: "1 2 d 1 1",
    })).toEqual({
      playerOneName: "1P",
      playerTwoName: "2P",
      winnerName: "1P",
      winsRequired: 3,
      playerOneWins: 3,
      playerTwoWins: 1,
      redPlayerWins: 3,
      bluePlayerWins: 1,
      setNumbers: [1, 2, 3, 4, 5],
      setCompleted: [true, true, true, true, true],
      playerOneResults: [true, false, false, true, true],
      playerTwoResults: [false, true, false, false, false],
    });
  });

  it("counts draws for both players when enabled", () => {
    const data = buildOverlayTestFirstToNWins({
      playerOneName: "1P",
      playerTwoName: "2P",
      winsRequired: 2,
      drawCountsAsWin: true,
      history: "2d",
    });

    expect(data).toMatchObject({
      winnerName: "2P",
      playerOneWins: 1,
      playerTwoWins: 2,
      playerOneResults: [false, true],
      playerTwoResults: [true, true],
    });
  });

  it("has no winner until a player reaches the target with a lead", () => {
    expect(buildOverlayTestFirstToNWins({
      playerOneName: "1P",
      playerTwoName: "2P",
      winsRequired: 2,
      drawCountsAsWin: true,
      history: "d",
    })).toMatchObject({
      winnerName: null,
      playerOneWins: 1,
      playerTwoWins: 1,
    });
  });

  it("validates the supported history symbols", () => {
    expect(isValidOverlayTestFirstToNWinsHistory("1 2 D\n1")).toBe(true);
    expect(isValidOverlayTestFirstToNWinsHistory("1,x,2")).toBe(false);
  });
});
