import { describe, expect, it, vi } from "vitest";
import { useObsOverlaySetActions } from "./useObsOverlaySetActions";
import type { SetSnapshot } from "../domain/bracketProgression";
import type { ObsOverlayState } from "./useObsOverlay";

vi.mock("react", async (importOriginal) => ({
  ...await importOriginal<typeof import("react")>(),
  useState: () => [null, vi.fn()],
}));

describe("overlay player identity for item selections", () => {
  it.each(["start", "scores", "names"] as const)("sends resolved entrant IDs on %s updates", async (operation) => {
    const set: SetSnapshot = {
      setId: "set", fullRoundText: "Round 1", round: 1, phaseName: null,
      phaseGroupName: null, phaseOrder: null, phaseGroupDisplayIdentifier: null,
      state: 2, winnerId: null, entrant1Source: null, entrant2Source: null,
      slots: [
        { entrantId: "upper", entrantName: "Same name", seedId: null, seedNum: null, score: 1 },
        { entrantId: "lower", entrantName: "Same name", seedId: null, seedNum: null, score: 2 },
      ],
    };
    const state: ObsOverlayState = {
      active: operation !== "start", fullyStopped: false, currentSetId: "set",
      eventName: "Event", eventAlias: "", roundText: "Round 1",
      redPlayerName: "Same alias", bluePlayerName: "Same alias",
      redSetWins: 1, blueSetWins: 2, fontScale: 1,
      showSetInfo: true, showEventAlias: true, overlayUrl: "http://localhost/overlay",
    };
    const toggleObsOverlaySet = vi.fn().mockResolvedValue(true);
    const actions = useObsOverlaySetActions({
      selectedEvent: { eventId: "event", name: "Event", sets: [set] },
      resolvedEventSetsById: new Map([[set.setId, set]]),
      aliasNamesByEntrantId: { upper: "Same alias", lower: "Same alias" },
      useAliasName: true, eventAlias: "", obsOverlayState: state,
      setDisplayCodeById: new Map([[set.setId, "A"]]),
      getSavedSide: (_setId, entrantId) => entrantId === "upper" ? "2P" : "1P",
      refreshObsOverlayState: vi.fn().mockResolvedValue(state),
      toggleObsOverlaySet,
    });
    if (operation === "start") await actions.toggleActiveMatchOverlay(set);
    if (operation === "scores") await actions.syncOverlayScoresForSet(set, [], { upper: "1P", lower: "2P" });
    if (operation === "names") await actions.refreshActivePlayerDisplay({ upper: "Same alias", lower: "Same alias" }, true);
    expect(toggleObsOverlaySet).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      enabled: true, setId: "set",
      redEntrantId: operation === "scores" ? "upper" : "lower",
      blueEntrantId: operation === "scores" ? "lower" : "upper",
      redPlayerName: "Same alias", bluePlayerName: "Same alias",
    }));
  });
});
