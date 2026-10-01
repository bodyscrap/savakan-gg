import { useState } from "react";
import { isMatchupReady } from "./bracketDisplay";
import type { SetSnapshot } from "./bracketProgression";
import { buildInitialMatchDialogDraft, resolveExistingMatchDialogDraft } from "./matchDialogDraft";

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
    initializeMatchDraft,
    saveSetDraft,
    removeInterimDraft,
    removeDraftsForSet,
    clearAllDrafts,
  };
}