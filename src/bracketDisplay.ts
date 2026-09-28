import type { RoundColumn } from "./bracketLayout";
import type {
  PhaseGroupProgressionSnapshot,
  PhaseGroupSeedSnapshot,
  SetSlot,
  SetSnapshot,
} from "./bracketProgression";

export type EventSnapshot = {
  eventId: string;
  name: string;
  phases?: PhaseSnapshot[];
  phaseGroups?: PhaseGroupSnapshot[];
  sets: SetSnapshot[];
};

export type PhaseSnapshot = {
  phaseId: string;
  name: string | null;
  phaseOrder: number | null;
};

export type PhaseGroupSnapshot = {
  phaseGroupId?: string;
  setIds?: string[];
  tiebreakOrder?: string[];
  phaseName: string | null;
  phaseOrder: number | null;
  displayIdentifier: string | null;
  bracketType: string | null;
  progressionsOut?: PhaseGroupProgressionSnapshot[];
  seedMap?: unknown;
  seedOrder?: string[];
  seeds?: PhaseGroupSeedSnapshot[];
};

export function isGrandFinalText(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (normalized.includes("grand final") || normalized.includes("grand finals") || normalized.includes("グランド")) {
    return true;
  }
  return /(^|\s|\()gf(\s|\)|$)/i.test(text);
}

export function isGrandFinalResetText(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (normalized.includes("reset") || normalized.includes("リセット")) {
    return true;
  }
  return /(^|\s|\()gfr(\s|\)|$)/i.test(text);
}

export function isGrandFinalResetSet(set: SetSnapshot): boolean {
  return isGrandFinalText(set.fullRoundText) && isGrandFinalResetText(set.fullRoundText);
}

export function isVirtualGrandFinalResetSet(set: SetSnapshot): boolean {
  return set.setId.startsWith("virtual_gf_reset_");
}

export function samePhaseGroup(left: SetSnapshot, right: SetSnapshot): boolean {
  if (left.phaseGroupId && right.phaseGroupId) {
    return left.phaseGroupId === right.phaseGroupId;
  }
  if (left.phaseOrder !== null && right.phaseOrder !== null && left.phaseOrder !== right.phaseOrder) {
    return false;
  }

  const leftGroup = (left.phaseGroupDisplayIdentifier ?? left.phaseGroupName ?? "").trim().toLowerCase();
  const rightGroup = (right.phaseGroupDisplayIdentifier ?? right.phaseGroupName ?? "").trim().toLowerCase();
  const sameGroup = leftGroup !== "" && rightGroup !== "" && leftGroup === rightGroup;
  const leftPhase = (left.phaseName ?? "").trim().toLowerCase();
  const rightPhase = (right.phaseName ?? "").trim().toLowerCase();
  return sameGroup && (leftPhase === "" || rightPhase === "" || leftPhase === rightPhase);
}

export function grandFinalWinnerIsFromLosersSide(event: EventSnapshot, grandFinal: SetSnapshot): boolean {
  if (!grandFinal.winnerId) {
    return false;
  }

  const winnerSlotIndex = grandFinal.slots.findIndex((slot) => slot.entrantId === grandFinal.winnerId);
  const winnerSource = winnerSlotIndex === 0
    ? grandFinal.entrant1Source
    : winnerSlotIndex === 1
      ? grandFinal.entrant2Source
      : null;
  const sourceSetId = winnerSource?.resolvedSetId ?? winnerSource?.typeId;
  const sourceSet = sourceSetId
    ? event.sets.find((set) => set.setId === sourceSetId)
    : undefined;
  if (sourceSet && samePhaseGroup(sourceSet, grandFinal)) {
    return isLosersBracketSet(sourceSet);
  }

  return event.sets.some((set) =>
    isLosersBracketSet(set)
    && samePhaseGroup(set, grandFinal)
    && set.slots.some((slot) => slot.entrantId === grandFinal.winnerId),
  );
}

export function isInactiveGrandFinalReset(set: SetSnapshot, event: EventSnapshot | null): boolean {
  if (!event || !isGrandFinalResetSet(set)) {
    return false;
  }
  const grandFinal = event.sets.find((candidate) =>
    isGrandFinalText(candidate.fullRoundText)
    && !isGrandFinalResetSet(candidate)
    && isCompletedSet(candidate)
    && samePhaseGroup(candidate, set),
  );
  return grandFinal !== undefined && !grandFinalWinnerIsFromLosersSide(event, grandFinal);
}

