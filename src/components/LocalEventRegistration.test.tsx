import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultLocalEventRegistration, type RegisteredLocalParticipant } from "../domain/localEventRegistration";
import { LocalEventRegistration } from "./LocalEventRegistration";
import type { EventManagementMeta } from "../domain/tournamentWorkspaceRepository";
import { setLanguage } from "../i18n";
import { LocalRegistrationCsvImport } from "./LocalRegistrationCsvImport";
import { importRegistrationCsv, parseRegistrationCsv } from "../domain/localRegistrationCsv";

function csvImport(node: React.ReactNode): React.ReactElement<React.ComponentProps<typeof LocalRegistrationCsvImport>> {
  const found = findCsvImport(node);
  if (found) return found;
  throw new Error("CSV import control not found");
}

function findCsvImport(node: React.ReactNode): React.ReactElement<React.ComponentProps<typeof LocalRegistrationCsvImport>> | undefined {
  for (const child of React.Children.toArray(node)) {
    if (!React.isValidElement<{ children?: React.ReactNode }>(child)) continue;
    if (child.type === LocalRegistrationCsvImport) {
      return child as React.ReactElement<React.ComponentProps<typeof LocalRegistrationCsvImport>>;
    }
    const found = findCsvImport(child.props.children);
    if (found) return found;
  }
  return undefined;
}

vi.mock("react", { spy: true });
afterEach(() => {
  vi.restoreAllMocks();
  setLanguage("ja");
});

const setting: EventManagementMeta = {
  ...defaultLocalEventRegistration().setting,
  itemListSnapshots: [{ id: "characters", name: "Characters", categoryName: "Character", items: ["A", "B"] }],
  categoryMinCounts: [1, 0, 0], categoryMaxCounts: [2, 0, 0],
};
const player: RegisteredLocalParticipant = {
  entrantId: "player", name: "Alice", categorySelections: [["A"], [], []], selectionsConfirmed: true,
};

function buttons(node: React.ReactNode): Array<{ label: string; click?: () => void }> {
  return React.Children.toArray(node).flatMap((child) => {
    if (!React.isValidElement<{ children?: React.ReactNode; onClick?: () => void }>(child)) return [];
    return child.type === "button"
      ? [{ label: renderToStaticMarkup(<>{child.props.children}</>).replace(/<[^>]*>/g, "").replace(/&amp;/g, "&"), click: child.props.onClick }]
      : buttons(child.props.children);
  });
}

function setup(draft: RegisteredLocalParticipant | null = null, settingDraft = setting, requireItemSelections = true) {
  const onChange = vi.fn();
  const onPendingChange = vi.fn();
  vi.mocked(React.useState)
    .mockImplementationOnce(() => [settingDraft, vi.fn()])
    .mockImplementationOnce(() => [draft, vi.fn()])
    .mockImplementationOnce(() => ["", vi.fn()])
    .mockImplementationOnce(() => ["", vi.fn()])
    .mockImplementationOnce(() => [false, vi.fn()]);
  vi.mocked(React.useEffect).mockImplementation((effect) => { effect(); });
  const tree = LocalEventRegistration({
    itemLists: setting.itemListSnapshots, registration: { requireItemSelections, setting, participants: [player] },
    onChange, onPendingChange, busy: false, onImportEventName: vi.fn(),
  });
  return { tree, onChange, onPendingChange, controls: buttons(tree) };
}

