import { useState } from "react";
import { isMatchupReady } from "../domain/bracketDisplay";
import type { SetSnapshot } from "../domain/bracketProgression";
import { buildInitialMatchDialogDraft, resolveExistingMatchDialogDraft } from "../domain/matchDialogDraft";
import {
  applyScoreDraftWithOpponentDefault,
  resolveDirectWinnerDrafts,
  setDisqualificationDrafts,
  stepScoreDraftValue,
} from "../domain/setResultDrafts";

export type SetScoreDraft = Record<string, string>;

export type SetResultDraftState = {
  winnerId: string;
  scoreDrafts: SetScoreDraft;
  directWin?: boolean;
};

export type ResultConfirmationState = {
  match: SetSnapshot;
  scoreDrafts: SetScoreDraft;
  directWinnerId: string | null;
};

export type InitializeMatchDraftInput = {
  setId: string;
  forcedDraftState?: SetResultDraftState;
  pendingDraftState?: SetResultDraftState;
  snapshotScoreDrafts: SetScoreDraft;
  defaultScoreDrafts: SetScoreDraft;
};

export function useSetResultDrafts() {
  const [scoreDrafts, setScoreDrafts] = useState<SetScoreDraft>({});
  const [directWinnerId, setDirectWinnerId] = useState<string | null>(null);
  const [setResultDrafts, setSetResultDrafts] = useState<Record<string, SetResultDraftState>>({});
  const [interimScoreDraftsBySetId, setInterimScoreDraftsBySetId] = useState<Record<string, SetScoreDraft>>({});
  const [resultConfirmation, setResultConfirmation] = useState<ResultConfirmationState | null>(null);

  function requestResultConfirmation(match: SetSnapshot) {
    if (!isMatchupReady(match)) {
      return;
    }

    setResultConfirmation({
      match,
      scoreDrafts: { ...scoreDrafts },
      directWinnerId,
    });
  }

  function clearResultConfirmation() {
    setResultConfirmation(null);
  }

  function adjustScoreDraft(match: SetSnapshot, entrantId: string, delta: number) {
    setScoreDrafts((current) => applyScoreDraftWithOpponentDefault(
      match,
      current,
      entrantId,
      stepScoreDraftValue(current[entrantId] ?? "", delta),
    ));
  }

  function changeScoreDraft(match: SetSnapshot, entrantId: string, value: string) {
    setScoreDrafts((current) => applyScoreDraftWithOpponentDefault(match, current, entrantId, value));
  }

  function toggleDirectWinnerDraft(entrantId: string, otherEntrantId: string) {
    const isSelectedWinner = directWinnerId === entrantId;
    setDirectWinnerId((current) => current === entrantId ? null : entrantId);
    setScoreDrafts((current) => resolveDirectWinnerDrafts(
      current,
      isSelectedWinner,
      entrantId,
      otherEntrantId,
    ));
  }

  function setDisqualificationDraft(entrantId: string, otherEntrantId: string) {
    setScoreDrafts((current) => setDisqualificationDrafts(current, entrantId, otherEntrantId));
  }

  function initializeMatchDraft({
    setId,
    forcedDraftState,
    pendingDraftState,
    snapshotScoreDrafts,
    defaultScoreDrafts,
  }: InitializeMatchDraftInput) {
    const existingDraft = resolveExistingMatchDialogDraft(
      forcedDraftState,
      pendingDraftState,
      setResultDrafts[setId],
    );
    if (existingDraft) {
      const { draftState } = existingDraft;
      setDirectWinnerId(draftState.directWin ? draftState.winnerId : null);
      setScoreDrafts(draftState.scoreDrafts);
      if (existingDraft.shouldPersist) {
        saveSetDraft(setId, draftState);
      }
      return;
    }

    const initialDraft = buildInitialMatchDialogDraft(snapshotScoreDrafts, defaultScoreDrafts);
    setDirectWinnerId(null);
    setScoreDrafts(initialDraft.scoreDrafts);
    saveSetDraft(setId, initialDraft);
  }

  function saveSetDraft(setId: string, draft: SetResultDraftState) {
    setSetResultDrafts((current) => ({ ...current, [setId]: draft }));
  }

  function removeSetDraft(setId: string) {
    setSetResultDrafts((current) => {
      if (!(setId in current)) {
        return current;
      }
      const next = { ...current };
      delete next[setId];
      return next;
    });
  }

  function removeInterimDraft(setId: string) {
    setInterimScoreDraftsBySetId((current) => {
      if (!(setId in current)) {
        return current;
      }
      const next = { ...current };
      delete next[setId];
      return next;
    });
  }

  function removeDraftsForSet(setId: string) {
    removeSetDraft(setId);
    removeInterimDraft(setId);
  }

  function clearAllDrafts() {
    setScoreDrafts({});
    setDirectWinnerId(null);
    setSetResultDrafts({});
    setInterimScoreDraftsBySetId({});
  }

  return {
    scoreDrafts,
    setScoreDrafts,
    directWinnerId,
    setDirectWinnerId,
    setResultDrafts,
    interimScoreDraftsBySetId,
    resultConfirmation,
    requestResultConfirmation,
    clearResultConfirmation,
    adjustScoreDraft,
    changeScoreDraft,
    toggleDirectWinnerDraft,
    setDisqualificationDraft,
    initializeMatchDraft,
    saveSetDraft,
    removeInterimDraft,
    removeDraftsForSet,
    clearAllDrafts,
  };
}