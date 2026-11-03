import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { BracketDialogs, RestoreAllSeedsDialog } from "./BracketDialogs";
import { MatchDetailDialog } from "./MatchDetailDialog";
import { resolveEntrantDisplayName } from "../domain/bracketDisplay";
import type { SetSnapshot } from "../domain/bracketProgression";

const noop = () => {};
const match: SetSnapshot = {
  setId: "set-1", fullRoundText: "Final", round: 1,
  phaseName: "Main", phaseGroupName: "A", phaseOrder: 1,
  phaseGroupDisplayIdentifier: "A", state: 1, winnerId: null,
  entrant1Source: null, entrant2Source: null,
  slots: [
    { entrantId: "entrant-1", entrantName: "Original One", seedId: null, seedNum: null, score: null },
    { entrantId: "entrant-2", entrantName: "Original Two", seedId: null, seedNum: null, score: null },
  ],
};

describe("bracket dialog player display names", () => {
  it.each([true, false])("uses the current alias setting in result confirmation (%s)", (enabled) => {
    const props: ComponentProps<typeof BracketDialogs> = {
      busy: false,
      resolvePlayerName: (entrantId, name) => resolveEntrantDisplayName(name, entrantId === "entrant-1" ? "Alias One" : " ", enabled),
      resultConfirmation: { match, scoreDrafts: { "entrant-1": "2", "entrant-2": "1" }, directWinnerId: null },
      activeSetId: match.setId, onCancelResultConfirmation: noop, onConfirmResult: noop,
      seedSnapshotPromptOpen: false, canReportWithoutSnapshot: false,
      onCloseSeedSnapshotPrompt: noop, onUpdateSeedSnapshot: noop, onReportWithoutSnapshot: noop,
      restoreOpen: false, selectedEventName: "Event", canRestoreCurrentPool: false,
      canRestoreLockedPoolsInCurrentPhase: false, canRestoreAll: false, canUpdateSnapshot: false,
      canDiscardAllDrafts: false, onCloseRestore: noop, onRestoreCurrentPool: noop,
      onRestoreLockedPoolsInCurrentPhase: noop, onRestoreAll: noop, onUpdateSnapshot: noop,
      onDiscardAllDrafts: noop, overlaySwitch: null, overlayBusy: false,
      onCancelOverlaySwitch: noop, onConfirmOverlaySwitch: noop,
      mobileInputOpen: false, mobileInputCandidates: [], mobileInputBusy: false,
      issuedUrl: "", issuedUrlDisplayIp: "", issuedQrUrl: "", showIssuedUrl: false,
      onCloseMobileInput: noop, onIssueMobileUrl: noop, onCopyMobileUrl: noop,
      onRefreshMobileUrl: noop, conflictDialog: null, forceOverwriteRemaining: false,
      onCancelConflict: noop, onForceOverwriteRemainingChange: noop, onContinueConflict: noop,
    };
    const html = renderToStaticMarkup(<BracketDialogs {...props} />);
    expect(html).toContain(`${enabled ? "Alias One" : "Original One"}: 2`);
    expect(html).toContain("Original Two: 1");
    expect(match.slots[0].entrantName).toBe("Original One");
  });

  it.each([true, false])("uses slot identity for random-side notices even when player cards are reversed (%s)", (enabled) => {
    const props: ComponentProps<typeof MatchDetailDialog> = {
      match, isLive: false, completed: false, matchupReady: true, busy: false,
      overlayBusy: false, scoreInputDisabled: false, scoreEditLocked: false, directWinnerId: null,
      displayPlayersBySide: true, onDisplayPlayersBySideChange: noop,
      randomNotice: {
        setId: match.setId, upperEntrantName: "Original One", lowerEntrantName: "Original Two",
        upperSide: "2P", lowerSide: "1P", changed: true, triggeredAt: 0,
      },
      resolvePlayerName: (entrantId, name) => resolveEntrantDisplayName(name, entrantId === "entrant-1" ? "Alias One" : "", enabled),
      players: [...match.slots].reverse().map((slot) => ({
        key: slot.entrantId!, slot, entrantId: slot.entrantId, entrantName: "Card Player",
        side: "", scoreValue: "", otherEntrantId: null,
      })),
      callNotices: [], calledEntrantIds: [], hasUnresolvedCalls: false, canResolveCalls: false,
      callingEntrantId: "", isDqDraft: false, overlayActive: false, overlayVisibilityOverrides: {},
      onClose: noop, onSwapSides: noop, onRandomizeSides: noop, onScoreAdjust: noop,
      onScoreChange: noop, onToggleWinner: noop, onSetDq: noop, onCall: noop,
      onDiscardDraft: noop, onResetSet: noop, onSaveDraft: noop, onResolveCalls: noop,
      onToggleOverlay: noop, onConfirm: noop,
    };
    const html = renderToStaticMarkup(<MatchDetailDialog {...props} />);
    expect(html).toContain(`上段 ${enabled ? "Alias One" : "Original One"} = 2P / 下段 Original Two = 1P`);
    expect(match.slots[0].entrantName).toBe("Original One");
  });
});

describe("all snapshot restore seed choice", () => {
  it("passes the selected seed policy and does nothing when cancelled", () => {
    const onRestore = vi.fn();
    const onCancel = vi.fn();
    const dialog = RestoreAllSeedsDialog({ busy: false, selectedEventName: "Event", onCancel, onRestore });
    const actions = dialog.props.children.props.children[2];
    actions.props.children[0].props.onClick();
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onRestore).not.toHaveBeenCalled();
    actions.props.children[1].props.onClick();
    expect(onRestore).toHaveBeenLastCalledWith(true);
    actions.props.children[2].props.onClick();
    expect(onRestore).toHaveBeenLastCalledWith(false);
  });

  it("offers preservation, discard, and cancellation as explicit choices", () => {
    const html = renderToStaticMarkup(
      <RestoreAllSeedsDialog
        busy={false}
        selectedEventName="Test Event"
        onCancel={vi.fn()}
        onRestore={vi.fn()}
      />,
    );
    expect(html).toContain('role="dialog"');
    expect(html).toContain("Test Event");
    expect(html).toContain("Seedの並び順を維持して復元");
    expect(html).toContain("Seedの並び替えも破棄して復元");
    expect(html).toContain("キャンセル");
    expect(html).not.toContain("disabled");
  });

  it("disables all choices while restoring", () => {
    const html = renderToStaticMarkup(
      <RestoreAllSeedsDialog busy selectedEventName="Event" onCancel={vi.fn()} onRestore={vi.fn()} />,
    );
    expect(html.match(/disabled=""/g)).toHaveLength(3);
  });
});
