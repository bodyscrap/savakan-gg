import { t } from "../i18n";
import { useState } from "react";
import {
  buildPhasePoolGroups,
  isCompletedSet,
  isDisplayableSet,
  resolveEntrantDisplayName,
  type EventSnapshot,
} from "../domain/bracketDisplay";
import type { SetSnapshot } from "../domain/bracketProgression";
import {
  buildOverlaySetRoundText,
  type OverlaySetOutcome,
  resolveOverlaySidesForSet,
  type FirstToNWinsOverlayData,
  type ObsOverlaySetInput,
  type ObsOverlayState,
} from "./useObsOverlay";
import type { PlaySide } from "./useTournamentWorkspace";

type UseObsOverlaySetActionsOptions = {
  selectedEvent: EventSnapshot | null;
  resolvedEventSetsById: Map<string, SetSnapshot>;
  aliasNamesByEntrantId: Record<string, string>;
  useAliasName: boolean;
  eventAlias: string;
  obsOverlayState: ObsOverlayState | null;
  setDisplayCodeById: Map<string, string>;
  getSavedSide: (setId: string, entrantId: string | null) => PlaySide | "";
  refreshObsOverlayState: () => Promise<ObsOverlayState>;
  toggleObsOverlaySet: (input: ObsOverlaySetInput) => Promise<boolean | void>;
  recordSetStreamStart?: (setId: string, startedAt: string) => Promise<void>;
};

export function buildFirstToNWinsOverlayData(
  event: EventSnapshot | null,
  activeSet: SetSnapshot,
  aliasesByEntrantId: Record<string, string>,
  useAliasName: boolean,
  sideEntrantIds: { redEntrantId?: string | null; blueEntrantId?: string | null } = {},
): FirstToNWinsOverlayData | null {
  const phaseGroup = buildPhasePoolGroups(event).find((group) =>
    group.firstToNWins && group.sets.some((set) => set.setId === activeSet.setId));
  const settings = phaseGroup?.firstToNWins;
  if (!phaseGroup || !settings) return null;

  const eventOrder = new Map(event?.sets.map((set, index) => [set.setId, index + 1]) ?? []);
  const setOrder = (set: SetSnapshot) => {
    const identity = Number(set.identifier);
    return Number.isSafeInteger(identity) && identity > 0
      ? identity
      : eventOrder.get(set.setId) ?? Number.MAX_SAFE_INTEGER;
  };
  const orderedSets = [...phaseGroup.sets].sort((left, right) =>
    setOrder(left) - setOrder(right)
      || (eventOrder.get(left.setId) ?? 0) - (eventOrder.get(right.setId) ?? 0));
  const playerOneId = settings.playerOneEntrantId;
  const playerTwoSeed = phaseGroup.seeds.find((seed) => seed.entrantId !== playerOneId && seed.entrantId !== null);
  const playerTwoId = playerTwoSeed?.entrantId ?? orderedSets.flatMap((set) => set.slots)
    .find((slot) => slot.entrantId !== playerOneId && slot.entrantId !== null)?.entrantId;
  if (!playerTwoId) return null;

  const nameFor = (entrantId: string) => {
    const seed = phaseGroup.seeds.find((item) => item.entrantId === entrantId);
    const entrantName = seed?.entrantName ?? orderedSets.flatMap((set) => set.slots)
      .find((slot) => slot.entrantId === entrantId)?.entrantName ?? entrantId;
    return resolveEntrantDisplayName(entrantName, aliasesByEntrantId[entrantId], useAliasName);
  };

  let playerOneWins = 0;
  let playerTwoWins = 0;
  let winnerId: string | null = null;
  const setCompleted = orderedSets.map(isCompletedSet);
  const playerOneResults: Array<boolean | null> = [];
  const playerTwoResults: Array<boolean | null> = [];
  for (const [index, set] of orderedSets.entries()) {
    if (setCompleted[index] && set.winnerId === playerOneId) {
      playerOneWins += 1;
      playerOneResults.push(true);
      playerTwoResults.push(false);
    } else if (setCompleted[index] && set.winnerId === playerTwoId) {
      playerTwoWins += 1;
      playerOneResults.push(false);
      playerTwoResults.push(true);
    } else if (setCompleted[index] && !set.winnerId) {
      if (settings.drawCountsAsWin) {
        playerOneWins += 1;
        playerTwoWins += 1;
        playerOneResults.push(true);
        playerTwoResults.push(true);
      } else {
        playerOneResults.push(false);
        playerTwoResults.push(false);
      }
    } else {
      playerOneResults.push(null);
      playerTwoResults.push(null);
    }

    if (winnerId === null
      && ((playerOneWins >= settings.winsRequired && playerOneWins > playerTwoWins)
        || (playerTwoWins >= settings.winsRequired && playerTwoWins > playerOneWins))) {
      winnerId = playerOneWins > playerTwoWins ? playerOneId : playerTwoId;
    }
  }

  const winsForEntrant = (entrantId: string | null | undefined) =>
    entrantId === playerOneId ? playerOneWins : entrantId === playerTwoId ? playerTwoWins : 0;

  return {
    playerOneName: nameFor(playerOneId),
    playerTwoName: nameFor(playerTwoId),
    winnerName: winnerId ? nameFor(winnerId) : null,
    winsRequired: settings.winsRequired,
    playerOneWins,
    playerTwoWins,
    redPlayerWins: winsForEntrant(sideEntrantIds.redEntrantId),
    bluePlayerWins: winsForEntrant(sideEntrantIds.blueEntrantId),
    setNumbers: orderedSets.map((_set, index) => index + 1),
    setCompleted,
    playerOneResults,
    playerTwoResults,
  };
}

