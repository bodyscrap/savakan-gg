import { t } from "../i18n";
import { emptyCategorySelections } from "./eventManagement";
import { validateRegisteredSelections, type LocalEventRegistration, type RegisteredLocalParticipant } from "./localEventRegistration";

export type TonamelParticipant = { id: string; name: string; serialNumber: number; status: string };
export type TonamelEvent = { eventName: string; users: TonamelParticipant[] };

export function importTonamelParticipants(users: TonamelParticipant[], registration: LocalEventRegistration): RegisteredLocalParticipant[] {
  if (users.length < 1 || users.length > 512) throw new Error(t("取り込むユーザーは1〜512人にしてください。"));
  return users.map((user) => {
    const participant = { entrantId: crypto.randomUUID(), name: user.name, skill: null,
      categorySelections: emptyCategorySelections(), selectionsConfirmed: false };
    participant.selectionsConfirmed = validateRegisteredSelections(participant, registration.setting).errors.length === 0;
    return participant;
  });
}