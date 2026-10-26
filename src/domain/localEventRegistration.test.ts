import { describe, expect, it } from "vitest";
import {
  applyRegistrationSetting, canRegisterParticipant, defaultLocalEventRegistration, isRegistrationComplete, validateRegisteredSelections,
  type RegisteredLocalParticipant,
} from "./localEventRegistration";
import type { EventManagementMeta } from "./tournamentWorkspaceRepository";

const setting: EventManagementMeta = {
  sideDecisionMethod: "upper_1p", totalMinCount: 1, totalMaxCount: 3,
  itemListSnapshots: [{ id: "characters", name: "Characters", categoryName: "Character", items: ["A", "B"] }],
  categoryMinCounts: [1, 0, 0], categoryMaxCounts: [2, 0, 0], categoryAllowDuplicates: [false, false, false],
};
function participant(items = ["A"]): RegisteredLocalParticipant {
  return { entrantId: "player", name: "Player", categorySelections: [items, [], []], selectionsConfirmed: true };
}

describe("local event participant registration", () => {
  it("starts with an empty participant list and no required items", () => {
    const initial = defaultLocalEventRegistration();
    expect(initial.participants).toEqual([]);
    expect(isRegistrationComplete(participant([]), initial.setting)).toBe(true);
  });

  it("validates category limits, duplicates, membership, and total limits", () => {
    expect(isRegistrationComplete(participant(), setting)).toBe(true);
    for (const items of [[], ["A", "A"], ["unknown"], ["A", "B", "A"]]) {
      expect(isRegistrationComplete(participant(items), setting)).toBe(false);
    }
    expect(isRegistrationComplete(participant(["A", "B"]), { ...setting, totalMaxCount: 1 })).toBe(false);
    expect(isRegistrationComplete(participant(), { ...setting, totalMinCount: 2 })).toBe(false);
  });

  it("preserves order and allowed duplicates", () => {
    const duplicateSetting = { ...setting, categoryAllowDuplicates: [true, false, false], categoryMaxCounts: [3, 0, 0] };
    const player = participant(["B", "A", "B"]);
    expect(isRegistrationComplete(player, duplicateSetting)).toBe(true);
    expect(validateRegisteredSelections(player, duplicateSetting).flattened).toEqual(["B", "A", "B"]);
  });

  it("clears only players that no longer meet the new conditions", () => {
    const one = participant();
    const two = { ...participant(["A", "B"]), entrantId: "second" };
    const next = applyRegistrationSetting({ requireItemSelections: true, setting, participants: [one, two] }, {
      ...setting, categoryMinCounts: [2, 0, 0],
    });
    expect(next.participants[0].categorySelections).toEqual([[], [], []]);
    expect(next.participants[0].selectionsConfirmed).toBe(false);
    expect(next.participants[1]).toEqual(two);
  });

  it("marks cleared optional selections incomplete until explicitly saved again", () => {
    const next = applyRegistrationSetting({ requireItemSelections: true, setting, participants: [participant()] }, {
      ...defaultLocalEventRegistration().setting,
    });
    expect(next.participants[0].categorySelections).toEqual([[], [], []]);
    expect(isRegistrationComplete(next.participants[0], next.setting)).toBe(false);
    expect(isRegistrationComplete({ ...next.participants[0], selectionsConfirmed: true }, next.setting)).toBe(true);
  });

  it("preserves matching items when switching lists", () => {
    const nextSetting = { ...setting, itemListSnapshots: [{ ...setting.itemListSnapshots[0], id: "different" }] };
    const next = applyRegistrationSetting({ requireItemSelections: true, setting, participants: [participant()] }, nextSetting);
    expect(next.participants[0].categorySelections).toEqual([["A"], [], []]);
    expect(next.participants[0].selectionsConfirmed).toBe(true);
  });

  it("removes only items absent from the new list and preserves other categories", () => {
    const oldSetting = { ...setting, itemListSnapshots: [
      setting.itemListSnapshots[0],
      { id: "colors", name: "Colors", categoryName: "Color", items: ["Red"] },
    ], categoryMinCounts: [2, 0, 0], categoryMaxCounts: [2, 1, 0] };
    const player = { ...participant(["A", "B"]), categorySelections: [["A", "B"], ["Red"], []] };
    const nextSetting = { ...oldSetting, itemListSnapshots: [
      { ...oldSetting.itemListSnapshots[0], id: "new", items: ["A"] },
      oldSetting.itemListSnapshots[1],
    ] };
    const next = applyRegistrationSetting({ requireItemSelections: true, setting: oldSetting, participants: [player] }, nextSetting);
    expect(next.participants[0].categorySelections).toEqual([["A"], ["Red"], []]);
    expect(next.participants[0].selectionsConfirmed).toBe(false);
  });

  it("requires a name and explicit confirmation", () => {
    expect(isRegistrationComplete({ ...participant(), name: " " }, setting)).toBe(false);
    expect(isRegistrationComplete({ ...participant(), selectionsConfirmed: false }, setting)).toBe(false);
  });

  it("permits missing or partial selections only when item registration is optional", () => {
    const requiredSetting = { ...setting, categoryMinCounts: [2, 0, 0], totalMinCount: 2 };
    for (const items of [[], ["A"]]) {
      const player = { ...participant(items), selectionsConfirmed: false };
      expect(canRegisterParticipant(player, { setting: requiredSetting, requireItemSelections: true })).toBe(false);
      expect(canRegisterParticipant(player, { setting: requiredSetting, requireItemSelections: false })).toBe(true);
      expect(isRegistrationComplete(player, requiredSetting)).toBe(false);
    }
  });

  it("still validates names, maximums, duplicates, and membership when optional", () => {
    const optional = { setting, requireItemSelections: false };
    for (const items of [["unknown"], ["A", "A"], ["A", "B", "A"]]) {
      expect(canRegisterParticipant(participant(items), optional)).toBe(false);
    }
    expect(canRegisterParticipant({ ...participant([]), name: " " }, optional)).toBe(false);
    expect(canRegisterParticipant(participant(["A", "B"]), {
      ...optional, setting: { ...setting, totalMaxCount: 1 },
    })).toBe(false);
  });
});
