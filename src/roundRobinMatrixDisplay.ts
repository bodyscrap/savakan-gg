import type { LocalSetResultMeta } from "./useTournamentWorkspace";
import type { PhaseGroupSnapshot } from "./bracketDisplay";
import type {
  RoundRobinStanding,
  RoundRobinTieBreakRule,
  PhaseGroupSeedSnapshot,
  SetEntrantSource,
  SetSlot,
  SetSnapshot,
} from "./bracketProgression";
import type { RoundRobinMatrixRowView } from "./RoundRobinMatrix";
import {
  getPendingSetChangeClass,
  getSetResultVisualStatus,
  getSetScoresForDisplay,
} from "./setResultDrafts";
import type { SetScoreDraft } from "./useSetResultDrafts";
import type { ObsOverlayState } from "./useObsOverlay";

export type RoundRobinBoardData = {
  entrants: string[];
  entrantNames: Map<string, string>;
  entrantIdsByColumnKey: Map<string, string | null>;
  entrantSeedIds: Map<string, string>;
  entrantSeedNumbers: Map<string, number>;
  sourceDiagnostics: string[];
  setsByPair: Map<string, SetSnapshot>;
  candidateSetCount: number;
  twoSlotSetCount: number;
  resolvedSetCount: number;
  registeredSetCount: number;
  unresolvedSetIds: string[];
  unresolvedSetReasons: string[];
  standings: RoundRobinStanding[];
  qualifyingCount: number;
  tieBreakRules: RoundRobinTieBreakRule[];
};

export type RoundRobinSeedIndexes = {
  byId: Map<string, PhaseGroupSeedSnapshot>;
  byNum: Map<number, PhaseGroupSeedSnapshot>;
  byOriginPlacement: Map<number, PhaseGroupSeedSnapshot>;
  seedIdByEntrantId: Map<string, string>;
  orderedSeeds: PhaseGroupSeedSnapshot[];
};

export function buildRoundRobinSeedIndexes(seeds: PhaseGroupSeedSnapshot[]): RoundRobinSeedIndexes {
  const byId = new Map(
    seeds.filter((seed) => Boolean(seed.seedId)).map((seed) => [seed.seedId, seed]),
  );
  const byNum = new Map(
    seeds
      .filter((seed) => seed.seedNum !== null && seed.seedNum !== undefined)
      .map((seed) => [seed.seedNum as number, seed]),
  );
  const byOriginPlacement = new Map(
    seeds
      .filter((seed) => seed.originPlacement !== null && seed.originPlacement !== undefined)
      .map((seed) => [seed.originPlacement as number, seed]),
  );
  const seedIdByEntrantId = new Map(
    seeds
      .filter((seed) => Boolean(seed.seedId && seed.entrantId))
      .map((seed) => [seed.entrantId as string, seed.seedId]),
  );
  const orderedSeeds = [...seeds]
    .filter((seed) => Boolean(seed.seedId))
    .sort((left, right) => {
      if (left.seedNum !== null && left.seedNum !== undefined
        && right.seedNum !== null && right.seedNum !== undefined
        && left.seedNum !== right.seedNum) {
        return left.seedNum - right.seedNum;
      }
      if (left.seedNum !== null && left.seedNum !== undefined) {
        return -1;
      }
      if (right.seedNum !== null && right.seedNum !== undefined) {
        return 1;
      }
      return left.seedId.localeCompare(right.seedId);
    });

  return { byId, byNum, byOriginPlacement, seedIdByEntrantId, orderedSeeds };
}

