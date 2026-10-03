import type { PositionedRoundColumn } from "./bracketLayout";
import { isCompletedSet, isMatchupReady, resolveEntrantDisplayName } from "./bracketDisplay";
import type { SetSlot, SetSnapshot } from "./bracketProgression";
import type { EliminationBracketSectionView } from "../components/EliminationBracket";
import {
  getPendingSetChangeClass,
  getSetResultVisualStatus,
} from "./setResultDrafts";
import type { LocalSetResultMeta } from "../hooks/useTournamentWorkspace";
import type { SetScoreDraft } from "../hooks/useSetResultDrafts";

type RenderedSection = {
  key: string;
  title: string;
  setCount: number;
  columns: PositionedRoundColumn[];
};

export function buildEliminationBracketSections(input: {
  sections: RenderedSection[];
  resolvedEventSetsById: Map<string, SetSnapshot>;
  pendingResultBySetId: Map<string, LocalSetResultMeta>;
  interimScoreDraftsBySetId: Record<string, SetScoreDraft>;
  activeOverlay: { active: boolean; currentSetId: string | null } | null;
  entrantMeta: Array<{ entrantId: string; aliasName?: string }>;
  useAliasName: boolean;
  setDisplayCodeById: Map<string, string>;
  getTbdSourceLabel: (set: SetSnapshot, slotIndex: number, slot: SetSlot) => string | null;
  getSideLabel: (
    setId: string,
    entrantId: string | null,
    options: { fallbackBySlotIndex: number; finishedSet: boolean; matchupReady: boolean },
  ) => string;
  getScoresForSet: (set: SetSnapshot) => {
    scores: Record<string, string>;
    isDq: boolean;
    winnerId: string | null;
  };
  formatScoreValue: (value: number) => string;
  isDqScoreValue: (value: number | null) => boolean;
}): EliminationBracketSectionView[] {
  const aliasNameByEntrantId = new Map(
    input.entrantMeta.map((meta) => [meta.entrantId, meta.aliasName ?? ""]),
  );
  return input.sections.map((section) => ({
    key: section.key,
    title: section.title,
    setCount: section.setCount,
    columns: section.columns.map((column) => ({
      key: column.key,
      title: column.title,
      round: column.round,
      height: column.height,
      hidden: column.hidden,
      cards: column.positionedSets.map(({ set, y }) => {
        const displaySet = input.resolvedEventSetsById.get(set.setId) ?? set;
        const pendingResult = input.pendingResultBySetId.get(set.setId);
        const resultStatus = getSetResultVisualStatus(
          set,
          pendingResult,
          input.interimScoreDraftsBySetId[set.setId],
        );
        const resultStatusLabel = resultStatus === "confirmed"
          ? "確定"
          : resultStatus === "reset"
            ? "取消待ち"
            : resultStatus === "draft"
              ? "下書き"
              : resultStatus === "inprogress"
                ? "途中"
                : "";
        const finishedSet = isCompletedSet(set);
        const matchupReady = isMatchupReady(displaySet);
        const setDisplay = input.getScoresForSet(displaySet);
        const winnerId = setDisplay.winnerId ?? set.winnerId;

        return {
          set,
          positionY: y,
          displayCode: input.setDisplayCodeById.get(set.setId),
          changeClass: pendingResult ? getPendingSetChangeClass(pendingResult) : "",
          resultStatus,
          resultStatusLabel,
          isLiveOverlaySet: Boolean(
            input.activeOverlay?.active
            && input.activeOverlay.currentSetId === set.setId
            && input.activeOverlay.currentSetId !== "__test__",
          ),
          slots: displaySet.slots.map((slot, index) => {
            const entrantId = slot.entrantId;
            const tbdSourceLabel = input.getTbdSourceLabel(set, index, slot);
            const entrantName = !entrantId && tbdSourceLabel
              ? tbdSourceLabel
              : resolveEntrantDisplayName(
                slot.entrantName,
                entrantId ? aliasNameByEntrantId.get(entrantId) : undefined,
                input.useAliasName,
              );
            const isWinner = entrantId && winnerId ? entrantId === winnerId : false;
            const sideLabel = input.getSideLabel(set.setId, entrantId, {
              fallbackBySlotIndex: index,
              finishedSet,
              matchupReady,
            });
            const sideBadgeClass = sideLabel === "1P"
              ? (finishedSet ? "side-1p-finished" : "side-1p")
              : sideLabel === "2P"
                ? (finishedSet ? "side-2p-finished" : "side-2p")
                : "side-none";
            const gameWins = entrantId
              ? (setDisplay.scores[entrantId]
                ?? (slot.score !== null
                  ? (input.isDqScoreValue(slot.score) ? "DQ" : input.formatScoreValue(slot.score))
                  : (winnerId ? (isWinner ? "✓" : "-") : "-")))
              : "-";
            const scoreClass = (input.isDqScoreValue(slot.score) || setDisplay.isDq)
              ? (isWinner ? "win" : "dq")
              : (isWinner ? "win" : "lose");

            return {
              key: `${set.setId}-${index}`,
              sideLabel,
              sideBadgeClass,
              entrantName,
              gameWins,
              scoreClass,
            };
          }),
        };
      }),
    })),
  }));
}