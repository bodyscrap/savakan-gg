import { buildPositionedRoundColumns, type PositionedRoundColumn, type RoundColumn } from "./bracketLayout";
import type {
  PhaseGroupProgressionSnapshot,
  PhaseGroupSeedSnapshot,
  SetEntrantSource,
  SetSlot,
  SetSnapshot,
} from "./bracketProgression";
import { isResolvedEntrantName } from "./bracketProgression";

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

export function formatScoreValue(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function resolveEntrantDisplayName(
  entrantName: string,
  aliasName: string | null | undefined,
  useAliasName: boolean,
): string {
  const normalizedAlias = aliasName?.trim() ?? "";
  return useAliasName && normalizedAlias !== "" ? normalizedAlias : entrantName;
}

export function getBracketVerticalLayoutScale(zoomLevel: number): number {
  if (zoomLevel >= 0.9) {
    return 1;
  }
  if (zoomLevel >= 0.6) {
    return 0.72;
  }
  return 0.58;
}

export function scaleBracketSectionsForZoom(
  sections: BracketSectionForView[],
  scale: number,
): BracketSectionForView[] {
  return sections.map((section) => ({
    ...section,
    columns: section.columns.map((column) => ({
      ...column,
      height: column.height * scale,
      positionedSets: column.positionedSets.map((item) => ({
        ...item,
        y: item.y * scale,
      })),
    })),
  }));
}

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

export function buildSetDisplayCodeById(
  sections: BracketSectionForView[],
): Map<string, string> {
  const map = new Map<string, string>();
  const used = new Set<string>();
  const orderedSets: SetSnapshot[] = [];

  const orderedSections = [...sections].sort((left, right) => {
    const weight = (key: string): number => {
      if (key === "winners") {
        return 0;
      }
      if (key === "losers") {
        return 1;
      }
      return 2;
    };

    return weight(left.key) - weight(right.key);
  });

  for (const section of orderedSections) {
    for (const column of section.columns) {
      const setsInColumn = [...column.positionedSets].sort((left, right) => {
        const byY = left.y - right.y;
        if (Math.abs(byY) > 0.0001) {
          return byY;
        }
        return left.set.setId.localeCompare(right.set.setId, "ja");
      });

      for (const item of setsInColumn) {
        orderedSets.push(item.set);
      }
    }
  }

  for (const set of orderedSets) {
    const identifier = set.identifier?.trim();
    if (identifier) {
      map.set(set.setId, identifier);
    }
  }

  let fallbackIndex = 0;
  let gfSeen = false;
  let reservedAfterGf = false;
  for (const set of orderedSets) {
    if (map.has(set.setId)) {
      continue;
    }

    const currentIsLosers = isLosersBracketSet(set);
    const currentIsGf = isGrandFinalText(set.fullRoundText);
    const currentIsReset = isGrandFinalResetSet(set);

    if (currentIsLosers && gfSeen && reservedAfterGf && !currentIsReset) {
      fallbackIndex += 1;
      reservedAfterGf = false;
    }

    let code = formatAlphabetSequence(fallbackIndex);
    while (used.has(code)) {
      fallbackIndex += 1;
      code = formatAlphabetSequence(fallbackIndex);
    }

    map.set(set.setId, code);
    used.add(code);
    fallbackIndex += 1;

    if (currentIsGf) {
      gfSeen = true;
      reservedAfterGf = true;
    }

    if (currentIsReset) {
      reservedAfterGf = false;
    }
  }

  return map;
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

type DisplaySlotOptions = {
  fallbackBySlotIndex: number;
  finishedSet?: boolean;
  matchupReady?: boolean;
};

export function getDisplaySlotsForSet(
  set: SetSnapshot,
  options: {
    displayBySide: boolean;
    finishedSet?: boolean;
    matchupReady?: boolean;
    sideDrafts?: Record<string, "1P" | "2P" | "">;
    getSideLabel: (setId: string, entrantId: string | null, options: DisplaySlotOptions) => string;
  },
): Array<{ slot: SetSlot; slotIndex: number }> {
  const indexed = set.slots.map((slot, slotIndex) => ({ slot, slotIndex }));
  if (!options.displayBySide) {
    return indexed;
  }

  const sideRank = (label: string): number => {
    if (label === "1P") {
      return 0;
    }
    if (label === "2P") {
      return 2;
    }
    return 1;
  };

  return indexed
    .slice()
    .sort((left, right) => {
      const leftDraftSide = left.slot.entrantId ? (options.sideDrafts?.[left.slot.entrantId] ?? "") : "";
      const rightDraftSide = right.slot.entrantId ? (options.sideDrafts?.[right.slot.entrantId] ?? "") : "";
      const leftSide = options.getSideLabel(set.setId, left.slot.entrantId, {
        fallbackBySlotIndex: left.slotIndex,
        finishedSet: options.finishedSet,
        matchupReady: options.matchupReady,
      });
      const rightSide = options.getSideLabel(set.setId, right.slot.entrantId, {
        fallbackBySlotIndex: right.slotIndex,
        finishedSet: options.finishedSet,
        matchupReady: options.matchupReady,
      });

      const resolvedLeftSide = leftDraftSide !== "" ? leftDraftSide : leftSide;
      const resolvedRightSide = rightDraftSide !== "" ? rightDraftSide : rightSide;
      const bySide = sideRank(resolvedLeftSide) - sideRank(resolvedRightSide);
      return bySide !== 0 ? bySide : left.slotIndex - right.slotIndex;
    });
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

export function selectPhaseScopedPoolGroups(
  phasePoolGroups: PhasePoolGroup[],
  selectedPhaseName: string,
): PhasePoolGroup[] {
  if (phasePoolGroups.length === 0) {
    return [];
  }

  const phaseName = selectedPhaseName === "" ? phasePoolGroups[0].phaseName : selectedPhaseName;
  return phasePoolGroups.filter((group) => group.phaseName === phaseName);
}

export function resolveSelectedPhasePoolGroup(
  phaseScopedPoolGroups: PhasePoolGroup[],
  selectedPhasePoolKey: string,
): PhasePoolGroup | null {
  if (phaseScopedPoolGroups.length === 0) {
    return null;
  }

  if (selectedPhasePoolKey === "") {
    return phaseScopedPoolGroups[0];
  }

  return phaseScopedPoolGroups.find((group) => group.key === selectedPhasePoolKey)
    ?? phaseScopedPoolGroups[0];
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

export function buildTbdSourceLabelBySlotKey(
  sections: BracketSection[],
  setDisplayCodeById: Map<string, string>,
): Map<string, string> {
  const map = new Map<string, string>();
  const winnersSection = sections.find((section) => section.key === "winners") ?? null;
  const losersSection = sections.find((section) => section.key === "losers") ?? null;
  const winnersColumnsOrdered = winnersSection?.columns ?? [];
  const losersColumnsOrdered = losersSection?.columns ?? [];
  const winnersRoundOneIds = winnersColumnsOrdered[0]?.sets.map((set) => set.setId) ?? [];
  const losersRoundOne = losersColumnsOrdered[0];

  if (losersRoundOne && winnersRoundOneIds.length > 0) {
    losersRoundOne.sets.forEach((set, currentIndex) => {
      const sources = pickPairSourceIds(winnersRoundOneIds, losersRoundOne.sets.length, currentIndex)
        .map((setId) => setDisplayCodeById.get(setId))
        .filter((code): code is string => Boolean(code));

      sources.forEach((code, sourceIndex) => {
        map.set(`${set.setId}:${sourceIndex}`, normalizeSourceText("losers", code));
      });
    });
  }

  for (let columnIndex = 1; columnIndex < winnersColumnsOrdered.length; columnIndex += 1) {
    const previousColumn = winnersColumnsOrdered[columnIndex - 1];
    const currentColumn = winnersColumnsOrdered[columnIndex];
    const previousIds = previousColumn.sets.map((set) => set.setId);

    currentColumn.sets.forEach((set, currentIndex) => {
      const sources = pickPairSourceIds(previousIds, currentColumn.sets.length, currentIndex)
        .map((setId) => setDisplayCodeById.get(setId))
        .filter((code): code is string => Boolean(code));

      sources.forEach((code, sourceIndex) => {
        map.set(`${set.setId}:${sourceIndex}`, normalizeSourceText("winners", code));
      });
    });
  }

  const winnersColumnsByCount = new Map<number, string[][]>();
  for (const column of winnersColumnsOrdered) {
    const ids = column.sets.map((set) => set.setId);
    if (ids.length === 0) {
      continue;
    }
    const found = winnersColumnsByCount.get(ids.length);
    if (found) {
      found.push(ids);
    } else {
      winnersColumnsByCount.set(ids.length, [ids]);
    }
  }

  const winnersCountUseCursor = new Map<number, number>();
  for (let columnIndex = 1; columnIndex < losersColumnsOrdered.length; columnIndex += 1) {
    const previousColumn = losersColumnsOrdered[columnIndex - 1];
    const currentColumn = losersColumnsOrdered[columnIndex];
    const previousIds = previousColumn.sets.map((set) => set.setId);
    const currentCount = currentColumn.sets.length;

    if (currentCount <= 0) {
      continue;
    }

    if (previousIds.length === currentCount) {
      const candidateWinnersColumns = winnersColumnsByCount.get(currentCount) ?? [];
      const winnerCursor = winnersCountUseCursor.get(currentCount) ?? 0;
      const winnersSourceIds = candidateWinnersColumns[winnerCursor] ?? [];
      if (candidateWinnersColumns.length > winnerCursor) {
        winnersCountUseCursor.set(currentCount, winnerCursor + 1);
      }

      currentColumn.sets.forEach((set, currentIndex) => {
        const losersCode = setDisplayCodeById.get(previousIds[currentIndex]);
        if (losersCode) {
          map.set(`${set.setId}:0`, normalizeSourceText("winners", losersCode));
        }

        const winnersSourceId = winnersSourceIds[currentIndex];
        const winnersCode = winnersSourceId ? setDisplayCodeById.get(winnersSourceId) : undefined;
        if (winnersCode) {
          map.set(`${set.setId}:1`, normalizeSourceText("losers", winnersCode));
        }
      });
      continue;
    }

    currentColumn.sets.forEach((set, currentIndex) => {
      const sources = pickPairSourceIds(previousIds, currentCount, currentIndex)
        .map((setId) => setDisplayCodeById.get(setId))
        .filter((code): code is string => Boolean(code));
      sources.forEach((code, sourceIndex) => {
        map.set(`${set.setId}:${sourceIndex}`, normalizeSourceText("winners", code));
      });
    });
  }

  const winnersAllSets = winnersColumnsOrdered.flatMap((column) => column.sets);
  const losersAllSets = losersColumnsOrdered.flatMap((column) => column.sets);
  const winnersFinalSet = winnersAllSets.find((set) => isWinnersFinalText(set.fullRoundText))
    ?? winnersAllSets.filter((set) => !isGrandFinalText(set.fullRoundText)).slice(-1)[0];
  const losersFinalSet = losersAllSets.find((set) => isLosersFinalText(set.fullRoundText))
    ?? losersAllSets.slice(-1)[0];
  const winnersFinalCode = winnersFinalSet ? setDisplayCodeById.get(winnersFinalSet.setId) : undefined;
  const losersFinalCode = losersFinalSet ? setDisplayCodeById.get(losersFinalSet.setId) : undefined;

  if (winnersFinalCode || losersFinalCode) {
    for (const set of winnersAllSets) {
      if (!isGrandFinalText(set.fullRoundText)) {
        continue;
      }
      if (winnersFinalCode) {
        map.set(`${set.setId}:0`, normalizeSourceText("winners", winnersFinalCode));
      }
      if (losersFinalCode) {
        map.set(`${set.setId}:1`, normalizeSourceText("winners", losersFinalCode));
      }
    }
  }

  return map;
}

export function resolveTbdSourceLabel(
  set: SetSnapshot,
  slotIndex: number,
  slot: SetSlot,
  event: EventSnapshot | null,
  setDisplayCodeById: Map<string, string>,
  sourceLabelsBySlotKey: Map<string, string>,
): string | null {
  if (!isSlotTbd(slot)) {
    return null;
  }

  const source = slotIndex === 0 ? set.entrant1Source : set.entrant2Source;
  const resolveSource = (
    currentSource: SetEntrantSource | null | undefined,
    visited: Set<string>,
  ): string | null => {
    if (!currentSource) {
      return null;
    }
    const sourceSetId = currentSource.resolvedSetId ?? currentSource.typeId;
    const sourceSet = sourceSetId
      ? event?.sets.find((candidate) => candidate.setId === sourceSetId)
      : undefined;
    if (!sourceSetId || !sourceSet || visited.has(sourceSetId)) {
      return currentSource.placeholderName?.trim() || null;
    }

    const nextVisited = new Set(visited);
    nextVisited.add(sourceSetId);
    const sourceCondition = currentSource.condition?.trim().toLowerCase();
    if (sourceSet.winnerId && (sourceCondition === "winner" || sourceCondition === "loser")) {
      const resolvedSlot = sourceSet.slots.find((candidate) => {
        if (candidate.entrantId === null || !isResolvedEntrantName(candidate.entrantName)) {
          return false;
        }
        const isWinner = candidate.entrantId === sourceSet.winnerId;
        return sourceCondition === "winner" ? isWinner : !isWinner;
      });
      if (resolvedSlot) {
        return resolvedSlot.entrantName.trim();
      }
    }

    if (
      sourceSet.isIntermediate
      && !sourceSet.winnerId
      && sourceCondition !== "winner"
      && sourceCondition !== "loser"
    ) {
      const resolvedSlots = sourceSet.slots.filter(
        (candidate) => candidate.entrantId !== null && isResolvedEntrantName(candidate.entrantName),
      );
      if (resolvedSlots.length === 1) {
        return resolvedSlots[0].entrantName.trim();
      }
    }

    if (sourceSet.isIntermediate) {
      const nested = [sourceSet.entrant1Source, sourceSet.entrant2Source]
        .map((nestedSource) => resolveSource(nestedSource, nextVisited))
        .find((label): label is string => Boolean(label));
      if (nested) {
        return nested;
      }
    }

    const sourceSetCode = setDisplayCodeById.get(sourceSetId);
    if (currentSource.placeholderName?.trim()) {
      return currentSource.placeholderName.trim();
    }
    if (sourceSetCode && (sourceCondition === "winner" || sourceCondition === "loser")) {
      return normalizeSourceText(sourceCondition === "winner" ? "winners" : "losers", sourceSetCode);
    }
    return null;
  };

  const resolvedSourceLabel = resolveSource(source, new Set<string>());
  if (resolvedSourceLabel) {
    return resolvedSourceLabel;
  }

  const own = sourceLabelsBySlotKey.get(`${set.setId}:${slotIndex}`);
  if (own) {
    return own;
  }

  const conditionString = source?.conditionString?.trim();
  if (conditionString) {
    return conditionString;
  }

  if (set.slots.length === 2) {
    const other = sourceLabelsBySlotKey.get(`${set.setId}:${slotIndex === 0 ? 1 : 0}`);
    if (other) {
      return other;
    }
  }

  return null;
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