export function findRoundRobinPhaseGroupSeed(
  slot: SetSlot,
  source: SetEntrantSource | null | undefined,
  indexes: Pick<RoundRobinSeedIndexes, "byId" | "byNum" | "byOriginPlacement">,
): PhaseGroupSeedSnapshot | undefined {
  return (slot.seedId ? indexes.byId.get(slot.seedId) : undefined)
    ?? (slot.seedNum !== null ? indexes.byNum.get(slot.seedNum) : undefined)
    ?? (source?.seedNum !== null && source?.seedNum !== undefined
      ? indexes.byNum.get(source.seedNum)
      : undefined)
    ?? (source?.groupSeedNum !== null && source?.groupSeedNum !== undefined
      ? indexes.byNum.get(source.groupSeedNum)
      : undefined)
    ?? (source?.placement !== null && source?.placement !== undefined
      ? indexes.byOriginPlacement.get(source.placement)
      : undefined);
}

export type RoundRobinSeedColumns = {
  fixedEntrants: string[];
  entrantNames: Map<string, string>;
  entrantIdsByColumnKey: Map<string, string | null>;
  entrantSeedIds: Map<string, string>;
  entrantSeedNumbers: Map<string, number>;
  standingByEntrantId: Map<string, RoundRobinStanding>;
};

export type RoundRobinResolvedSlot = {
  entrantId: string;
  entrantName: string;
  isPlaceholder: boolean;
  seedId?: string | null;
  seedNum?: number | null;
  originPlacement?: number | null;
  originDisplayIdentifier?: string | null;
  originOrder?: number | null;
};

export function buildRoundRobinSeedColumns(
  seeds: PhaseGroupSeedSnapshot[],
  seedSlotById: Map<string, SetSlot>,
): RoundRobinSeedColumns {
  const fixedEntrants: string[] = [];
  const entrantNames = new Map<string, string>();
  const entrantIdsByColumnKey = new Map<string, string | null>();
  const entrantSeedIds = new Map<string, string>();
  const entrantSeedNumbers = new Map<string, number>();
  const standingByEntrantId = new Map<string, RoundRobinStanding>();

  for (const seed of seeds) {
    const columnKey = `seed:${seed.seedId}`;
    fixedEntrants.push(columnKey);
    entrantIdsByColumnKey.set(columnKey, seed.entrantId ?? null);
    if (seed.entrantId) {
      entrantSeedIds.set(seed.entrantId, seed.seedId);
      if (seed.seedNum !== null && seed.seedNum !== undefined) {
        entrantSeedNumbers.set(seed.entrantId, seed.seedNum);
      }
    }
    if (seed.entrantId && seed.entrantName?.trim()) {
      entrantNames.set(columnKey, seed.entrantName.trim());
    } else {
      entrantNames.set(
        columnKey,
        seed.placeholderName?.trim()
          || seedSlotById.get(seed.seedId)?.seedPlaceholderName?.trim()
          || seed.entrantName?.trim()
          || "TBD",
      );
    }
  }

  for (const seed of seeds) {
    if (!seed.entrantId || standingByEntrantId.has(seed.entrantId)) {
      continue;
    }
    standingByEntrantId.set(seed.entrantId, {
      entrantId: seed.entrantId,
      entrantName: seed.entrantName?.trim() || seed.entrantId,
      isPlaceholder: false,
      wins: 0,
      losses: 0,
      gameWins: 0,
      gameLosses: 0,
      h2hPoints: 0,
      qualified: false,
    });
  }

  return {
    fixedEntrants,
    entrantNames,
    entrantIdsByColumnKey,
    entrantSeedIds,
    entrantSeedNumbers,
    standingByEntrantId,
  };
}