export function shouldShowGrandFinalResetColumn(
  column: RoundColumn,
  phaseGroupSets: SetSnapshot[],
  event: EventSnapshot | null,
  pendingGrandFinalResetSetIds: Set<string>,
): boolean {
  const hasResetSet = column.sets.some((set) => isGrandFinalResetSet(set));
  if (!hasResetSet) {
    return true;
  }

  const grandFinal = phaseGroupSets.find((set) =>
    isGrandFinalText(set.fullRoundText)
    && !isGrandFinalResetSet(set)
    && isCompletedSet(set)
    && column.sets.some((resetSet) => isGrandFinalResetSet(resetSet) && samePhaseGroup(resetSet, set)),
  );
  if (!grandFinal) {
    return false;
  }
  if (!event || !grandFinalWinnerIsFromLosersSide(event, grandFinal)) {
    return false;
  }

  const hasVirtualResetSet = column.sets.some((set) => isVirtualGrandFinalResetSet(set));
  if (hasVirtualResetSet || pendingGrandFinalResetSetIds.has(grandFinal.setId)) {
    return true;
  }

  return column.sets.some((set) => {
    if (set.winnerId !== null) {
      return true;
    }

    return set.slots.some((slot) => slot.entrantId !== null || slot.score !== null);
  });
}

export function isWinnersFinalText(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  return normalized.includes("winners final") || normalized.includes("winners finals") || normalized.includes("勝者決勝");
}

export function isLosersFinalText(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  return normalized.includes("losers final") || normalized.includes("losers finals") || normalized.includes("敗者決勝");
}

export function isSlotTbd(slot: SetSlot): boolean {
  if (slot.entrantId !== null) {
    return false;
  }

  const normalized = slot.entrantName.trim().toUpperCase();
  if (normalized === "") {
    return true;
  }

  const unresolvedLabel = slot.entrantName.trim().toLowerCase();
  return normalized === "TBD"
    || normalized === "TBA"
    || normalized === "UNKNOWN"
    || unresolvedLabel.startsWith("winner of ")
    || unresolvedLabel.startsWith("loser of ")
    || slot.entrantName.trim().startsWith("勝者")
    || slot.entrantName.trim().startsWith("敗者");
}

export function isDisplayableSet(set: SetSnapshot, event: EventSnapshot | null): boolean {
  if (!event?.phaseGroups) {
    return set.isIntermediate !== true;
  }

  const phaseGroupSetIds = event.phaseGroups.flatMap((phaseGroup) => phaseGroup.setIds ?? []);
  if (phaseGroupSetIds.length === 0) {
    return set.isIntermediate !== true;
  }

  return phaseGroupSetIds.includes(set.setId);
}

export function compareSetsForStableLane(left: SetSnapshot, right: SetSnapshot): number {
  return left.setId.localeCompare(right.setId, "ja");
}

export function buildRoundColumns(sets: SetSnapshot[]): RoundColumn[] {
  const map = new Map<string, RoundColumn>();
  let seq = 0;

  for (const set of sets) {
    const normalizedRoundTitle = set.fullRoundText.trim().toLowerCase();
    const roundKey = set.round !== null
      ? `round-${set.round}-title-${normalizedRoundTitle}`
      : `text-${normalizedRoundTitle}`;
    const found = map.get(roundKey);

    if (found) {
      found.sets.push(set);
      found.sets.sort(compareSetsForStableLane);
      continue;
    }

    map.set(roundKey, {
      key: roundKey,
      title: set.fullRoundText,
      round: set.round,
      seq,
      sets: [set],
    });
    seq += 1;
  }

  return [...map.values()].sort((a, b) => {
    if (a.round !== null && b.round !== null) {
      const byRound = a.round - b.round;
      if (byRound !== 0) {
        return byRound;
      }

      const leftIsReset = a.sets.some((set) => isGrandFinalResetSet(set));
      const rightIsReset = b.sets.some((set) => isGrandFinalResetSet(set));
      if (leftIsReset !== rightIsReset) {
        return leftIsReset ? 1 : -1;
      }

      return a.seq - b.seq;
    }

    if (a.round !== null) {
      return -1;
    }

    if (b.round !== null) {
      return 1;
    }

    return a.seq - b.seq;
  });
}

export function isMatchupReady(set: SetSnapshot): boolean {
  if (set.slots.length < 2) {
    return false;
  }

  return set.slots.every((slot) => slot.entrantId !== null);
}

export function isCompletedSet(set: SetSnapshot): boolean {
  return set.state === 3;
}

export function isLosersBracketSet(set: SetSnapshot): boolean {
  if (set.round !== null && set.round < 0) {
    return true;
  }

  const roundText = set.fullRoundText.toLowerCase();
  return roundText.includes("losers") || roundText.includes("loser") || roundText.includes("敗者");
}