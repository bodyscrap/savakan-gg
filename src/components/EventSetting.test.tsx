import { Children, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setLanguage } from "../i18n";
import { EventSetting, type EventSettingProps } from "./EventSetting";

function setup(): EventSettingProps {
  return {
    event: {
      slug: "test", eventId: "event", hasSelectedEvent: true,
      tournamentName: "Tournament", eventName: "Event", busy: false,
      canUpdateSnapshot: false, eventAliasDraft: "", initialSeedPhaseName: "",
      initialSeedEntrantCount: 0, canShuffleInitialSeeds: false, canRestoreInitialSeeds: false,
    },
    rules: {
      sideDecisionMethod: "upper_1p", itemLists: [], categorySlotListIds: ["", "", ""],
      categorySlotMinCounts: [0, 0, 0], categorySlotMaxCounts: [1, 1, 1],
      categorySlotAllowDuplicates: [false, false, false], totalItemMinCount: 0,
      totalItemMaxCount: 3, useAliasName: false,
    },
    playerMeta: {
      selectedEventEntrants: [{ entrantId: "player", entrantName: "Player", aliasName: "日本語の名前" }],
      selectedEventMetaEntrantCount: 1, selectedEntrantId: "player", selectedEntrantName: "Player",
      selectedEntrantAliasName: "日本語の名前", selectedEntrantSkillTier: "", skillTierErrors: [],
      canRestoreSkillTier: false,
      configuredCategorySlots: [],
      selectedCategoryUsageList: [], draftSelectionsBySlot: [], validationErrors: [],
      canSavePlayerMeta: true,
    },
    actions: {
      onUpdateSnapshot: vi.fn(), onShuffleInitialSeeds: vi.fn(), onRestoreInitialSeeds: vi.fn(),
      onEventAliasDraftChange: vi.fn(), onSaveEventAlias: vi.fn(), onSideDecisionMethodChange: vi.fn(),
      onApplySideDecisionMethod: vi.fn(), onCategoryListChange: vi.fn(), onCategoryMinChange: vi.fn(),
      onCategoryMaxChange: vi.fn(), onCategoryAllowDuplicatesChange: vi.fn(), onTotalItemMinChange: vi.fn(),
      onTotalItemMaxChange: vi.fn(), onUseAliasNameChange: vi.fn(), onRefreshPlayerDisplay: vi.fn(),
      onSaveEventManagementSetting: vi.fn(), onSelectEntrant: vi.fn(), onAddDraftSelection: vi.fn(),
      onRemoveDraftSelection: vi.fn(), onSavePlayerAliasName: vi.fn(), onSavePlayerSkillTier: vi.fn(),
      onSkillTierChange: vi.fn(), onSavePlayerSelections: vi.fn(),
      onRestorePlayerSkillTier: vi.fn(),
      onEntrantAliasNameChange: vi.fn(),
    },
  };
}

function buttons(node: ReactNode): Array<{ label: string; disabled?: boolean; click?: () => void }> {
  return Children.toArray(node).flatMap((child) => {
    if (!isValidElement<{ children?: ReactNode; disabled?: boolean; onClick?: () => void }>(child)) return [];
    return child.type === "button"
      ? [{
        label: Children.toArray(child.props.children).join(""),
        disabled: child.props.disabled, click: child.props.onClick,
      }]
      : buttons(child.props.children);
  });
}

afterEach(() => setLanguage("ja"));