export function buildRoundRobinProgressionSeeds(sets: SetSnapshot[]): Map<string, RoundRobinResolvedSlot> {
  const progressionSeedById = new Map<string, RoundRobinResolvedSlot>();
  for (const set of sets) {
    const progressionSeeds = [
      {
        seedId: set.winnerProgressionSeedId,
        placeholderName: set.winnerProgressionSeedPlaceholderName,
        originDisplayIdentifier: set.winnerProgressionOriginPhaseGroupDisplayIdentifier,
        originPhaseOrder: set.winnerProgressionOriginPhaseOrder,
        originPlacement: set.winnerProgressionOriginPlacement,
      },
      {
        seedId: set.loserProgressionSeedId,
        placeholderName: set.loserProgressionSeedPlaceholderName,
        originDisplayIdentifier: set.loserProgressionOriginPhaseGroupDisplayIdentifier,
        originPhaseOrder: set.loserProgressionOriginPhaseOrder,
        originPlacement: set.loserProgressionOriginPlacement,
      },
    ];
    for (const progressionSeed of progressionSeeds) {
      if (!progressionSeed.seedId || progressionSeedById.has(progressionSeed.seedId)) {
        continue;
      }
      progressionSeedById.set(progressionSeed.seedId, {
        entrantId: `placeholder:${progressionSeed.seedId}`,
        entrantName: progressionSeed.placeholderName?.trim() || progressionSeed.seedId,
        isPlaceholder: true,
        seedId: progressionSeed.seedId,
        originPlacement: progressionSeed.originPlacement,
        originDisplayIdentifier: progressionSeed.originDisplayIdentifier,
      });
    }
  }
  return progressionSeedById;
}

export function roundRobinPairKey(leftEntrantId: string, rightEntrantId: string): string {
  return [leftEntrantId, rightEntrantId].sort((left, right) => left.localeCompare(right, "ja")).join("::");
}

export function roundRobinPlaceholderId(slot: SetSlot, source?: SetEntrantSource | null): string {
  const sourceIdentity = source?.typeId
    ? `${source.typeId}:${source.condition?.trim().toLowerCase() || "source"}`
    : null;
  const identity = slot.seedId
    || sourceIdentity
    || slot.seedPlaceholderName?.trim()
    || source?.placeholderName?.trim()
    || slot.entrantName
    || "unknown";
  return `placeholder:${identity}`;
}

export function resolveRoundRobinOriginOrder(
  phaseGroups: PhaseGroupSnapshot[],
  originPhaseOrder: number | null | undefined,
  originDisplayIdentifier: string | null | undefined,
  originPlacement: number | null | undefined,
): number | null {
  if (originPlacement === null || originPlacement === undefined) {
    return null;
  }

  const normalizedDisplayIdentifier = originDisplayIdentifier?.trim() || null;
  const sourceGroup = phaseGroups.find((group) =>
    group.phaseOrder === originPhaseOrder
    && (group.displayIdentifier?.trim() || null) === normalizedDisplayIdentifier,
  );
  return sourceGroup?.progressionsOut
    ?.filter((progression) => progression.originPlacement === originPlacement)
    .map((progression) => progression.originOrder)
    .filter((order): order is number => order !== null)
    .sort((left, right) => left - right)[0] ?? null;
}

