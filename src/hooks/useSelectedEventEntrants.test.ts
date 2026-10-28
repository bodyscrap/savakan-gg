import { describe, expect, it, vi } from "vitest";
import { useSelectedEventEntrants } from "./useSelectedEventEntrants";
import type { EventEntrantMeta } from "../domain/tournamentWorkspaceRepository";

vi.mock("react", () => ({
  useState: () => ["", vi.fn()],
  useMemo: (compute: () => unknown) => compute(),
  useEffect: () => {},
}));

describe("imported event entrants", () => {
  it("allows selecting entrants and their local skills before any sets exist", () => {
    const event = {
      eventId: "event",
      name: "Event",
      sets: [],
      entrants: [{ entrantId: "player", name: "Player", skill: 5 }],
    };
    const meta: EventEntrantMeta[] = [{
      entrantId: "player", entrantName: "Player", skill: 9,
      importedSkill: { skill: 5 }, aliasName: "Alias",
      playSide: null, characterNames: [], authCode: "code", notes: null,
    }];
    const selected = useSelectedEventEntrants(event, meta);
    expect(selected.entrants).toEqual([{
      entrantId: "player", entrantName: "Player", aliasName: "Alias", skill: 9,
    }]);
    expect(selected.selectedEntrant?.entrantId).toBe("player");
  });
});
