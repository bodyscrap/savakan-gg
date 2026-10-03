import { describe, expect, it } from "vitest";
import type { LocalSnapshotEventListItem } from "./tournamentWorkspaceRepository";
import { formatDefaultSnapshotName, localSnapshotAliasLabel, resolveSelectedSnapshotName } from "./snapshotDisplay";

const snapshotItem: LocalSnapshotEventListItem = {
  tournamentId: "tournament-1",
  slug: "tournament/example",
  tournamentName: "Example Tournament",
  updatedAt: "2026-10-03T00:00:00Z",
  eventId: "event-1",
  eventName: "Singles",
  eventAlias: null,
  setCount: 0,
};

describe("snapshot display names", () => {
  it("formats a default name from the tournament and event names", () => {
    expect(formatDefaultSnapshotName(" Example Tournament ", " Singles "))
      .toBe("Example Tournament / Singles");
  });

  it("uses the formatted default name when the alias is empty", () => {
    expect(localSnapshotAliasLabel(snapshotItem)).toBe("Example Tournament / Singles");
    expect(resolveSelectedSnapshotName([snapshotItem], {
      eventAlias: "",
      tournamentName: "Example Tournament",
      eventName: "Singles",
      slug: snapshotItem.slug,
      eventId: snapshotItem.eventId,
      fallbackName: "Fallback",
    })).toBe("Example Tournament / Singles");
  });

  it("prefers a non-empty alias", () => {
    expect(localSnapshotAliasLabel({ ...snapshotItem, eventAlias: "Weekly Finals" }))
      .toBe("Weekly Finals");
  });
});