export function createRoundRobinSourceSlotResolver(input: {
  setById: Map<string, SetSnapshot>;
  phaseGroupSeedById: Map<string, PhaseGroupSeedSnapshot>;
  phaseGroupSeedByNum: Map<number, PhaseGroupSeedSnapshot>;
  phaseGroupSeedByOriginPlacement: Map<number, PhaseGroupSeedSnapshot>;
  seedSlotById: Map<string, SetSlot>;
  progressionSeedById: Map<string, RoundRobinResolvedSlot>;
  resolveOriginOrder: (
    originPhaseOrder: number | null | undefined,
    originDisplayIdentifier: string | null | undefined,
    originPlacement: number | null | undefined,
  ) => number | null;
}): (source: SetEntrantSource | null | undefined, visited: Set<string>) => RoundRobinResolvedSlot | null {
  const resolveSourceSlot = (
    source: SetEntrantSource | null | undefined,
    visited: Set<string>,
  ): RoundRobinResolvedSlot | null => {
    if (!source) {
      return null;
    }

    if (source.sourceType?.trim().toLowerCase() === "seed" && source.typeId) {
      const phaseGroupSeed = input.phaseGroupSeedById.get(source.typeId)
        ?? (source.seedNum !== null && source.seedNum !== undefined
          ? input.phaseGroupSeedByNum.get(source.seedNum)
          : undefined)
        ?? (source.groupSeedNum !== null && source.groupSeedNum !== undefined
          ? input.phaseGroupSeedByNum.get(source.groupSeedNum)
          : undefined)
        ?? (source.placement !== null && source.placement !== undefined
          ? input.phaseGroupSeedByOriginPlacement.get(source.placement)
          : undefined);
      if (phaseGroupSeed?.entrantId) {
        return {
          entrantId: phaseGroupSeed.entrantId,
          entrantName: phaseGroupSeed.entrantName?.trim() || phaseGroupSeed.entrantId,
          isPlaceholder: false,
          seedId: phaseGroupSeed.seedId,
          seedNum: source.seedNum ?? phaseGroupSeed.seedNum,
          originPlacement: source.placement ?? phaseGroupSeed.originPlacement,
          originDisplayIdentifier: source.originPhaseGroupDisplayIdentifier
            ?? phaseGroupSeed.originPhaseGroupDisplayIdentifier,
          originOrder: input.resolveOriginOrder(
            source.originPhaseOrder ?? phaseGroupSeed.originPhaseOrder,
            source.originPhaseGroupDisplayIdentifier
              ?? phaseGroupSeed.originPhaseGroupDisplayIdentifier,
            source.placement ?? phaseGroupSeed.originPlacement,
          ),
        };
      }
      const seedSlot = input.seedSlotById.get(source.typeId);
      if (seedSlot) {
        const placeholderName = source.placeholderName?.trim()
          || seedSlot.seedPlaceholderName?.trim()
          || source.conditionString?.trim();
        if (seedSlot.entrantId) {
          return {
            entrantId: seedSlot.entrantId,
            entrantName: seedSlot.entrantName,
            isPlaceholder: false,
            seedId: seedSlot.seedId,
            seedNum: source.seedNum ?? seedSlot.seedNum,
            originPlacement: source.placement ?? seedSlot.seedOriginPlacement,
            originDisplayIdentifier: source.originPhaseGroupDisplayIdentifier
              ?? seedSlot.seedOriginPhaseGroupDisplayIdentifier,
            originOrder: input.resolveOriginOrder(
              source.originPhaseOrder ?? seedSlot.seedOriginPhaseOrder,
              source.originPhaseGroupDisplayIdentifier ?? seedSlot.seedOriginPhaseGroupDisplayIdentifier,
              source.placement ?? seedSlot.seedOriginPlacement,
            ),
          };
        }
        if (placeholderName) {
          return {
            entrantId: roundRobinPlaceholderId(seedSlot, source),
            entrantName: placeholderName,
            isPlaceholder: true,
            seedId: seedSlot.seedId,
            seedNum: source.seedNum ?? seedSlot.seedNum,
            originPlacement: source.placement ?? seedSlot.seedOriginPlacement,
            originDisplayIdentifier: source.originPhaseGroupDisplayIdentifier
              ?? seedSlot.seedOriginPhaseGroupDisplayIdentifier,
            originOrder: input.resolveOriginOrder(
              source.originPhaseOrder ?? seedSlot.seedOriginPhaseOrder,
              source.originPhaseGroupDisplayIdentifier ?? seedSlot.seedOriginPhaseGroupDisplayIdentifier,
              source.placement ?? seedSlot.seedOriginPlacement,
            ),
          };
        }
      }
      const progressionSeed = input.progressionSeedById.get(source.typeId);
      if (progressionSeed?.entrantName && progressionSeed.entrantName !== progressionSeed.seedId) {
        return {
          ...progressionSeed,
          entrantName: source.placeholderName?.trim() || progressionSeed.entrantName,
          seedNum: source.seedNum ?? progressionSeed.seedNum,
          originPlacement: source.originPlacement ?? progressionSeed.originPlacement,
          originDisplayIdentifier: source.originPhaseGroupDisplayIdentifier
            ?? progressionSeed.originDisplayIdentifier,
          originOrder: input.resolveOriginOrder(
            source.originPhaseOrder,
            source.originPhaseGroupDisplayIdentifier ?? progressionSeed.originDisplayIdentifier,
            source.originPlacement ?? progressionSeed.originPlacement,
          ),
        };
      }
    }

    const sourceSetId = source.resolvedSetId ?? source.typeId;
    const sourceSet = sourceSetId ? input.setById.get(sourceSetId) : undefined;
    if (!sourceSet || visited.has(sourceSet.setId)) {
      const placeholderName = source.placeholderName?.trim() || source.conditionString?.trim();
      return placeholderName
        ? {
          entrantId: roundRobinPlaceholderId({
            entrantId: null,
            entrantName: placeholderName,
            seedId: null,
            seedNum: null,
            seedPlaceholderName: null,
            score: null,
          }, source),
          entrantName: placeholderName,
          isPlaceholder: true,
        }
        : null;
    }

    const nextVisited = new Set(visited);
    nextVisited.add(sourceSet.setId);
    const condition = source.condition?.trim().toLowerCase();
    if ((condition === "winner" || condition === "loser") && sourceSet.winnerId) {
      const candidate = sourceSet.slots.find((slot) => {
        if (!slot.entrantId) {
          return false;
        }
        return condition === "winner"
          ? slot.entrantId === sourceSet.winnerId
          : slot.entrantId !== sourceSet.winnerId;
      });
      if (candidate?.entrantId) {
        return {
          entrantId: candidate.entrantId,
          entrantName: candidate.entrantName,
          isPlaceholder: false,
          seedId: candidate.seedId,
          seedNum: candidate.seedNum,
          originPlacement: candidate.seedOriginPlacement,
          originDisplayIdentifier: candidate.seedOriginPhaseGroupDisplayIdentifier,
          originOrder: input.resolveOriginOrder(
            source.originPhaseOrder,
            source.originPhaseGroupDisplayIdentifier ?? candidate.seedOriginPhaseGroupDisplayIdentifier,
            source.originPlacement ?? candidate.seedOriginPlacement,
          ),
        };
      }
    }

    const nestedSources = [sourceSet.entrant1Source, sourceSet.entrant2Source];
    return nestedSources
      .map((nestedSource) => resolveSourceSlot(nestedSource, nextVisited))
      .find((resolved): resolved is RoundRobinResolvedSlot => resolved !== null)
      ?? (source.placeholderName?.trim()
        ? {
          entrantId: roundRobinPlaceholderId({
            entrantId: null,
            entrantName: source.placeholderName.trim(),
            seedId: null,
            seedNum: null,
            seedPlaceholderName: source.placeholderName.trim(),
            score: null,
          }, source),
          entrantName: source.placeholderName.trim(),
          isPlaceholder: true,
        }
        : null);
  };

  return resolveSourceSlot;
}

