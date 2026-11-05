import { describe, expect, it, vi } from "vitest";
import {
  buildFirstToNWinsOverlayData,
  resolveFirstToNWinsLatestSet,
  useObsOverlaySetActions,
} from "./useObsOverlaySetActions";
import type { EventSnapshot } from "../domain/bracketDisplay";
import type { SetSnapshot } from "../domain/bracketProgression";
import type { ObsOverlayState } from "./useObsOverlay";

vi.mock("react", async (importOriginal) => ({
  ...await importOriginal<typeof import("react")>(),
  useState: () => [null, vi.fn()],
}));

describe("First to N wins overlay history", () => {
  it("uses the latest incomplete set for overlay streaming regardless of the clicked set", async () => {
    const makeSet = (setId: string, identifier: string, state: number, winnerId: string | null): SetSnapshot => ({
      setId, phaseGroupId: "group", identifier, fullRoundText: `Set ${identifier}`,
      round: 1, phaseName: "Phase", phaseGroupName: "Final", phaseOrder: 1,
      phaseGroupDisplayIdentifier: "A", state, winnerId,
      entrant1Source: null, entrant2Source: null,
      slots: [
        { entrantId: "one", entrantName: "Player One", seedId: null, seedNum: null, score: 0 },
        { entrantId: "two", entrantName: "Player Two", seedId: null, seedNum: null, score: 0 },
      ],
    });
    const first = makeSet("set-1", "1", 3, "one");
    const latest = makeSet("set-2", "2", 2, null);
    const future = makeSet("set-3", "3", 1, null);
    const event: EventSnapshot = {
      eventId: "event", name: "Event", sets: [first, latest, future],
      phaseGroups: [{
        phaseGroupId: "group", setIds: ["set-1", "set-2", "set-3"],
        phaseName: "Phase", phaseOrder: 1, displayIdentifier: "A", bracketType: "FIRST_TO_N_WINS",
        firstToNWins: {
          phaseSetCount: 3, winsRequired: 2, playerOneEntrantId: "one",
          playAllMatches: true, drawCountsAsWin: false, suddenDeath: false,
        },
      }],
    };
    const overlayToggle = vi.fn().mockResolvedValue(true);
    const actions = useObsOverlaySetActions({
      selectedEvent: event,
      resolvedEventSetsById: new Map(event.sets.map((set) => [set.setId, set])),
      aliasNamesByEntrantId: {}, useAliasName: false, eventAlias: "",
      obsOverlayState: null, setDisplayCodeById: new Map(),
      getSavedSide: () => "", refreshObsOverlayState: vi.fn(),
      toggleObsOverlaySet: overlayToggle,
    });

    expect(resolveFirstToNWinsLatestSet(event, first)).toBe(latest);
    await actions.toggleActiveMatchOverlay(first);
    expect(overlayToggle).toHaveBeenCalledWith(expect.objectContaining({
      setId: "set-2",
      roundText: expect.stringContaining("Set 2"),
    }));

    event.sets[1] = makeSet("set-2", "2", 3, "two");
    event.sets[2] = makeSet("set-3", "3", 3, "one");
    expect(resolveFirstToNWinsLatestSet(event, first).setId).toBe("set-3");
  });

  it("orders sets, resolves aliases, and counts only configured draw wins", () => {
    const makeSet = (
      setId: string,
      identifier: string,
      state: number,
      winnerId: string | null,
    ): SetSnapshot => ({
      setId, phaseGroupId: "group", identifier, fullRoundText: `Set ${identifier}`,
      round: 1, phaseName: "Phase", phaseGroupName: "Pool A", phaseOrder: 1,
      phaseGroupDisplayIdentifier: "A", state, winnerId,
      entrant1Source: null, entrant2Source: null,
      slots: [
      { entrantId: "two", entrantName: "Player Two", seedId: null, seedNum: null, score: null },
      { entrantId: "one", entrantName: "Player One", seedId: null, seedNum: null, score: null },
      ],
    });
    const set2 = makeSet("set-2", "2", 3, "two");
    const set1 = makeSet("set-1", "1", 3, "one");
    const set3 = makeSet("set-3", "3", 3, null);
    const event = {
      eventId: "event", name: "Event",
      sets: [set2, set1, set3],
      phaseGroups: [{
        phaseGroupId: "group", setIds: ["set-1", "set-2", "set-3"],
        seeds: [
          { seedId: "seed-2", entrantId: "two", entrantName: "Initial Player Two" },
          { seedId: "seed-1", entrantId: "one", entrantName: "Initial Player One" },
        ],
        phaseName: "Phase", phaseOrder: 1, displayIdentifier: "A", bracketType: "ROUND_ROBIN",
        firstToNWins: {
          phaseSetCount: 3, winsRequired: 2, playerOneEntrantId: "one",
          playAllMatches: true, drawCountsAsWin: false, suddenDeath: false,
        },
      }],
    };

    expect(buildFirstToNWinsOverlayData(event, set1, { one: "Alias One" }, true)).toEqual({
      playerOneName: "Alias One",
      playerTwoName: "Initial Player Two",
      winnerName: null,
      winsRequired: 2,
      playerOneWins: 1,
      playerTwoWins: 1,
      setNumbers: [1, 2, 3],
      setCompleted: [true, true, true],
      playerOneResults: [true, false, false],
      playerTwoResults: [false, true, false],
    });

    event.phaseGroups[0].firstToNWins.drawCountsAsWin = true;
    expect(buildFirstToNWinsOverlayData(event, set1, {}, false)).toMatchObject({
      playerOneWins: 2,
      playerTwoWins: 2,
      playerOneResults: [true, false, true],
      playerTwoResults: [false, true, true],
    });
  });

  it("identifies the player who reaches the configured win target", () => {
    const first: SetSnapshot = {
      setId: "set-1", phaseGroupId: "group", identifier: "1", fullRoundText: "Set 1",
      round: 1, phaseName: "Phase", phaseGroupName: "Final", phaseOrder: 1,
      phaseGroupDisplayIdentifier: "A", state: 3, winnerId: "one",
      entrant1Source: null, entrant2Source: null,
      slots: [
        { entrantId: "one", entrantName: "Player One", seedId: null, seedNum: null, score: 1 },
        { entrantId: "two", entrantName: "Player Two", seedId: null, seedNum: null, score: 0 },
      ],
    };
    const second = {
      ...first, setId: "set-2", identifier: "2", fullRoundText: "Set 2",
    };
    const event: EventSnapshot = {
      eventId: "event", name: "Event", sets: [first, second],
      phaseGroups: [{
        phaseGroupId: "group", setIds: ["set-1", "set-2"], phaseName: "Phase",
        phaseOrder: 1, displayIdentifier: "A", bracketType: "FIRST_TO_N_WINS",
        firstToNWins: {
          phaseSetCount: 2, winsRequired: 2, playerOneEntrantId: "one",
          playAllMatches: true, drawCountsAsWin: false, suddenDeath: false,
        },
      }],
    };

    expect(buildFirstToNWinsOverlayData(event, first, {}, false)).toMatchObject({
      playerOneWins: 2,
      playerTwoWins: 0,
      winnerName: "Player One",
    });
  });

  it("includes the just-saved outcome before the refreshed event snapshot arrives", async () => {
    const set: SetSnapshot = {
      setId: "set", phaseGroupId: "group", identifier: "1", fullRoundText: "Set 1",
      round: 1, phaseName: "Phase", phaseGroupName: "Final", phaseOrder: 1,
      phaseGroupDisplayIdentifier: "A", state: 2, winnerId: null,
      entrant1Source: null, entrant2Source: null,
      slots: [
        { entrantId: "one", entrantName: "Player One", seedId: null, seedNum: null, score: 0 },
        { entrantId: "two", entrantName: "Player Two", seedId: null, seedNum: null, score: 0 },
      ],
    };
    const event: EventSnapshot = {
      eventId: "event", name: "Event", sets: [set],
      phaseGroups: [{
        phaseGroupId: "group", setIds: ["set"], phaseName: "Phase", phaseOrder: 1,
        displayIdentifier: "A", bracketType: "FIRST_TO_N_WINS",
        firstToNWins: {
          phaseSetCount: 1, winsRequired: 1, playerOneEntrantId: "one",
          playAllMatches: true, drawCountsAsWin: false, suddenDeath: false,
        },
      }],
    };
    const state: ObsOverlayState = {
      active: true, fullyStopped: false, currentSetId: "set",
      eventName: "Event", eventAlias: "", roundText: "Set 1",
      redPlayerName: "Player One", bluePlayerName: "Player Two",
      redSetWins: 0, blueSetWins: 0, fontScale: 1,
      showSetInfo: true, showEventAlias: true, overlayUrl: "http://localhost/overlay",
    };
    const toggleObsOverlaySet = vi.fn().mockResolvedValue(true);
    const actions = useObsOverlaySetActions({
      selectedEvent: event,
      resolvedEventSetsById: new Map([[set.setId, set]]),
      aliasNamesByEntrantId: {}, useAliasName: false, eventAlias: "",
      obsOverlayState: state, setDisplayCodeById: new Map(),
      getSavedSide: () => "",
      refreshObsOverlayState: vi.fn().mockResolvedValue(state),
      toggleObsOverlaySet,
    });

    await actions.syncOverlayScoresForSet(set, [], undefined, { winnerId: "one", completed: true });

    expect(toggleObsOverlaySet).toHaveBeenCalledWith(expect.objectContaining({
      firstToNWins: expect.objectContaining({
        playerOneWins: 1,
        playerTwoWins: 0,
        playerOneResults: [true],
        playerTwoResults: [false],
      }),
    }));
  });

  it("switches a streamed First to N wins set to the next playable set and records its start time", async () => {
    const makeSet = (setId: string, identifier: string, state: number): SetSnapshot => ({
      setId, phaseGroupId: "group", identifier, fullRoundText: `Set ${identifier}`,
      round: 1, phaseName: "Phase", phaseGroupName: "Final", phaseOrder: 1,
      phaseGroupDisplayIdentifier: "A", state, winnerId: null,
      entrant1Source: null, entrant2Source: null,
      slots: [
        { entrantId: "one", entrantName: "Player One", seedId: null, seedNum: null, score: 0 },
        { entrantId: "two", entrantName: "Player Two", seedId: null, seedNum: null, score: 0 },
      ],
    });
    const currentSet = makeSet("set-1", "1", 2);
    const nextSet = makeSet("set-2", "2", 1);
    const event: EventSnapshot = {
      eventId: "event", name: "Event", sets: [currentSet, nextSet],
      phaseGroups: [{
        phaseGroupId: "group", setIds: ["set-1", "set-2"],
        phaseName: "Phase", phaseOrder: 1, displayIdentifier: "A", bracketType: "FIRST_TO_N_WINS",
        firstToNWins: {
          phaseSetCount: 2, winsRequired: 2, playerOneEntrantId: "one",
          playAllMatches: false, drawCountsAsWin: false, suddenDeath: false,
        },
      }],
    };
    const state: ObsOverlayState = {
      active: true, fullyStopped: false, currentSetId: currentSet.setId,
      eventName: "Event", eventAlias: "", roundText: "Set 1",
      redPlayerName: "Player One", bluePlayerName: "Player Two",
      redSetWins: 0, blueSetWins: 0, fontScale: 1,
      showSetInfo: true, showEventAlias: true, overlayUrl: "http://localhost/overlay",
    };
    const toggleObsOverlaySet = vi.fn().mockResolvedValue(true);
    const recordSetStreamStart = vi.fn().mockResolvedValue(undefined);
    const actions = useObsOverlaySetActions({
      selectedEvent: event,
      resolvedEventSetsById: new Map(event.sets.map((set) => [set.setId, set])),
      aliasNamesByEntrantId: {}, useAliasName: false, eventAlias: "",
      obsOverlayState: state, setDisplayCodeById: new Map(),
      getSavedSide: () => "",
      refreshObsOverlayState: vi.fn().mockResolvedValue(state),
      toggleObsOverlaySet,
      recordSetStreamStart,
    });

    await actions.syncOverlayScoresForSet(currentSet, [], undefined, {
      winnerId: "one", completed: true, confirmed: true,
    });

    expect(toggleObsOverlaySet).toHaveBeenNthCalledWith(1, expect.objectContaining({
      enabled: false,
      setId: currentSet.setId,
    }));
    expect(toggleObsOverlaySet).toHaveBeenNthCalledWith(2, expect.objectContaining({
      enabled: true,
      setId: nextSet.setId,
      firstToNWins: expect.objectContaining({
        playerOneWins: 1,
        playerOneResults: [true, null],
      }),
    }));
    expect(recordSetStreamStart).toHaveBeenCalledWith(nextSet.setId, expect.any(String));
    expect(Number.isFinite(Date.parse(recordSetStreamStart.mock.calls[0][1]))).toBe(true);

    toggleObsOverlaySet.mockClear();
    recordSetStreamStart.mockClear();
    await actions.syncOverlayScoresForSet(currentSet, [], undefined, {
      winnerId: "one", completed: true, confirmed: false,
    });
    expect(toggleObsOverlaySet).toHaveBeenCalledOnce();
    expect(toggleObsOverlaySet).toHaveBeenCalledWith(expect.objectContaining({
      enabled: true,
      setId: currentSet.setId,
    }));
    expect(recordSetStreamStart).not.toHaveBeenCalled();
  });
});

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
