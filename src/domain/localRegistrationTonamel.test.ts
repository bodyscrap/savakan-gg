import { describe, expect, it } from "vitest";
import { defaultLocalEventRegistration } from "./localEventRegistration";
import { FREE_TEXT_LIST_ID } from "./itemList";
import { applyTonamelCategoryMappings, importTonamelParticipants, type TonamelParticipant } from "./localRegistrationTonamel";

const users: TonamelParticipant[] = [
  { id: "entrant-1", name: " Full Tonamel Entry Name ", serialNumber: 1, status: "ENTRY", answers: { question: "A, B" } },
  { id: "entrant-2", name: "Second Player", serialNumber: 2, status: "ENTRY", answers: { question: "B" } },
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

  it("maps Tonamel answer columns to every participant's configured category", () => {
    const registration = defaultLocalEventRegistration();
    registration.setting.itemListSnapshots = [{ id: "characters", name: "Characters", categoryName: "Fighter", items: ["A", "B"] }];
    registration.setting.categoryMaxCounts = [2, 0, 0];
    const participants = importTonamelParticipants(users, registration);
    const mapped = applyTonamelCategoryMappings(participants, users, registration, ["question", null, null]);
    expect(mapped.map((participant) => participant.categorySelections)).toEqual([
      [["A", "B"], [], []], [["B"], [], []],
    ]);
    expect(mapped.every((participant) => participant.selectionsConfirmed)).toBe(true);
  });

  it("ignores source values that do not match a selected item list", () => {
    const registration = defaultLocalEventRegistration();
    registration.setting.itemListSnapshots = [{ id: "characters", name: "Characters", categoryName: "Fighter", items: ["A"] }];
    registration.setting.categoryMaxCounts = [1, 0, 0];
    const mapped = applyTonamelCategoryMappings(importTonamelParticipants(users, registration), users, registration,
      ["question", null, null]);
    expect(mapped.map((participant) => participant.categorySelections[0])).toEqual([["A"], []]);
  });

  it("keeps arbitrary mapped values for a free-text category", () => {
    const registration = defaultLocalEventRegistration();
    registration.setting.itemListSnapshots = [{
      id: FREE_TEXT_LIST_ID, name: "自由記入", categoryName: "カテゴリ1", items: [],
    }];
    registration.setting.categoryMaxCounts = [2, 0, 0];
    const mapped = applyTonamelCategoryMappings(importTonamelParticipants(users, registration), users, registration,
      ["question", null, null]);
    expect(mapped[0].categorySelections[0]).toEqual(["A", "B"]);
  });
});