export function buildRoundRobinOriginAxisOrder(
  entrantOriginPlacements: Map<string, number>,
  entrantOriginDisplayIdentifiers: Map<string, string>,
  originDisplayIdentifiers: Iterable<string>,
): Map<string, number> {
  const orderedDisplayIdentifiers = [...new Set(originDisplayIdentifiers)]
    .sort((left, right) => left.localeCompare(right, "ja"));
  const displayIdentifierOrder = new Map(
    orderedDisplayIdentifiers.map((displayIdentifier, index) => [displayIdentifier, index]),
  );
  const groupCount = orderedDisplayIdentifiers.length;
  const axisOrderByEntrantId = new Map<string, number>();

  for (const [entrantId, placement] of entrantOriginPlacements) {
    const groupIdentifier = entrantOriginDisplayIdentifiers.get(entrantId);
    const groupOrder = groupIdentifier === undefined
      ? groupCount
      : displayIdentifierOrder.get(groupIdentifier) ?? groupCount;
    if (groupCount === 0 || groupOrder === groupCount) {
      axisOrderByEntrantId.set(entrantId, placement * (groupCount + 1));
      continue;
    }

    const groupOrderInPlacement = placement % 2 === 0
      ? groupCount - 1 - groupOrder
      : groupOrder;
    axisOrderByEntrantId.set(entrantId, (placement - 1) * groupCount + groupOrderInPlacement);
  }

  return axisOrderByEntrantId;
}

