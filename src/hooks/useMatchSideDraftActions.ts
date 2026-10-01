import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { isMatchupReady } from "../domain/bracketDisplay";
import type { MatchSideRandomNotice } from "../components/MatchDetailDialog";
import {
  resolveRandomMatchSideAssignment,
  resolveSwappedMatchSideAssignment,
} from "../domain/eventManagement";
import type { SetSnapshot } from "../domain/bracketProgression";
import type { PlaySide } from "./useTournamentWorkspace";

type UseMatchSideDraftActionsOptions = {
  activeMatchSideDrafts: Record<string, PlaySide | "">;
  setActiveMatchSideDrafts: Dispatch<SetStateAction<Record<string, PlaySide | "">>>;
  getSetSlotSide: (setId: string, entrantId: string) => PlaySide | "";
};

export function useMatchSideDraftActions({
  activeMatchSideDrafts,
  setActiveMatchSideDrafts,
  getSetSlotSide,
}: UseMatchSideDraftActionsOptions) {
  const [randomNotice, setRandomNotice] = useState<MatchSideRandomNotice | null>(null);

  useEffect(() => {
    if (!randomNotice) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setRandomNotice((current) => {
        if (!current || current.triggeredAt !== randomNotice.triggeredAt) {
          return current;
        }
        return null;
      });
    }, 6000);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [randomNotice]);

  function clearRandomNotice() {
    setRandomNotice(null);
  }

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

    setRandomNotice({
      setId: setSnapshot.setId,
      upperEntrantName: upper.entrantName,
      lowerEntrantName: lower.entrantName,
      upperSide,
      lowerSide,
      changed: upperCurrent !== upperSide || lowerCurrent !== lowerSide,
      triggeredAt: Date.now(),
    });
  }

  return { swapMatchSides, randomizeMatchSides, randomNotice, clearRandomNotice };
}