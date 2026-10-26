import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultLocalEventRegistration, type RegisteredLocalParticipant } from "../domain/localEventRegistration";
import { LocalEventRegistration } from "./LocalEventRegistration";
import type { EventManagementMeta } from "../domain/tournamentWorkspaceRepository";
import { setLanguage } from "../i18n";

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
      ? [{ label: React.Children.toArray(child.props.children).join(""), click: child.props.onClick }]
      : buttons(child.props.children);
  });
}

function setup(draft: RegisteredLocalParticipant | null = null, settingDraft = setting, requireItemSelections = true) {
  const onChange = vi.fn();
  const onPendingChange = vi.fn();
  vi.mocked(React.useState)
    .mockImplementationOnce(() => [settingDraft, vi.fn()])
    .mockImplementationOnce(() => [draft, vi.fn()])
    .mockImplementationOnce(() => ["", vi.fn()]);
  vi.mocked(React.useEffect).mockImplementation((effect) => { effect(); });
  const tree = LocalEventRegistration({
    itemLists: setting.itemListSnapshots, registration: { requireItemSelections, setting, participants: [player] },
    onChange, onPendingChange, busy: false,
  });
  return { tree, onChange, onPendingChange, controls: buttons(tree) };
}

describe("local registration editor", () => {
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
      { ...player, name: "Alice edited", categorySelections: [["B"], [], []] },
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
      registration={registration} onChange={vi.fn()} onPendingChange={vi.fn()} busy={false} />);
    expect(html).toContain("local-registration-player incomplete");
    expect(html).toContain("選択未完了");
    expect(html).not.toContain("選択完了");
  });

  it("disables registration during unapplied category changes", () => {
    const { tree } = setup(null, { ...setting, categoryMinCounts: [2, 0, 0] });
    const html = renderToStaticMarkup(tree);
    expect(html).toContain('<button type="button" disabled="">参加登録</button>');
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
