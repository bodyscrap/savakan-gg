import { describe, expect, it, vi } from "vitest";
import type { MouseEvent as ReactMouseEvent } from "react";
import { useMatchDialogActions } from "./useMatchDialogActions";
import type { SetSnapshot } from "./bracketProgression";

function createSet(): SetSnapshot {
  return {
    setId: "set-1",
    fullRoundText: "Round 1",
    round: 1,
    phaseName: "Main",
    phaseGroupName: "Pool A",
    phaseOrder: 1,
    phaseGroupDisplayIdentifier: "A",
    state: 2,
    winnerId: null,
    entrant1Source: null,
    entrant2Source: null,
    slots: [],
  };
}

function createMouseEvent(overrides: Partial<ReactMouseEvent<HTMLButtonElement>> = {}) {
  return {
    altKey: false,
    ctrlKey: false,
    button: 0,
    preventDefault: vi.fn(),
    ...overrides,
  } as unknown as ReactMouseEvent<HTMLButtonElement>;
}

function createActions(overrides: { busy?: boolean; overlayBusy?: boolean } = {}) {
  const stopOverlay = vi.fn(async () => undefined);
  const toggleOverlay = vi.fn(async () => undefined);
  const actions = useMatchDialogActions({
    selectedEvent: null,
    resolvedEventSetsById: new Map(),
    pendingResultBySetId: new Map(),
    setActiveMatchSetId: vi.fn(),
    setActiveMatchSideDrafts: vi.fn(),
    getSetSlotSide: () => "",
    getSetScoresForDisplay: () => ({ scores: {} }),
    initializeMatchDraft: vi.fn(),
    busy: overrides.busy ?? false,
    overlayBusy: overrides.overlayBusy ?? false,
    stopOverlay,
    toggleOverlay,
  });

  return { ...actions, stopOverlay, toggleOverlay };
}

describe("match dialog set interactions", () => {
  it("stops the overlay on round-robin Alt-click", () => {
    const actions = createActions();
    const event = createMouseEvent({ altKey: true });

    actions.handleRoundRobinMatchClick(createSet(), event);

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(actions.stopOverlay).toHaveBeenCalledWith(true);
    expect(actions.toggleOverlay).not.toHaveBeenCalled();
  });

  it("only stops the elimination overlay on Alt-left-click", () => {
    const actions = createActions();
    const event = createMouseEvent({ altKey: true, button: 1 });

    actions.handleEliminationSetActivate(createSet(), event);

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(actions.stopOverlay).not.toHaveBeenCalled();
  });

  it("suppresses overlay actions while the app or overlay is busy", () => {
    const actions = createActions({ overlayBusy: true });
    const event = createMouseEvent({ ctrlKey: true });

    actions.handleRoundRobinMatchClick(createSet(), event);

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(actions.toggleOverlay).not.toHaveBeenCalled();
  });
});