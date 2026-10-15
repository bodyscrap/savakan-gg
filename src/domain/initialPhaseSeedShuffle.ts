import type { EventSnapshot } from "./bracketDisplay";
import type { PhaseGroupSeedSnapshot } from "./bracketProgression";

export type InitialPhaseSeedMappingEntry = {
  seedId: string;
  seedNum: number;
};

export function buildInitialPhaseSeedMapping(
  event: EventSnapshot,
  random: () => number = Math.random,
): InitialPhaseSeedMappingEntry[] {
  const firstPhase = [...(event.phases ?? [])]
    .filter((phase) => phase.phaseOrder !== null)
    .sort((left, right) => (left.phaseOrder ?? 0) - (right.phaseOrder ?? 0))[0];
  if (!firstPhase) {
    throw new Error("最初のPhase情報がありません。");
  }

  const seedsById = new Map<string, PhaseGroupSeedSnapshot>();
  for (const group of event.phaseGroups ?? []) {
    if (group.phaseId !== firstPhase.phaseId) {
      continue;
    }
    for (const seed of group.seeds ?? []) {
      if (!seed.seedId || seed.seedNum === null || seed.seedNum === undefined) {
        throw new Error("初期PhaseのSeed番号が不足しています。");
      }
      const existing = seedsById.get(seed.seedId);
      if (existing && (
        existing.seedNum !== seed.seedNum
        || existing.entrantId !== seed.entrantId
      )) {
        throw new Error("初期Phaseに不整合なSeed情報があります。");
      }
      seedsById.set(seed.seedId, seed);
    }
  }
  const seeds = [...seedsById.values()];
  const entrantSeeds = seeds.filter((seed) => seed.entrantId !== null && seed.entrantId !== undefined);
  if (entrantSeeds.length < 2) {
    throw new Error("シャッフルできるプレイヤーSeedが2件以上ありません。");
  }

  const shuffledIds = entrantSeeds.map((seed) => seed.seedId);
  for (let index = shuffledIds.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [shuffledIds[index], shuffledIds[target]] = [shuffledIds[target], shuffledIds[index]];
  }
  const positions = entrantSeeds.map((seed) => seed.seedNum!).sort((left, right) => left - right);
  const numById = new Map(shuffledIds.map((seedId, index) => [seedId, positions[index]]));

  return seeds.map((seed) => ({
    seedId: seed.seedId,
    seedNum: numById.get(seed.seedId) ?? seed.seedNum!,
  }));
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
