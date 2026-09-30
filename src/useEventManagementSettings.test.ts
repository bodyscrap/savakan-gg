import { describe, expect, it } from "vitest";
import {
  resolveCommittedEventManagementSetting,
  shouldHydrateEventManagementSettings,
} from "./useEventManagementSettings";

describe("event management settings hydration", () => {
  it("hydrates when settings become ready for a new event", () => {
    expect(shouldHydrateEventManagementSettings(true, "tournament::event-2", "tournament::event-1")).toBe(true);
  });

  it("does not rehydrate the same event after a workspace update", () => {
    expect(shouldHydrateEventManagementSettings(true, "tournament::event-1", "tournament::event-1")).toBe(false);
  });

  it("waits until settings are loaded and ignores an empty selection", () => {
    expect(shouldHydrateEventManagementSettings(false, "tournament::event-1", "")).toBe(false);
    expect(shouldHydrateEventManagementSettings(true, "", "")).toBe(false);
  });

  it("does not treat locally restored draft settings as committed settings", () => {
    expect(resolveCommittedEventManagementSetting(null)).toBeNull();
  });

  it("normalizes category limits from the workspace-saved setting", () => {
    expect(resolveCommittedEventManagementSetting({
      sideDecisionMethod: "upper_1p",
      itemListSnapshots: [{ id: "characters", name: "Characters", categoryName: "Game", items: ["A"] }],
      categoryMinCounts: [1],
      categoryMaxCounts: [2],
      categoryAllowDuplicates: [true],
      totalMinCount: 1,
      totalMaxCount: 2,
    })).toMatchObject({
      itemListIds: ["characters", "", ""],
      categoryMinCounts: [1, 0, 0],
      categoryMaxCounts: [2, 1, 1],
      categoryAllowDuplicates: [true, false, false],
    });
  });
});