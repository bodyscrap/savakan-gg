import { describe, expect, it } from "vitest";
import { defaultLocalEventRegistration } from "./localEventRegistration";
import { importTonamelParticipants, type TonamelParticipant } from "./localRegistrationTonamel";

const users: TonamelParticipant[] = [
  { id: "entrant-1", name: " Full Tonamel Entry Name ", serialNumber: 1, status: "ENTRY" },
  { id: "entrant-2", name: "Second Player", serialNumber: 2, status: "ENTRY" },
];

describe("Tonamel registration import", () => {
  it("creates local participants from Tonamel entry names", () => {
    const participants = importTonamelParticipants(users, defaultLocalEventRegistration());
    expect(participants.map((participant) => participant.name)).toEqual([" Full Tonamel Entry Name ", "Second Player"]);
    expect(participants[0]).toMatchObject({ skill: null, categorySelections: [[], [], []] });
    expect(new Set(participants.map((participant) => participant.entrantId)).size).toBe(2);
  });

  it("rejects empty or oversized imports", () => {
    const registration = defaultLocalEventRegistration();
    expect(() => importTonamelParticipants([], registration)).toThrow();
    expect(() => importTonamelParticipants(Array.from({ length: 513 }, (_, index) => ({
      ...users[0], id: `entrant-${index}`,
    })), registration)).toThrow();
  });
});