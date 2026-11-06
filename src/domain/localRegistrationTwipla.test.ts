import { describe, expect, it } from "vitest";
import { defaultLocalEventRegistration } from "./localEventRegistration";
import { importTwiplaUsers, selectTwiplaUsers, type TwiplaUser } from "./localRegistrationTwipla";

const users: TwiplaUser[] = [
  { id: "alice", name: "Alice", status: "attending" },
  { id: "bob", name: "Bob", status: "interested" },
  { id: "carol", name: "Carol", status: "notAttending" },
];

describe("Twipla registration import", () => {
  it("selects only checked statuses and supports all combinations", () => {
    expect(selectTwiplaUsers(users, ["attending"])).toEqual([users[0]]);
    expect(selectTwiplaUsers(users, ["interested", "notAttending"])).toEqual(users.slice(1));
    expect(selectTwiplaUsers(users, ["attending", "interested", "notAttending"])).toEqual(users);
    expect(selectTwiplaUsers(users, [])).toEqual([]);
  });

  it("deduplicates accounts but preserves distinct users with matching names", () => {
    expect(selectTwiplaUsers([users[0], users[0], { ...users[0], id: "other" }], ["attending"])).toHaveLength(2);
  });

  it("creates unique participants with unset skill and item selections", () => {
    const participants = importTwiplaUsers(users, defaultLocalEventRegistration());
    expect(new Set(participants.map((participant) => participant.entrantId)).size).toBe(3);
    expect(participants[0]).toMatchObject({ name: "Alice", skill: null, categorySelections: [[], [], []] });
  });

  it("requires item confirmation when the registration setting requires items", () => {
    const registration = defaultLocalEventRegistration();
    registration.setting.itemListSnapshots = [{ id: "items", name: "Items", categoryName: "Type", items: ["A"] }];
    registration.setting.categoryMinCounts = [1, 0, 0];
    registration.setting.categoryMaxCounts = [1, 0, 0];
    registration.setting.totalMinCount = 1;
    expect(importTwiplaUsers(users, registration)[0].selectionsConfirmed).toBe(false);
  });

  it("rejects empty or oversized imports and accepts 512 users", () => {
    const registration = defaultLocalEventRegistration();
    expect(() => importTwiplaUsers([], registration)).toThrow();
    expect(() => importTwiplaUsers(Array.from({ length: 513 }, () => users[0]), registration)).toThrow();
    expect(importTwiplaUsers(Array.from({ length: 512 }, () => users[0]), registration)).toHaveLength(512);
  });
});