import { useEffect, useRef } from "react";
import {
  isCompletedSet,
  isMatchupReady,
  type EventSnapshot,
} from "./bracketDisplay";
import {
  resolveSideDecisionMethod,
  resolveSidesByDecisionMethod,
  type EventManagementSetting,
} from "./eventManagement";
import type { SetSlot, SetSnapshot } from "./bracketProgression";
import { toApiSlug } from "./slugUtils";
import type { PlaySide } from "./useTournamentWorkspace";
import type { MatchSideDraftSavePlan } from "./matchSideDrafts";

type SaveSetPlaySideOptions = {
  silent?: boolean;
  manageBusy?: boolean;
};

type UseSetSideAssignmentOptions = {
  slug: string;
  selectedEvent: EventSnapshot | null;
  resolvedEventSetsById: Map<string, SetSnapshot>;
  setPlaySideMap: Map<string, PlaySide>;
  selectedEventSettingKey: string;
  sideDecisionMethod: EventManagementSetting["sideDecisionMethod"];
  eventMgmtSettings: Record<string, EventManagementSetting>;
  saveLocalSetPlaySide: (input: {
    slug: string;
    eventId: string;
    setId: string;
    entrantId: string;
    opponentEntrantId: string | null;
    playSide: PlaySide | null;
  }) => Promise<unknown>;
  resolveMatchSideDraftSavePlan: (
    set: SetSnapshot,
    sideDrafts: Record<string, PlaySide | "">,
  ) => MatchSideDraftSavePlan | null;
  syncOverlayScores: (
    set: SetSnapshot,
    slotScores: Array<{ entrantId: string; score: number }>,
    sideOverrides?: Record<string, PlaySide | "">,
  ) => Promise<void>;
  setBusy: (busy: boolean) => void;
  setError: (error: string) => void;
  setMessage: (message: string) => void;
};

