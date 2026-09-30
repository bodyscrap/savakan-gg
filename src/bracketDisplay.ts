import { buildPositionedRoundColumns, type PositionedRoundColumn, type RoundColumn } from "./bracketLayout";
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

export type PhasePoolGroup = {
  key: string;
  phaseGroupId: string | null;
  phaseName: string;
  phaseGroupName: string;
  bracketType: string | null;
  phaseOrder: number | null;
  phaseGroupDisplayIdentifier: string | null;
  tiebreakOrder?: string[];
  progressionsOut: PhaseGroupProgressionSnapshot[];
  seedMap: unknown;
  seedOrder: string[];
  seeds: PhaseGroupSeedSnapshot[];
  sets: SetSnapshot[];
  columns: RoundColumn[];
};

export type BracketSection = {
  key: string;
  title: string;
  columns: RoundColumn[];
  setCount: number;
};

export type BracketSectionForView = Omit<BracketSection, "columns"> & {
  columns: PositionedRoundColumn[];
};

export function formatAlphabetSequence(index: number): string {
  let remaining = index;
  let label = "";

  do {
    const remainder = remaining % 26;
    label = String.fromCharCode(65 + remainder) + label;
    remaining = Math.floor(remaining / 26) - 1;
  } while (remaining >= 0);

  return label;
}

export function pickPairSourceIds(previousSetIds: string[], currentCount: number, currentIndex: number): string[] {
  if (previousSetIds.length === 0 || currentCount <= 0) {
    return [];
  }

  if (previousSetIds.length === 1) {
    return [previousSetIds[0]];
  }

  if (previousSetIds.length >= currentCount * 2) {
    const first = previousSetIds[currentIndex * 2];
    const second = previousSetIds[currentIndex * 2 + 1];
    return [first, second].filter((item): item is string => Boolean(item));
  }

  const mapped = ((currentIndex + 0.5) * previousSetIds.length) / currentCount - 0.5;
  const left = Math.max(0, Math.floor(mapped));
  const right = Math.min(previousSetIds.length - 1, Math.ceil(mapped));
  const first = previousSetIds[left];
  const second = previousSetIds[right];

  if (first && second && first !== second) {
    return [first, second];
  }

  if (first) {
    const neighbor = previousSetIds[Math.min(previousSetIds.length - 1, left + 1)] ?? previousSetIds[Math.max(0, left - 1)];
    if (neighbor && neighbor !== first) {
      return [first, neighbor];
    }
    return [first];
  }

  return [];
}

export function normalizeSourceText(kind: "winners" | "losers", setCode: string): string {
  return `${kind === "winners" ? "winner" : "loser"} of ${setCode}`;
}

