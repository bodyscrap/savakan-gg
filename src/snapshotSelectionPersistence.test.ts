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
      { eventId: "42", name: "Open" },
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

  it("skips phase-pool persistence until both phase and group are selected", () => {
    expect(resolveEventPhasePoolPersistence(
      { slug: "my-event" },
      { eventId: "42", name: "Open" },
      "Main phase",
      "",
    )).toBeNull();
    expect(resolveEventPhasePoolPersistence(
      { slug: "" },
      { eventId: "42", name: "Open" },
      "Main phase",
      "Main phase::Top 8",
    )).toBeNull();
  });
});