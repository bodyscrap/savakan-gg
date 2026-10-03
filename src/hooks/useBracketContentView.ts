import { useMemo } from "react";
import { buildEliminationBracketSections } from "../domain/eliminationBracketDisplay";
import { buildRoundRobinMatrixRows } from "../domain/roundRobinMatrixDisplay";
import { buildRoundRobinBoardData } from "../domain/roundRobinBoardBuilder";
import {
  buildPendingSetResultsById,
  getSetScoresForDisplay as buildSetScoresForDisplay,
} from "../domain/setResultDrafts";
import { resolveEntrantDisplayName, type EventSnapshot } from "../domain/bracketDisplay";
import type { SetSlot, SetSnapshot } from "../domain/bracketProgression";
import type { RoundRobinMatrixRowView } from "../components/RoundRobinMatrix";
import type { LocalGrandFinalResetResultMeta, LocalSetResultMeta } from "../domain/tournamentWorkspaceRepository";
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
  aliasNamesByEntrantId: Record<string, string>;
  useAliasName: boolean;
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
  aliasNamesByEntrantId,
  useAliasName,
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

  const entrantMeta = useMemo(
    () => Object.entries(aliasNamesByEntrantId).map(([entrantId, aliasName]) => ({
      entrantId,
      aliasName,
    })),
    [aliasNamesByEntrantId],
  );

  const roundRobinMatrixRows = useMemo<RoundRobinMatrixRowView[]>(
    () => buildRoundRobinMatrixRows({
      boardData: roundRobinBoardData,
      pendingResultBySetId,
      interimScoreDraftsBySetId,
      obsOverlayState,
      setDisplayCodeById,
      entrantMeta,
      useAliasName,
    }),
    [
      entrantMeta,
      interimScoreDraftsBySetId,
      obsOverlayState,
      pendingResultBySetId,
      roundRobinBoardData,
      setDisplayCodeById,
      useAliasName,
    ],
  );

  const roundRobinEntrantNames = useMemo(
    () => roundRobinBoardData.entrants.map((entrantId) => {
      const entrantName = roundRobinBoardData.entrantNames.get(entrantId) ?? "";
      const resolvedEntrantId = roundRobinBoardData.entrantIdsByColumnKey.get(entrantId) ?? entrantId;
      return resolveEntrantDisplayName(
        entrantName,
        aliasNamesByEntrantId[resolvedEntrantId],
        useAliasName,
      );
    }),
    [aliasNamesByEntrantId, roundRobinBoardData, useAliasName],
  );

  const roundRobinStandings = useMemo(
    () => roundRobinBoardData.standings.map((standing) => ({
      ...standing,
      entrantName: resolveEntrantDisplayName(
        standing.entrantName,
        aliasNamesByEntrantId[standing.entrantId],
        useAliasName,
      ),
    })),
    [aliasNamesByEntrantId, roundRobinBoardData.standings, useAliasName],
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
    entrantMeta,
    useAliasName,
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
    roundRobinEntrantNames,
    roundRobinStandings,
    roundRobinMatrixRows,
    eliminationBracketSections,
    getSetScoresForDisplay,
  };
}
