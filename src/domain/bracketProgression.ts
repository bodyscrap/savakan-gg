export type SetSlot = {
  entrantId: string | null;
  entrantName: string;
  seedId: string | null;
  seedNum: number | null;
  seedPlaceholderName?: string | null;
  seedOriginPhaseOrder?: number | null;
  seedOriginPhaseGroupDisplayIdentifier?: string | null;
  seedOriginPlacement?: number | null;
  score: number | null;
};

export type SetEntrantSource = {
  sourceType?: string | null;
  typeId: string | null;
  resolvedSetId?: string | null;
  condition: string | null;
  conditionString: string | null;
  placeholderName?: string | null;
  groupSeedNum?: number | null;
  seedNum?: number | null;
  placement?: number | null;
  originPhaseOrder?: number | null;
  originPhaseGroupDisplayIdentifier?: string | null;
  originPlacement?: number | null;
};

export type SetSnapshot = {
  setId: string;
  phaseGroupId?: string | null;
  identifier?: string | null;
  fullRoundText: string;
  round: number | null;
  phaseName: string | null;
  phaseGroupName: string | null;
  phaseOrder: number | null;
  phaseGroupDisplayIdentifier: string | null;
  phaseGroupSetName?: string | null;
  isIntermediate?: boolean;
  state: number;
  winnerId: string | null;
  winnerProgressionSeedId?: string | null;
  winnerProgressionId?: string | null;
  winnerProgressionSeedPlaceholderName?: string | null;
  winnerProgressionOriginPhaseGroupDisplayIdentifier?: string | null;
  winnerProgressionOriginPhaseOrder?: number | null;
  winnerProgressionOriginPlacement?: number | null;
  loserProgressionSeedId?: string | null;
  loserProgressionId?: string | null;
  loserProgressionSeedPlaceholderName?: string | null;
  loserProgressionOriginPhaseGroupDisplayIdentifier?: string | null;
  loserProgressionOriginPhaseOrder?: number | null;
  loserProgressionOriginPlacement?: number | null;
  entrant1Source: SetEntrantSource | null;
  entrant2Source: SetEntrantSource | null;
  slots: SetSlot[];
};

export type EventEntrantSnapshot = {
  entrantId: string;
  entrantName: string;
  seedId: string | null;
  seedNum: number | null;
  firstSeenSetId: string;
};

export function collectEventEntrants(sets: SetSnapshot[]): EventEntrantSnapshot[] {
  const seenOrder: string[] = [];
  const byEntrant = new Map<string, EventEntrantSnapshot>();

  for (const set of sets) {
    for (const slot of set.slots) {
      if (!slot.entrantId) {
        continue;
      }

      const current = byEntrant.get(slot.entrantId);
      const normalizedSeedNum = typeof slot.seedNum === "number" ? slot.seedNum : null;
      const normalizedSeedId = typeof slot.seedId === "string" && slot.seedId.trim() !== "" ? slot.seedId : null;

      if (!current) {
        seenOrder.push(slot.entrantId);
        byEntrant.set(slot.entrantId, {
          entrantId: slot.entrantId,
          entrantName: slot.entrantName,
          seedId: normalizedSeedId,
          seedNum: normalizedSeedNum,
          firstSeenSetId: set.setId,
        });
        continue;
      }

      if (current.seedNum === null && normalizedSeedNum !== null) {
        current.seedNum = normalizedSeedNum;
      }
      if (current.seedId === null && normalizedSeedId !== null) {
        current.seedId = normalizedSeedId;
      }
    }
  }

  return seenOrder
    .map((entrantId) => byEntrant.get(entrantId))
    .filter((entrant): entrant is EventEntrantSnapshot => entrant !== undefined);
}

