import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  CallListPlayingCommunication,
  CallReactionDialog,
  StatusBoard,
  StatusBoardHero,
  type CallListEventGroup,
} from "./StatusBoard";
import type { FeatureMessage } from "../domain/messages";
import { AppShell } from "./AppShell";

const group: CallListEventGroup = {
  key: "group", tournamentId: "tournament", tournamentName: "Tournament",
  eventId: "event", eventName: "Event", eventAlias: "Event",
  phaseName: "Main", phaseGroupName: "A",
  players: [
    { messageId: "own", entrantId: "own", entrantName: "Own Player", senderName: "Me", isOwn: true, isPlaying: false, playingUntil: "", playingCommunication: "", dqRequest: null, createdAt: "2026-10-14T00:00:00Z" },
    { messageId: "remote", entrantId: "remote", entrantName: "Remote Player", senderName: "Caller", isOwn: false, isPlaying: false, playingUntil: "", playingCommunication: "", dqRequest: null, createdAt: "2026-10-14T00:00:00Z" },
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
      onResolveOwnCall={vi.fn()} onOpenCallReaction={vi.fn()}
      communicationDisabled={disabled}
      disableOwnCallActions={disableOwnCallActions} disableOtherCallActions={disableOtherCallActions} />,
  );
}
describe("feature-only navigation and call cards", () => {
  it("opens a reaction screen from remote cards while keeping own cards for resolution", () => {
    const html = board(false);
    expect(html).toContain('aria-label="Remote Player への呼び出しリアクション"');
    expect(html).not.toContain('aria-label="Own Player への呼び出しリアクション"');
  });
  it("labels the call-list broadcast control as sync", () => {
    const html = renderToStaticMarkup(
      <StatusBoardHero currentPage={1} totalPages={1} sortStrategy="alias" onToggleSort={vi.fn()}
        canBroadcastSync onBroadcastSync={vi.fn()} onNextPage={vi.fn()} pageProgressPercent={0} />,
    );
    expect(html).toMatch(/hero-call-list-head[\s\S]*call-list-hero-title[\s\S]*hero-call-list-toolbar[\s\S]*並び替え:[\s\S]*呼び出しの同期[\s\S]*call-list-page-big/);
    expect(html).toContain(">呼び出しの同期</button>");
  });
  it("disables remote reaction cards when communication is disabled", () => {
    expect(board(true)).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Remote Player への呼び出しリアクション"/);
  });
  it("locks own and remote call actions independently", () => {
    const ownLocked = board(false, true, false);
    expect(ownLocked).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Own Player の呼び出しを解決"/);
    expect(ownLocked).not.toMatch(/<button[^>]*disabled=""[^>]*aria-label="Remote Player への呼び出しリアクション"/);

    const remoteLocked = board(false, false, true);
    expect(remoteLocked).not.toMatch(/<button[^>]*disabled=""[^>]*aria-label="Own Player の呼び出しを解決"/);
    expect(remoteLocked).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Remote Player への呼び出しリアクション"/);
  });
  it("shows a DQ request badge on the corresponding own call card", () => {
    const html = renderToStaticMarkup(
      <StatusBoard eventGroups={[groupWithDqRequest]} activePage={[groupWithDqRequest]}
        hiddenUnresolvedCount={0} focusOwnUnresolved={false} onShowAllUnresolved={vi.fn()}
        resolvePhaseName={(_, phase) => phase} pageSwitchedAtMs={0} colorToRedSeconds={60}
        resolvePlayerName={(_, player) => player.entrantName} onResolveOwnCall={vi.fn()}
        onOpenCallReaction={vi.fn()} communicationDisabled={false}
        disableOwnCallActions={false} disableOtherCallActions={false} />,
    );
    expect(html).toContain("DQ申請あり");
    expect(html).toContain('aria-label="Own Player のDQ申請を確認"');
  });
  it("shows the active playing status and release action for its sender", () => {
    const activeGroup: CallListEventGroup = {
      ...group,
      players: [{
        ...group.players[1],
        isPlaying: true,
        playingUntil: "",
      }],
    };
    const html = renderToStaticMarkup(
      <StatusBoard eventGroups={[activeGroup]} activePage={[activeGroup]} hiddenUnresolvedCount={0}
        focusOwnUnresolved={false} onShowAllUnresolved={vi.fn()} resolvePhaseName={(_, phase) => phase}
        pageSwitchedAtMs={0} colorToRedSeconds={60} resolvePlayerName={(_, player) => player.entrantName}
        onResolveOwnCall={vi.fn()} onOpenCallReaction={vi.fn()}
        communicationDisabled={false} disableOwnCallActions={false} disableOtherCallActions={false} />,
    );
    expect(html).toContain("プレイ中(終了未定)");
  });
  it("shows the estimated remaining minutes for a playing notification", () => {
    const activeGroup: CallListEventGroup = {
      ...group,
      players: [{
        ...group.players[1],
        isPlaying: true,
        playingUntil: new Date(120_000).toISOString(),
      }],
    };
    const html = renderToStaticMarkup(
      <StatusBoard eventGroups={[activeGroup]} activePage={[activeGroup]} hiddenUnresolvedCount={0}
        focusOwnUnresolved={false} onShowAllUnresolved={vi.fn()} resolvePhaseName={(_, phase) => phase}
        pageSwitchedAtMs={0} colorToRedSeconds={60} resolvePlayerName={(_, player) => player.entrantName}
        onResolveOwnCall={vi.fn()} onOpenCallReaction={vi.fn()}
        communicationDisabled={false} disableOwnCallActions={false} disableOtherCallActions={false} />,
    );
    expect(html).toContain("プレイ中（あと約2分）");
  });
  it("offers DQ and playing actions from the call reaction screen", () => {
    const html = renderToStaticMarkup(
      <CallReactionDialog playerName="Remote Player" senderName="Caller"
        senderUserId="87654321" senderIp="192.168.1.20" isPlaying={false}
        playingUntil="" playingCommunication="" playingByMe={false} referenceMs={0} disabled={false}
        onRequestDq={vi.fn()} onNotifyPlaying={vi.fn()} onReleasePlaying={vi.fn()} onClose={vi.fn()} />,
    );
    expect(html).toContain('aria-label="呼び出しへのリアクション(Remote Player)"');
    expect(html).not.toContain('<p class="dialog-summary-title">Remote Player</p>');
    expect(html).toContain(">DQ申請</button>");
    expect(html).toContain(">プレイ中通知</button>");
  });
  it("offers release instead of a second playing notification when this device is active", () => {
    const html = renderToStaticMarkup(
      <CallReactionDialog playerName="Remote Player" senderName="Caller"
        senderUserId="87654321" senderIp="192.168.1.20" isPlaying playingUntil=""
        playingCommunication="少し遅れます" playingByMe referenceMs={0} disabled={false}
        onRequestDq={vi.fn()} onNotifyPlaying={vi.fn()} onReleasePlaying={vi.fn()} onClose={vi.fn()} />,
    );
    expect(html).toContain(">プレイ中通知を解除</button>");
    expect(html).not.toContain(">プレイ中通知</button>");
    expect(html).toContain("少し遅れます");
  });
  it("renders received playing communication for call-card details", () => {
    const html = renderToStaticMarkup(
      <CallListPlayingCommunication communication={"20分ほど遅れます\n先に開始してください"} />,
    );
    expect(html).toContain("通信欄");
    expect(html).toContain("20分ほど遅れます");
    expect(html).toContain("先に開始してください");
  });
  it("shows call, received playing, and pending DQ request counts in the sidebar", () => {
    const html = renderToStaticMarkup(
      <AppShell appVersion="" activeTab="bracket" onTabSelect={vi.fn()}
        otherDeviceCallCount={3} receivedPlayingCount={2} pendingDqRequestCount={4}
        sidebarSummary={null} message="" error="" statusProgresses={[]}><span /></AppShell>,
    );
    expect(html).toContain("呼出リスト");
    expect(html).toContain('aria-label="他端末呼び出し 3件"');
    expect(html).toContain('aria-label="受信したプレイ中通知 2件"');
    expect(html).toContain("tab-count-badge--calls");
    expect(html).toContain("tab-count-badge--playing");
    expect(html).toContain('aria-label="受信した未処理DQ申請 4件"');
    expect(html).toContain("tab-count-badge--dq");
    expect(html).not.toContain("メッセージ");
    expect(html).not.toContain("message-mode");
  });
});
