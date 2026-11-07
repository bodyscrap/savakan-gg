import type { SetSnapshot } from "./bracketProgression";

export type RoundColumn = {
  key: string;
  title: string;
  round: number | null;
  seq: number;
  sets: SetSnapshot[];
};

type PositionedSet = {
  set: SetSnapshot;
  y: number;
};

export type PositionedRoundColumn = {
  key: string;
  title: string;
  round: number | null;
  positionedSets: PositionedSet[];
  height: number;
  hidden: boolean;
};

const BRACKET_TOP_PADDING = 10;
const BRACKET_BOTTOM_PADDING = 16;
const BRACKET_ROW_STEP = 106;
const BRACKET_SET_CARD_HEIGHT = 80;

function clampIndex(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function sourceSetIdsForSet(set: SetSnapshot): string[] {
  return [set.entrant1Source, set.entrant2Source]
    .filter((source) => source && (
      source.sourceType?.toLowerCase() === "set"
      || source.resolvedSetId
      || source.condition === "winner"
      || source.condition === "loser"
    ))
    .map((source) => source?.resolvedSetId ?? source?.typeId)
    .filter((setId): setId is string => Boolean(setId && setId.trim() !== ""));
}

function setsConnected(left: SetSnapshot, right: SetSnapshot): boolean {
  return sourceSetIdsForSet(left).includes(right.setId)
    || sourceSetIdsForSet(right).includes(left.setId)
    || left.slots.some((slot) => slot.entrantId !== null
      && right.slots.some((other) => other.entrantId === slot.entrantId));
}

function incomingWinnersLoserSourceOrder(
  set: SetSnapshot,
  winnersSourceOrder: Map<string, number>,
): number | null {
  const sources = [set.entrant1Source, set.entrant2Source];
  const positions = sources.flatMap((source) => {
    if (source?.condition?.toLowerCase() !== "loser") {
      return [];
    }

    const sourceSetId = source.resolvedSetId ?? source.typeId;
    const order = sourceSetId ? winnersSourceOrder.get(sourceSetId) : undefined;
    return order === undefined ? [] : [order];
  });

  return positions.length > 0
    ? positions.reduce((sum, position) => sum + position, 0) / positions.length
    : null;
}

function buildExpandedLaneIndexes(previousCount: number, currentCount: number): number[] {
  if (previousCount <= 0 || currentCount <= 0) {
    return [];
  }

  const result: number[] = [];
  let last = -1;

  for (let previousIndex = 0; previousIndex < previousCount; previousIndex += 1) {
    const raw = Math.floor(((previousIndex + 0.5) * currentCount) / previousCount);
    const remaining = previousCount - previousIndex - 1;
    const minAllowed = last + 1;
    const maxAllowed = currentCount - 1 - remaining;
    const laneIndex = clampIndex(raw, minAllowed, maxAllowed);
    result.push(laneIndex);
    last = laneIndex;
  }

  return result;
}

function buildFirstWinnersColumnPositions(setCount: number, nextCount: number): number[] {
  const laneIndexes = buildExpandedLaneIndexes(setCount, nextCount);
  if (laneIndexes.length !== setCount) {
    return Array.from({ length: setCount }, (_, index) => BRACKET_TOP_PADDING + index * BRACKET_ROW_STEP);
  }

  return laneIndexes.map((laneIndex) => BRACKET_TOP_PADDING + laneIndex * BRACKET_ROW_STEP);
}

function buildLosersRoundPositions(
  previousColumnSets: SetSnapshot[],
  previousPositions: number[],
  currentColumnSets: SetSnapshot[],
): number[] {
  const previousCount = previousPositions.length;
  const currentCount = currentColumnSets.length;

  if (previousCount === 0 || currentCount === 0) {
    return [];
  }

  const fallback =
    previousCount === currentCount * 2
      ? averagePairPositions(previousPositions, currentCount)
      : interpolateLanePositions(previousPositions, currentCount);

  const previousSetIndexByEntrantId = new Map<string, number>();
  const previousSetIndexBySetId = new Map<string, number>();
  previousColumnSets.forEach((set, setIndex) => {
    previousSetIndexBySetId.set(set.setId, setIndex);
    set.slots.forEach((slot) => {
      if (!slot.entrantId) {
        return;
      }
      if (!previousSetIndexByEntrantId.has(slot.entrantId)) {
        previousSetIndexByEntrantId.set(slot.entrantId, setIndex);
      }
    });
  });

  return currentColumnSets.map((set, currentIndex) => {
    const sourceIndexes = Array.from(new Set([
      ...sourceSetIdsForSet(set).map((sourceSetId) => previousSetIndexBySetId.get(sourceSetId)),
      ...set.slots.map((slot) => (
        slot.entrantId ? previousSetIndexByEntrantId.get(slot.entrantId) : undefined
      )),
    ].filter((value): value is number => value !== undefined))).sort((left, right) => left - right);

    if (sourceIndexes.length >= 2) {
      const first = sourceIndexes[0];
      const second = sourceIndexes[1];
      return (previousPositions[first] + previousPositions[second]) / 2;
    }

    if (sourceIndexes.length === 1) {
      return previousPositions[sourceIndexes[0]] ?? fallback[currentIndex] ?? (BRACKET_TOP_PADDING + currentIndex * BRACKET_ROW_STEP);
    }

    return fallback[currentIndex] ?? (BRACKET_TOP_PADDING + currentIndex * BRACKET_ROW_STEP);
  });
}

function buildPreviousLosersRoundPositions(
  previousColumnSets: SetSnapshot[],
  currentColumnSets: SetSnapshot[],
  currentPositions: number[],
): number[] {
  if (previousColumnSets.length === 0 || currentPositions.length === 0) {
    return [];
  }

  const previousSetIndexByEntrantId = new Map<string, number>();
  const previousSetIndexBySetId = new Map<string, number>();
  previousColumnSets.forEach((set, setIndex) => {
    previousSetIndexBySetId.set(set.setId, setIndex);
    set.slots.forEach((slot) => {
      if (slot.entrantId && !previousSetIndexByEntrantId.has(slot.entrantId)) {
        previousSetIndexByEntrantId.set(slot.entrantId, setIndex);
      }
    });
  });

  const currentIndexesByPreviousIndex = previousColumnSets.map(() => [] as number[]);
  currentColumnSets.forEach((set, currentIndex) => {
    const previousIndexes = new Set([
      ...sourceSetIdsForSet(set).map((sourceSetId) => previousSetIndexBySetId.get(sourceSetId)),
      ...set.slots.map((slot) => (
        slot.entrantId ? previousSetIndexByEntrantId.get(slot.entrantId) : undefined
      )),
    ].filter((value): value is number => value !== undefined));

    for (const previousIndex of previousIndexes) {
      currentIndexesByPreviousIndex[previousIndex]?.push(currentIndex);
    }
  });

  const fallback = interpolateLanePositions(currentPositions, previousColumnSets.length);
  return previousColumnSets.map((_, previousIndex) => {
    const currentIndexes = currentIndexesByPreviousIndex[previousIndex] ?? [];
    if (currentIndexes.length === 0) {
      return fallback[previousIndex] ?? (BRACKET_TOP_PADDING + previousIndex * BRACKET_ROW_STEP);
    }

    return currentIndexes.reduce((sum, currentIndex) => (
      sum + currentPositions[currentIndex]
    ), 0) / currentIndexes.length;
  });
}

function buildPreviousRoundPositions(
  previousColumnSets: SetSnapshot[],
  currentColumnSets: SetSnapshot[],
  currentPositions: number[],
): number[] {
  const previousSetIndexById = new Map(previousColumnSets.map((set, index) => [set.setId, index]));
  const successorPositions = previousColumnSets.map(() => [] as number[]);
  currentColumnSets.forEach((set, index) => {
    const position = currentPositions[index];
    if (position === undefined) return;
    for (const sourceSetId of sourceSetIdsForSet(set)) {
      const previousIndex = previousSetIndexById.get(sourceSetId);
      if (previousIndex !== undefined) successorPositions[previousIndex].push(position);
    }
  });
  const fallback = interpolateLanePositions(currentPositions, previousColumnSets.length);
  return successorPositions.map((positions, index) => {
    if (positions.length === 0) return fallback[index] ?? (BRACKET_TOP_PADDING + index * BRACKET_ROW_STEP);
    return positions.reduce((sum, position) => sum + position, 0) / positions.length;
  });
}

function buildPositionsFromPreviousRounds(
  currentColumnSets: SetSnapshot[],
  previousRounds: Array<{ sets: SetSnapshot[]; positions: number[] }>,
): Array<number | null> {
  const positionBySetId = new Map<string, number>();
  const positionByEntrantId = new Map<string, { setId: string; position: number }>();
  previousRounds.forEach(({ sets, positions }) => sets.forEach((set, index) => {
    const position = positions[index];
    if (position === undefined) return;
    positionBySetId.set(set.setId, position);
    set.slots.forEach((slot) => {
      if (slot.entrantId && !positionByEntrantId.has(slot.entrantId)) {
        positionByEntrantId.set(slot.entrantId, { setId: set.setId, position });
      }
    });
  }));

  return currentColumnSets.map((set) => {
    const sourcePositions: number[] = [];
    const sourceSetIds = new Set(sourceSetIdsForSet(set));
    for (const sourceSetId of sourceSetIds) {
      const position = positionBySetId.get(sourceSetId);
      if (position !== undefined) sourcePositions.push(position);
    }
    for (const slot of set.slots) {
      if (!slot.entrantId) continue;
      const position = positionByEntrantId.get(slot.entrantId);
      if (position && !sourceSetIds.has(position.setId)) sourcePositions.push(position.position);
    }
    if (sourcePositions.length >= 2) return (sourcePositions[0] + sourcePositions[1]) / 2;
    return sourcePositions[0] ?? null;
  });
}

function buildWinnersExpandedRoundPositions(
  previousColumnSets: SetSnapshot[],
  previousPositions: number[],
  currentColumnSets: SetSnapshot[],
): number[] {
  const previousCount = previousPositions.length;
  const currentCount = currentColumnSets.length;

  if (previousCount === 0 || currentCount === 0) {
    return [];
  }

  const baseInterpolated = interpolateLanePositions(previousPositions, currentCount);
  const expandedLaneIndexes = buildExpandedLaneIndexes(previousCount, currentCount);
  const laneYByIndex = Array.from(
    { length: currentCount },
    (_, laneIndex) => BRACKET_TOP_PADDING + laneIndex * BRACKET_ROW_STEP,
  );

  const pickNearestFreeLane = (
    preferredLane: number,
    occupiedLanes: Set<number>,
  ): number | null => {
    if (!occupiedLanes.has(preferredLane)) {
      return preferredLane;
    }

    for (let radius = 1; radius < currentCount; radius += 1) {
      const left = preferredLane - radius;
      if (left >= 0 && !occupiedLanes.has(left)) {
        return left;
      }

      const right = preferredLane + radius;
      if (right < currentCount && !occupiedLanes.has(right)) {
        return right;
      }
    }

    return null;
  };

  const previousSetIndexByEntrantId = new Map<string, number>();
  const previousSetIndexBySetId = new Map<string, number>();

  previousColumnSets.forEach((set, setIndex) => {
    previousSetIndexBySetId.set(set.setId, setIndex);
    set.slots.forEach((slot) => {
      if (!slot.entrantId) {
        return;
      }
      if (!previousSetIndexByEntrantId.has(slot.entrantId)) {
        previousSetIndexByEntrantId.set(slot.entrantId, setIndex);
      }
    });
  });

  const occupiedLanes = new Set<number>();

  const rawPositions = currentColumnSets.map((set, currentIndex) => {
    const mapped = ((currentIndex + 0.5) * previousCount) / currentCount - 0.5;
    const mappedLeft = clampIndex(Math.floor(mapped), 0, previousCount - 1);
    let mappedRight = clampIndex(Math.ceil(mapped), 0, previousCount - 1);

    if (mappedLeft === mappedRight && previousCount > 1) {
      mappedRight = mappedLeft < previousCount - 1 ? mappedLeft + 1 : mappedLeft - 1;
    }

    const sourceIndexes = Array.from(new Set([
      ...sourceSetIdsForSet(set).map((sourceSetId) => previousSetIndexBySetId.get(sourceSetId)),
      ...set.slots.map((slot) => (
        slot.entrantId ? previousSetIndexByEntrantId.get(slot.entrantId) : undefined
      )),
    ].filter((value): value is number => value !== undefined))).sort((left, right) => left - right);

    const unresolvedSlotCount = set.slots.filter((slot) => slot.entrantId === null).length;

    if (sourceIndexes.length >= 2) {
      const first = sourceIndexes[0];
      const second = sourceIndexes[1];
      return (previousPositions[first] + previousPositions[second]) / 2;
    }

    if (sourceIndexes.length === 1) {
      return previousPositions[sourceIndexes[0]] ?? baseInterpolated[currentIndex] ?? (BRACKET_TOP_PADDING + currentIndex * BRACKET_ROW_STEP);
    }

    if (unresolvedSlotCount >= 2 && previousCount > 1) {
      return (previousPositions[mappedLeft] + previousPositions[mappedRight]) / 2;
    }

    if (unresolvedSlotCount === 1) {
      const anchor = clampIndex(Math.round(mapped), 0, previousCount - 1);
      const anchorLane = expandedLaneIndexes[anchor] ?? anchor;
      occupiedLanes.add(anchorLane);
      return previousPositions[anchor];
    }

    if (unresolvedSlotCount === 0) {
      const preferredLane = clampIndex(currentIndex, 0, currentCount - 1);
      const selectedLane = pickNearestFreeLane(preferredLane, occupiedLanes);
      if (selectedLane !== null) {
        occupiedLanes.add(selectedLane);
        return laneYByIndex[selectedLane] ?? (BRACKET_TOP_PADDING + selectedLane * BRACKET_ROW_STEP);
      }
      return baseInterpolated[currentIndex] ?? (BRACKET_TOP_PADDING + currentIndex * BRACKET_ROW_STEP);
    }

    return baseInterpolated[currentIndex] ?? (BRACKET_TOP_PADDING + currentIndex * BRACKET_ROW_STEP);
  });

  return rawPositions;
}

function interpolateLanePositions(previousPositions: number[], nextCount: number): number[] {
  if (nextCount <= 0) {
    return [];
  }

  if (previousPositions.length === 0) {
    return Array.from({ length: nextCount }, (_, index) => BRACKET_TOP_PADDING + index * BRACKET_ROW_STEP);
  }

  if (previousPositions.length === 1) {
    const center = previousPositions[0];
    return Array.from(
      { length: nextCount },
      (_, index) => center + (index - (nextCount - 1) / 2) * BRACKET_ROW_STEP,
    );
  }

  return Array.from({ length: nextCount }, (_, index) => {
    const mapped = ((index + 0.5) * previousPositions.length) / nextCount - 0.5;
    const left = Math.max(0, Math.floor(mapped));
    const right = Math.min(previousPositions.length - 1, Math.ceil(mapped));

    if (left === right) {
      return previousPositions[left];
    }

    const ratio = mapped - left;
    return previousPositions[left] + (previousPositions[right] - previousPositions[left]) * ratio;
  });
}

function averagePairPositions(previousPositions: number[], nextCount: number): number[] {
  return Array.from({ length: nextCount }, (_, index) => {
    const first = previousPositions[index * 2];
    const second = previousPositions[index * 2 + 1];

    if (first !== undefined && second !== undefined) {
      return (first + second) / 2;
    }

    if (first !== undefined) {
      return first;
    }

    if (second !== undefined) {
      return second;
    }

    return BRACKET_TOP_PADDING + index * BRACKET_ROW_STEP;
  });
}

function fitPositionsToAvailableLanes(
  positions: number[],
  laneCount: number,
  anchored: boolean[],
): number[] {
  if (positions.length <= 1 || positions.length > laneCount) {
    return positions;
  }

  const sortedPositions = positions.slice().sort((left, right) => left - right);
  if (sortedPositions.every((position, index) => index === 0
    || position - sortedPositions[index - 1] >= BRACKET_ROW_STEP)) {
    return positions;
  }

  const fitted = [...positions];
  const occupied = positions.filter((_, index) => anchored[index]);
  const unanchoredIndexes = positions.map((_, index) => index).filter((index) => !anchored[index])
    .sort((left, right) => positions[left] - positions[right] || left - right);
  for (const index of unanchoredIndexes) {
    const candidates = Array.from({ length: laneCount }, (_, lane) => BRACKET_TOP_PADDING + lane * BRACKET_ROW_STEP)
      .sort((left, right) => Math.abs(left - positions[index]) - Math.abs(right - positions[index]));
    const selected = candidates.find((candidate) => occupied.every((position) => (
      Math.abs(candidate - position) >= BRACKET_ROW_STEP
    )));
    if (selected === undefined) continue;
    fitted[index] = selected;
    occupied.push(selected);
  }
  return fitted;
}

export function buildPositionedRoundColumns(
  columns: RoundColumn[],
  sectionKey: string,
  winnersSourceOrder = new Map<string, number>(),
): PositionedRoundColumn[] {
  const displayOrder = new Map(columns.map((column, index) => [column.key, index]));
  if (sectionKey === "losers") {
    columns = [...columns].sort((left, right) => (right.round ?? 0) - (left.round ?? 0));
  }
  const positionedColumns: Array<PositionedRoundColumn | null> = Array.from(
    { length: columns.length },
    () => null,
  );
  const resolvedPositions: number[][] = Array.from({ length: columns.length }, () => []);
  const maxSetCount = Math.max(0, ...columns.map((column) => column.sets.length));
  const maxSetCountIndexes = columns
    .map((column, index) => ({ column, index }))
    .filter(({ column }) => column.sets.length === maxSetCount && column.sets.length > 0);
  const maxSetCountIndex = maxSetCountIndexes[0]?.index ?? -1;
  const winnersMergeOrderByColumn = new Map<number, number>();
  if (sectionKey === "losers") {
    let mergeIndex = 0;
    columns.forEach((column, columnIndex) => {
      if (column.sets.some((set) => [set.entrant1Source, set.entrant2Source]
        .some((source) => source?.condition?.toLowerCase() === "loser"))) {
        const round = Math.abs(column.round ?? 0);
        const roundMergeIndex = round === 1
          ? 0
          : round >= 2 && round % 2 === 0
            ? round / 2
            : mergeIndex;
        winnersMergeOrderByColumn.set(columnIndex, roundMergeIndex);
        mergeIndex += 1;
      }
    });
  }

  const applyWinnersMergeOrder = (columnIndex: number, positions: number[]): number[] => {
    const mergeIndex = winnersMergeOrderByColumn.get(columnIndex);
    const column = columns[columnIndex];
    if (mergeIndex === undefined || !column || positions.length !== column.sets.length) {
      return positions;
    }
    if (column.round === -2) {
      return positions;
    }
    const previousLosersSetIds = new Set(
      columns[columnIndex - 1]?.sets.map((set) => set.setId) ?? [],
    );
    if (column.sets.some((set) => [set.entrant1Source, set.entrant2Source].some((source) => {
      if (source?.condition?.toLowerCase() !== "winner") {
        return false;
      }

      const sourceSetId = source.resolvedSetId ?? source.typeId;
      return sourceSetId != null && previousLosersSetIds.has(sourceSetId);
    }))) {
      return positions;
    }

    const mergeSetIndexes = column.sets
      .map((set, index) => ({
        index,
        sourceOrder: incomingWinnersLoserSourceOrder(set, winnersSourceOrder),
      }))
      .filter((item): item is { index: number; sourceOrder: number } => item.sourceOrder !== null)
      .sort((left, right) => left.sourceOrder - right.sourceOrder || left.index - right.index);
    const mergeLanes = mergeSetIndexes
      .map(({ index }) => positions[index])
      .filter((position): position is number => position !== undefined)
      .sort((left, right) => left - right);

    if (mergeSetIndexes.length < 2 || mergeLanes.length !== mergeSetIndexes.length) {
      return positions;
    }

    const orderedLanes = mergeIndex % 2 === 0 ? mergeLanes : mergeLanes.reverse();
    const adjusted = [...positions];
    mergeSetIndexes.forEach(({ index }, mergeSetIndex) => {
      adjusted[index] = orderedLanes[mergeSetIndex]!;
    });
    return adjusted;
  };

  const assignDefaultPositions = (columnIndex: number): number[] => {
    const column = columns[columnIndex];
    if (!column || column.sets.length === 0) {
      return [];
    }

    const nextColumn = columns[columnIndex + 1];
    const nextCount = nextColumn?.sets.length ?? 0;
    const defaultPositions =
      sectionKey === "winners" && columnIndex === 0 && nextCount > column.sets.length
        ? buildFirstWinnersColumnPositions(column.sets.length, nextCount)
        : Array.from(
          { length: column.sets.length },
          (_, index) => BRACKET_TOP_PADDING + index * BRACKET_ROW_STEP,
        );

    const orderedPositions = applyWinnersMergeOrder(columnIndex, defaultPositions);
    resolvedPositions[columnIndex] = orderedPositions;
    return orderedPositions;
  };

  if (maxSetCountIndex >= 0) {
    assignDefaultPositions(maxSetCountIndex);
  }

  for (let columnIndex = maxSetCountIndex - 1; columnIndex >= 0; columnIndex -= 1) {
    const column = columns[columnIndex];
    const nextColumn = columns[columnIndex + 1];
    if (!column || column.sets.length === 0 || !nextColumn || nextColumn.sets.length === 0) {
      if (resolvedPositions[columnIndex].length === 0) {
        assignDefaultPositions(columnIndex);
      }
      continue;
    }

    const referencePositions = resolvedPositions[columnIndex + 1];
    const isReverseRoundOne = sectionKey === "winners"
      ? column.round === 1 && nextColumn.round === 2
      : column.round === -1 && nextColumn.round === -2;
    const lanePositions = isReverseRoundOne
      ? buildPreviousRoundPositions(column.sets, nextColumn.sets, referencePositions)
      : sectionKey === "losers"
        ? buildPreviousLosersRoundPositions(column.sets, nextColumn.sets, referencePositions)
        : buildWinnersExpandedRoundPositions(nextColumn.sets, referencePositions, column.sets);

    const anchoredPositions = column.sets.map((set) => nextColumn.sets.some((nextSet) => setsConnected(set, nextSet)));
    const adjustedPositions = sectionKey === "losers" && nextColumn.round !== -2
      ? fitPositionsToAvailableLanes(lanePositions, maxSetCount, anchoredPositions)
      : lanePositions;
    const positions = adjustedPositions.length > 0
      ? adjustedPositions
      : assignDefaultPositions(columnIndex);
    if (adjustedPositions.length > 0) {
      resolvedPositions[columnIndex] = applyWinnersMergeOrder(columnIndex, positions);
    }
  }

  for (let columnIndex = maxSetCountIndex + 1; columnIndex < columns.length; columnIndex += 1) {
    const previousColumn = columns[columnIndex - 1];
    const column = columns[columnIndex];
    if (!column || column.sets.length === 0) {
      continue;
    }

    const previousPositions = resolvedPositions[columnIndex - 1];
    const fallbackPositions =
      previousColumn && previousColumn.sets.length > 0
        ? sectionKey === "losers"
          ? buildLosersRoundPositions(previousColumn.sets, previousPositions, column.sets)
          : buildWinnersExpandedRoundPositions(previousColumn.sets, previousPositions, column.sets)
        : assignDefaultPositions(columnIndex);
    const sourcePositions = buildPositionsFromPreviousRounds(
      column.sets,
      columns.slice(0, columnIndex).map((previous, index) => ({
        sets: previous.sets,
        positions: resolvedPositions[index],
      })),
    );
    const lanePositions = fallbackPositions.map((position, index) => sourcePositions[index] ?? position);

    if (lanePositions.length > 0) {
      const anchoredPositions = sourcePositions.map((position) => position !== null);
      const positions = sectionKey === "losers"
        ? fitPositionsToAvailableLanes(lanePositions, maxSetCount, anchoredPositions)
        : lanePositions;
      resolvedPositions[columnIndex] = applyWinnersMergeOrder(columnIndex, positions);
    } else {
      assignDefaultPositions(columnIndex);
    }
  }

  for (let columnIndex = 0; columnIndex < columns.length; columnIndex += 1) {
    const column = columns[columnIndex];
    if (!column) {
      continue;
    }

    if (column.sets.length === 0) {
      positionedColumns[columnIndex] = {
        key: column.key,
        title: column.title,
        round: column.round,
        positionedSets: [],
        height: BRACKET_TOP_PADDING + BRACKET_SET_CARD_HEIGHT + BRACKET_BOTTOM_PADDING,
        hidden: false,
      };
      continue;
    }

    const lanePositions = resolvedPositions[columnIndex];
    const positionedSets = column.sets.map((set, index) => ({
      set,
      y: lanePositions[index] ?? (BRACKET_TOP_PADDING + index * BRACKET_ROW_STEP),
    }));

    const maxTop = positionedSets.reduce((max, item) => Math.max(max, item.y), BRACKET_TOP_PADDING);
    const height = Math.max(
      BRACKET_TOP_PADDING + BRACKET_SET_CARD_HEIGHT + BRACKET_BOTTOM_PADDING,
      maxTop + BRACKET_SET_CARD_HEIGHT + BRACKET_BOTTOM_PADDING,
    );

    positionedColumns[columnIndex] = {
      key: column.key,
      title: column.title,
      round: column.round,
      positionedSets,
      height,
      hidden: false,
    };
  }

  return positionedColumns
    .filter((item): item is PositionedRoundColumn => item !== null)
    .sort((left, right) => displayOrder.get(left.key)! - displayOrder.get(right.key)!);
}