export function sortEventEntrants(entrants: EventEntrantSnapshot[]): EventEntrantSnapshot[] {
  return [...entrants].sort((left, right) => {
    const leftSeed = typeof left.seedNum === "number" ? left.seedNum : null;
    const rightSeed = typeof right.seedNum === "number" ? right.seedNum : null;

    if (leftSeed !== null && rightSeed !== null) {
      return leftSeed - rightSeed
        || (left.seedId ?? "").localeCompare(right.seedId ?? "", "ja")
        || left.entrantName.localeCompare(right.entrantName, "ja");
    }
    if (leftSeed !== null) {
      return -1;
    }
    if (rightSeed !== null) {
      return 1;
    }

    return 0;
  });
}

export type PhaseGroupSeedSnapshot = {
  seedId: string;
  seedNum?: number | null;
  originPhaseOrder?: number | null;
  originPhaseGroupDisplayIdentifier?: string | null;
  originPlacement?: number | null;
  originOrder?: number | null;
  entrantId: string | null;
  entrantName: string | null;
  placeholderName?: string | null;
};

export type PhaseGroupProgressionSnapshot = {
  progressionId: string;
  originOrder: number | null;
  originPhaseId: string | null;
  originPhaseOrder: number | null;
  originPhaseGroupId: string | null;
  originPhaseGroupDisplayIdentifier: string | null;
  originPlacement: number | null;
  placeholderName: string | null;
};

export type BracketProgressionModel =
  | "single_elimination"
  | "double_elimination"
  | "round_robin"
  | "source_directed";

export type RoundRobinStanding = {
  entrantId: string;
  entrantName: string;
  isPlaceholder: boolean;
  wins: number;
  losses: number;
  gameWins: number;
  gameLosses: number;
  h2hPoints: number;
  qualified: boolean;
};

export type RoundRobinTieBreakRule = "total_sets_won" | "game_wins" | "game_win_percentage" | "head_to_head";

export const DEFAULT_ROUND_ROBIN_TIE_BREAK_RULES: RoundRobinTieBreakRule[] = [
  "total_sets_won",
];

type ProgressionPhaseGroup = {
  seeds?: PhaseGroupSeedSnapshot[];
};

export function getBracketProgressionModel(bracketType: string | null): BracketProgressionModel {
  const normalized = bracketType?.trim().toUpperCase();
  if (normalized === "SINGLE_ELIMINATION") {
    return "single_elimination";
  }
  if (normalized === "DOUBLE_ELIMINATION") {
    return "double_elimination";
  }
  if (normalized === "ROUND_ROBIN") {
    return "round_robin";
  }
  return "source_directed";
}

export function parseRoundRobinGameScore(rawScore: string | number | undefined): number | null {
  if (rawScore === undefined || rawScore === "✓") {
    return null;
  }

  if (rawScore === "DQ" || rawScore === "W" || rawScore === "L") {
    return 0;
  }

  const score = Number(rawScore);
  if (!Number.isInteger(score)) {
    return null;
  }
  return score === -1 ? 0 : score >= 0 ? score : null;
}

export function roundRobinTieBreakRuleFromApi(value: string): RoundRobinTieBreakRule | null {
  const normalized = value.replace(/[^a-z0-9]/gi, "").toUpperCase();
  if (["SETWINS", "SETSWON", "TOTALSETSWON", "WINS"].includes(normalized)) {
    return "total_sets_won";
  }
  if (normalized === "GAMEWINS") {
    return "game_wins";
  }
  if (["GAMERATIO", "GAMEWINPERCENTAGE", "GAMEPERCENTAGE", "WINPERCENTAGE"].includes(normalized)) {
    return "game_win_percentage";
  }
  if (["HEADTOHEAD", "HEADTOHEADWINS"].includes(normalized)) {
    return "head_to_head";
  }
  return null;
}

export function resolveRoundRobinTieBreakRules(configuredRules: string[] | null | undefined): RoundRobinTieBreakRule[] {
  if (!configuredRules || configuredRules.length === 0) {
    return [...DEFAULT_ROUND_ROBIN_TIE_BREAK_RULES];
  }

  return [...new Set(configuredRules
    .map((rule) => roundRobinTieBreakRuleFromApi(rule))
    .filter((rule): rule is RoundRobinTieBreakRule => rule !== null))];
}

