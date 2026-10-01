import type { SetResultDraftState, SetScoreDraft } from "./useSetResultDrafts";
import { buildMatchSideDrafts } from "./matchSideDrafts";
import { buildScoreDraftsFromResult, buildScoreDraftsFromSet } from "./setResultDrafts";
import type { PlaySide, TournamentWorkspace } from "./tournamentWorkspaceRepository";

export type ExistingMatchDialogDraft = {
  draftState: SetResultDraftState;
  shouldPersist: boolean;
};

export type WorkspaceMatchDraftState = {
  scoreDrafts: SetScoreDraft;
  directWinnerId: string | null;
  sideDrafts: Record<string, PlaySide | "">;
};

export function resolveWorkspaceMatchDraftState(
  workspace: TournamentWorkspace,
  eventId: string,
  setId: string,
  getSavedSide: (setId: string, entrantId: string) => PlaySide | "",
): WorkspaceMatchDraftState | null {
  const set = workspace.snapshot.events
    .find((event) => event.eventId === eventId)
    ?.sets.find((candidate) => candidate.setId === setId);
  if (!set) {
    return null;
  }

  const pending = workspace.localMeta.pendingSetResults.find(
    (item) => item.eventId === eventId && item.setId === setId,
  );

  return {
    scoreDrafts: pending ? buildScoreDraftsFromResult(set, pending) : buildScoreDraftsFromSet(set),
    directWinnerId: pending?.directWin ? pending.winnerId : null,
    sideDrafts: buildMatchSideDrafts(set, getSavedSide),
  };
}

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