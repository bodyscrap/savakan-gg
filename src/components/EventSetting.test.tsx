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
      selectedEntrantAliasName: "日本語の名前", configuredCategorySlots: [],
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
      onRemoveDraftSelection: vi.fn(), onSavePlayerAliasName: vi.fn(), onSavePlayerSelections: vi.fn(),
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
  it("keeps the alias save enabled while invalid selections cannot be saved", () => {
    const props = setup();
    props.playerMeta.validationErrors = ["選択数が不足しています。"];
    const controls = buttons(EventSetting(props));
    expect(controls.find((button) => button.label === "プレイヤーエイリアス名を保存")?.disabled).toBe(false);
    expect(controls.find((button) => button.label === "アイテムの選択状態を保存")?.disabled).toBe(true);
    expect(renderToStaticMarkup(<EventSetting {...props} />)).not.toContain("このプレイヤーを保存");
  });

  it("binds each button to its own save action", () => {
    const props = setup();
    const controls = buttons(EventSetting(props));
    controls.find((button) => button.label === "プレイヤーエイリアス名を保存")?.click?.();
    expect(props.actions.onSavePlayerAliasName).toHaveBeenCalledOnce();
    expect(props.actions.onSavePlayerSelections).not.toHaveBeenCalled();
    controls.find((button) => button.label === "アイテムの選択状態を保存")?.click?.();
    expect(props.actions.onSavePlayerAliasName).toHaveBeenCalledOnce();
    expect(props.actions.onSavePlayerSelections).toHaveBeenCalledOnce();
  });

  it("disables both saves when saving is unavailable", () => {
    const props = setup();
    props.playerMeta.canSavePlayerMeta = false;
    const controls = buttons(EventSetting(props));
    expect(controls.find((button) => button.label === "プレイヤーエイリアス名を保存")?.disabled).toBe(true);
    expect(controls.find((button) => button.label === "アイテムの選択状態を保存")?.disabled).toBe(true);
  });

  it("provides English labels without translating the player's input", () => {
    setLanguage("en");
    const html = renderToStaticMarkup(<EventSetting {...setup()} />);
    expect(html).toContain("Save player alias");
    expect(html).toContain("Save item selections");
    expect(html).toContain('value="日本語の名前"');
  });
});
