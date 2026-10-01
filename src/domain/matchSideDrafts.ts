import type { SetSnapshot } from "./bracketProgression";
import { isMatchupReady } from "./bracketDisplay";
import { resolveMatchSideAssignment } from "./eventManagement";
import type { PlaySide } from "../hooks/useTournamentWorkspace";

export function buildMatchSideDrafts(
  set: Pick<SetSnapshot, "setId" | "slots">,
  getSavedSide: (setId: string, entrantId: string) => PlaySide | "",
): Record<string, PlaySide | ""> {
  const drafts: Record<string, PlaySide | ""> = {};
  for (const slot of set.slots) {
    if (!slot.entrantId) {
      continue;
    }

    drafts[slot.entrantId] = getSavedSide(set.setId, slot.entrantId);
  }

  return drafts;
}

export type MatchSideDraftSavePlan = {
  upperEntrantId: string;
  sideOverrides: Record<string, PlaySide>;
  sidesChanged: boolean;
};

export function resolveMatchSideDraftSavePlan(
  set: SetSnapshot,
  sideDrafts: Record<string, PlaySide | "">,
  getSavedSide: (setId: string, entrantId: string) => PlaySide | "",
  getFallbackSide: (setId: string, entrantId: string, slotIndex: number) => string,
): MatchSideDraftSavePlan | null {
  if (!isMatchupReady(set)) {
    return null;
  }

  const slots = set.slots.filter((slot) => slot.entrantId !== null);
  if (slots.length < 2) {
    return null;
  }

  const upperId = slots[0].entrantId;
  const lowerId = slots[1].entrantId;
  if (!upperId || !lowerId) {
    return null;
  }

  const currentUpper = getSavedSide(set.setId, upperId);
  const currentLower = getSavedSide(set.setId, lowerId);
  const toPlaySide = (value: string): PlaySide | "" => value === "1P" || value === "2P" ? value : "";
  const draftUpper = sideDrafts[upperId]
    || currentUpper
    || toPlaySide(getFallbackSide(set.setId, upperId, 0));
  const draftLower = sideDrafts[lowerId]
    || currentLower
    || toPlaySide(getFallbackSide(set.setId, lowerId, 1));
  const sideAssignment = resolveMatchSideAssignment(draftUpper, draftLower);
  if (!sideAssignment) {
    return null;
  }

  const sideOverrides = {
    [upperId]: sideAssignment.upperSide,
    [lowerId]: sideAssignment.lowerSide,
  };

  return {
    upperEntrantId: upperId,
    sideOverrides,
    sidesChanged: currentUpper !== sideAssignment.upperSide || currentLower !== sideAssignment.lowerSide,
  };
}