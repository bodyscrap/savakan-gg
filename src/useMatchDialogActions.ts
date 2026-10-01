import type { EventSnapshot } from "./bracketDisplay";
import { isDisplayableSet, isInactiveGrandFinalReset } from "./bracketDisplay";
import { buildMatchSideDrafts } from "./matchSideDrafts";
import { buildDraftStateFromPending, buildScoreDraftsFromSet } from "./setResultDrafts";
import type { SetSnapshot } from "./bracketProgression";
import type { LocalSetResultMeta, PlaySide } from "./tournamentWorkspaceRepository";
import type {
  InitializeMatchDraftInput,
  SetResultDraftState,
  SetScoreDraft,
} from "./useSetResultDrafts";

type UseMatchDialogActionsOptions = {
  selectedEvent: EventSnapshot | null;
  resolvedEventSetsById: Map<string, SetSnapshot>;
  pendingResultBySetId: Map<string, LocalSetResultMeta>;
  setActiveMatchSetId: (setId: string) => void;
  setActiveMatchSideDrafts: (drafts: Record<string, PlaySide | "">) => void;
  getSetSlotSide: (setId: string, entrantId: string | null) => PlaySide | "";
  getSetScoresForDisplay: (set: SetSnapshot) => { scores: SetScoreDraft };
  initializeMatchDraft: (input: InitializeMatchDraftInput) => void;
};

export function useMatchDialogActions({
  selectedEvent,
  resolvedEventSetsById,
  pendingResultBySetId,
  setActiveMatchSetId,
  setActiveMatchSideDrafts,
  getSetSlotSide,
  getSetScoresForDisplay,
  initializeMatchDraft,
}: UseMatchDialogActionsOptions) {
  function openMatchDialog(set: SetSnapshot, forcedDraftState?: SetResultDraftState) {
    if (!isDisplayableSet(set, selectedEvent) || isInactiveGrandFinalReset(set, selectedEvent)) {
      return;
    }

    const inputSet = resolvedEventSetsById.get(set.setId) ?? set;
    setActiveMatchSetId(set.setId);
    setActiveMatchSideDrafts(buildMatchSideDrafts(inputSet, getSetSlotSide));

    const pending = pendingResultBySetId.get(set.setId);
    initializeMatchDraft({
      setId: set.setId,
      forcedDraftState,
      pendingDraftState: pending ? buildDraftStateFromPending(inputSet, pending) : undefined,
      snapshotScoreDrafts: getSetScoresForDisplay(set).scores,
      defaultScoreDrafts: buildScoreDraftsFromSet(inputSet),
    });
  }

  return { openMatchDialog };
}