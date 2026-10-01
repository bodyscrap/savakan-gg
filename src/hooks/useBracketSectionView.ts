import { useMemo } from "react";
import type { CSSProperties } from "react";
import {
  buildBracketSections,
  buildBracketSectionsForView,
  buildSetDisplayCodeById,
  buildTbdSourceLabelBySlotKey,
  buildPhaseNames,
  buildPhasePoolGroups,
  getBracketVerticalLayoutScale,
  resolveSelectedPhasePoolGroup,
  resolveTbdSourceLabel as resolveTbdSourceLabelForEvent,
  scaleBracketSectionsForZoom,
  selectPhaseScopedPoolGroups,
  type EventSnapshot,
} from "../domain/bracketDisplay";
import type { SetSlot, SetSnapshot } from "../domain/bracketProgression";
import { hasDqScoreInDrafts } from "../domain/setResultDrafts";
import type { ObsOverlayState } from "./useObsOverlay";
import type { SetScoreDraft } from "./useSetResultDrafts";
import type { LocalGrandFinalResetResultMeta } from "../domain/tournamentWorkspaceRepository";

type UseBracketSectionViewOptions = {
  selectedEvent: EventSnapshot | null;
  allSets: Array<{ eventName: string; set: SetSnapshot }>;
  resolvedEventSetsById: Map<string, SetSnapshot>;
  selectedPhaseName: string;
  selectedPhasePoolKey: string;
  activeMatchSetId: string;
  pendingGrandFinalResetResults: LocalGrandFinalResetResultMeta[];
  bracketZoomLevel: number;
  obsOverlayState: ObsOverlayState | null;
  scoreDrafts: SetScoreDraft;
};

export function useBracketSectionView({
  selectedEvent,
  allSets,
  resolvedEventSetsById,
  selectedPhaseName,
  selectedPhasePoolKey,
  activeMatchSetId,
  pendingGrandFinalResetResults,
  bracketZoomLevel,
  obsOverlayState,
  scoreDrafts,
}: UseBracketSectionViewOptions) {
  const phasePoolGroups = useMemo(() => buildPhasePoolGroups(selectedEvent), [selectedEvent]);

  const phaseNames = useMemo(
    () => buildPhaseNames(phasePoolGroups, selectedEvent?.phases),
    [phasePoolGroups, selectedEvent?.phases],
  );

  const phaseScopedPoolGroups = useMemo(
    () => selectPhaseScopedPoolGroups(phasePoolGroups, selectedPhaseName),
    [phasePoolGroups, selectedPhaseName],
  );

  const selectedPhasePoolGroup = useMemo(
    () => resolveSelectedPhasePoolGroup(phaseScopedPoolGroups, selectedPhasePoolKey),
    [phaseScopedPoolGroups, selectedPhasePoolKey],
  );

  const activeMatch = useMemo(() => {
    if (!selectedPhasePoolGroup || activeMatchSetId.trim() === "") {
      return null;
    }

    const set = selectedPhasePoolGroup.sets.find((candidate) => candidate.setId === activeMatchSetId);
    return set ? resolvedEventSetsById.get(set.setId) ?? set : null;
  }, [resolvedEventSetsById, selectedPhasePoolGroup, activeMatchSetId]);

  const activeObsOverlaySet = useMemo(() => {
    if (!obsOverlayState?.active || !obsOverlayState.currentSetId) {
      return null;
    }
    return allSets.find((entry) => entry.set.setId === obsOverlayState.currentSetId) ?? null;
  }, [allSets, obsOverlayState]);

  const isActiveMatchDqDraft = useMemo(
    () => activeMatch ? hasDqScoreInDrafts(activeMatch, scoreDrafts) : false,
    [activeMatch, scoreDrafts],
  );

  const selectedBracketSections = useMemo(
    () => buildBracketSections(selectedPhasePoolGroup),
    [selectedPhasePoolGroup],
  );

  const selectedBracketSectionsForView = useMemo(() => buildBracketSectionsForView({
    sections: selectedBracketSections,
    phaseGroupSets: selectedPhasePoolGroup?.sets ?? [],
    event: selectedEvent,
    pendingResetSetIds: new Set(
      pendingGrandFinalResetResults.map((result) => result.sourceGrandFinalSetId),
    ),
  }), [pendingGrandFinalResetResults, selectedEvent, selectedPhasePoolGroup, selectedBracketSections]);

  const bracketScaleStyle = useMemo(() => ({
    ["--bracket-scale" as string]: String(bracketZoomLevel),
  } satisfies CSSProperties), [bracketZoomLevel]);

  const bracketVerticalLayoutScale = useMemo(
    () => getBracketVerticalLayoutScale(bracketZoomLevel),
    [bracketZoomLevel],
  );

  const renderedBracketSectionsForView = useMemo(
    () => scaleBracketSectionsForZoom(selectedBracketSectionsForView, bracketVerticalLayoutScale),
    [bracketVerticalLayoutScale, selectedBracketSectionsForView],
  );

  const setDisplayCodeById = useMemo(
    () => buildSetDisplayCodeById(selectedBracketSectionsForView),
    [selectedBracketSectionsForView],
  );

  const tbdSourceLabelBySlotKey = useMemo(
    () => buildTbdSourceLabelBySlotKey(selectedBracketSections, setDisplayCodeById),
    [selectedBracketSections, setDisplayCodeById],
  );

  function resolveTbdSourceLabel(set: SetSnapshot, slotIndex: number, slot: SetSlot): string | null {
    return resolveTbdSourceLabelForEvent(
      set,
      slotIndex,
      slot,
      selectedEvent,
      setDisplayCodeById,
      tbdSourceLabelBySlotKey,
    );
  }

  return {
    phasePoolGroups,
    phaseNames,
    phaseScopedPoolGroups,
    selectedPhasePoolGroup,
    activeMatch,
    activeObsOverlaySet,
    isActiveMatchDqDraft,
    selectedBracketSections,
    renderedBracketSectionsForView,
    bracketScaleStyle,
    bracketVerticalLayoutScale,
    setDisplayCodeById,
    tbdSourceLabelBySlotKey,
    resolveTbdSourceLabel,
  };
}