export function buildPhasePoolGroups(event: EventSnapshot | null): PhasePoolGroup[] {
  if (!event) {
    return [];
  }

  const groupMap = new Map<string, PhasePoolGroup>();

  for (const set of event.sets) {
    if (!isDisplayableSet(set, event)) {
      continue;
    }
    const phaseName = set.phaseName && set.phaseName.trim() !== "" ? set.phaseName : "Phase 未設定";
    const phaseGroupName = set.phaseGroupName && set.phaseGroupName.trim() !== "" ? set.phaseGroupName : "Pool 未設定";
    const phaseGroupDisplayIdentifier = set.phaseGroupDisplayIdentifier?.trim() || null;
    const phaseGroupMetadata = set.phaseGroupId
      ? event.phaseGroups?.find((group) => group.phaseGroupId === set.phaseGroupId)
      : event.phaseGroups?.find((group) =>
        group.phaseOrder === set.phaseOrder
        && (group.displayIdentifier?.trim() || null) === phaseGroupDisplayIdentifier,
      ) ?? event.phaseGroups?.find((group) =>
        group.phaseName === set.phaseName
        && (group.displayIdentifier?.trim() || null) === phaseGroupDisplayIdentifier,
      );
    if (!phaseGroupMetadata) {
      continue;
    }
    const bracketType = phaseGroupMetadata.bracketType?.trim().toUpperCase() || null;
    const tiebreakOrder = phaseGroupMetadata.tiebreakOrder ?? [];
    const progressionsOut = phaseGroupMetadata.progressionsOut ?? [];
    const seedMap = phaseGroupMetadata.seedMap ?? null;
    const seedOrder = phaseGroupMetadata.seedOrder ?? [];
    const seeds = phaseGroupMetadata.seeds ?? [];
    const hasStablePhasePoolIdentity = set.phaseOrder !== null && phaseGroupDisplayIdentifier !== null;
    const groupKey = set.phaseGroupId
      ? `id:${set.phaseGroupId}`
      : hasStablePhasePoolIdentity
        ? `order:${set.phaseOrder}::pool:${phaseGroupDisplayIdentifier}`
        : `name:${phaseName}::${phaseGroupName}`;
    const found = groupMap.get(groupKey);

    if (found) {
      found.sets.push(set);
      if (found.bracketType === null && bracketType !== null) {
        found.bracketType = bracketType;
      }
      if (found.progressionsOut.length === 0 && progressionsOut.length > 0) {
        found.progressionsOut = progressionsOut;
      }
      if (found.seedMap === null && seedMap !== null) {
        found.seedMap = seedMap;
      }
      if (found.seedOrder.length === 0 && seedOrder.length > 0) {
        found.seedOrder = seedOrder;
      }
      if (found.seeds.length === 0 && seeds.length > 0) {
        found.seeds = seeds;
      }
      continue;
    }

    groupMap.set(groupKey, {
      key: groupKey,
      phaseGroupId: set.phaseGroupId ?? null,
      phaseName,
      phaseGroupName,
      bracketType,
      phaseOrder: set.phaseOrder,
      phaseGroupDisplayIdentifier,
      tiebreakOrder,
      progressionsOut,
      seedMap,
      seedOrder,
      seeds,
      sets: [set],
      columns: [],
    });
  }

  return [...groupMap.values()]
    .sort((left, right) => {
      if (left.phaseOrder === null && right.phaseOrder !== null) {
        return 1;
      }
      if (left.phaseOrder !== null && right.phaseOrder === null) {
        return -1;
      }
      if (left.phaseOrder !== null && right.phaseOrder !== null && left.phaseOrder !== right.phaseOrder) {
        return left.phaseOrder - right.phaseOrder;
      }
      const byPhase = left.phaseName.localeCompare(right.phaseName, "ja");
      if (byPhase !== 0) {
        return byPhase;
      }
      if (left.phaseGroupDisplayIdentifier !== null && right.phaseGroupDisplayIdentifier !== null) {
        return left.phaseGroupDisplayIdentifier.localeCompare(right.phaseGroupDisplayIdentifier, "ja");
      }
      return left.phaseGroupName.localeCompare(right.phaseGroupName, "ja");
    })
    .map((group) => ({
      ...group,
      columns: buildRoundColumns(group.sets),
    }));
}

