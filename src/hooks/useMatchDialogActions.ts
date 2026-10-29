import type { MouseEvent } from "react";
import type { EventSnapshot } from "../domain/bracketDisplay";
import { isDisplayableSet, isInactiveGrandFinalReset } from "../domain/bracketDisplay";
import { buildMatchSideDrafts } from "../domain/matchSideDrafts";
import { buildDraftStateFromPending, buildScoreDraftsFromSet } from "../domain/setResultDrafts";
import type { SetSnapshot } from "../domain/bracketProgression";
import type { LocalSetResultMeta, PlaySide } from "../domain/tournamentWorkspaceRepository";
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
  busy: boolean;
  interactionDisabled?: boolean;
  overlayBusy: boolean;
  stopOverlay: (fullyStopped: boolean) => Promise<void>;
  toggleOverlay: (set: SetSnapshot) => Promise<void>;
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
  busy,
  interactionDisabled = false,
  overlayBusy,
  stopOverlay,
  toggleOverlay,
}: UseMatchDialogActionsOptions) {
  function openMatchDialog(set: SetSnapshot, forcedDraftState?: SetResultDraftState) {
    if (interactionDisabled) return;
    if (!isDisplayableSet(set, selectedEvent) || isInactiveGrandFinalReset(set, selectedEvent)) {
      return;
    }

    const inputSet = resolvedEventSetsById.get(set.setId) ?? set;
    setActiveMatchSetId(set.setId);
    setActiveMatchSideDrafts(buildMatchSideDrafts(inputSet, getSetSlotSide));

    const pending = pendingResultBySetId.get(set.setId);
    const entrantIds = inputSet.slots
      .map((slot) => slot.entrantId)
      .filter((entrantId): entrantId is string => entrantId !== null);
    const snapshotScoreDrafts = getSetScoresForDisplay(set).scores;
    initializeMatchDraft({
      setId: set.setId,
      entrantIds,
      forcedDraftState,
      pendingDraftState: pending ? buildDraftStateFromPending(inputSet, pending) : undefined,
      snapshotScoreDrafts: Object.fromEntries(
        Object.entries(snapshotScoreDrafts).filter(([entrantId]) => entrantIds.includes(entrantId)),
      ),
      defaultScoreDrafts: buildScoreDraftsFromSet(inputSet),
    });
  }

  function handleRoundRobinMatchClick(set: SetSnapshot, event: MouseEvent<HTMLButtonElement>) {
    if (interactionDisabled) { event.preventDefault(); return; }
    if (event.altKey) {
      event.preventDefault();
      if (!busy && !overlayBusy) {
        void stopOverlay(true);
      }
      return;
    }
    if (event.ctrlKey) {
      event.preventDefault();
      if (!busy && !overlayBusy) {
        void toggleOverlay(set);
      }
      return;
    }
    openMatchDialog(set);
  }

  function handleEliminationSetActivate(set: SetSnapshot, event: MouseEvent<HTMLElement>) {
    if (interactionDisabled) { event.preventDefault(); return; }
    if (event.altKey && event.button === 0) {
      event.preventDefault();
      if (!busy && !overlayBusy) {
        void stopOverlay(true);
      }
      return;
    }
    if (event.ctrlKey) {
      event.preventDefault();
      if (!busy && !overlayBusy) {
        void toggleOverlay(set);
      }
      return;
    }
    openMatchDialog(set);
  }

  return { openMatchDialog, handleRoundRobinMatchClick, handleEliminationSetActivate };
}