import type { SetResultDraftState, SetScoreDraft } from "../hooks/useSetResultDrafts";
import { buildMatchSideDrafts } from "./matchSideDrafts";
import { buildScoreDraftsFromResult, buildScoreDraftsFromSet } from "./setResultDrafts";
import { getDisplaySlotsForSet, isMatchupReady } from "./bracketDisplay";
import type { MatchDialogPlayerView } from "../components/MatchDetailDialog";
import type { PlaySide, TournamentWorkspace } from "./tournamentWorkspaceRepository";
import type { SetSnapshot, SetSlot } from "./bracketProgression";

export type ExistingMatchDialogDraft = {
  draftState: SetResultDraftState;
  shouldPersist: boolean;
};

export type WorkspaceMatchDraftState = {
  scoreDrafts: SetScoreDraft;
  directWinnerId: string | null;
  sideDrafts: Record<string, PlaySide | "">;
};

type BuildMatchDialogPlayersOptions = {
  set: SetSnapshot;
  displayBySide: boolean;
  sideDrafts: Record<string, PlaySide | "">;
  scoreDrafts: SetScoreDraft;
  directWinnerId: string | null;
  getSavedSide: (setId: string, entrantId: string | null) => PlaySide | "";
  getSideLabel: (
    setId: string,
    entrantId: string | null,
    options: { fallbackBySlotIndex: number; matchupReady?: boolean },
  ) => string;
  getTbdSourceLabel: (set: SetSnapshot, slotIndex: number, slot: SetSlot) => string | null;
};

export function buildMatchDialogPlayers({
  set,
  displayBySide,
  sideDrafts,
  scoreDrafts,
  directWinnerId,
  getSavedSide,
  getSideLabel,
  getTbdSourceLabel,
}: BuildMatchDialogPlayersOptions): MatchDialogPlayerView[] {
  const matchupReady = isMatchupReady(set);

  return getDisplaySlotsForSet(set, {
    displayBySide,
    matchupReady,
    sideDrafts,
    getSideLabel,
  }).map(({ slot, slotIndex }) => {
    const entrantId = slot.entrantId;
    const tbdLabel = getTbdSourceLabel(set, slotIndex, slot);
    const fallbackSide = getSideLabel(set.setId, entrantId, {
      fallbackBySlotIndex: slotIndex,
      matchupReady,
    });
    const otherEntrantId = set.slots.find(
      (item) => item.entrantId !== null && item.entrantId !== entrantId,
    )?.entrantId ?? null;

    return {
      key: `${set.setId}-dialog-${slotIndex}`,
      slot,
      entrantId,
      entrantName: !entrantId && tbdLabel ? tbdLabel : slot.entrantName,
      side: entrantId
        ? sideDrafts[entrantId] || getSavedSide(set.setId, entrantId) || fallbackSide
        : "",
      scoreValue: entrantId && directWinnerId
        ? (entrantId === directWinnerId ? "W" : "L")
        : entrantId ? scoreDrafts[entrantId] ?? "" : "",
      otherEntrantId,
    };
  });
}

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