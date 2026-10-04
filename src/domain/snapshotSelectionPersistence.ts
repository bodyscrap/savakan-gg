import { buildPhasePoolGroups, type EventSnapshot } from "./bracketDisplay";
import { parsePhasePoolKey } from "./messageUtils";
import { toSlugInput } from "./slugUtils";

export function resolveSelectedPhasePoolNames(
  selectedEvent: EventSnapshot,
  selectedPhaseName: string,
  selectedPhasePoolKey: string,
) {
  const selectedGroup = buildPhasePoolGroups(selectedEvent)
    .find((group) => group.key === selectedPhasePoolKey);
  const parsed = parsePhasePoolKey(selectedPhasePoolKey);
  return {
    phaseName: (selectedGroup?.phaseName ?? parsed?.phaseName ?? selectedPhaseName).trim(),
    phaseGroupName: (selectedGroup?.phaseGroupName ?? parsed?.phaseGroupName ?? "").trim(),
  };
}

export function buildSnapshotSelectionPersistenceKey(
  slug: string,
  eventId: string,
  phaseName: string | null | undefined,
  phaseGroupName: string | null | undefined,
): string | null {
  const slugKey = toSlugInput(slug);
  const eventIdKey = eventId.trim();
  if (slugKey === "" || eventIdKey === "") {
    return null;
  }

  return [slugKey, eventIdKey, phaseName?.trim() ?? "", phaseGroupName?.trim() ?? ""].join("::");
}

export function resolveEventPhasePoolPersistence(
  snapshot: { slug: string },
  selectedEvent: EventSnapshot,
  selectedPhaseName: string,
  selectedPhasePoolKey: string,
) {
  const { phaseName, phaseGroupName } = resolveSelectedPhasePoolNames(
    selectedEvent,
    selectedPhaseName,
    selectedPhasePoolKey,
  );
  if (phaseName === "" || phaseGroupName === "") {
    return null;
  }

  const persistenceKey = buildSnapshotSelectionPersistenceKey(
    snapshot.slug,
    selectedEvent.eventId,
    phaseName,
    phaseGroupName,
  );
  if (persistenceKey === null) {
    return null;
  }

  return {
    persistenceKey,
    slug: snapshot.slug,
    eventId: selectedEvent.eventId,
    eventName: selectedEvent.name,
    phaseName,
    phaseGroupName,
  };
}