describe("local registration editor", () => {
  it("clears all participants while preserving category settings", () => {
    const { controls, onChange } = setup(player);
    const clear = controls.find((button) => button.label === "参加者を全員クリア");
    expect(clear).toBeDefined();
    clear?.click?.();
    expect(onChange).toHaveBeenCalledWith({ requireItemSelections: true, setting, participants: [] });
  });

  it("disables clearing when no participants are registered", () => {
    const registration = { requireItemSelections: true, setting, participants: [] };
    const html = renderToStaticMarkup(<LocalEventRegistration itemLists={setting.itemListSnapshots}
      registration={registration} onChange={vi.fn()} onPendingChange={vi.fn()} onImportEventName={vi.fn()} busy={false} />);
    expect(html).toContain('<button type="button" class="ghost" disabled="">参加者を全員クリア</button>');
  });

  it("shows a relative skill tier field for every registered participant editor", () => {
    const { tree } = setup(player);
    const html = renderToStaticMarkup(<>{tree}</>);
    expect(html).toContain("Skill Tier");
    expect(html).toContain("大きい値ほど高Skillとして扱い、未設定は0として扱います。");
    expect(html).toMatch(/local-registration-name-skill-row"><label[^>]*>プレイヤー名[\s\S]*?<\/label><label[^>]*>Skill Tier[\s\S]*?<\/label><\/div>/);
    expect(html).toContain('class="local-registration-skill-tier-input" type="number"');
  });

  it("keeps CSV import enabled while a participant is selected for editing", () => {
    const { tree, onChange } = setup({ ...player, name: "Unsaved edit" });
    const control = csvImport(tree);
    expect(control.props.disabled).toBe(false);
    const replacements = [{ ...player, entrantId: "imported", name: "Imported" }];
    control.props.onImport(replacements, "大会");
    expect(onChange.mock.calls[0][0].participants).toEqual(replacements);
  });

  it("keeps CSV import enabled after committing imported category settings", () => {
    const { tree } = setup();
    const control = csvImport(tree);
    expect(control.props.disabled).toBe(false);
    expect(control.props.registration.setting).toEqual(setting);
  });

  it("imports using unapplied category settings and commits settings with replacement participants", () => {
    const changed = { ...setting, itemListSnapshots: [
      { id: "robots", name: "Robots", categoryName: "Robot", items: ["ジャッカル"] },
    ] };
    const { tree, onChange } = setup(null, changed);
    const control = csvImport(tree);
    expect(control.props.disabled).toBe(false);
    expect(control.props.registration.setting.itemListSnapshots).toEqual(changed.itemListSnapshots);
    expect(onChange).not.toHaveBeenCalled();
    const players = importRegistrationCsv(parseRegistrationCsv("name,item\nBob,ジャッカル"),
      { name: 0, categories: [1, null, null] }, control.props.registration);
    control.props.onImport(players, "大会");
    expect(onChange.mock.calls[0][0]).toMatchObject({
      setting: changed,
      participants: [{ name: "Bob", categorySelections: [["ジャッカル"], [], []] }],
    });
    expect(onChange.mock.calls[0][0].participants).toHaveLength(1);
  });

  it("does not allow importing with invalid draft category limits", () => {
    const { tree } = setup(null, { ...setting, categoryMinCounts: [3, 0, 0], categoryMaxCounts: [2, 0, 0] });
    expect(csvImport(tree).props.disabled).toBe(true);
  });

  it("collapses category settings through the save button by default and puts the count in the list heading", () => {
    const { tree } = setup();
    const html = renderToStaticMarkup(tree);
    expect(html).toMatch(/<details class="item-category-settings"><summary><h3>アイテム選択カテゴリの設定<\/h3><\/summary>[\s\S]*設定の適用&amp;保存[\s\S]*<\/details>/);
    expect(html).not.toMatch(/<details[^>]*\bopen\b/);
    expect(html).toContain("<h3>参加者一覧(1 人)</h3>");
    expect(html).not.toContain("参加人数:");
    expect(html).not.toContain("プレイヤー一覧 (seed順)");
  });

  it("adds a new participant and preserves the existing seed order", () => {
    const { controls, onChange, onPendingChange } = setup({ ...player, entrantId: "new", name: " Bob " });
    controls.find((button) => button.label === "参加者を保存")?.click?.();
    expect(onChange.mock.calls[0][0].participants.map((participant: RegisteredLocalParticipant) => participant.name))
      .toEqual(["Alice", "Bob"]);
    expect(onPendingChange).toHaveBeenCalledWith(true);
  });

  it("updates an existing participant without adding another entrant", () => {
    const { controls, onChange } = setup({ ...player, name: "Alice edited", categorySelections: [["B"], [], []] });
    controls.find((button) => button.label === "参加者を保存")?.click?.();
    expect(onChange.mock.calls[0][0].participants).toEqual([
      { ...player, name: "Alice edited", categorySelections: [["B"], [], []], skill: null },
    ]);
  });

  it("allows an incomplete registration but marks it incomplete", () => {
    const { controls, onChange, tree } = setup({ ...player, categorySelections: [[], [], []] }, setting, false);
    expect(renderToStaticMarkup(tree)).toContain('<button type="button">参加者を保存</button>');
    controls.find((button) => button.label === "参加者を保存")?.click?.();
    expect(onChange.mock.calls[0][0].participants[0].selectionsConfirmed).toBe(false);
  });

  it("deletes the selected participant", () => {
    const { controls, onChange } = setup(player);
    controls.find((button) => button.label === "参加者を削除")?.click?.();
    expect(onChange.mock.calls[0][0].participants).toEqual([]);
  });

  it("clears invalid saved selections when applying category changes", () => {
    const { controls, onChange, onPendingChange } = setup(null, { ...setting, categoryMinCounts: [2, 0, 0] });
    controls.find((button) => button.label === "設定の適用&保存")?.click?.();
    expect(onChange.mock.calls[0][0].participants[0]).toMatchObject({
      categorySelections: [[], [], []], selectionsConfirmed: false,
    });
    expect(onPendingChange).toHaveBeenCalledWith(true);
  });

  it("renders a visible incomplete status", () => {
    const registration = { requireItemSelections: true, setting, participants: [{ ...player, selectionsConfirmed: false }] };
    const html = renderToStaticMarkup(<LocalEventRegistration itemLists={setting.itemListSnapshots}
      registration={registration} onChange={vi.fn()} onPendingChange={vi.fn()} onImportEventName={vi.fn()} busy={false} />);
    expect(html).toContain("local-registration-player incomplete");
    expect(html).toContain("選択未完了");
    expect(html).not.toContain("選択完了");
  });

  it("allows registration and applies pending category changes before adding", () => {
    const { tree, controls, onChange } = setup(null, { ...setting, categoryMinCounts: [2, 0, 0] });
    const html = renderToStaticMarkup(tree);
    expect(html).toContain('<button type="button">参加登録</button>');
    controls.find((button) => button.label === "参加登録")?.click?.();
    expect(onChange.mock.calls[0][0].setting.categoryMinCounts).toEqual([2, 0, 0]);
  });

  it("allows selecting an imported participant after changing category lists", () => {
    const changed = { ...setting, itemListSnapshots: [
      { id: "new", name: "New", categoryName: "New", items: ["C"] },
    ] };
    const { tree, onChange } = setup(null, changed);
    expect(renderToStaticMarkup(tree)).toContain("Alice");
    const playerButton = buttons(tree).find((button) => button.label.includes("選択未完了"));
    expect(playerButton).toBeDefined();
    playerButton?.click?.();
    expect(onChange.mock.calls[0][0].participants[0].categorySelections).toEqual([[], [], []]);
    expect(onChange.mock.calls[0][0].setting.itemListSnapshots).toEqual(changed.itemListSnapshots);
  });

  it("saves an open editor against pending settings without restoring removed items", () => {
    const changed = { ...setting, itemListSnapshots: [
      { ...setting.itemListSnapshots[0], items: ["B"] },
    ], categoryMinCounts: [0, 0, 0] };
    const { controls, onChange } = setup(player, changed, false);
    controls.find((button) => button.label === "参加者を保存")?.click?.();
    expect(onChange.mock.calls[0][0].setting).toEqual(changed);
    expect(onChange.mock.calls[0][0].participants[0].categorySelections).toEqual([[], [], []]);
  });

  it("disables saving an incomplete participant when item registration is required", () => {
    const { tree } = setup({ ...player, categorySelections: [[], [], []] });
    expect(renderToStaticMarkup(tree)).toContain('<button type="button" disabled="">参加者を保存</button>');
    expect(renderToStaticMarkup(tree)).toContain('type="checkbox" checked=""/>アイテム登録は必須');
  });

  it("preserves optional registration when applying category settings", () => {
    const { controls, onChange } = setup(null, { ...setting, categoryMinCounts: [2, 0, 0] }, false);
    controls.find((button) => button.label === "設定の適用&保存")?.click?.();
    expect(onChange.mock.calls[0][0].requireItemSelections).toBe(false);
  });

  it("translates the editor controls without translating player input", () => {
    setLanguage("en");
    const { tree } = setup({ ...player, name: "登録プレイヤー" });
    const html = renderToStaticMarkup(tree);
    expect(html).toContain("Participants and item settings");
    expect(html).toContain("Player name");
    expect(html).toContain("Save participant");
    expect(html).toContain('value="登録プレイヤー"');
  });
});
