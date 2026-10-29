import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultLocalEventRegistration, type LocalEventRegistration } from "../domain/localEventRegistration";
import { useLocalEventDraft } from "./useLocalEventDraft";

vi.mock("react", { spy: true });
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function setup(withParticipants = true) {
  let registration: LocalEventRegistration = {
    ...defaultLocalEventRegistration(),
    participants: withParticipants
      ? [{ entrantId: "player", name: "Player", skill: 7, categorySelections: [[], [], []], selectionsConfirmed: true }]
      : [],
  };
  vi.mocked(React.useState).mockImplementation(() => [
    registration,
    (update: unknown) => {
      if (typeof update !== "function") throw new Error("Expected a functional draft update");
      registration = update(registration);
    },
  ]);
  return { draft: useLocalEventDraft(), current: () => registration };
}

describe("local event participant draft", () => {
  it.each(["metadata", "creation"] as const)("preserves participants until %s clearing is confirmed", async (reason) => {
    vi.stubGlobal("window", { confirm: vi.fn().mockResolvedValue(false) });
    const { draft, current } = setup();
    const original = current();
    expect(await draft.confirmDiscardParticipants(reason)).toBe(false);
    expect(current()).toBe(original);
  });

  it("does not clear participants on confirmation alone, so failed creation preserves them", async () => {
    vi.stubGlobal("window", { confirm: vi.fn().mockResolvedValue(true) });
    const { draft, current } = setup();
    const original = current();
    expect(await draft.confirmDiscardParticipants("creation")).toBe(true);
    expect(current()).toBe(original);
    draft.clearParticipants();
    expect(current()).toEqual({ ...original, participants: [] });
  });

  it("clears confirmed metadata drafts without changing item settings", async () => {
    vi.stubGlobal("window", { confirm: vi.fn().mockResolvedValue(true) });
    const { draft, current } = setup();
    const original = current();
    expect(await draft.confirmDiscardParticipants("metadata")).toBe(true);
    draft.clearParticipants();
    expect(current()).toEqual({ ...original, participants: [] });
  });

  it("does not prompt for an empty list", async () => {
    vi.stubGlobal("window", { confirm: vi.fn() });
    const { draft } = setup(false);
    expect(await draft.confirmDiscardParticipants("metadata")).toBe(true);
    expect(await draft.confirmDiscardParticipants("creation")).toBe(true);
    expect(window.confirm).not.toHaveBeenCalled();
  });
});
