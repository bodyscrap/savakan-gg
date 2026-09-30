import { parsePhasePoolKey } from "./messageUtils";
import { toSlugInput } from "./slugUtils";

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
  selectedEvent: { eventId: string; name: string },
  selectedPhaseName: string,
  selectedPhasePoolKey: string,
) {
  const parsed = parsePhasePoolKey(selectedPhasePoolKey);
  const phaseName = (parsed?.phaseName ?? selectedPhaseName).trim();
  const phaseGroupName = (parsed?.phaseGroupName ?? "").trim();
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