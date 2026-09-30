import { useState } from "react";

export type SetScoreDraft = Record<string, string>;

export type SetResultDraftState = {
  winnerId: string;
  scoreDrafts: SetScoreDraft;
  directWin?: boolean;
};

export function useSetResultDrafts() {
  const [scoreDrafts, setScoreDrafts] = useState<SetScoreDraft>({});
  const [directWinnerId, setDirectWinnerId] = useState<string | null>(null);
  const [setResultDrafts, setSetResultDrafts] = useState<Record<string, SetResultDraftState>>({});
  const [interimScoreDraftsBySetId, setInterimScoreDraftsBySetId] = useState<Record<string, SetScoreDraft>>({});

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
    saveSetDraft,
    removeInterimDraft,
    removeDraftsForSet,
    clearAllDrafts,
  };
}