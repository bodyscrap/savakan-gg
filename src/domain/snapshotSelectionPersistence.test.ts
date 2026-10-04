import { describe, expect, it } from "vitest";
import {
  buildSnapshotSelectionPersistenceKey,
  resolveEventPhasePoolPersistence,
} from "./snapshotSelectionPersistence";

describe("snapshot selection persistence", () => {
  it("normalizes the event key and trims optional phase scope", () => {
    expect(buildSnapshotSelectionPersistenceKey("my-event", " 42 ", " Pools ", null))
      .toBe("my-event::42::Pools::");
  });

  it("resolves the selected phase and group from the phase-pool key", () => {
    expect(resolveEventPhasePoolPersistence(
      { slug: "my-event" },
      { eventId: "42", name: "Open", sets: [], phaseGroups: [] },
      "Fallback phase",
      "Main phase::Top 8",
    )).toEqual({
      persistenceKey: "my-event::42::Main phase::Top 8",
      slug: "my-event",
      eventId: "42",
      eventName: "Open",
      phaseName: "Main phase",
      phaseGroupName: "Top 8",
    });
  });

  it("resolves display names from an ID-based pool key", () => {
    const selectedEvent = {
      eventId: "42",
      name: "Open",
      phaseGroups: [{
        phaseGroupId: "pool-id",
        setIds: ["set-id"],
        phaseName: "Main phase",
        phaseOrder: 1,
        displayIdentifier: "Top 8",
        bracketType: "SINGLE_ELIMINATION",
      }],
      sets: [{
        setId: "set-id",
        phaseGroupId: "pool-id",
        fullRoundText: "Round 1",
        round: 1,
        phaseName: "Main phase",
        phaseGroupName: "Top 8",
        phaseOrder: 1,
        phaseGroupDisplayIdentifier: "Top 8",
        state: 1,
        winnerId: null,
        entrant1Source: null,
        entrant2Source: null,
        slots: [],
      }],
    };
    expect(resolveEventPhasePoolPersistence(
      { slug: "my-event" },
      selectedEvent,
      "Fallback phase",
      "id:pool-id",
    )).toMatchObject({
      phaseName: "Main phase",
      phaseGroupName: "Top 8",
    });
  });

  it("skips phase-pool persistence until both phase and group are selected", () => {
    expect(resolveEventPhasePoolPersistence(
      { slug: "my-event" },
      { eventId: "42", name: "Open", sets: [], phaseGroups: [] },
      "Main phase",
      "",
    )).toBeNull();
    expect(resolveEventPhasePoolPersistence(
      { slug: "" },
      { eventId: "42", name: "Open", sets: [], phaseGroups: [] },
      "Main phase",
      "Main phase::Top 8",
    )).toBeNull();
  });
});