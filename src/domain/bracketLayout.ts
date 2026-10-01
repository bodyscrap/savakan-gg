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
  return [
    set.entrant1Source?.resolvedSetId ?? set.entrant1Source?.typeId,
    set.entrant2Source?.resolvedSetId ?? set.entrant2Source?.typeId,
  ].filter((setId): setId is string => Boolean(setId && setId.trim() !== ""));
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

export function buildPositionedRoundColumns(
  columns: RoundColumn[],
  sectionKey: string,
): PositionedRoundColumn[] {
  const positionedColumns: Array<PositionedRoundColumn | null> = Array.from(
    { length: columns.length },
    () => null,
  );
  const resolvedPositions: number[][] = Array.from({ length: columns.length }, () => []);
  const maxSetCount = Math.max(0, ...columns.map((column) => column.sets.length));
  const maxSetCountIndex = columns.findIndex((column) => column.sets.length === maxSetCount && column.sets.length > 0);

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

    resolvedPositions[columnIndex] = defaultPositions;
    return defaultPositions;
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
    const lanePositions =
      sectionKey === "losers"
        ? buildLosersRoundPositions(nextColumn.sets, referencePositions, column.sets)
        : buildWinnersExpandedRoundPositions(nextColumn.sets, referencePositions, column.sets);

    resolvedPositions[columnIndex] = lanePositions.length > 0 ? lanePositions : assignDefaultPositions(columnIndex);
  }

  for (let columnIndex = maxSetCountIndex + 1; columnIndex < columns.length; columnIndex += 1) {
    const previousColumn = columns[columnIndex - 1];
    const column = columns[columnIndex];
    if (!column || column.sets.length === 0) {
      continue;
    }

    const previousPositions = resolvedPositions[columnIndex - 1];
    const lanePositions =
      previousColumn && previousColumn.sets.length > 0
        ? sectionKey === "losers"
          ? buildLosersRoundPositions(previousColumn.sets, previousPositions, column.sets)
          : buildWinnersExpandedRoundPositions(previousColumn.sets, previousPositions, column.sets)
        : assignDefaultPositions(columnIndex);

    resolvedPositions[columnIndex] = lanePositions.length > 0 ? lanePositions : assignDefaultPositions(columnIndex);
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

  return positionedColumns.filter((item): item is PositionedRoundColumn => item !== null);
}