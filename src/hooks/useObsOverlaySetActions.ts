import { useState } from "react";
import { isDisplayableSet, resolveEntrantDisplayName, type EventSnapshot } from "../domain/bracketDisplay";
import type { SetSnapshot } from "../domain/bracketProgression";
import {
  buildOverlaySetRoundText,
  resolveOverlaySidesForSet,
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
};

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
}: UseObsOverlaySetActionsOptions) {
  const [overlaySwitchConfirm, setOverlaySwitchConfirm] = useState<{
    targetSetId: string;
    targetSetLabel: string;
  } | null>(null);

  async function toggleActiveMatchOverlay(set: SetSnapshot) {
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
      fontScale: obsOverlayState?.fontScale ?? 1,
    });
  }

  async function forceSwitchActiveMatchOverlay(set: SetSnapshot) {
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
        fontScale: obsOverlayState?.fontScale ?? 1,
      });
    }

    await toggleActiveMatchOverlay(set);
  }

  function requestToggleActiveMatchOverlay(set: SetSnapshot) {
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