function roundRobinGameWinPercentage(standing: RoundRobinStanding): number {
  const totalGames = standing.gameWins + standing.gameLosses;
  return totalGames > 0 ? standing.gameWins / totalGames : 0;
}

export function compareRoundRobinTieBreakRule(
  left: RoundRobinStanding,
  right: RoundRobinStanding,
  rule: RoundRobinTieBreakRule,
): number {
  if (rule === "total_sets_won") {
    return right.wins - left.wins;
  }
  if (rule === "game_wins") {
    return right.gameWins - left.gameWins;
  }
  if (rule === "game_win_percentage") {
    return roundRobinGameWinPercentage(right) - roundRobinGameWinPercentage(left);
  }
  return right.h2hPoints - left.h2hPoints;
}

export function calculateRoundRobinHeadToHeadPoints(
  standings: RoundRobinStanding[],
  tieBreakRules: RoundRobinTieBreakRule[],
  headToHeadWins: Map<string, Map<string, number>>,
): Map<string, number> {
  const headToHeadRuleIndex = tieBreakRules.indexOf("head_to_head");
  const pointsByEntrantId = new Map<string, number>();
  if (headToHeadRuleIndex < 0) {
    return pointsByEntrantId;
  }

  const precedingRules = tieBreakRules.slice(0, headToHeadRuleIndex);
  for (const standing of standings) {
    const tiedEntrantIds = new Set(
      standings
        .filter((candidate) => precedingRules.every((rule) =>
          compareRoundRobinTieBreakRule(candidate, standing, rule) === 0,
        ))
        .map((candidate) => candidate.entrantId),
    );
    const points = [...(headToHeadWins.get(standing.entrantId)?.entries() ?? [])]
      .filter(([opponentId]) => tiedEntrantIds.has(opponentId))
      .reduce((total, [, wins]) => total + wins, 0);
    pointsByEntrantId.set(standing.entrantId, points);
  }

  return pointsByEntrantId;
}

export function calculateRoundRobinQualifyingCount(input: {
  progressionsOut: PhaseGroupProgressionSnapshot[];
  currentPhaseOrder: number | null;
  currentPhaseGroupDisplayIdentifier: string | null;
  nextPhaseOrder: number | null;
  downstreamSets: SetSnapshot[];
}): number {
  const configuredPlacements = new Set(
    input.progressionsOut
      .map((progression) => progression.originPlacement)
      .filter((placement): placement is number => placement !== null),
  );
  if (configuredPlacements.size > 0) {
    return configuredPlacements.size;
  }

  const inferredPlacements = new Set<number>();
  if (input.currentPhaseOrder !== null && input.nextPhaseOrder !== null) {
    for (const set of input.downstreamSets) {
      if (set.phaseOrder !== input.nextPhaseOrder) {
        continue;
      }
      for (const slot of set.slots) {
        const samePool = slot.seedOriginPhaseGroupDisplayIdentifier
          === input.currentPhaseGroupDisplayIdentifier;
        if (slot.seedOriginPhaseOrder === input.currentPhaseOrder
          && samePool
          && slot.seedOriginPlacement !== null
          && slot.seedOriginPlacement !== undefined) {
          inferredPlacements.add(slot.seedOriginPlacement);
        }
      }
    }
  }
  return inferredPlacements.size;
}

