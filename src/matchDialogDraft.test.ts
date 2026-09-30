import { describe, expect, it } from "vitest";
import {
  buildInitialMatchDialogDraft,
  resolveExistingMatchDialogDraft,
} from "./matchDialogDraft";

describe("match dialog draft selection", () => {
  const forced = { winnerId: "forced", scoreDrafts: { forced: "W" }, directWin: true };
  const pending = { winnerId: "pending", scoreDrafts: { pending: "2" } };
  const cached = { winnerId: "cached", scoreDrafts: { cached: "1" } };

  it("prioritizes forced, then pending, then cached drafts", () => {
    expect(resolveExistingMatchDialogDraft(forced, pending, cached)).toEqual({
      draftState: forced,
      shouldPersist: true,
    });
    expect(resolveExistingMatchDialogDraft(undefined, pending, cached)).toEqual({
      draftState: pending,
      shouldPersist: true,
    });
    expect(resolveExistingMatchDialogDraft(undefined, undefined, cached)).toEqual({
      draftState: cached,
      shouldPersist: false,
    });
    expect(resolveExistingMatchDialogDraft(undefined, undefined, undefined)).toBeNull();
  });

  it("prefers displayed snapshot scores and otherwise initializes from the set", () => {
    const defaults = { playerA: "0", playerB: "0" };
    expect(buildInitialMatchDialogDraft({ playerA: "2", playerB: "1" }, defaults)).toEqual({
      winnerId: "",
      scoreDrafts: { playerA: "2", playerB: "1" },
      directWin: false,
    });
    expect(buildInitialMatchDialogDraft({}, defaults).scoreDrafts).toBe(defaults);
  });
});