import { describe, expect, it } from "vitest";
import {
  calculateRoundRobinHeadToHeadPoints,
  collectEventEntrants,
  resolveRoundRobinTieBreakRules,
  sortEventEntrants,
} from "./bracketProgression";
import type { RoundRobinStanding, SetSnapshot } from "./bracketProgression";

function makeSet(setId: string, slots: SetSnapshot["slots"]): SetSnapshot {
  return { setId, slots } as SetSnapshot;
}

describe("event entrants from sets", () => {
  it("keeps first-seen name and order while filling missing seed data", () => {
    const entrants = collectEventEntrants([
      makeSet("set-1", [
        { entrantId: "a", entrantName: "First A", seedId: null, seedNum: null, score: null },
        { entrantId: "b", entrantName: "Player B", seedId: "seed-b", seedNum: 3, score: null },
      ]),
      makeSet("set-2", [
        { entrantId: "a", entrantName: "Later A", seedId: "seed-a", seedNum: 2, score: null },
        { entrantId: null, entrantName: "TBD", seedId: null, seedNum: null, score: null },
      ]),
    ]);

    expect(entrants).toEqual([
      { entrantId: "a", entrantName: "First A", seedId: "seed-a", seedNum: 2, firstSeenSetId: "set-1" },
      { entrantId: "b", entrantName: "Player B", seedId: "seed-b", seedNum: 3, firstSeenSetId: "set-1" },
    ]);
    expect(sortEventEntrants(entrants).map((entrant) => entrant.entrantId)).toEqual(["a", "b"]);
  });

  it("sorts seeded entrants first and preserves encounter order for unseeded entrants", () => {
    const entrants = collectEventEntrants([
      makeSet("set-1", [
        { entrantId: "unseeded-a", entrantName: "A", seedId: null, seedNum: null, score: null },
        { entrantId: "seed-2", entrantName: "Seed 2", seedId: "seed-2", seedNum: 2, score: null },
        { entrantId: "unseeded-b", entrantName: "B", seedId: null, seedNum: null, score: null },
        { entrantId: "seed-1", entrantName: "Seed 1", seedId: "seed-1", seedNum: 1, score: null },
      ]),
    ]);

    expect(sortEventEntrants(entrants).map((entrant) => entrant.entrantId)).toEqual([
      "seed-1",
      "seed-2",
      "unseeded-a",
      "unseeded-b",
    ]);
    expect(entrants.map((entrant) => entrant.entrantId)).toEqual([
      "unseeded-a",
      "seed-2",
      "unseeded-b",
      "seed-1",
    ]);
  });
});

describe("round-robin head-to-head tie-break", () => {
  it("counts wins only among entrants tied by the preceding rule", () => {
    const standings: RoundRobinStanding[] = [
      { entrantId: "a", entrantName: "A", isPlaceholder: false, wins: 2, losses: 0, gameWins: 4, gameLosses: 1, h2hPoints: 0, qualified: false },
      { entrantId: "b", entrantName: "B", isPlaceholder: false, wins: 2, losses: 0, gameWins: 3, gameLosses: 2, h2hPoints: 0, qualified: false },
      { entrantId: "c", entrantName: "C", isPlaceholder: false, wins: 1, losses: 1, gameWins: 2, gameLosses: 2, h2hPoints: 0, qualified: false },
    ];
    const headToHeadWins = new Map([
      ["a", new Map([["b", 1], ["c", 1]])],
      ["b", new Map([["a", 1]])],
      ["c", new Map<string, number>()],
    ]);

    expect(calculateRoundRobinHeadToHeadPoints(
      standings,
      ["total_sets_won", "head_to_head"],
      headToHeadWins,
    )).toEqual(new Map([["a", 1], ["b", 1], ["c", 0]]));
    expect(standings.every((standing) => standing.h2hPoints === 0)).toBe(true);
  });

  it("returns no calculated values when head-to-head is not configured", () => {
    expect(calculateRoundRobinHeadToHeadPoints([], ["total_sets_won"], new Map())).toEqual(new Map());
  });

  it("uses the default rule when no tie-break rules are configured", () => {
    expect(resolveRoundRobinTieBreakRules([])).toEqual(["total_sets_won"]);
  });

  it("normalizes configured rules, removes unknown rules, and keeps first occurrence", () => {
    expect(resolveRoundRobinTieBreakRules([
      "GAME_WINS",
      "UNKNOWN_RULE",
      "HEAD_TO_HEAD",
      "GAMEWINS",
    ])).toEqual(["game_wins", "head_to_head"]);
  });
});