export function buildPhaseNames(phasePoolGroups: PhasePoolGroup[], phases: PhaseSnapshot[] = []): string[] {
  const names = [...new Set(phasePoolGroups.map((group) => group.phaseName))];
  const phasePositionByName = new Map<string, number>();
  for (const [index, phase] of phases.entries()) {
    if (phase.name && !phasePositionByName.has(phase.name)) {
      phasePositionByName.set(phase.name, index);
    }
  }

  const groupOrderByName = new Map<string, number>();
  for (const group of phasePoolGroups) {
    if (group.phaseOrder === null) {
      continue;
    }
    const currentOrder = groupOrderByName.get(group.phaseName);
    if (currentOrder === undefined || group.phaseOrder < currentOrder) {
      groupOrderByName.set(group.phaseName, group.phaseOrder);
    }
  }

  const useGroupOrderFallback = phasePositionByName.size === 0;
  return names.sort((left, right) => {
    const leftPosition = phasePositionByName.get(left);
    const rightPosition = phasePositionByName.get(right);
    if (leftPosition !== undefined && rightPosition !== undefined && leftPosition !== rightPosition) {
      return leftPosition - rightPosition;
    }
    if (leftPosition !== undefined && rightPosition === undefined) {
      return -1;
    }
    if (leftPosition === undefined && rightPosition !== undefined) {
      return 1;
    }

    const leftOrder = useGroupOrderFallback ? groupOrderByName.get(left) : undefined;
    const rightOrder = useGroupOrderFallback ? groupOrderByName.get(right) : undefined;
    if (leftOrder === undefined && rightOrder !== undefined) {
      return 1;
    }
    if (leftOrder !== undefined && rightOrder === undefined) {
      return -1;
    }
    if (leftOrder !== undefined && rightOrder !== undefined && leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }
    return left.localeCompare(right, "ja");
  });
}

export function buildBracketSections(group: PhasePoolGroup | null): BracketSection[] {
  if (!group) {
    return [];
  }

  const winnersSets = group.sets.filter((set) => !isLosersBracketSet(set));
  const losersSets = group.sets.filter((set) => isLosersBracketSet(set));
  const sections: BracketSection[] = [];

  if (winnersSets.length > 0) {
    sections.push({
      key: "winners",
      title: "Winners",
      columns: buildRoundColumns(winnersSets),
      setCount: winnersSets.length,
    });
  }

  if (losersSets.length > 0) {
    sections.push({
      key: "losers",
      title: "Losers",
      columns: buildRoundColumns(losersSets),
      setCount: losersSets.length,
    });
  }

  if (sections.length === 0) {
    sections.push({
      key: "all",
      title: "Bracket",
      columns: group.columns,
      setCount: group.sets.length,
    });
  }

  return sections;
}

export function buildBracketSectionsForView(input: {
  sections: BracketSection[];
  phaseGroupSets: SetSnapshot[];
  event: EventSnapshot | null;
  pendingResetSetIds: Set<string>;
}): BracketSectionForView[] {
  return input.sections.map((section) => {
    const preparedColumns = section.columns.map((column) => ({
      column,
      hidden: !shouldShowGrandFinalResetColumn(
        column,
        input.phaseGroupSets,
        input.event,
        input.pendingResetSetIds,
      ),
    }));

    const hasResetColumn = preparedColumns.some((item) => item.column.sets.some((set) => isGrandFinalResetSet(set)));
    if (!hasResetColumn) {
      const grandFinalColumnIndex = preparedColumns.findIndex((item) =>
        item.column.sets.some((set) => isGrandFinalText(set.fullRoundText) && !isGrandFinalResetSet(set)),
      );

      if (grandFinalColumnIndex >= 0) {
        const grandFinalColumn = preparedColumns[grandFinalColumnIndex].column;
        preparedColumns.splice(grandFinalColumnIndex + 1, 0, {
          column: {
            key: `placeholder-gf-reset-${grandFinalColumn.key}`,
            title: "Grand Final Reset",
            round: grandFinalColumn.round,
            seq: grandFinalColumn.seq + 1,
            sets: [],
          },
          hidden: true,
        });
      }
    }

    const visualColumns = section.key === "losers" ? [...preparedColumns].reverse() : preparedColumns;
    const hiddenByKey = new Map(visualColumns.map((item) => [item.column.key, item.hidden] as const));
    const positionedColumns = buildPositionedRoundColumns(
      visualColumns.map((item) => item.column),
      section.key,
    ).map((column) => ({
      ...column,
      hidden: hiddenByKey.get(column.key) ?? false,
    }));

    return {
      ...section,
      columns: positionedColumns,
    };
  });
}

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