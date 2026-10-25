import { t } from "../i18n";
import type { EventSnapshot } from "./bracketDisplay";
import type { PhaseGroupSeedSnapshot } from "./bracketProgression";

export type InitialPhaseSeedMappingEntry = {
  seedId: string;
  seedNum: number;
  phaseGroupId?: string;
};

export function buildInitialPhaseSeedMapping(
  event: EventSnapshot,
  random: () => number = Math.random,
  includePhaseGroupPositions = false,
): InitialPhaseSeedMappingEntry[] {
  const firstPhase = [...(event.phases ?? [])]
    .filter((phase) => phase.phaseOrder !== null)
    .sort((left, right) => (left.phaseOrder ?? 0) - (right.phaseOrder ?? 0))[0];
  if (!firstPhase) {
    throw new Error(t("最初のPhase情報がありません。"));
  }

  const seedsById = new Map<string, { seed: PhaseGroupSeedSnapshot; phaseGroupId: string }>();
  for (const group of event.phaseGroups ?? []) {
    if (group.phaseId !== firstPhase.phaseId) {
      continue;
    }
    for (const seed of group.seeds ?? []) {
      if (!seed.seedId || seed.seedNum === null || seed.seedNum === undefined) {
        throw new Error(t("初期PhaseのSeed番号が不足しています。"));
      }
      const existing = seedsById.get(seed.seedId);
      if (existing && (
        existing.seed.seedNum !== seed.seedNum
        || existing.seed.entrantId !== seed.entrantId
        || existing.phaseGroupId !== group.phaseGroupId
      )) {
        throw new Error(t("初期Phaseに不整合なSeed情報があります。"));
      }
      seedsById.set(seed.seedId, { seed, phaseGroupId: group.phaseGroupId ?? "" });
    }
  }
  const seedEntries = [...seedsById.values()];
  const entrantSeeds = seedEntries.filter(({ seed }) => seed.entrantId !== null && seed.entrantId !== undefined);
  if (entrantSeeds.length < 2) {
    throw new Error(t("シャッフルできるプレイヤーSeedが2件以上ありません。"));
  }

  const shuffledIds = entrantSeeds.map(({ seed }) => seed.seedId);
  for (let index = shuffledIds.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [shuffledIds[index], shuffledIds[target]] = [shuffledIds[target], shuffledIds[index]];
  }
  const positions = entrantSeeds
    .map(({ seed, phaseGroupId }) => ({ seedNum: seed.seedNum!, phaseGroupId }))
    .sort((left, right) => left.seedNum - right.seedNum);
  const positionById = new Map(shuffledIds.map((seedId, index) => [seedId, positions[index]]));
  const groupIdsBySeedNum = new Map<number, Set<string>>();
  for (const { seed, phaseGroupId } of seedEntries) {
    const groupIds = groupIdsBySeedNum.get(seed.seedNum!) ?? new Set<string>();
    groupIds.add(phaseGroupId);
    groupIdsBySeedNum.set(seed.seedNum!, groupIds);
  }
  const hasCrossGroupDuplicatePositions = [...groupIdsBySeedNum.values()].some((groupIds) => groupIds.size > 1);

  return seedEntries.map(({ seed, phaseGroupId }) => {
    const position = positionById.get(seed.seedId) ?? { seedNum: seed.seedNum!, phaseGroupId };
    return {
      seedId: seed.seedId,
      seedNum: position.seedNum,
      ...(includePhaseGroupPositions && hasCrossGroupDuplicatePositions
        ? { phaseGroupId: position.phaseGroupId }
        : {}),
    };
  });
}

export function canShuffleInitialPhaseSeeds(event: EventSnapshot): boolean {
  const firstPhase = [...(event.phases ?? [])]
    .filter((phase) => phase.phaseOrder !== null)
    .sort((left, right) => (left.phaseOrder ?? 0) - (right.phaseOrder ?? 0))[0];
  if (!firstPhase || event.sets.length === 0
    || !event.sets.every((set) => set.state === 1 && set.winnerId === null)) {
    return false;
  }
  const entrantIds = new Set(
    (event.phaseGroups ?? [])
      .filter((group) => group.phaseId === firstPhase.phaseId)
      .flatMap((group) => group.seeds ?? [])
      .map((seed) => seed.entrantId)
      .filter((entrantId): entrantId is string => Boolean(entrantId)),
  );
  return entrantIds.size > 1;
}
