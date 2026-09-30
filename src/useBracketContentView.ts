import { useMemo } from "react";
import { buildEliminationBracketSections } from "./eliminationBracketDisplay";
import { buildRoundRobinMatrixRows } from "./roundRobinMatrixDisplay";
import { buildRoundRobinBoardData } from "./roundRobinBoardBuilder";
import {
  buildPendingSetResultsById,
  getSetScoresForDisplay as buildSetScoresForDisplay,
} from "./setResultDrafts";
import type { EventSnapshot } from "./bracketDisplay";
import type { SetSlot, SetSnapshot } from "./bracketProgression";
import type { RoundRobinMatrixRowView } from "./RoundRobinMatrix";
import type { LocalGrandFinalResetResultMeta, LocalSetResultMeta } from "./tournamentWorkspaceRepository";
import type { ObsOverlayState } from "./useObsOverlay";
import type { SetScoreDraft } from "./useSetResultDrafts";
import type { useBracketSectionView } from "./useBracketSectionView";

type BracketSectionView = ReturnType<typeof useBracketSectionView>;
type RenderedSections = BracketSectionView["renderedBracketSectionsForView"];
type ScoreDisplay = ReturnType<typeof buildSetScoresForDisplay>;

type UseBracketContentViewOptions = {
  selectedEvent: EventSnapshot | null;
  selectedPhasePoolGroup: BracketSectionView["selectedPhasePoolGroup"];
  renderedSections: RenderedSections;
  resolvedEventSetsById: Map<string, SetSnapshot>;
  pendingSetResults: LocalSetResultMeta[];
  pendingGrandFinalResetResults: LocalGrandFinalResetResultMeta[];
  interimScoreDraftsBySetId: Record<string, SetScoreDraft>;
  obsOverlayState: ObsOverlayState | null;
  setDisplayCodeById: Map<string, string>;
  getTbdSourceLabel: (set: SetSnapshot, slotIndex: number, slot: SetSlot) => string | null;
  getSideLabel: (
    setId: string,
    entrantId: string | null,
    options: { fallbackBySlotIndex: number; finishedSet: boolean; matchupReady: boolean },
  ) => string;
  formatScoreValue: (value: number) => string;
  isDqScoreValue: (value: number | null) => boolean;
};

export function useBracketContentView({
  selectedEvent,
  selectedPhasePoolGroup,
  renderedSections,
  resolvedEventSetsById,
  pendingSetResults,
  pendingGrandFinalResetResults,
  interimScoreDraftsBySetId,
  obsOverlayState,
  setDisplayCodeById,
  getTbdSourceLabel,
  getSideLabel,
  formatScoreValue,
  isDqScoreValue,
}: UseBracketContentViewOptions) {
  const pendingResultBySetId = useMemo(
    () => buildPendingSetResultsById(pendingSetResults, pendingGrandFinalResetResults),
    [pendingGrandFinalResetResults, pendingSetResults],
  );

  const roundRobinBoardData = useMemo(
    () => buildRoundRobinBoardData({
      event: selectedEvent,
      phasePoolGroup: selectedPhasePoolGroup,
      pendingResultBySetId,
      interimScoreDraftsBySetId,
    }),
    [interimScoreDraftsBySetId, pendingResultBySetId, selectedEvent, selectedPhasePoolGroup],
  );

  const roundRobinMatrixRows = useMemo<RoundRobinMatrixRowView[]>(
    () => buildRoundRobinMatrixRows({
      boardData: roundRobinBoardData,
      pendingResultBySetId,
      interimScoreDraftsBySetId,
      obsOverlayState,
      setDisplayCodeById,
    }),
    [interimScoreDraftsBySetId, obsOverlayState, pendingResultBySetId, roundRobinBoardData, setDisplayCodeById],
  );

  function getSetScoresForDisplay(set: SetSnapshot): ScoreDisplay {
    return buildSetScoresForDisplay(
      set,
      pendingResultBySetId.get(set.setId),
      interimScoreDraftsBySetId[set.setId],
    );
  }

  const eliminationBracketSections = buildEliminationBracketSections({
    sections: renderedSections,
    resolvedEventSetsById,
    pendingResultBySetId,
    interimScoreDraftsBySetId,
    activeOverlay: obsOverlayState,
    setDisplayCodeById,
    getTbdSourceLabel,
    getSideLabel,
    getScoresForSet: getSetScoresForDisplay,
    formatScoreValue,
    isDqScoreValue,
  });

  return {
    pendingResultBySetId,
    roundRobinBoardData,
    roundRobinMatrixRows,
    eliminationBracketSections,
    getSetScoresForDisplay,
  };
}