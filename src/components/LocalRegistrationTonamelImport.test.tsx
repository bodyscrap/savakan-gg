import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { invoke } from "@tauri-apps/api/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalRegistrationTonamelImport } from "./LocalRegistrationTonamelImport";
import { defaultLocalEventRegistration } from "../domain/localEventRegistration";
import { importTonamelParticipants, type TonamelEvent } from "../domain/localRegistrationTonamel";

vi.mock("react", { spy: true });
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const source: TonamelEvent = {
  eventName: "20260726第2回2XKO中級者大会",
  columns: [{ id: "character-question", label: "Favorite character" }],
  users: [
    { id: "entrant-1", name: "テンカク", serialNumber: 1, status: "ENTRY", answers: { "character-question": "A,B" } },
    { id: "entrant-2", name: "フルネームのエントリー", serialNumber: 2, status: "ENTRY", answers: { "character-question": "B" } },
  ],
};

function setup({ data = source as TonamelEvent | null, existing = false, mappings = [null, null, null] as Array<string | null> } = {}) {
  const registration = defaultLocalEventRegistration();
  registration.setting.itemListSnapshots = [{ id: "characters", name: "Characters", categoryName: "Fighter", items: ["A", "B"] }];
  registration.setting.categoryMaxCounts = [2, 0, 0];
  const participants = data ? importTonamelParticipants(data.users, registration) : null;
  if (existing) registration.participants = [{ entrantId: "old", name: "Old", categorySelections: [[], [], []], selectionsConfirmed: false }];
  const onImport = vi.fn();
  const onPendingChange = vi.fn();
  const setOpen = vi.fn();
  const setSource = vi.fn();
  const setBaseParticipants = vi.fn();
  const setCategoryMappings = vi.fn();
  const setError = vi.fn();
  const setLoading = vi.fn();
  vi.mocked(React.useState).mockImplementationOnce(() => [true, setOpen]);
  vi.mocked(React.useEffect).mockImplementation((effect) => { effect(); });
  vi.mocked(React.useRef).mockReturnValue({ current: null });
  const tree = LocalRegistrationTonamelImport({ registration, disabled: false, onImport, onPendingChange });
  const element = tree.props.children[1];
  vi.mocked(React.useState)
    .mockImplementationOnce(() => ["https://tonamel.com/competition/GGzJP", vi.fn()])
    .mockImplementationOnce(() => [data, setSource])
    .mockImplementationOnce(() => [participants, setBaseParticipants])
    .mockImplementationOnce((initial?: unknown): [unknown, React.Dispatch<unknown>] => [mappings ?? initial, setCategoryMappings])
    .mockImplementationOnce(() => [false, setLoading])
    .mockImplementationOnce(() => ["", setError]);
  const dialog = element.type(element.props);
  const form = dialog.props.children;
  const actions = form.props.children[2].props.children;
  return { dialog, form, actions, onImport, onPendingChange, setOpen, setSource, setBaseParticipants, setCategoryMappings, setError, setLoading,
    participants };
}

function findSelect(node: React.ReactNode): React.ReactElement<{
  children?: React.ReactNode;
  onChange?: (event: { currentTarget: { value: string } }) => void;
}> | undefined {
  for (const child of React.Children.toArray(node)) {
    if (!React.isValidElement<{
      children?: React.ReactNode;
      onChange?: (event: { currentTarget: { value: string } }) => void;
    }>(child)) continue;
    if (child.type === "select") return child;
    const found = findSelect(child.props.children);
    if (found) return found;
  }
  return undefined;
}

describe("Tonamel import dialog", () => {
  it("shows the event title and full entry names in a table", () => {
    const { dialog, onPendingChange } = setup();
    const html = renderToStaticMarkup(dialog);
    expect(html).toContain("event名: 20260726第2回2XKO中級者大会");
    expect(html).toContain('<th scope="col">ユーザー名</th><th scope="col">参加区分</th>');
    expect(html).toContain("フルネームのエントリー");
    expect(html).toContain("Characters/Fighter");
    expect(html).toContain('<option value="character-question">Favorite character</option>');
    expect(html.match(/<tr>/g)).toHaveLength(3);
    expect(html).toContain("出場");
    expect(onPendingChange).toHaveBeenCalledWith(true);
  });

  it("fetches participants from a competition top-page URL", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(source);
    const { form, setSource, setBaseParticipants, setLoading } = setup({ data: null });
    form.props.onSubmit({ preventDefault: vi.fn() });
    await vi.waitFor(() => expect(setLoading).toHaveBeenLastCalledWith(false));
    expect(invoke).toHaveBeenCalledWith("fetch_tonamel_participants", { url: "https://tonamel.com/competition/GGzJP" });
    expect(setSource).toHaveBeenLastCalledWith(source);
    expect(setBaseParticipants).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ name: "テンカク" }),
      expect.objectContaining({ name: "フルネームのエントリー" }),
    ]));
  });

  it("imports participants and passes the competition title", async () => {
    const { actions, onImport, setOpen } = setup({ mappings: ["character-question", null, null] });
    await actions[1].props.onClick();
    expect(onImport.mock.calls[0][0].map((participant: { name: string }) => participant.name))
      .toEqual(["テンカク", "フルネームのエントリー"]);
    expect(onImport.mock.calls[0][1]).toBe(source.eventName);
    expect(onImport.mock.calls[0][0].map((participant: { categorySelections: string[][] }) => participant.categorySelections))
      .toEqual([[ ["A", "B"], [], [] ], [["B"], [], []]]);
    expect(setOpen).toHaveBeenCalledWith(false);
  });

  it("offers a source column for each configured category", () => {
    const { dialog, setCategoryMappings } = setup();
    const html = renderToStaticMarkup(dialog);
    expect(html).toContain("Characters/Fighter");
    expect(html).toContain('<option value="" selected="">割り当てなし</option>');
    expect(html).toContain('<option value="character-question">Favorite character</option>');
    const sourceSelect = findSelect(dialog);
    expect(sourceSelect).toBeDefined();
    const event = { currentTarget: { value: "character-question" } };
    sourceSelect?.props.onChange?.(event);
    event.currentTarget = null as unknown as { value: string };
    const update = vi.mocked(setCategoryMappings).mock.calls[0][0];
    expect(typeof update).toBe("function");
    expect((update as (current: Array<string | null>) => Array<string | null>)([null, null, null]))
      .toEqual(["character-question", null, null]);
  });

  it("keeps existing participants when replacement is declined", async () => {
    vi.stubGlobal("window", { confirm: vi.fn().mockResolvedValue(false) });
    const { actions, onImport } = setup({ existing: true });
    await actions[1].props.onClick();
    expect(window.confirm).toHaveBeenCalledOnce();
    expect(onImport).not.toHaveBeenCalled();
  });

  it("reports fetch failures", async () => {
    vi.mocked(invoke).mockRejectedValueOnce("HTTP 503");
    const { form, setError, setLoading } = setup({ data: null });
    form.props.onSubmit({ preventDefault: vi.fn() });
    await vi.waitFor(() => expect(setLoading).toHaveBeenLastCalledWith(false));
    expect(setError).toHaveBeenLastCalledWith("Tonamelから取得できませんでした: HTTP 503");
  });
});