export function useSetSideAssignment({
  slug,
  selectedEvent,
  resolvedEventSetsById,
  setPlaySideMap,
  selectedEventSettingKey,
  sideDecisionMethod,
  eventMgmtSettings,
  saveLocalSetPlaySide,
  resolveMatchSideDraftSavePlan,
  syncOverlayScores,
  setBusy,
  setError,
  setMessage,
}: UseSetSideAssignmentOptions) {
  const autoAssigningSidesRef = useRef(false);
  const standbyReadinessRef = useRef<Record<string, string>>({});

  async function saveSetPlaySide(
    eventSnapshot: EventSnapshot,
    setSnapshot: SetSnapshot,
    entrantId: string,
    playSide: PlaySide | "",
    options?: SaveSetPlaySideOptions,
  ) {
    const silent = options?.silent ?? true;
    const manageBusy = options?.manageBusy ?? true;

    if (manageBusy) {
      setBusy(true);
    }
    setError("");
    if (!silent) {
      setMessage("");
    }

    try {
      await saveLocalSetPlaySide({
        slug: toApiSlug(slug),
        eventId: eventSnapshot.eventId,
        setId: setSnapshot.setId,
        entrantId,
        opponentEntrantId: setSnapshot.slots
          .map((slot) => slot.entrantId)
          .find((candidate) => candidate && candidate !== entrantId) ?? null,
        playSide: playSide === "" ? null : playSide,
      });

      if (!silent) {
        setMessage("setサイドを保存しました。");
      }
    } catch (err) {
      const errorMessage = String(err);
      const isTransientSideAssignmentError = errorMessage.includes("対戦カードが確定していないsetはサイド設定できません");
      if (!silent || !isTransientSideAssignmentError) {
        setError(errorMessage);
        throw err;
      }
    } finally {
      if (manageBusy) {
        setBusy(false);
      }
    }
  }

  async function saveMatchSideDraftsForResult(
    eventSnapshot: EventSnapshot,
    set: SetSnapshot,
    sideDrafts: Record<string, PlaySide | "">,
  ) {
    const savePlan = resolveMatchSideDraftSavePlan(set, sideDrafts);
    if (!savePlan) {
      return;
    }

    if (savePlan.sidesChanged) {
      await saveSetPlaySide(
        eventSnapshot,
        set,
        savePlan.upperEntrantId,
        savePlan.sideOverrides[savePlan.upperEntrantId],
        { silent: true, manageBusy: false },
      );

      const currentScores = set.slots
        .filter((slot): slot is SetSlot & { entrantId: string } => slot.entrantId !== null)
        .map((slot) => ({ entrantId: slot.entrantId, score: slot.score ?? 0 }));
      await syncOverlayScores(set, currentScores, savePlan.sideOverrides);
    }

    return savePlan.sideOverrides;
  }

  const saveSetPlaySideRef = useRef(saveSetPlaySide);
  saveSetPlaySideRef.current = saveSetPlaySide;

  function getConfiguredSideDecisionMethod(): EventManagementSetting["sideDecisionMethod"] {
    if (selectedEventSettingKey === "") {
      return "upper_1p";
    }

    return resolveSideDecisionMethod(eventMgmtSettings[selectedEventSettingKey]?.sideDecisionMethod);
  }

  useEffect(() => {
    if (!selectedEvent) {
      standbyReadinessRef.current = {};
      return;
    }

    if (autoAssigningSidesRef.current) {
      return;
    }

    const previousReadiness = standbyReadinessRef.current;
    const nextReadiness: Record<string, string> = {};
    const updates: Array<{ setSnapshot: SetSnapshot; upperEntrantId: string; upperSide: PlaySide }> = [];

    for (const set of selectedEvent.sets.map((candidate) =>
      resolvedEventSetsById.get(candidate.setId) ?? candidate,
    )) {
      const isReadyForAutoAssign = !isCompletedSet(set) && isMatchupReady(set);
      const slots = set.slots.filter((slot) => slot.entrantId !== null);
      const upperId = slots[0]?.entrantId ?? "";
      const lowerId = slots[1]?.entrantId ?? "";
      const readinessKey = isReadyForAutoAssign && upperId !== "" && lowerId !== ""
        ? `${upperId}:${lowerId}`
        : "";
      nextReadiness[set.setId] = readinessKey;

      const previousReadinessKey = previousReadiness[set.setId] ?? "";
      if (!isReadyForAutoAssign || readinessKey === "") {
        continue;
      }

      if (slots.length < 2 || !upperId || !lowerId) {
        continue;
      }

      const upperCurrent: PlaySide | "" = setPlaySideMap.get(`${set.setId}:${upperId}`) ?? "";
      const lowerCurrent: PlaySide | "" = setPlaySideMap.get(`${set.setId}:${lowerId}`) ?? "";
      const hasInvalidPair = (upperCurrent === "") !== (lowerCurrent === "")
        || (upperCurrent !== "" && lowerCurrent !== "" && upperCurrent === lowerCurrent);
      if (previousReadinessKey === readinessKey && !hasInvalidPair) {
        continue;
      }

      let upperSide: PlaySide | "" = upperCurrent;
      let lowerSide: PlaySide | "" = lowerCurrent;

      if (upperSide !== "" && lowerSide !== "") {
        if (upperSide !== lowerSide) {
          continue;
        }

        const decided = resolveSidesByDecisionMethod(set.setId, getConfiguredSideDecisionMethod());
        upperSide = decided.upperSide;
        lowerSide = decided.lowerSide;
      }

      if (upperSide !== "" && lowerSide === "") {
        lowerSide = upperSide === "1P" ? "2P" : "1P";
      } else if (lowerSide !== "" && upperSide === "") {
        upperSide = lowerSide === "1P" ? "2P" : "1P";
      } else {
        const decided = resolveSidesByDecisionMethod(set.setId, getConfiguredSideDecisionMethod());
        upperSide = decided.upperSide;
        lowerSide = decided.lowerSide;
      }

      if (upperCurrent !== upperSide || lowerCurrent !== lowerSide) {
        updates.push({ setSnapshot: set, upperEntrantId: upperId, upperSide });
      }
    }

    standbyReadinessRef.current = nextReadiness;

    if (updates.length === 0) {
      return;
    }

    autoAssigningSidesRef.current = true;
    void (async () => {
      try {
        for (const update of updates) {
          await saveSetPlaySideRef.current(selectedEvent, update.setSnapshot, update.upperEntrantId, update.upperSide, {
            silent: true,
            manageBusy: false,
          });
        }
      } finally {
        autoAssigningSidesRef.current = false;
      }
    })();
  }, [selectedEvent, resolvedEventSetsById, setPlaySideMap, sideDecisionMethod, eventMgmtSettings, selectedEventSettingKey]);

  async function applySideDecisionMethodToAllUnconfirmedSets() {
    if (!selectedEvent) {
      return;
    }

    setBusy(true);
    setError("");
    setMessage("");

    try {
      const method = getConfiguredSideDecisionMethod();
      const updates: Array<{ setSnapshot: SetSnapshot; upperEntrantId: string; upperSide: PlaySide }> = [];

      for (const set of selectedEvent.sets.map((candidate) =>
        resolvedEventSetsById.get(candidate.setId) ?? candidate,
      )) {
        if (isCompletedSet(set) || !isMatchupReady(set)) {
          continue;
        }

        const slots = set.slots.filter((slot) => slot.entrantId !== null);
        if (slots.length < 2) {
          continue;
        }

        const upperId = slots[0].entrantId;
        const lowerId = slots[1].entrantId;
        if (!upperId || !lowerId) {
          continue;
        }

        const decided = resolveSidesByDecisionMethod(set.setId, method);
        const upperCurrent = setPlaySideMap.get(`${set.setId}:${upperId}`) ?? "";
        const lowerCurrent = setPlaySideMap.get(`${set.setId}:${lowerId}`) ?? "";

        if (upperCurrent !== decided.upperSide || lowerCurrent !== decided.lowerSide) {
          updates.push({ setSnapshot: set, upperEntrantId: upperId, upperSide: decided.upperSide });
        }
      }

      if (updates.length === 0) {
        setMessage("適用対象の未確定試合はありませんでした。");
        return;
      }

      autoAssigningSidesRef.current = true;
      try {
        for (const update of updates) {
          await saveSetPlaySideRef.current(selectedEvent, update.setSnapshot, update.upperEntrantId, update.upperSide, {
            silent: true,
            manageBusy: false,
          });
        }
      } finally {
        autoAssigningSidesRef.current = false;
      }

      const affectedSetCount = new Set(updates.map((update) => update.setSnapshot.setId)).size;
      setMessage(`未確定試合 ${affectedSetCount} 件に 1P/2P 決定方法を適用しました。`);
    } catch (err) {
      setError(String(err));
    } finally {
      autoAssigningSidesRef.current = false;
      setBusy(false);
    }
  }

  return { applySideDecisionMethodToAllUnconfirmedSets, saveSetPlaySide, saveMatchSideDraftsForResult };
}