import type { EventSnapshot, PhasePoolGroup } from "./bracketDisplay";
import {
  calculateRoundRobinHeadToHeadPoints,
  calculateRoundRobinQualifyingCount,
  DEFAULT_ROUND_ROBIN_TIE_BREAK_RULES,
  getBracketProgressionModel,
  rankRoundRobinStandings,
  resolveRoundRobinTieBreakRules,
} from "./bracketProgression";
import type { LocalSetResultMeta } from "./useTournamentWorkspace";
import type { SetScoreDraft } from "./useSetResultDrafts";
import { getSetScoresForDisplay } from "./setResultDrafts";
import {
  aggregateRoundRobinSetResults,
  buildRoundRobinSeedColumns,
  buildRoundRobinSeedIndexes,
  buildRoundRobinProgressionSeeds,
  createRoundRobinSourceSlotResolver,
  indexRoundRobinSeedSlotsById,
  orderRoundRobinEntrantColumns,
  resolveRoundRobinOriginOrder,
  resolveRoundRobinSlotEntrant,
  type RoundRobinBoardData,
  type RoundRobinResolvedSet,
} from "./roundRobinMatrixDisplay";

export function buildRoundRobinBoardData(input: {
  event: EventSnapshot | null | undefined;
  phasePoolGroup: PhasePoolGroup | null | undefined;
  pendingResultBySetId: Map<string, LocalSetResultMeta>;
  interimScoreDraftsBySetId: Record<string, SetScoreDraft>;
}): RoundRobinBoardData {
  const selectedEvent = input.event;
  const selectedPhasePoolGroup = input.phasePoolGroup;
  if (getBracketProgressionModel(selectedPhasePoolGroup?.bracketType ?? null) !== "round_robin") {
    return {
      entrants: [],
      entrantNames: new Map(),
      entrantIdsByColumnKey: new Map(),
      entrantSeedIds: new Map(),
      entrantSeedNumbers: new Map(),
      sourceDiagnostics: [],
      setsByPair: new Map(),
      candidateSetCount: 0,
      twoSlotSetCount: 0,
      resolvedSetCount: 0,
      registeredSetCount: 0,
      unresolvedSetIds: [],
      unresolvedSetReasons: [],
      standings: [],
      qualifyingCount: 0,
      tieBreakRules: DEFAULT_ROUND_ROBIN_TIE_BREAK_RULES,
    };
  }

  const sourceDiagnostics: string[] = [];
  const candidateSetCount = selectedPhasePoolGroup?.sets.length ?? 0;
  const resolvedSets: RoundRobinResolvedSet[] = [];
  const isLaterPhase = (selectedPhasePoolGroup?.phaseOrder ?? 1) > 1;
  const entrantOriginPlacements = new Map<string, number>();
  const entrantOriginOrders = new Map<string, number>();
  const entrantOriginDisplayIdentifiers = new Map<string, string>();
  const originDisplayIdentifiers = new Set<string>();
  const setById = new Map((selectedEvent?.sets ?? []).map((set) => [set.setId, set]));
  const phaseGroupSeedIndexes = buildRoundRobinSeedIndexes(selectedPhasePoolGroup?.seeds ?? []);
  const {
    byId: phaseGroupSeedById,
    byNum: phaseGroupSeedByNum,
    byOriginPlacement: phaseGroupSeedByOriginPlacement,
    seedIdByEntrantId: phaseGroupSeedIdByEntrantId,
    orderedSeeds: phaseGroupSeeds,
  } = phaseGroupSeedIndexes;
  const seedSlotById = indexRoundRobinSeedSlotsById(selectedPhasePoolGroup?.sets ?? []);

  const {
    fixedEntrants,
    entrantNames,
    entrantIdsByColumnKey,
    entrantSeedIds,
    entrantSeedNumbers,
    standingByEntrantId,
  } = buildRoundRobinSeedColumns(phaseGroupSeeds, seedSlotById);

  const findOriginOrder = (
    originPhaseOrder: number | null | undefined,
    originDisplayIdentifier: string | null | undefined,
    originPlacement: number | null | undefined,
  ): number | null => resolveRoundRobinOriginOrder(
    selectedEvent?.phaseGroups ?? [],
    originPhaseOrder,
    originDisplayIdentifier,
    originPlacement,
  );

  const progressionSeedById = buildRoundRobinProgressionSeeds(selectedEvent?.sets ?? []);
  const resolveSourceSlot = createRoundRobinSourceSlotResolver({
    setById,
    phaseGroupSeedById,
    phaseGroupSeedByNum,
    phaseGroupSeedByOriginPlacement,
    seedSlotById,
    progressionSeedById,
    resolveOriginOrder: findOriginOrder,
  });

  for (const set of selectedPhasePoolGroup?.sets ?? []) {
    const entrants = set.slots.map((slot, slotIndex) => {
      const source = slotIndex === 0 ? set.entrant1Source : set.entrant2Source;
      if (isLaterPhase) {
        const sourceSeedSlot = source?.sourceType?.trim().toLowerCase() === "seed" && source.typeId
          ? seedSlotById.get(source.typeId)
          : undefined;
        const sourceProgressionSeed = source?.sourceType?.trim().toLowerCase() === "seed" && source.typeId
          ? progressionSeedById.get(source.typeId)
          : undefined;
        sourceDiagnostics.push([
          `${set.setId}[${slotIndex + 1}]`,
          `rawName=${slot.entrantName || ""}`,
          `entrantId=${slot.entrantId || ""}`,
          `seedId=${slot.seedId || ""}`,
          `placeholder=${slot.seedPlaceholderName || ""}`,
          `sourceType=${source?.sourceType || ""}`,
          `sourceTypeId=${source?.typeId || ""}`,
          `sourceGroupSeedNum=${source?.groupSeedNum ?? ""}`,
          `sourceSeedNum=${source?.seedNum ?? ""}`,
          `sourcePlacement=${source?.placement ?? ""}`,
          `seedLookupPlaceholder=${sourceSeedSlot?.seedPlaceholderName || ""}`,
          `progressionSeedPlaceholder=${sourceProgressionSeed?.entrantName || ""}`,
          `sourcePlaceholder=${source?.placeholderName || ""}`,
          `condition=${source?.conditionString || ""}`,
        ].join(" | "));
      }
      return resolveRoundRobinSlotEntrant({
        slot,
        source,
        setId: set.setId,
        phaseGroupSeedIndexes,
        phaseGroupSeedIdByEntrantId,
        seedSlotById,
        resolveSourceSlot,
        resolveOriginOrder: findOriginOrder,
      });
    });
    entrants.forEach(({ slot, entrantId, entrantName, isPlaceholder, seedId, seedNum, originPlacement, originDisplayIdentifier, originOrder }) => {
      entrantNames.set(entrantId, entrantName);
      const effectiveSeedId = phaseGroupSeedIdByEntrantId.get(entrantId)
        ?? seedId
        ?? slot.seedId;
      if (effectiveSeedId) {
        entrantSeedIds.set(entrantId, effectiveSeedId);
      }
      const effectiveSeedNum = seedNum ?? slot.seedNum;
      const effectiveOriginPlacement = originPlacement ?? slot.seedOriginPlacement;
      const effectiveOriginDisplayIdentifier = originDisplayIdentifier?.trim()
        || slot.seedOriginPhaseGroupDisplayIdentifier?.trim();
      if (effectiveSeedNum !== null && effectiveSeedNum !== undefined) {
        const currentSeedNumber = entrantSeedNumbers.get(entrantId);
        if (currentSeedNumber === undefined || effectiveSeedNum < currentSeedNumber) {
          entrantSeedNumbers.set(entrantId, effectiveSeedNum);
        }
      }
      if (effectiveOriginPlacement !== null && effectiveOriginPlacement !== undefined) {
        const currentPlacement = entrantOriginPlacements.get(entrantId);
        if (currentPlacement === undefined || effectiveOriginPlacement < currentPlacement) {
          entrantOriginPlacements.set(entrantId, effectiveOriginPlacement);
        }
      }
      if (originOrder !== null && originOrder !== undefined) {
        const currentOrder = entrantOriginOrders.get(entrantId);
        if (currentOrder === undefined || originOrder < currentOrder) {
          entrantOriginOrders.set(entrantId, originOrder);
        }
      }
      if (effectiveOriginDisplayIdentifier) {
        originDisplayIdentifiers.add(effectiveOriginDisplayIdentifier);
        const currentPlacement = entrantOriginPlacements.get(entrantId);
        const currentDisplayIdentifier = entrantOriginDisplayIdentifiers.get(entrantId);
        if (currentDisplayIdentifier === undefined
          || (effectiveOriginPlacement !== null
            && effectiveOriginPlacement !== undefined
            && currentPlacement === effectiveOriginPlacement)) {
          entrantOriginDisplayIdentifiers.set(entrantId, effectiveOriginDisplayIdentifier);
        }
      }
      if (!standingByEntrantId.has(entrantId)) {
        standingByEntrantId.set(entrantId, {
          entrantId,
          entrantName,
          isPlaceholder,
          wins: 0,
          losses: 0,
          gameWins: 0,
          gameLosses: 0,
          h2hPoints: 0,
          qualified: false,
        });
      }
    });
    resolvedSets.push({
      set,
      entrants,
      hasUnassignedSlot: set.slots.some((slot) => slot.entrantId === null),
    });
  }

  const setResults = aggregateRoundRobinSetResults(
    resolvedSets,
    (set) => getSetScoresForDisplay(
      set,
      input.pendingResultBySetId.get(set.setId),
      input.interimScoreDraftsBySetId[set.setId],
    ),
  );
  for (const [entrantId, stats] of setResults.standingStatsByEntrantId) {
    const standing = standingByEntrantId.get(entrantId);
    if (standing) {
      standing.wins = stats.wins;
      standing.losses = stats.losses;
      standing.gameWins = stats.gameWins;
      standing.gameLosses = stats.gameLosses;
    }
  }

  const tieBreakRules = resolveRoundRobinTieBreakRules(selectedPhasePoolGroup?.tiebreakOrder);
  const headToHeadPoints = calculateRoundRobinHeadToHeadPoints(
    [...standingByEntrantId.values()],
    tieBreakRules,
    setResults.headToHeadWins,
  );
  for (const [entrantId, points] of headToHeadPoints) {
    const standing = standingByEntrantId.get(entrantId);
    if (standing) {
      standing.h2hPoints = points;
    }
  }

  const currentPhaseOrder = selectedPhasePoolGroup?.phaseOrder ?? null;
  const nextPhaseOrder = currentPhaseOrder === null
    ? null
    : (selectedEvent?.phaseGroups ?? [])
      .map((group) => group.phaseOrder)
      .filter((order): order is number => order !== null && order > currentPhaseOrder)
      .sort((left, right) => left - right)[0] ?? null;
  const qualifyingCount = calculateRoundRobinQualifyingCount({
    progressionsOut: selectedPhasePoolGroup?.progressionsOut ?? [],
    currentPhaseOrder,
    currentPhaseGroupDisplayIdentifier: selectedPhasePoolGroup?.phaseGroupDisplayIdentifier ?? null,
    nextPhaseOrder,
    downstreamSets: selectedEvent?.sets ?? [],
  });
  const {
    fixedEntrants: orderedEntrants,
    entrantIdsByColumnKey: orderedEntrantIdsByColumnKey,
    entrantOrder,
  } = orderRoundRobinEntrantColumns({
    entrantIds: standingByEntrantId.keys(),
    entrantSeedIds,
    seedOrder: selectedPhasePoolGroup?.seedOrder ?? [],
    isLaterPhase,
    entrantOriginPlacements,
    entrantOriginOrders,
    entrantOriginDisplayIdentifiers,
    originDisplayIdentifiers,
    entrantSeedNumbers,
    entrantNames,
    phaseGroupSeedCount: phaseGroupSeeds.length,
    fixedEntrants,
    entrantIdsByColumnKey,
  });
  const standings = rankRoundRobinStandings({
    standings: [...standingByEntrantId.values()],
    tieBreakRules,
    entrantSeedNumbers,
    entrantOrder,
    qualifyingCount,
  });

  return {
    entrants: orderedEntrants,
    entrantNames,
    entrantIdsByColumnKey: orderedEntrantIdsByColumnKey,
    entrantSeedIds,
    entrantSeedNumbers,
    sourceDiagnostics,
    setsByPair: setResults.setsByPair,
    candidateSetCount,
    twoSlotSetCount: setResults.twoSlotSetCount,
    resolvedSetCount: setResults.resolvedSetCount,
    registeredSetCount: setResults.registeredSetCount,
    unresolvedSetIds: setResults.unresolvedSetIds,
    unresolvedSetReasons: setResults.unresolvedSetReasons,
    standings,
    qualifyingCount,
    tieBreakRules,
  };
}