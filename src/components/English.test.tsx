import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setLanguage } from "../i18n";
import { componentTranslations } from "../i18n/components";
import type { FeatureMessage } from "../domain/messages";
import { AppShell } from "./AppShell";
import { RestoreAllSeedsDialog } from "./BracketDialogs";
import { BracketSetCard } from "./BracketSetCard";
import { PlayerDqRequestPanel, ExternalReportRequestPanel } from "./BracketTab";
import { DqRequestDialog } from "./DqRequestDialog";
import { ItemListEditor } from "./ItemListEditor";
import { OverlayControl } from "./OverlayControl";
import { SettingsScreen } from "./SettingMenu";
import { CallListPlayingCommunication, CallReactionDialog, formatCallElapsedTime } from "./StatusBoard";
import { ReferenceStreamMatchInfo, StreamStartEditor, YoutubeChapters } from "./YoutubeChapters";

afterEach(() => {
  setLanguage("ja");
});

const noop = () => {};
const request: FeatureMessage = {
  messageId: "request-id", threadId: "thread-id", parentMessageId: null, messageType: "normal",
  method: "external_edit_request", destination: "bracket", messageMeta: null,
  subject: "Request", body: "理由は日本語のまま", senderName: "日本語送信者", senderUserId: "12345678",
  senderIp: "192.168.1.20", createdAt: "2026-10-20T00:00:00Z",
};

const settingsProps: ComponentProps<typeof SettingsScreen> = {
  disableLocalCommunication: false,
  onDisableLocalCommunicationChange: noop,
  senderNameDraft: "送信者・日本語 {value1}",
  onSenderNameChange: noop,
  senderUserIdDraft: "12345678",
  onSenderUserIdChange: noop,
  networkCandidates: [{ key: "device-id", label: "日本語ネットワーク" }],
  selectedNetworkCandidateKey: "device-id",
  onNetworkCandidateChange: noop,
  networkCandidatesLoading: false,
  senderSettingsStatus: "",
  onRefreshNetworkCandidates: noop,
  onRandomizeSenderUserId: noop,
  onOpenSenderUserList: noop,
  onSaveSenderProfile: noop,
  onCancelSenderProfile: noop,
  canSaveSenderProfile: true,
  canCancelSenderProfile: true,
  mobileInputPollingMs: 1500,
  mobileInputPollingMsMin: 500,
  mobileInputPollingMsMax: 10000,
  onMobileInputPollingMsChange: noop,
  onMobileInputPollingMsBlur: noop,
  callListPageRotateSeconds: 10,
  callListRotateSecondsMin: 1,
  callListRotateSecondsMax: 180,
  onCallListPageRotateSecondsChange: noop,
  onCallListPageRotateSecondsBlur: noop,
  callListColorSeconds: 180,
  callListColorSecondsMin: 30,
  callListColorSecondsMax: 3600,
  onCallListColorSecondsChange: noop,
  onCallListColorSecondsBlur: noop,
  hasCallListMessages: false,
  onClearCallList: noop,
  disableOwnCallActions: false,
  onDisableOwnCallActionsChange: noop,
  disableOtherCallActions: false,
  onDisableOtherCallActionsChange: noop,
};

