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

type ProgressionPhaseGroup = {
  seeds?: PhaseGroupSeedSnapshot[];
};

function isPlaceholderEntrantName(name: string, placeholderName?: string | null): boolean {
  return placeholderName?.trim() !== "" && name.trim() === placeholderName?.trim();
}

function resolveEntrantFromSource(
  source: SetEntrantSource | null | undefined,
  sets: SetSnapshot[],
  phaseGroups: ProgressionPhaseGroup[],
  visited: Set<string>,
): SetSlot | null {
  if (!source) {
    return null;
  }

  if (source.sourceType?.trim().toLowerCase() === "seed") {
    const seed = phaseGroups
      .flatMap((group) => group.seeds ?? [])
      .find((candidate) => candidate.seedId === source.typeId);
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

    const progressionSource = sets.find((candidate) => {
      return candidate.winnerProgressionSeedId === source.typeId
        || candidate.loserProgressionSeedId === source.typeId
        || candidate.winnerProgressionId === source.typeId
        || candidate.loserProgressionId === source.typeId;
    });
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

  const sourceSet = sets.find((candidate) => candidate.setId === sourceSetId);
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
      .map((nestedSource) => resolveEntrantFromSource(nestedSource, sets, phaseGroups, nextVisited))
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

export function resolveSetEntrantsForInput(
  set: SetSnapshot,
  sets: SetSnapshot[],
  phaseGroups: ProgressionPhaseGroup[],
): SetSnapshot {
  const resolveKnownEntrantName = (entrantId: string, fallbackName: string): string => {
    const knownSlotName = sets.flatMap((candidate) => candidate.slots.map((slot, slotIndex) => ({
      slot,
      source: slotIndex === 0 ? candidate.entrant1Source : candidate.entrant2Source,
    }))).find(({ slot, source }) => (
      slot.entrantId === entrantId
      && isResolvedEntrantName(slot.entrantName)
      && !isPlaceholderEntrantName(slot.entrantName, slot.seedPlaceholderName)
      && !isPlaceholderEntrantName(slot.entrantName, source?.placeholderName)
    ))?.slot.entrantName;
    if (knownSlotName) {
      return knownSlotName;
    }

    return phaseGroups
      .flatMap((group) => group.seeds ?? [])
      .find((seed) => (
        seed.entrantId === entrantId
        && isResolvedEntrantName(seed.entrantName ?? "")
        && !isPlaceholderEntrantName(seed.entrantName ?? "", seed.placeholderName)
      ))
      ?.entrantName
      ?? fallbackName;
  };

  const slots = set.slots.map((slot, slotIndex) => {
    if (slot.entrantId) {
      return {
        ...slot,
        entrantName: resolveKnownEntrantName(slot.entrantId, slot.entrantName),
      };
    }

    const source = slotIndex === 0 ? set.entrant1Source : set.entrant2Source;
    const resolved = resolveEntrantFromSource(source, sets, phaseGroups, new Set([set.setId]));
    return resolved?.entrantId
      ? {
        ...slot,
        entrantId: resolved.entrantId,
        entrantName: resolveKnownEntrantName(resolved.entrantId, resolved.entrantName),
      }
      : slot;
  });

  return slots === set.slots ? set : { ...set, slots };
}