export function resolveFirstToNWinsLatestSet(
  event: EventSnapshot | null,
  requestedSet: SetSnapshot,
): SetSnapshot {
  const phaseGroup = buildPhasePoolGroups(event).find((group) =>
    group.firstToNWins && group.sets.some((set) => set.setId === requestedSet.setId));
  if (!phaseGroup) return requestedSet;

  const eventOrder = new Map(event?.sets.map((set, index) => [set.setId, index]) ?? []);
  const orderedSets = [...phaseGroup.sets].sort((left, right) => {
    const leftIdentifier = Number(left.identifier);
    const rightIdentifier = Number(right.identifier);
    const leftOrder = Number.isSafeInteger(leftIdentifier) && leftIdentifier > 0
      ? leftIdentifier : eventOrder.get(left.setId) ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = Number.isSafeInteger(rightIdentifier) && rightIdentifier > 0
      ? rightIdentifier : eventOrder.get(right.setId) ?? Number.MAX_SAFE_INTEGER;
    return leftOrder - rightOrder
      || (eventOrder.get(left.setId) ?? 0) - (eventOrder.get(right.setId) ?? 0);
  });
  return orderedSets.find((set) => !isCompletedSet(set))
    ?? orderedSets[orderedSets.length - 1]
    ?? requestedSet;
}

export function resolveFirstToNWinsNextPlayableSet(
  event: EventSnapshot | null,
  completedSet: SetSnapshot,
  outcome: OverlaySetOutcome,
): SetSnapshot | null {
  const updatedEvent = eventWithSetOutcome(event, completedSet, outcome);
  const phaseGroup = buildPhasePoolGroups(updatedEvent).find((group) =>
    group.firstToNWins && group.sets.some((set) => set.setId === completedSet.setId));
  if (!phaseGroup?.firstToNWins) return null;

  const eventOrder = new Map(updatedEvent?.sets.map((set, index) => [set.setId, index]) ?? []);
  const orderedSets = [...phaseGroup.sets].sort((left, right) => {
    const leftIdentifier = Number(left.identifier);
    const rightIdentifier = Number(right.identifier);
    const leftOrder = Number.isSafeInteger(leftIdentifier) && leftIdentifier > 0
      ? leftIdentifier : eventOrder.get(left.setId) ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = Number.isSafeInteger(rightIdentifier) && rightIdentifier > 0
      ? rightIdentifier : eventOrder.get(right.setId) ?? Number.MAX_SAFE_INTEGER;
    return leftOrder - rightOrder
      || (eventOrder.get(left.setId) ?? 0) - (eventOrder.get(right.setId) ?? 0);
  });
  const nextSet = orderedSets.find((set) => !isCompletedSet(set));
  if (!nextSet || nextSet.setId === completedSet.setId) return null;

  if (!phaseGroup.firstToNWins.playAllMatches) {
    let playerOneWins = 0;
    let playerTwoWins = 0;
    for (const set of orderedSets) {
      if (isCompletedSet(set)) {
        if (set.winnerId === phaseGroup.firstToNWins.playerOneEntrantId) {
          playerOneWins += 1;
        } else if (set.winnerId) {
          playerTwoWins += 1;
        } else if (phaseGroup.firstToNWins.drawCountsAsWin) {
          playerOneWins += 1;
          playerTwoWins += 1;
        }
      }
      if (set.setId === completedSet.setId) break;
    }
    if ((playerOneWins >= phaseGroup.firstToNWins.winsRequired && playerOneWins > playerTwoWins)
      || (playerTwoWins >= phaseGroup.firstToNWins.winsRequired && playerTwoWins > playerOneWins)) {
      return null;
    }
  }

  return nextSet;
}

