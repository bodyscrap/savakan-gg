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
import { OverlayComponentDialog } from "./OverlayComponentDialog";
import { OverlayPresetSwitchDialog } from "./OverlayPresetSwitchDialog";
import { OverlayPresetCopyDialog } from "./OverlayPresetCopyDialog";
import { OverlayPresetCreateDialog } from "./OverlayPresetCreateDialog";
import { OverlayColorInput } from "./OverlayColorInput";
import { OverlayFontControls } from "./OverlayFontControls";
import { OverlayLayoutEditor } from "./OverlayLayoutEditor";
import { newOverlayComponent, newOverlayPreset, type OverlayLayouts } from "../domain/overlayLayout";
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
    const props: ComponentProps<typeof OverlayControl> = {
      overlayState: { active: true, fullyStopped: false, currentSetId: "set-id", eventName: "大会", eventAlias: "別名", roundText: "Round 1", redPlayerName: "赤", bluePlayerName: "青", redSetWins: 1, blueSetWins: 2, fontScale: 1, overlayUrl: "http://localhost/overlay" },
      isTestOverlayActive: false, activeSetLabel: "日本語試合", busy: false,
      testEventAlias: "テスト大会", testRedName: "設定", testBlueName: "青プレイヤー", testRedWins: 1, testBlueWins: 2,
      testRedItems: ["選択A 選択B", "", "選択C"], testBlueItems: ["選択D", "選択E", ""],
      previewWrapRef: { current: null }, previewIframeRef: { current: null },
      onOpenUrl: noop,
      onTestRedNameChange: noop, onTestEventAliasChange: noop, onTestBlueNameChange: noop,
      onTestRedItemsChange: noop, onTestBlueItemsChange: noop,
      onTestRedWinsChange: noop, onTestBlueWinsChange: noop, onToggleTestOverlay: noop, onFullyStop: noop, onPreviewLoad: noop,
    };
    const html = renderToStaticMarkup(<OverlayControl {...props} />);
    expect(html).toContain("Stream settings Status: Live (set-id)");
    expect(html).toContain("Live set: 日本語試合");
    expect(html).toContain('title="Overlay preview"');
    expect(html).toContain('value="設定"');
    expect(html).toContain('value="青プレイヤー"');
    expect(html).toContain("Start test stream");
    expect(html).toContain("Dummy item lists (space-separated)");
    expect(html).toContain("Live streams show each player&#x27;s saved selections from Snapshot &amp; metadata settings.");
    for (const side of ["1P", "2P"]) {
      for (const category of [1, 2, 3]) expect(html).toContain(`${side} dummy items (category ${category})`);
    }
    expect(html).toContain('value="選択A 選択B"');
    expect(html).toContain("Preset to apply");
    expect(html).not.toContain("Saved presets are applied immediately. Unsaved edits are not applied.");
    expect(html).not.toContain("Test stream (stops automatically when leaving this tab)");
    expect(html).not.toContain("Save and apply");
    expect(html).not.toContain("Shrink player names to fit");
    const testStreamHtml = renderToStaticMarkup(<OverlayControl {...props} isTestOverlayActive />);
    expect(testStreamHtml).toContain("Stream settings Status: Test stream active");
  });

  it("translates the overlay component creation dialog", () => {
    setLanguage("en");
    const html = renderToStaticMarkup(<OverlayComponentDialog onCreate={() => true} onClose={noop} />);
    expect(html).toContain('aria-label="Create component"');
    expect(html).toContain("Component type");
    expect(html).toContain("Component name");
    expect(html).toMatch(/<label>Component name<input[^>]*value="Text"/);
    expect(html).toContain("Text");
    expect(html).toContain("Image");
    expect(html).toContain("Number");
    expect(html).toContain('<option value="item">Item</option>');
    expect(html).toContain('<option value="clock">Clock</option>');
    expect(html).toContain("This name identifies the component and is not displayed in the overlay.");
  });

  it("translates the preset creation dialog and initializes the default resolution", () => {
    setLanguage("en");
    const html = renderToStaticMarkup(<OverlayPresetCreateDialog onCreate={() => true} onClose={noop} />);
    expect(html).toContain("<dialog");
    expect(html).toContain('aria-label="New preset resolution"');
    expect(html).toContain("Canvas width");
    expect(html).toContain('value="1920"');
    expect(html).toContain("Canvas height");
    expect(html).toContain('value="1080"');
    expect(html).toContain("Create with this resolution");
    expect(html).toContain("The resolution cannot be changed after creation.");
    expect(html).toContain("Cancel");
    expect(html).not.toContain("Width and height are linked");
  });

  it("translates the preset duplication dialog and initializes the source resolution", () => {
    setLanguage("en");
    const source = newOverlayPreset({ width: 1080, height: 1920 });
    source.name = "Portrait";
    const html = renderToStaticMarkup(<OverlayPresetCopyDialog source={source} onCopy={() => true} onClose={noop} />);
    expect(html).toContain('<dialog');
    expect(html).toContain('aria-label="Duplicate preset"');
    expect(html).toContain("Source: Portrait (1080 × 1920)");
    expect(html).toContain("Canvas width");
    expect(html).toContain('value="1080"');
    expect(html).toContain("Canvas height");
    expect(html).toContain('value="1920"');
    expect(html).toContain("Width and height are linked to preserve the original aspect ratio.");
    expect(html).toContain("Duplicate with this resolution");
    expect(html).toContain("Cancel");
  });

  it("combines color and alpha controls in a compact custom picker", () => {
    setLanguage("en");
    const html = renderToStaticMarkup(<OverlayColorInput label="背景色" value="#12345680" onChange={noop} />);
    expect(html).toContain('class="overlay-color-swatch"');
    expect(html).toContain('style="background:#12345680"');
    expect(html).toContain("#12345680");
    expect(html).not.toContain('type="color"');
    expect(html).toContain('class="overlay-color-trigger"');
    expect(html).toContain('aria-label="Background color" aria-haspopup="dialog" aria-expanded="false"');
    expect(html).toContain('popover="auto" role="dialog"');
    expect(html).toContain("Color code");
    expect(html).toContain('value="#12345680"');
    expect(html).toContain("Hue");
    expect(html).toContain("Saturation");
    expect(html).toContain("Brightness");
    expect(html).toContain('aria-label="Background color opacity"');
    expect(html).toContain('aria-label="Background color alpha"');
    expect(html).toContain('type="number"');
    expect(html).toContain('min="0" max="255" step="1"');
    expect(html).toContain('value="128"');
    expect(html).toContain("0 is fully transparent; 255 is opaque.");
    expect(html.match(/type="range"/g)).toHaveLength(4);
    const transparent = renderToStaticMarkup(<OverlayColorInput label="文字色" value="transparent" onChange={noop} />);
    expect(transparent).toContain("#00000000");
    expect(transparent).toContain('aria-label="Text color alpha"');
    expect(transparent).toContain('value="0"');
  });

  it("combines filtering and selection in a selection-only font combobox", () => {
    setLanguage("en");
    const html = renderToStaticMarkup(<OverlayFontControls fontFamily={'"Yu Gothic", Arial, sans-serif'} fontSize={1000}
      onFontFamilyChange={noop} onFontSizeChange={noop}>
      <OverlayColorInput label="文字色" value="#ffffff" onChange={noop} />
      <label className="overlay-font-align">Text alignment<select defaultValue="left"><option value="left">Left</option></select></label>
      <label className="checkbox-row overlay-font-bold"><input type="checkbox" defaultChecked />Bold</label>
    </OverlayFontControls>);
    expect(html).toContain('class="overlay-font-family"');
    expect(html).not.toContain("<datalist");
    expect(html).toContain("Font family");
    expect(html).toContain('role="combobox"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-autocomplete="list"');
    expect(html).toContain('role="listbox"');
    expect(html).toContain('type="search"');
    expect(html).toContain("Show font candidates");
    expect(html).not.toContain("Font family (manual entry)");
    expect(html.match(/type="search"/g)).toHaveLength(1);
    expect(html).toContain("Typing only filters candidates.");
    expect(html).toContain('title="sans-serif"');
    expect(html).toContain('title="monospace"');
    expect(html).toContain('value="&quot;Yu Gothic&quot;, Arial, sans-serif"');
    expect(html).toContain('class="overlay-font-size"');
    expect(html).toContain('max="1000"');
    expect(html).toContain('value="1000"');
    expect(html.indexOf("Font size")).toBeLessThan(html.indexOf("Text color"));
    expect(html.indexOf("Text color")).toBeLessThan(html.indexOf("Text alignment"));
    expect(html.indexOf("Text alignment")).toBeLessThan(html.indexOf("Bold"));
    expect(html.indexOf("Bold")).toBeLessThan(html.indexOf("Loading fonts"));
    expect(html).toContain("Loading fonts");
  });

  it("lists every generic font independently of the current sans-serif setting", () => {
    setLanguage("en");
    const html = renderToStaticMarkup(<OverlayFontControls fontFamily="sans-serif" fontSize={48}
      onFontFamilyChange={noop} onFontSizeChange={noop} />);
    expect(html).toContain('value="sans-serif"');
    for (const family of ["serif", "monospace", "system-ui", "cursive", "fantasy"]) {
      expect(html).toContain(`title="${family}"`);
    }
    expect(html).not.toContain("Current setting:");
    expect(html).toContain('type="search"');
  });

  it("disables the font combobox, candidate toggle and font-size input while busy", () => {
    setLanguage("en");
    const html = renderToStaticMarkup(<OverlayFontControls fontFamily="sans-serif" fontSize={48} disabled
      onFontFamilyChange={noop} onFontSizeChange={noop} />);
    expect(html).toMatch(/<input[^>]*role="combobox"[^>]*disabled=""/);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Show font candidates"/);
    expect(html).toContain('aria-expanded="false"');
  });

  it("shows the default layout preview and its components as read-only", () => {
    setLanguage("en");
    const html = renderToStaticMarkup(<OverlayLayoutEditor
      state={{ active: false, fullyStopped: false, redPlayerName: "", bluePlayerName: "", redSetWins: 0, blueSetWins: 0, roundText: null, eventName: null, eventAlias: null }}
      savedLayouts={{ version: 1, activePresetId: null, presets: [] }} disabled={false}
      onSave={async (layouts) => layouts} />);
    expect(html).toContain('aria-label="Customization preview"');
    expect(html).toContain("Use Ctrl+mouse wheel over the preview to zoom from 25% to 400%.");
    expect(html).toMatch(/type="range"[^>]*min="25"[^>]*max="400"[^>]*step="1"/);
    expect(html).toContain('<option value="" selected="">Default</option>');
    expect(html).toContain("The default layout is read-only. Duplicate it to create an editable preset.");
    expect(html).toContain("overlay-layout-canvas");
    expect(html).not.toContain("overlay-layout-hit");
    expect(html).not.toContain("Component name");
    expect(html).not.toContain('draggable="true"');
    expect(html).not.toContain("Alt+ArrowUp");
    expect(html).not.toContain("overlay-selection-actions");
    const checkboxes = html.match(/<input[^>]*aria-label="Show [^"]*"[^>]*>/g) ?? [];
    expect(checkboxes).toHaveLength(8);
    for (const checkbox of checkboxes) expect(checkbox).toContain('disabled=""');
    expect(html).toContain('<fieldset class="overlay-centering-options" disabled=""');
  });

  it("offers save, discard, and cancel when switching presets with pending changes", () => {
    setLanguage("en");
    const html = renderToStaticMarkup(<OverlayPresetSwitchDialog
      onConfirm={noop} onDiscard={noop} onCancel={noop} />);
    expect(html).toContain("Unsaved changes");
    expect(html).toContain("What would you like to do with the current edits before selecting another preset?");
    expect(html).toContain("Save and switch");
    expect(html).toContain("Discard and switch");
    expect(html).toContain("Cancel switching");
  });

  it("lists frontmost components first with a leading visibility column without changing stored order", () => {
    setLanguage("en");
    const preset = newOverlayPreset();
    preset.components = [newOverlayComponent("text", "Back"), newOverlayComponent("number", "Front")];
    const layouts: OverlayLayouts = { version: 1, activePresetId: preset.id, presets: [preset] };
    const html = renderToStaticMarkup(<OverlayLayoutEditor
      state={{ active: false, fullyStopped: false, redPlayerName: "", bluePlayerName: "", redSetWins: 0, blueSetWins: 0, roundText: null, eventName: null, eventAlias: null }}
      savedLayouts={layouts} disabled={false} onSave={async (next) => next} />);
    expect(html).toContain('<th scope="col">Visible</th><th scope="col">Name</th><th scope="col">Type</th><th scope="col">Content</th>');
    const actions = html.slice(html.indexOf('class="overlay-component-actions"'));
    expect(actions.indexOf("Add new")).toBeLessThan(actions.indexOf("Duplicate"));
    expect(html.indexOf('title="Front"')).toBeLessThan(html.indexOf('title="Back"'));
    expect(html).toContain('aria-label="Show Front"');
    expect(html).toContain('aria-label="Show Back"');
    expect(html.match(/draggable="true"/g)).toHaveLength(2);
    expect(html).toContain("Alt+Up/Down also changes the display order.");
    expect(html).not.toContain("Shift-drag constrains movement");
    expect(html).toContain('aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"');
    expect(actions).not.toContain("Move backward");
    expect(actions).not.toContain("Move forward");
    expect(actions).toContain("Match sizes");
    expect(actions).toContain("Center selection");
    expect(html).not.toContain("<legend>Centering mode</legend>");
    expect(html).toContain('aria-label="Centering mode"');
    expect(html).toContain("Horizontal");
    expect(html).toContain("Vertical");
    expect(html).toContain("Both");
    const radios = html.match(/<input[^>]*type="radio"[^>]*>/g) ?? [];
    expect(radios).toHaveLength(3);
    expect(new Set(radios.map((radio) => radio.match(/name="([^"]+)"/)?.[1])).size).toBe(1);
    expect(radios.filter((radio) => radio.includes('checked=""'))).toHaveLength(1);
    expect(radios.find((radio) => radio.includes('checked=""'))).toContain('value="horizontal"');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Center selection<\/button>/);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Match sizes<\/button>/);
    expect(html).not.toContain("overlay-selection-actions");
    expect(preset.components.map((component) => component.name)).toEqual(["Back", "Front"]);
  });

  it("disables row dragging while the overlay editor is busy", () => {
    setLanguage("en");
    const preset = newOverlayPreset();
    const html = renderToStaticMarkup(<OverlayLayoutEditor
      state={{ active: false, fullyStopped: false, redPlayerName: "", bluePlayerName: "", redSetWins: 0, blueSetWins: 0, roundText: null, eventName: null, eventAlias: null }}
      savedLayouts={{ version: 1, activePresetId: preset.id, presets: [preset] }}
      disabled onSave={async (next) => next} />);
    expect(html).not.toContain('draggable="true"');
    expect(html).toContain('<fieldset class="overlay-centering-options" disabled=""');
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