export function indexRoundRobinSeedSlotsById(sets: SetSnapshot[]): Map<string, SetSlot> {
  const seedSlotById = new Map<string, SetSlot>();
  for (const set of sets) {
    for (const slot of set.slots) {
      if (!slot.seedId) {
        continue;
      }

      const current = seedSlotById.get(slot.seedId);
      const slotHasOrigin = slot.seedOriginPlacement !== null
        && slot.seedOriginPlacement !== undefined
        && Boolean(slot.seedOriginPhaseGroupDisplayIdentifier?.trim());
      const currentHasOrigin = current?.seedOriginPlacement !== null
        && current?.seedOriginPlacement !== undefined
        && Boolean(current?.seedOriginPhaseGroupDisplayIdentifier?.trim());
      if (!current || (slotHasOrigin && !currentHasOrigin)) {
        seedSlotById.set(slot.seedId, slot);
      }
    }
  }
  return seedSlotById;
}

type BuildRoundRobinMatrixRowsInput = {
  boardData: RoundRobinBoardData;
  pendingResultBySetId: Map<string, LocalSetResultMeta>;
  interimScoreDraftsBySetId: Record<string, SetScoreDraft>;
  obsOverlayState: Pick<ObsOverlayState, "active" | "currentSetId"> | null;
  setDisplayCodeById: Map<string, string>;
};

