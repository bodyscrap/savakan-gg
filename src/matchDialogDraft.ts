import type { SetResultDraftState, SetScoreDraft } from "./useSetResultDrafts";

export type ExistingMatchDialogDraft = {
  draftState: SetResultDraftState;
  shouldPersist: boolean;
};

export function resolveExistingMatchDialogDraft(
  forcedDraftState: SetResultDraftState | undefined,
  pendingDraftState: SetResultDraftState | undefined,
  cachedDraftState: SetResultDraftState | undefined,
): ExistingMatchDialogDraft | null {
  if (forcedDraftState) {
    return { draftState: forcedDraftState, shouldPersist: true };
  }

  if (pendingDraftState) {
    return { draftState: pendingDraftState, shouldPersist: true };
  }

  if (cachedDraftState) {
    return { draftState: cachedDraftState, shouldPersist: false };
  }

  return null;
}

export function buildInitialMatchDialogDraft(
  snapshotScoreDrafts: SetScoreDraft,
  defaultScoreDrafts: SetScoreDraft,
): SetResultDraftState {
  return {
    winnerId: "",
    scoreDrafts: Object.keys(snapshotScoreDrafts).length > 0 ? snapshotScoreDrafts : defaultScoreDrafts,
    directWin: false,
  };
}