export function rankRoundRobinStandings(input: {
  standings: RoundRobinStanding[];
  tieBreakRules: RoundRobinTieBreakRule[];
  entrantSeedNumbers: Map<string, number>;
  entrantOrder: Map<string, number>;
  qualifyingCount: number;
}): RoundRobinStanding[] {
  return input.standings
    .map((standing) => ({ ...standing, qualified: false }))
    .sort((left, right) => {
      for (const rule of input.tieBreakRules) {
        const comparison = compareRoundRobinTieBreakRule(left, right, rule);
        if (comparison !== 0) {
          return comparison;
        }
      }

      const leftSeedNumber = input.entrantSeedNumbers.get(left.entrantId);
      const rightSeedNumber = input.entrantSeedNumbers.get(right.entrantId);
      if (leftSeedNumber !== undefined || rightSeedNumber !== undefined) {
        if (leftSeedNumber === undefined || rightSeedNumber === undefined) {
          return leftSeedNumber === undefined ? 1 : -1;
        }
        if (leftSeedNumber !== rightSeedNumber) {
          return leftSeedNumber - rightSeedNumber;
        }
      }

      return (input.entrantOrder.get(left.entrantId) ?? Number.MAX_SAFE_INTEGER)
        - (input.entrantOrder.get(right.entrantId) ?? Number.MAX_SAFE_INTEGER);
    })
    .map((standing, index) => ({
      ...standing,
      qualified: input.qualifyingCount > 0 && index < input.qualifyingCount,
    }));
}

function isPlaceholderEntrantName(name: string, placeholderName?: string | null): boolean {
  return placeholderName?.trim() !== "" && name.trim() === placeholderName?.trim();
}

function resolveEntrantFromSource(
  source: SetEntrantSource | null | undefined,
  setsById: Map<string, SetSnapshot>,
  phaseGroupSeedById: Map<string, PhaseGroupSeedSnapshot>,
  progressionSourceById: Map<string | null, SetSnapshot>,
  visited: Set<string>,
): SetSlot | null {
  if (!source) {
    return null;
  }

  if (source.sourceType?.trim().toLowerCase() === "seed") {
    const seed = source.typeId ? phaseGroupSeedById.get(source.typeId) : undefined;
    if (seed?.entrantId) {
      return {
        entrantId: seed.entrantId,
        entrantName: seed.entrantName?.trim() || "TBD",
        seedId: seed.seedId,
        seedNum: seed.seedNum ?? null,
        seedPlaceholderName: seed.placeholderName ?? null,
        score: null,
      };
    }

    const progressionSource = progressionSourceById.get(source.typeId);
    if (progressionSource?.winnerId) {
      const progressionRelation = progressionSource.winnerProgressionSeedId === source.typeId
        || progressionSource.winnerProgressionId === source.typeId
        ? "winner"
        : "loser";
      return progressionSource.slots.find((slot) => {
        if (!slot.entrantId) {
          return false;
        }
        return progressionRelation === "winner"
          ? slot.entrantId === progressionSource.winnerId
          : slot.entrantId !== progressionSource.winnerId;
      }) ?? null;
    }
    return null;
  }

  const sourceSetId = source.resolvedSetId ?? source.typeId;
  if (!sourceSetId || visited.has(sourceSetId)) {
    return null;
  }

  const sourceSet = setsById.get(sourceSetId);
  if (!sourceSet) {
    return null;
  }

  const nextVisited = new Set(visited);
  nextVisited.add(sourceSetId);
  const condition = source.condition?.trim().toLowerCase();
  if (sourceSet.winnerId && (condition === "winner" || condition === "loser")) {
    return sourceSet.slots.find((slot) => {
      if (!slot.entrantId) {
        return false;
      }
      return condition === "winner"
        ? slot.entrantId === sourceSet.winnerId
        : slot.entrantId !== sourceSet.winnerId;
    }) ?? null;
  }

  if (sourceSet.isIntermediate) {
    return [sourceSet.entrant1Source, sourceSet.entrant2Source]
      .map((nestedSource) => resolveEntrantFromSource(
        nestedSource,
        setsById,
        phaseGroupSeedById,
        progressionSourceById,
        nextVisited,
      ))
      .find((slot): slot is SetSlot => slot !== null)
      ?? null;
  }

  return null;
}

