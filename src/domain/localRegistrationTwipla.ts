import { t } from "../i18n";
import { emptyCategorySelections } from "./eventManagement";
import { validateRegisteredSelections, type LocalEventRegistration, type RegisteredLocalParticipant } from "./localEventRegistration";

export type TwiplaStatus = "attending" | "interested" | "notAttending";
export type TwiplaUser = { id: string; name: string; status: TwiplaStatus };
export type TwiplaEvent = { eventName: string; users: TwiplaUser[] };

export function selectTwiplaUsers(users: TwiplaUser[], statuses: TwiplaStatus[]): TwiplaUser[] {
  const seen = new Set<string>();
  return users.filter((user) => {
    if (!statuses.includes(user.status) || seen.has(user.id)) return false;
    seen.add(user.id);
    return true;
  });
}

export function importTwiplaUsers(users: TwiplaUser[], registration: LocalEventRegistration): RegisteredLocalParticipant[] {
  if (users.length < 1 || users.length > 512) throw new Error(t("取り込むユーザーは1〜512人にしてください。"));
  return users.map((user) => {
    const participant = { entrantId: crypto.randomUUID(), name: user.name, skill: null,
      categorySelections: emptyCategorySelections(), selectionsConfirmed: false };
    participant.selectionsConfirmed = validateRegisteredSelections(participant, registration.setting).errors.length === 0;
    return participant;
  });
}