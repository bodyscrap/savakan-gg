import { t } from "../i18n";
import { emptyCategorySelections } from "./eventManagement";
import { registrationCategorySlots, validateRegisteredSelections, type LocalEventRegistration, type RegisteredLocalParticipant } from "./localEventRegistration";
import { FREE_TEXT_LIST_ID } from "./itemList";

export type TonamelColumn = { id: string; label: string };
export type TonamelParticipant = { id: string; name: string; serialNumber: number; status: string; answers: Record<string, string> };
export type TonamelEvent = { eventName: string; columns: TonamelColumn[]; users: TonamelParticipant[] };

export function importTonamelParticipants(users: TonamelParticipant[], registration: LocalEventRegistration): RegisteredLocalParticipant[] {
  if (users.length < 1 || users.length > 512) throw new Error(t("取り込むユーザーは1〜512人にしてください。"));
  return users.map((user) => {
    const participant = { entrantId: crypto.randomUUID(), name: user.name, skill: null,
      categorySelections: emptyCategorySelections(), selectionsConfirmed: false };
    participant.selectionsConfirmed = validateRegisteredSelections(participant, registration.setting).errors.length === 0;
    return participant;
  });
}

export function applyTonamelCategoryMappings(
  participants: RegisteredLocalParticipant[], users: TonamelParticipant[],
  registration: LocalEventRegistration, mappings: Array<string | null>,
): RegisteredLocalParticipant[] {
  const slots = registrationCategorySlots(registration.setting);
  return participants.map((participant, index) => {
    const categorySelections = emptyCategorySelections();
    for (const slot of slots) {
      const sourceId = mappings[slot.slotIndex];
      if (!sourceId) continue;
      const values = (users[index]?.answers[sourceId] ?? "").split(/[\r\n,]+/).map((value) => value.trim())
        .filter((value) => value !== "" && (slot.list.id === FREE_TEXT_LIST_ID || slot.list.items.includes(value)));
      categorySelections[slot.slotIndex] = slot.allowDuplicates ? values : [...new Set(values)];
    }
    const next = { ...participant, categorySelections };
    return { ...next, selectionsConfirmed: validateRegisteredSelections(next, registration.setting).errors.length === 0 };
  });
}