export function isResolvedEntrantName(name: string): boolean {
  const raw = String(name ?? "").trim();
  if (raw === "") {
    return false;
  }

  const normalized = raw.toUpperCase();
  if (normalized === "TBD" || normalized === "TBA" || normalized === "UNKNOWN") {
    return false;
  }

  const unresolvedLabel = raw.toLowerCase();
  if (unresolvedLabel.startsWith("winner of ") || unresolvedLabel.startsWith("loser of ")) {
    return false;
  }
  if (raw.startsWith("勝者") || raw.startsWith("敗者")) {
    return false;
  }

  return true;
}

export function createSetEntrantResolver(
  sets: SetSnapshot[],
  phaseGroups: ProgressionPhaseGroup[],
): (set: SetSnapshot) => SetSnapshot {
  const setsById = new Map(sets.map((set) => [set.setId, set]));
  const phaseGroupSeedById = new Map<string, PhaseGroupSeedSnapshot>();
  const phaseGroupSeedByEntrantId = new Map<string, PhaseGroupSeedSnapshot>();
  const knownEntrantNameById = new Map<string, string>();
  const progressionSourceById = new Map<string | null, SetSnapshot>();

  for (const phaseGroup of phaseGroups) {
    for (const seed of phaseGroup.seeds ?? []) {
      if (!phaseGroupSeedById.has(seed.seedId)) {
        phaseGroupSeedById.set(seed.seedId, seed);
      }
      if (seed.entrantId
        && !phaseGroupSeedByEntrantId.has(seed.entrantId)
        && isResolvedEntrantName(seed.entrantName ?? "")
        && !isPlaceholderEntrantName(seed.entrantName ?? "", seed.placeholderName)) {
        phaseGroupSeedByEntrantId.set(seed.entrantId, seed);
      }
    }
  }

  for (const set of sets) {
    const progressionSeedIds = [
      set.winnerProgressionSeedId,
      set.loserProgressionSeedId,
      set.winnerProgressionId,
      set.loserProgressionId,
    ];
    for (const progressionSeedId of progressionSeedIds) {
      if (progressionSeedId !== undefined && !progressionSourceById.has(progressionSeedId)) {
        progressionSourceById.set(progressionSeedId, set);
      }
    }

    set.slots.forEach((slot, slotIndex) => {
      const source = slotIndex === 0 ? set.entrant1Source : set.entrant2Source;
      if (!slot.entrantId
        || knownEntrantNameById.has(slot.entrantId)
        || !isResolvedEntrantName(slot.entrantName)
        || isPlaceholderEntrantName(slot.entrantName, slot.seedPlaceholderName)
        || isPlaceholderEntrantName(slot.entrantName, source?.placeholderName)) {
        return;
      }
      knownEntrantNameById.set(slot.entrantId, slot.entrantName);
    });
  }

  const resolveKnownEntrantName = (entrantId: string, fallbackName: string): string => {
    const knownName = knownEntrantNameById.get(entrantId);
    if (knownName) {
      return knownName;
    }

    const seed = phaseGroupSeedByEntrantId.get(entrantId);
    return seed?.entrantName
      ?? fallbackName;
  };

  return (set) => {
    let changed = false;
    const slots = set.slots.map((slot, slotIndex) => {
      if (slot.entrantId) {
        const entrantName = resolveKnownEntrantName(slot.entrantId, slot.entrantName);
        if (entrantName === slot.entrantName) {
          return slot;
        }
        changed = true;
        return { ...slot, entrantName };
      }

      const source = slotIndex === 0 ? set.entrant1Source : set.entrant2Source;
      const resolved = resolveEntrantFromSource(
        source,
        setsById,
        phaseGroupSeedById,
        progressionSourceById,
        new Set([set.setId]),
      );
      if (!resolved?.entrantId) {
        return slot;
      }

      changed = true;
      return {
        ...slot,
        entrantId: resolved.entrantId,
        entrantName: resolveKnownEntrantName(resolved.entrantId, resolved.entrantName),
      };
    });

    return changed ? { ...set, slots } : set;
  };
}
