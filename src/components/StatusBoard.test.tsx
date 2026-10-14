import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { StatusBoard, StatusBoardHero, type CallListEventGroup } from "./StatusBoard";
import type { FeatureMessage } from "../domain/messages";
import { AppShell } from "./AppShell";

const group: CallListEventGroup = {
  key: "group", tournamentId: "tournament", tournamentName: "Tournament",
  eventId: "event", eventName: "Event", eventAlias: "Event",
  phaseName: "Main", phaseGroupName: "A",
  players: [
    { messageId: "own", entrantId: "own", entrantName: "Own Player", senderName: "Me", isOwn: true, dqRequest: null, createdAt: "2026-10-14T00:00:00Z" },
    { messageId: "remote", entrantId: "remote", entrantName: "Remote Player", senderName: "Caller", isOwn: false, dqRequest: null, createdAt: "2026-10-14T00:00:00Z" },
  ],
};
const dqRequest: FeatureMessage = {
  messageId: "request", threadId: "request", parentMessageId: null,
  messageType: "dq_request", messageMeta: { dqCallMessageId: "own" },
  method: "player_dq_request", subject: "DQ申請", senderName: "Requester",
  senderUserId: "87654321", senderIp: "192.168.1.20", body: "DQ申請",
  createdAt: "2026-10-14T00:00:00Z", destination: "bracket",
};
const groupWithDqRequest: CallListEventGroup = {
  ...group,
  players: [{ ...group.players[0], dqRequest }, group.players[1]],
};
function board(disabled: boolean, disableOwnCallActions = false, disableOtherCallActions = false) {
  return renderToStaticMarkup(
    <StatusBoard eventGroups={[group]} activePage={[group]} hiddenUnresolvedCount={0}
      focusOwnUnresolved={false} onShowAllUnresolved={vi.fn()} resolvePhaseName={(_, phase) => phase}
      pageSwitchedAtMs={0} colorToRedSeconds={60} resolvePlayerName={(_, player) => player.entrantName}
      onResolveOwnCall={vi.fn()} onRequestDq={vi.fn()} communicationDisabled={disabled}
      disableOwnCallActions={disableOwnCallActions} disableOtherCallActions={disableOtherCallActions} />,
  );
}
describe("feature-only navigation and call cards", () => {
  it("makes remote cards DQ buttons while keeping own cards for resolution", () => {
    const html = board(false);
    expect(html).toContain('aria-label="Remote Player のDQ申請"');
    expect(html).toContain("クリックしてPLAYER ID認証付きDQ申請");
    expect(html).not.toContain('aria-label="Own Player のDQ申請"');
  });
  it("labels the call-list broadcast control as sync", () => {
    const html = renderToStaticMarkup(
      <StatusBoardHero currentPage={1} totalPages={1} sortStrategy="alias" onToggleSort={vi.fn()}
        canBroadcastSync onBroadcastSync={vi.fn()} onNextPage={vi.fn()} pageProgressPercent={0} />,
    );
    expect(html).toContain(">呼び出しの同期</button>");
  });
  it("disables remote DQ cards when communication is disabled", () => {
    expect(board(true)).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Remote Player のDQ申請"/);
  });
  it("locks own and remote call actions independently", () => {
    const ownLocked = board(false, true, false);
    expect(ownLocked).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Own Player の呼び出しを解決"/);
    expect(ownLocked).not.toMatch(/<button[^>]*disabled=""[^>]*aria-label="Remote Player のDQ申請"/);

    const remoteLocked = board(false, false, true);
    expect(remoteLocked).not.toMatch(/<button[^>]*disabled=""[^>]*aria-label="Own Player の呼び出しを解決"/);
    expect(remoteLocked).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Remote Player のDQ申請"/);
  });
  it("shows a DQ request badge on the corresponding own call card", () => {
    const html = renderToStaticMarkup(
      <StatusBoard eventGroups={[groupWithDqRequest]} activePage={[groupWithDqRequest]}
        hiddenUnresolvedCount={0} focusOwnUnresolved={false} onShowAllUnresolved={vi.fn()}
        resolvePhaseName={(_, phase) => phase} pageSwitchedAtMs={0} colorToRedSeconds={60}
        resolvePlayerName={(_, player) => player.entrantName} onResolveOwnCall={vi.fn()}
        onRequestDq={vi.fn()} communicationDisabled={false}
        disableOwnCallActions={false} disableOtherCallActions={false} />,
    );
    expect(html).toContain("DQ申請あり");
    expect(html).toContain('aria-label="Own Player のDQ申請を確認"');
  });
  it("does not offer a generic message tab or unread badge", () => {
    const html = renderToStaticMarkup(
      <AppShell appVersion="" activeTab="bracket" onTabSelect={vi.fn()} unresolvedCallCount={1}
        sidebarSummary={null} message="" error="" statusProgresses={[]}><span /></AppShell>,
    );
    expect(html).toContain("呼び出しリスト");
    expect(html).not.toContain("メッセージ");
    expect(html).not.toContain("message-mode");
  });
});
