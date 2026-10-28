import { buildConfiguredCategorySlots, emptyCategorySelections, validateCategorySelections } from "./eventManagement";
import type { EventManagementMeta, LocalEventParticipantInput } from "./tournamentWorkspaceRepository";
import { FREE_TEXT_LIST_ID } from "./itemList";

export type RegisteredLocalParticipant = LocalEventParticipantInput & { selectionsConfirmed: boolean };
export type LocalEventRegistration = {
  requireItemSelections: boolean;
  setting: EventManagementMeta;
  participants: RegisteredLocalParticipant[];
};

export function defaultLocalEventRegistration(): LocalEventRegistration {
  return {
    requireItemSelections: true,
    setting: {
      sideDecisionMethod: "upper_1p", itemListSnapshots: [],
      categoryMinCounts: [0, 0, 0], categoryMaxCounts: [0, 0, 0],
      categoryAllowDuplicates: [false, false, false], totalMinCount: 0, totalMaxCount: 3,
    },
    participants: [],
  };
}

export function registrationCategorySlots(setting: EventManagementMeta) {
  return buildConfiguredCategorySlots({
    ...setting,
    itemListIds: setting.itemListSnapshots.map((list) => list.id),
  }, (id) => setting.itemListSnapshots.find((list) => list.id === id) ?? null);
}

export function validateRegisteredSelections(participant: LocalEventParticipantInput, setting: EventManagementMeta) {
  return validateCategorySelections(
    participant.categorySelections, registrationCategorySlots(setting),
    setting.totalMinCount ?? 0, setting.totalMaxCount ?? 3,
  );
}

export function isRegistrationComplete(participant: RegisteredLocalParticipant, setting: EventManagementMeta): boolean {
  const validated = validateRegisteredSelections(participant, setting);
  return participant.name.trim() !== "" && participant.selectionsConfirmed
    && validated.errors.length === 0
    && JSON.stringify(participant.categorySelections) === JSON.stringify(validated.normalizedBySlot);
}

export function canRegisterParticipant(
  participant: RegisteredLocalParticipant,
  registration: Pick<LocalEventRegistration, "setting" | "requireItemSelections">,
): boolean {
  if (registration.requireItemSelections) return isRegistrationComplete(participant, registration.setting);
  const optionalSetting = {
    ...registration.setting, categoryMinCounts: [0, 0, 0], totalMinCount: 0,
  };
  return isRegistrationComplete({ ...participant, selectionsConfirmed: true }, optionalSetting);
}

export function applyRegistrationSetting(current: LocalEventRegistration, setting: EventManagementMeta): LocalEventRegistration {
  return {
    ...current,
    setting,
    participants: current.participants.map((participant) => {
      const categorySelections = emptyCategorySelections();
      for (const slot of registrationCategorySlots(setting)) {
        categorySelections[slot.slotIndex] = (participant.categorySelections[slot.slotIndex] ?? [])
          .filter((item) => slot.list.id === FREE_TEXT_LIST_ID || slot.list.items.includes(item));
      }
      if (JSON.stringify(categorySelections) !== JSON.stringify(participant.categorySelections)) {
        return { ...participant, categorySelections, selectionsConfirmed: false };
      }
      const validated = validateRegisteredSelections(participant, setting);
      if (validated.errors.length > 0
        || JSON.stringify(participant.categorySelections) !== JSON.stringify(validated.normalizedBySlot)) {
        return { ...participant, categorySelections: emptyCategorySelections(), selectionsConfirmed: false };
      }
      return participant;
    }),
  };
}