describe("English component rendering", () => {
  it("offers both languages in settings and preserves editable user data", () => {
    setLanguage("en");
    const html = renderToStaticMarkup(<SettingsScreen {...settingsProps} />);
    expect(html).toContain("言語 / Language");
    expect(html).toContain('<option value="ja">日本語</option>');
    expect(html).toContain('<option value="en" selected="">English</option>');
    expect(html).toContain("Sender settings");
    expect(html).toContain("Network device");
    expect(html).toContain("Mobile input sync settings");
    expect(html).toContain("Call list settings");
    expect(html).toContain('placeholder="e.g. Stream PC-A"');
    expect(html).toContain('value="送信者・日本語 {value1}"');
    expect(html).toContain("日本語ネットワーク");
    expect(html).toContain('value="12345678"');

    setLanguage("ja");
    const japanese = renderToStaticMarkup(<SettingsScreen {...settingsProps} />);
    expect(japanese).toContain("送信者設定");
    expect(japanese).toContain('<option value="ja" selected="">日本語</option>');
  });

  it("translates navigation, accessibility labels and badges without translating snapshot names", () => {
    setLanguage("en");
    const html = renderToStaticMarkup(
      <AppShell
        appVersion="1.2.3"
        activeTab="bracket"
        onTabSelect={noop}
        otherDeviceCallCount={2}
        receivedPlayingCount={3}
        pendingDqRequestCount={4}
        sidebarSummary={{ name: "設定", slug: "tournament/日本語" }}
        message=""
        error=""
        statusProgresses={[]}
      >
        <p>大会のユーザーデータ</p>
      </AppShell>,
    );
    expect(html).toContain('aria-label="Main tabs"');
    expect(html).toContain('title="Bracket"');
    expect(html).toContain("<h2>Bracket</h2>");
    expect(html).toContain('aria-label="Manage selected snapshot: 設定"');
    expect(html).toContain('class="summary-name">設定</span>');
    expect(html).toContain("2 calls from other devices");
    expect(html).toContain("3 received playing notifications");
    expect(html).toContain("4 pending DQ requests received");
    expect(html).toContain("Idle");
    expect(html).toContain("大会のユーザーデータ");
  });

  it("translates memoized model status labels only at display boundaries", () => {
    setLanguage("en");
    const html = renderToStaticMarkup(
      <BracketSetCard
        positionY={0}
        changeClass=""
        displayCode="A1"
        resultStatus="confirmed"
        resultStatusLabel="確定"
        isLiveOverlaySet
        slots={[{ key: "entrant-id", sideLabel: "1P", sideBadgeClass: "", entrantName: "確定", gameWins: 2, scoreClass: "" }]}
        onActivate={noop}
        onOpen={noop}
      />,
    );
    expect(html).toContain('status-confirmed">Confirm</span>');
    expect(html).toContain('class="set-live-badge">Live</span>');
    expect(html).toContain('class="simple-player-name">確定</span>');
    expect(html).toContain("Set A1");
    expect(html).toContain(">1P</span>");
  });

  it("translates restore actions and preserves event names in interpolation", () => {
    setLanguage("en");
    const onRestore = vi.fn();
    const html = renderToStaticMarkup(
      <RestoreAllSeedsDialog busy={false} selectedEventName="設定 {value1}" onCancel={noop} onRestore={onRestore} />,
    );
    expect(html).toContain('aria-label="Seed handling for full restore"');
    expect(html).toContain("Target: 設定 {value1}");
    expect(html).toContain("Restore and preserve seed order");
    expect(html).toContain("Restore and discard seed changes");
    expect(html).toContain(">Cancel</button>");
    const dialog = RestoreAllSeedsDialog({ busy: false, selectedEventName: "設定", onCancel: noop, onRestore });
    dialog.props.children.props.children[2].props.children[1].props.onClick();
    expect(onRestore).toHaveBeenCalledWith(true);
  });

  it("translates request banners while leaving request content untouched", () => {
    setLanguage("en");
    const external = renderToStaticMarkup(
      <ExternalReportRequestPanel request={request} canAccept canRespond onAccept={noop} onReject={noop} />,
    );
    expect(external).toContain("External reporting request received");
    expect(external).toContain("日本語送信者");
    expect(external).toContain(">Accept</button>");
    expect(external).toContain(">Reject</button>");
    const dq = renderToStaticMarkup(
      <PlayerDqRequestPanel requests={[request]}
        busy={false} onProcess={noop} onDiscard={noop} />,
    );
    expect(dq).toContain("DQ requests received");
    expect(dq).toContain("理由は日本語のまま");
    expect(dq).toContain(">Review DQ request</button>");
  });

  it("translates call reactions, elapsed time and labels, not player messages", () => {
    setLanguage("en");
    const html = renderToStaticMarkup(
      <CallReactionDialog
        playerName="設定 {value1}" senderName="送信者" senderUserId="12345678" senderIp="192.168.1.2"
        isPlaying playingUntil="" playingCommunication="呼出への日本語メッセージ" playingByMe referenceMs={0} disabled={false}
        onRequestDq={noop} onNotifyPlaying={noop} onReleasePlaying={noop} onClose={noop}
      />,
    );
    expect(html).toContain('aria-label="Call reaction (設定 {value1})"');
    expect(html).toContain("Caller: 送信者 / ID: 12345678 / IP: 192.168.1.2");
    expect(html).toContain("Playing (end time not set)");
    expect(html).toContain("Release playing notification");
    expect(html).toContain("呼出への日本語メッセージ");
    expect(formatCallElapsedTime("invalid", 0)).toBe("00h 00m elapsed");
    expect(formatCallElapsedTime("2026-10-20T00:00:00Z", Date.parse("2026-10-20T01:23:00Z"))).toBe("01h 23m elapsed");
    expect(renderToStaticMarkup(<CallListPlayingCommunication communication="設定" />)).toContain("<p>設定</p>");
  });

  it("translates DQ input prompts and placeholders", () => {
    setLanguage("en");
    const props: ComponentProps<typeof DqRequestDialog> = {
      dialog: { call: request, expectedPlayerId: "PG-1234", callEntrantId: "entrant-id", callEntrantName: "参加者" },
      playerIdDraft: "PG-1234", onPlayerIdChange: noop,
      reasonDraft: "日本語の理由", onReasonChange: noop, cameraActive: false,
      error: "", videoRef: { current: null }, canvasRef: { current: null },
      onStartCameraScan: noop, onStopCameraScan: noop, submitting: false, onSubmit: noop, onClose: noop,
    };
    const html = renderToStaticMarkup(<DqRequestDialog {...props} />);
    expect(html).toContain('aria-label="DQ request (参加者)"');
    expect(html).toContain("Verify and request DQ");
    expect(html).toContain('placeholder="Enter additional details"');
    expect(html).toContain("日本語の理由");
  });

  it("translates overlay state and controls without changing test names", () => {
    setLanguage("en");
    const html = renderToStaticMarkup(
      <OverlayControl
        overlayState={{ active: true, fullyStopped: false, currentSetId: "set-id", eventName: "大会", eventAlias: "別名", roundText: "Round 1", redPlayerName: "赤", bluePlayerName: "青", redSetWins: 1, blueSetWins: 2, fontScale: 1, nameFitMode: "truncate", showSetInfo: true, showEventAlias: true, overlayUrl: "http://localhost/overlay" }}
        isTestOverlayActive={false} activeSetLabel="日本語試合" busy={false}
        testEventAlias="テスト大会" testRedName="設定" testBlueName="青プレイヤー" testRedWins={1} testBlueWins={2}
        previewWrapRef={{ current: null }} previewIframeRef={{ current: null }}
        onOpenUrl={noop} onNameFitModeChange={noop} onShowSetInfoChange={noop} onShowEventAliasChange={noop}
        onTestRedNameChange={noop} onTestEventAliasChange={noop} onTestBlueNameChange={noop}
        onTestRedWinsChange={noop} onTestBlueWinsChange={noop} onToggleTestOverlay={noop} onFullyStop={noop} onPreviewLoad={noop}
      />,
    );
    expect(html).toContain("Status: Live (set-id)");
    expect(html).toContain("Live set: 日本語試合");
    expect(html).toContain('title="Overlay preview"');
    expect(html).toContain('value="設定"');
    expect(html).toContain('value="青プレイヤー"');
    expect(html).toContain("Start test stream");
  });

  it("translates item list editing labels while preserving list and item names", () => {
    setLanguage("en");
    const props: ComponentProps<typeof ItemListEditor> = {
      itemListName: "設定", itemCategoryName: "キャラクター", itemListText: "参加者のアイテム",
      onItemListNameChange: noop, onItemCategoryNameChange: noop, onItemListTextChange: noop,
      isEditing: false, onSave: noop, onReset: noop, onImportItemList: noop,
      searchInput: "", onSearchInputChange: noop, filteredItemLists: [],
      onEditItemList: noop, onDeleteItemList: noop, onExportItemList: noop, busy: false,
    };
    const html = renderToStaticMarkup(<ItemListEditor {...props} />);
    expect(html).toContain("Item list editor");
    expect(html).toContain('placeholder="One item name per line"');
    expect(html).toContain('value="設定"');
    expect(html).toContain("参加者のアイテム");
  });

  it("translates video chapter screens and preserves reference match text", () => {
    setLanguage("en");
    const set = { setId: "set-id", setLabel: "日本語フェーズ / Pool A", matchup: "設定 vs ブラケット", startedAt: Date.parse("2026-10-20T00:00:00Z") };
    const html = renderToStaticMarkup(
      <>
        <ReferenceStreamMatchInfo count={3} set={set} />
        <StreamStartEditor set={set} disabled={false} onUpdate={async () => {}} />
        <YoutubeChapters slug="tournament/test" eventId="event" useAliasName={false} />
      </>,
    );
    expect(html).toContain('aria-label="Reference match information"');
    expect(html).toContain("Reference match (3 stream records)");
    expect(html).toContain("設定 vs ブラケット");
    expect(html).toContain("日本語フェーズ / Pool A");
    expect(html).toContain("Edit recorded date and time");
    expect(html).toContain("Video chapter generator");
    expect(html).toContain("Generate text");
    expect(html).toContain('placeholder="e.g. 00:05:30"');
  });

  it("provides nonempty translations with exactly the same interpolation slots", () => {
    for (const [source, english] of Object.entries(componentTranslations)) {
      expect(english, source).not.toBe("");
      const placeholders = (value: string) => [...value.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
      expect(placeholders(english), source).toEqual(placeholders(source));
    }
  });
});