export function buildRoundRobinMatrixRows({
  boardData,
  pendingResultBySetId,
  interimScoreDraftsBySetId,
  obsOverlayState,
  setDisplayCodeById,
}: BuildRoundRobinMatrixRowsInput): RoundRobinMatrixRowView[] {
  return boardData.entrants.map((rowEntrantId) => {
    const rowSeedId = rowEntrantId.startsWith("seed:")
      ? rowEntrantId.slice("seed:".length)
      : boardData.entrantSeedIds.get(rowEntrantId);
    const rowColumnEntrantId = boardData.entrantIdsByColumnKey.get(rowEntrantId);
    const standing = boardData.standings.find((item) =>
      item.entrantId === rowColumnEntrantId
      || (rowSeedId !== undefined
        && boardData.entrantSeedIds.get(item.entrantId) === rowSeedId)
      || (!rowEntrantId.startsWith("seed:") && item.entrantId === rowEntrantId),
    );

    const cells = boardData.entrants.map((columnEntrantId) => {
      const isDiagonal = rowEntrantId === columnEntrantId;
      const columnSeedId = columnEntrantId.startsWith("seed:")
        ? columnEntrantId.slice("seed:".length)
        : boardData.entrantSeedIds.get(columnEntrantId);
      const set = isDiagonal
        ? null
        : boardData.setsByPair.get(roundRobinPairKey(
          boardData.entrantIdsByColumnKey.get(rowEntrantId) ?? rowEntrantId,
          boardData.entrantIdsByColumnKey.get(columnEntrantId) ?? columnEntrantId,
        ))
          ?? boardData.setsByPair.get(roundRobinPairKey(
            rowSeedId ?? rowEntrantId,
            columnSeedId ?? columnEntrantId,
          ));

      if (!set) {
        return {
          key: columnEntrantId,
          kind: isDiagonal ? "diagonal" as const : "empty" as const,
        };
      }

      const setDisplay = getSetScoresForDisplay(
        set,
        pendingResultBySetId.get(set.setId),
        interimScoreDraftsBySetId[set.setId],
      );
      const pendingResult = pendingResultBySetId.get(set.setId);
      const resultStatus = getSetResultVisualStatus(
        set,
        pendingResult,
        interimScoreDraftsBySetId[set.setId],
      );
      const resultStatusClass = resultStatus ? `set-card-status-${resultStatus}` : "";
      const resultStatusLabel = resultStatus === "confirmed"
        ? "確定"
        : resultStatus === "reset"
          ? "取消待ち"
          : resultStatus === "draft"
            ? "下書き"
            : resultStatus === "inprogress"
              ? "進行中"
              : "";
      const winnerId = setDisplay.winnerId ?? set.winnerId;
      const columnColumnEntrantId = boardData.entrantIdsByColumnKey.get(columnEntrantId);
      const rowSlot = set.slots.find((slot) =>
        rowColumnEntrantId !== null && rowColumnEntrantId !== undefined
        && slot.entrantId === rowColumnEntrantId,
      ) ?? set.slots.find((slot) => rowSeedId && slot.seedId === rowSeedId);
      const columnSlot = set.slots.find((slot) =>
        columnColumnEntrantId !== null && columnColumnEntrantId !== undefined
        && slot.entrantId === columnColumnEntrantId,
      ) ?? set.slots.find((slot) => columnSeedId && slot.seedId === columnSeedId);
      const rowEntrantIdForSet = rowSlot?.entrantId ?? null;
      const columnEntrantIdForSet = columnSlot?.entrantId ?? null;
      const rowGameScore = rowEntrantIdForSet
        ? setDisplay.scores[rowEntrantIdForSet]
          ?? (rowSlot?.score !== null && rowSlot?.score !== undefined ? String(rowSlot.score) : "-")
        : "-";
      const columnGameScore = columnEntrantIdForSet
        ? setDisplay.scores[columnEntrantIdForSet]
          ?? (columnSlot?.score !== null && columnSlot?.score !== undefined ? String(columnSlot.score) : "-")
        : "-";
      const changeClass = pendingResult ? getPendingSetChangeClass(pendingResult) : "";
      const outcomeClass = winnerId === null
        ? ""
        : winnerId === rowEntrantIdForSet
          ? "round-robin-match-win"
          : winnerId === columnEntrantIdForSet
            ? "round-robin-match-loss"
            : "";
      const isLiveOverlaySet = Boolean(
        obsOverlayState?.active
        && obsOverlayState.currentSetId === set.setId
        && obsOverlayState.currentSetId !== "__test__",
      );
      const roundLabel = set.fullRoundText.trim() || `Round ${set.round ?? "-"}`;
      const setLabel = `Set ${setDisplayCodeById.get(set.setId) ?? set.identifier?.trim() ?? "-"}`;

      return {
        key: columnEntrantId,
        kind: "match" as const,
        match: {
          set,
          className: `round-robin-match ${outcomeClass} ${changeClass} ${resultStatusClass} ${isLiveOverlaySet ? "set-card-live" : ""}`,
          title: `${roundLabel} / ${setLabel}: ${boardData.entrantNames.get(rowEntrantId) || "-"} vs ${boardData.entrantNames.get(columnEntrantId) || "-"}`,
          roundLabel,
          setLabel,
          resultStatus,
          resultStatusLabel,
          isLiveOverlaySet,
          rowGameScore,
          columnGameScore,
        },
      };
    });

    return {
      key: rowEntrantId,
      entrantName: boardData.entrantNames.get(rowEntrantId) || "-",
      cells,
      setSummary: standing ? `${standing.wins}-${standing.losses}` : "-",
      gameSummary: standing ? `${standing.gameWins}-${standing.gameLosses}` : "-",
    };
  });
}