describe("player metadata save controls", () => {
  it.each([
    ["Alias", 7, '<span class="meta entrant-list-alias">Alias</span><span class="meta entrant-list-skill">Skill Tier: 7</span>'],
    ["", 0, '<span class="meta entrant-list-skill">Skill Tier: 0</span>'],
    ["Alias", null, '<span class="meta entrant-list-alias">Alias</span>'],
  ] as const)("combines alias %s and skill %s in one metadata row", (aliasName, skill, content) => {
    const props = setup();
    props.playerMeta.selectedEventEntrants[0] = {
      ...props.playerMeta.selectedEventEntrants[0], aliasName, skill,
    };
    const html = renderToStaticMarkup(<EventSetting {...props} />);
    expect(html).toContain(`<div class="entrant-list-meta-row">${content}</div>`);
  });

  it("omits the metadata row when neither alias nor skill is set", () => {
    const props = setup();
    props.playerMeta.selectedEventEntrants[0].aliasName = "";
    expect(renderToStaticMarkup(<EventSetting {...props} />)).not.toContain('class="entrant-list-meta-row"');
  });

  it("offers skill restoration only when an imported value exists, independently of validation", () => {
    const props = setup();
    const label = "Skill Tierを最新の取り込み値に戻す";
    expect(buttons(EventSetting(props)).find((button) => button.label === label)).toBeUndefined();
    props.playerMeta.canRestoreSkillTier = true;
    props.playerMeta.skillTierErrors = ["invalid"];
    props.playerMeta.validationErrors = ["invalid selections"];
    const restore = buttons(EventSetting(props)).find((button) => button.label === label);
    expect(restore?.disabled).toBe(false);
    restore?.click?.();
    expect(props.actions.onRestorePlayerSkillTier).toHaveBeenCalledOnce();
    props.playerMeta.canSavePlayerMeta = false;
    expect(buttons(EventSetting(props)).find((button) => button.label === label)?.disabled).toBe(true);
    setLanguage("en");
    expect(renderToStaticMarkup(<EventSetting {...props} />)).toContain("Restore latest imported skill tier");
  });

  it("collapses item category settings by default and combines the participant heading and count", () => {
    const html = renderToStaticMarkup(<EventSetting {...setup()} />);
    expect(html).toMatch(/<details class="item-category-settings"><summary><h3>アイテム選択カテゴリの設定<\/h3><\/summary>[\s\S]*設定の適用&amp;保存[\s\S]*<\/details>/);
    expect(html).not.toMatch(/<details[^>]*\bopen\b/);
    expect(html).toContain("<h3>参加者一覧(1 人)</h3>");
    expect(html).not.toContain("参加人数:");
    expect(html).not.toContain("プレイヤー一覧 (seed順)");
  });

  it("describes local seed shuffle without promising start.gg reporting", () => {
    const props = setup();
    props.event.isLocalEvent = true;
    props.event.canShuffleInitialSeeds = true;
    const html = renderToStaticMarkup(<EventSetting {...props} />);
    expect(html).toContain("不戦勝は開始済みに含みません。");
    expect(html).not.toContain("結果報告時にstart.ggへSeedを反映します。");
    expect(buttons(EventSetting(props)).find((button) => button.label === "Seedをシャッフル")?.disabled).toBe(false);
  });

  it("keeps the alias save enabled while invalid selections cannot be saved", () => {
    const props = setup();
    props.playerMeta.validationErrors = ["選択数が不足しています。"];
    const controls = buttons(EventSetting(props));
    expect(controls.find((button) => button.label === "エイリアス名を保存")?.disabled).toBe(false);
    expect(controls.find((button) => button.label === "アイテムの選択状態を保存")?.disabled).toBe(true);
    expect(controls.find((button) => button.label === "Skill Tierを保存")?.disabled).toBe(false);
    expect(renderToStaticMarkup(<EventSetting {...props} />)).not.toContain("このプレイヤーを保存");
  });

  it("binds each button to its own save action", () => {
    const props = setup();
    const controls = buttons(EventSetting(props));
    controls.find((button) => button.label === "エイリアス名を保存")?.click?.();
    expect(props.actions.onSavePlayerAliasName).toHaveBeenCalledOnce();
    expect(props.actions.onSavePlayerSelections).not.toHaveBeenCalled();
    controls.find((button) => button.label === "Skill Tierを保存")?.click?.();
    expect(props.actions.onSavePlayerSkillTier).toHaveBeenCalledOnce();
    controls.find((button) => button.label === "アイテムの選択状態を保存")?.click?.();
    expect(props.actions.onSavePlayerAliasName).toHaveBeenCalledOnce();
    expect(props.actions.onSavePlayerSelections).toHaveBeenCalledOnce();
  });

  it("places each metadata save button beside its input", () => {
    const html = renderToStaticMarkup(<EventSetting {...setup()} />);
    expect(html).toMatch(/entrant-meta-field-row"><label[^>]*>エイリアス名<input[\s\S]*?<\/label><button[^>]*>エイリアス名を保存<\/button><\/div>/);
    expect(html).toMatch(/entrant-meta-field-row"><label[^>]*>Skill Tier<input[\s\S]*?<\/label><button[^>]*>Skill Tierを保存<\/button><\/div>/);
  });

  it("disables both saves when saving is unavailable", () => {
    const props = setup();
    props.playerMeta.canSavePlayerMeta = false;
    const controls = buttons(EventSetting(props));
    expect(controls.find((button) => button.label === "エイリアス名を保存")?.disabled).toBe(true);
    expect(controls.find((button) => button.label === "アイテムの選択状態を保存")?.disabled).toBe(true);
    expect(controls.find((button) => button.label === "Skill Tierを保存")?.disabled).toBe(true);
  });

  it("provides English labels without translating the player's input", () => {
    setLanguage("en");
    const html = renderToStaticMarkup(<EventSetting {...setup()} />);
    expect(html).toContain("Save alias");
    expect(html).toContain("Save item selections");
    expect(html).toContain("Skill tier");
    expect(html).toContain("Save skill tier");
    expect(html).toContain("Item selection category settings");
    expect(html).toContain("Participants (1)");
    expect(html).toContain('value="日本語の名前"');
  });
});
