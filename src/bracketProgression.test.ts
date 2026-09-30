import { describe, expect, it } from "vitest";
import { collectEventEntrants, sortEventEntrants } from "./bracketProgression";
import type { SetSnapshot } from "./bracketProgression";

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