function eventWithSetOutcome(
  event: EventSnapshot | null,
  set: SetSnapshot,
  outcome: OverlaySetOutcome | undefined,
): EventSnapshot | null {
  if (!event || !outcome) return event;
  return {
    ...event,
    sets: event.sets.map((item) => item.setId === set.setId
      ? { ...set, winnerId: outcome.winnerId, state: outcome.completed ? 3 : set.state }
      : item),
  };
}

export function useObsOverlaySetActions({
  selectedEvent,
  resolvedEventSetsById,
  aliasNamesByEntrantId,
  useAliasName,
  eventAlias,
  obsOverlayState,
  setDisplayCodeById,
  getSavedSide,
  refreshObsOverlayState,
  toggleObsOverlaySet,
  recordSetStreamStart,
}: UseObsOverlaySetActionsOptions) {
  const [overlaySwitchConfirm, setOverlaySwitchConfirm] = useState<{
    targetSetId: string;
    targetSetLabel: string;
  } | null>(null);

  async function toggleActiveMatchOverlay(set: SetSnapshot) {
    set = resolveFirstToNWinsLatestSet(selectedEvent, set);
    if (!isDisplayableSet(set, selectedEvent)) {
      return;
    }
    const isSameActive = obsOverlayState?.active && obsOverlayState.currentSetId === set.setId;
    const displayCode = setDisplayCodeById.get(set.setId);
    const overlaySides = resolveOverlaySidesForSet(set, {
      getSavedSide: (setId, entrantId) => getSavedSide(setId, entrantId),
    });

    await toggleObsOverlaySet({
      enabled: !isSameActive,
      setId: set.setId,
      eventName: selectedEvent?.name ?? "",
      eventAlias,
      roundText: buildOverlaySetRoundText(set, displayCode),
      redPlayerName: resolveEntrantDisplayName(
        overlaySides.redPlayerName,
        overlaySides.redEntrantId ? aliasNamesByEntrantId[overlaySides.redEntrantId] : undefined,
        useAliasName,
      ),
      bluePlayerName: resolveEntrantDisplayName(
        overlaySides.bluePlayerName,
        overlaySides.blueEntrantId ? aliasNamesByEntrantId[overlaySides.blueEntrantId] : undefined,
        useAliasName,
      ),
      redSetWins: overlaySides.redSetWins,
      blueSetWins: overlaySides.blueSetWins,
      firstToNWins: buildFirstToNWinsOverlayData(
        selectedEvent, set, aliasNamesByEntrantId, useAliasName, overlaySides,
      ),
      redEntrantId: overlaySides.redEntrantId,
      blueEntrantId: overlaySides.blueEntrantId,
      fontScale: obsOverlayState?.fontScale ?? 1,
    });
  }

  async function forceSwitchActiveMatchOverlay(set: SetSnapshot) {
    set = resolveFirstToNWinsLatestSet(selectedEvent, set);
    const currentSetId = obsOverlayState?.active ? obsOverlayState.currentSetId : null;
    if (currentSetId && currentSetId !== "__test__" && currentSetId !== set.setId) {
      await toggleObsOverlaySet({
        enabled: false,
        setId: currentSetId,
        eventName: "",
        eventAlias: "",
        roundText: "",
        redPlayerName: "",
        bluePlayerName: "",
        redSetWins: 0,
        blueSetWins: 0,
        firstToNWins: null,
        fontScale: obsOverlayState?.fontScale ?? 1,
      });
    }

    await toggleActiveMatchOverlay(set);
  }

  function requestToggleActiveMatchOverlay(set: SetSnapshot) {
    set = resolveFirstToNWinsLatestSet(selectedEvent, set);
    const isSameActive = obsOverlayState?.active && obsOverlayState.currentSetId === set.setId;
    const otherSetIsActive = Boolean(
      obsOverlayState?.active
      && obsOverlayState.currentSetId
      && obsOverlayState.currentSetId !== set.setId
      && obsOverlayState.currentSetId !== "__test__",
    );

    if (otherSetIsActive && !isSameActive) {
      setOverlaySwitchConfirm({
        targetSetId: set.setId,
        targetSetLabel: set.fullRoundText || `Set ${setDisplayCodeById.get(set.setId) ?? "-"}`,
      });
      return;
    }

    void toggleActiveMatchOverlay(set);
  }

  function cancelOverlaySwitch() {
    setOverlaySwitchConfirm(null);
  }

  function confirmOverlaySwitch(set: SetSnapshot | null) {
    setOverlaySwitchConfirm(null);
    if (set) {
      void forceSwitchActiveMatchOverlay(set);
    }
  }

  async function syncOverlayScoresForSet(
    set: SetSnapshot,
    slotScores: Array<{ entrantId: string; score: number }>,
    sideOverrides?: Record<string, PlaySide | "">,
    outcome?: OverlaySetOutcome,
  ) {
    if (set.setId === "__test__" || !isDisplayableSet(set, selectedEvent)) {
      return;
    }

    let currentOverlayState = obsOverlayState;
    if (!currentOverlayState?.active || currentOverlayState.currentSetId !== set.setId) {
      try {
        currentOverlayState = await refreshObsOverlayState();
      } catch {
        return;
      }
    }

    if (!currentOverlayState?.active || currentOverlayState.currentSetId !== set.setId || currentOverlayState.currentSetId === "__test__") {
      return;
    }

    const scoreByEntrantId = new Map<string, number>();
    for (const item of slotScores) {
      scoreByEntrantId.set(item.entrantId, item.score);
    }

    const updatedEvent = eventWithSetOutcome(selectedEvent, set, outcome);
    if (outcome?.completed && outcome.confirmed) {
      const nextSet = resolveFirstToNWinsNextPlayableSet(selectedEvent, set, outcome);
      if (nextSet) {
        await toggleObsOverlaySet({
          enabled: false,
          setId: set.setId,
          eventName: "",
          eventAlias: "",
          roundText: "",
          redPlayerName: "",
          bluePlayerName: "",
          redSetWins: 0,
          blueSetWins: 0,
          firstToNWins: null,
          fontScale: currentOverlayState.fontScale,
        });

        const nextSides = resolveOverlaySidesForSet(nextSet, {
          getSavedSide: (setId, entrantId) => getSavedSide(setId, entrantId),
        });
        const switchSucceeded = await toggleObsOverlaySet({
          enabled: true,
          setId: nextSet.setId,
          eventName: selectedEvent?.name ?? "",
          eventAlias,
          roundText: buildOverlaySetRoundText(nextSet, setDisplayCodeById.get(nextSet.setId)),
          redPlayerName: resolveEntrantDisplayName(
            nextSides.redPlayerName,
            nextSides.redEntrantId ? aliasNamesByEntrantId[nextSides.redEntrantId] : undefined,
            useAliasName,
          ),
          bluePlayerName: resolveEntrantDisplayName(
            nextSides.bluePlayerName,
            nextSides.blueEntrantId ? aliasNamesByEntrantId[nextSides.blueEntrantId] : undefined,
            useAliasName,
          ),
          redSetWins: nextSides.redSetWins,
          blueSetWins: nextSides.blueSetWins,
          firstToNWins: buildFirstToNWinsOverlayData(
            updatedEvent, nextSet, aliasNamesByEntrantId, useAliasName, nextSides,
          ),
          redEntrantId: nextSides.redEntrantId,
          blueEntrantId: nextSides.blueEntrantId,
          fontScale: currentOverlayState.fontScale,
        });
        if (switchSucceeded === false) {
          throw new Error(t("次のSetへの配信切替に失敗しました。"));
        }
        await recordSetStreamStart?.(nextSet.setId, new Date().toISOString());
        return;
      }
    }

    const displayCode = setDisplayCodeById.get(set.setId);
    const overlaySides = resolveOverlaySidesForSet(set, {
      scoreByEntrantId,
      sideOverrides,
      getSavedSide: (setId, entrantId) => getSavedSide(setId, entrantId),
    });

    await toggleObsOverlaySet({
      enabled: true,
      setId: set.setId,
      eventName: selectedEvent?.name ?? "",
      eventAlias,
      roundText: buildOverlaySetRoundText(set, displayCode),
      redPlayerName: resolveEntrantDisplayName(
        overlaySides.redPlayerName,
        overlaySides.redEntrantId ? aliasNamesByEntrantId[overlaySides.redEntrantId] : undefined,
        useAliasName,
      ),
      bluePlayerName: resolveEntrantDisplayName(
        overlaySides.bluePlayerName,
        overlaySides.blueEntrantId ? aliasNamesByEntrantId[overlaySides.blueEntrantId] : undefined,
        useAliasName,
      ),
      redSetWins: overlaySides.redSetWins,
      blueSetWins: overlaySides.blueSetWins,
      firstToNWins: buildFirstToNWinsOverlayData(
        updatedEvent, set, aliasNamesByEntrantId, useAliasName, overlaySides,
      ),
      redEntrantId: overlaySides.redEntrantId,
      blueEntrantId: overlaySides.blueEntrantId,
      fontScale: currentOverlayState.fontScale,
    });
  }

  async function refreshActivePlayerDisplay(
    aliasNamesByEntrantId: Record<string, string>,
    useAliasName: boolean,
  ): Promise<boolean> {
    const currentOverlayState = await refreshObsOverlayState();
    const activeSetId = currentOverlayState.currentSetId;
    if (!currentOverlayState.active || !activeSetId || activeSetId === "__test__") {
      return true;
    }

    const set = resolvedEventSetsById.get(activeSetId);
    if (!set || !isDisplayableSet(set, selectedEvent)) {
      return true;
    }

    const overlaySides = resolveOverlaySidesForSet(set, {
      getSavedSide: (setId, entrantId) => getSavedSide(setId, entrantId),
    });

    return (await toggleObsOverlaySet({
      enabled: true,
      setId: set.setId,
      eventName: selectedEvent?.name ?? "",
      eventAlias,
      roundText: buildOverlaySetRoundText(set, setDisplayCodeById.get(set.setId)),
      redPlayerName: resolveEntrantDisplayName(
        overlaySides.redPlayerName,
        overlaySides.redEntrantId ? aliasNamesByEntrantId[overlaySides.redEntrantId] : undefined,
        useAliasName,
      ),
      bluePlayerName: resolveEntrantDisplayName(
        overlaySides.bluePlayerName,
        overlaySides.blueEntrantId ? aliasNamesByEntrantId[overlaySides.blueEntrantId] : undefined,
        useAliasName,
      ),
      redSetWins: currentOverlayState.redSetWins,
      blueSetWins: currentOverlayState.blueSetWins,
      firstToNWins: buildFirstToNWinsOverlayData(
        selectedEvent, set, aliasNamesByEntrantId, useAliasName, overlaySides,
      ),
      redEntrantId: overlaySides.redEntrantId,
      blueEntrantId: overlaySides.blueEntrantId,
      fontScale: currentOverlayState.fontScale,
    })) !== false;
  }

  return {
    overlaySwitchConfirm,
    requestToggleActiveMatchOverlay,
    cancelOverlaySwitch,
    confirmOverlaySwitch,
    toggleActiveMatchOverlay,
    syncOverlayScoresForSet,
    refreshActivePlayerDisplay,
  };
}