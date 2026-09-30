import type { Dispatch, SetStateAction } from "react";
import { isMatchupReady } from "./bracketDisplay";
import type { MatchSideRandomNotice } from "./MatchDetailDialog";
import {
  resolveRandomMatchSideAssignment,
  resolveSwappedMatchSideAssignment,
} from "./eventManagement";
import type { SetSnapshot } from "./bracketProgression";
import type { PlaySide } from "./useTournamentWorkspace";

type UseMatchSideDraftActionsOptions = {
  activeMatchSideDrafts: Record<string, PlaySide | "">;
  setActiveMatchSideDrafts: Dispatch<SetStateAction<Record<string, PlaySide | "">>>;
  getSetSlotSide: (setId: string, entrantId: string) => PlaySide | "";
  setMatchSideRandomNotice: Dispatch<SetStateAction<MatchSideRandomNotice | null>>;
};

export function useMatchSideDraftActions({
  activeMatchSideDrafts,
  setActiveMatchSideDrafts,
  getSetSlotSide,
  setMatchSideRandomNotice,
}: UseMatchSideDraftActionsOptions) {
  function swapMatchSides(setSnapshot: SetSnapshot) {
    if (!isMatchupReady(setSnapshot)) {
      return;
    }

    const slots = setSnapshot.slots.filter((slot) => slot.entrantId !== null);
    if (slots.length < 2) {
      return;
    }

    const upper = slots[0];
    const lower = slots[1];
    const upperId = upper.entrantId;
    const lowerId = lower.entrantId;
    if (!upperId || !lowerId) {
      return;
    }

    const sideAssignment = resolveSwappedMatchSideAssignment(
      activeMatchSideDrafts[upperId] ?? "",
      activeMatchSideDrafts[lowerId] ?? "",
      getSetSlotSide(setSnapshot.setId, upperId),
      getSetSlotSide(setSnapshot.setId, lowerId),
    );

    setActiveMatchSideDrafts((current) => ({
      ...current,
      [upperId]: sideAssignment.upperSide,
      [lowerId]: sideAssignment.lowerSide,
    }));
  }

  function randomizeMatchSides(setSnapshot: SetSnapshot) {
    if (!isMatchupReady(setSnapshot)) {
      return;
    }

    const slots = setSnapshot.slots.filter((slot) => slot.entrantId !== null);
    if (slots.length < 2) {
      return;
    }

    const upper = slots[0];
    const lower = slots[1];
    const upperId = upper.entrantId;
    const lowerId = lower.entrantId;
    if (!upperId || !lowerId) {
      return;
    }

    const { upperSide, lowerSide } = resolveRandomMatchSideAssignment(Math.random());
    const upperCurrent = activeMatchSideDrafts[upperId] ?? "";
    const lowerCurrent = activeMatchSideDrafts[lowerId] ?? "";

    setActiveMatchSideDrafts((current) => ({
      ...current,
      [upperId]: upperSide,
      [lowerId]: lowerSide,
    }));

    setMatchSideRandomNotice({
      setId: setSnapshot.setId,
      upperEntrantName: upper.entrantName,
      lowerEntrantName: lower.entrantName,
      upperSide,
      lowerSide,
      changed: upperCurrent !== upperSide || lowerCurrent !== lowerSide,
      triggeredAt: Date.now(),
    });
  }

  return { swapMatchSides, randomizeMatchSides };
}