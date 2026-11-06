import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { invoke } from "@tauri-apps/api/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalRegistrationTwiplaImport } from "./LocalRegistrationTwiplaImport";
import { defaultLocalEventRegistration } from "../domain/localEventRegistration";
import type { TwiplaStatus, TwiplaUser } from "../domain/localRegistrationTwipla";

vi.mock("react", { spy: true });
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const users: TwiplaUser[] = [
  { id: "alice", name: "Alice", status: "attending" },
  { id: "bob", name: "Bob", status: "interested" },
  { id: "carol", name: "Carol", status: "notAttending" },
];

function setup({ source = users as TwiplaUser[] | null, statuses = undefined as TwiplaStatus[] | undefined, existing = false, loading = false } = {}) {
  const registration = defaultLocalEventRegistration();
  if (existing) registration.participants = [{ entrantId: "old", name: "Old", categorySelections: [[], [], []], selectionsConfirmed: false }];
  const onImport = vi.fn();
  const onPendingChange = vi.fn();
  const setOpen = vi.fn();
  const setUsers = vi.fn();
  const setError = vi.fn();
  const setLoading = vi.fn();
  vi.mocked(React.useState).mockImplementationOnce(() => [true, setOpen]);
  vi.mocked(React.useEffect).mockImplementation((effect) => { effect(); });
  vi.mocked(React.useRef).mockReturnValue({ current: null });
  const tree = LocalRegistrationTwiplaImport({ registration, disabled: false, onImport, onPendingChange });
  const element = tree.props.children[1];
  vi.mocked(React.useState)
    .mockImplementationOnce(() => ["https://twipla.jp/events/123", vi.fn()])
    .mockImplementationOnce((initial?: unknown): [unknown, React.Dispatch<unknown>] => [statuses ?? initial, vi.fn()])
    .mockImplementationOnce(() => [source === null ? null : { eventName: "組合BYOC", users: source }, setUsers])
    .mockImplementationOnce(() => [loading, setLoading])
    .mockImplementationOnce(() => ["", setError]);
  const dialog = element.type(element.props);
  const form = dialog.props.children;
  const actions = form.props.children[2].props.children;
  return { dialog, form, actions, onImport, onPendingChange, setOpen, setUsers, setError, setLoading };
}

describe("Twipla import dialog", () => {
  it("defaults to attending only and shows the selected users", () => {
    const { dialog, onPendingChange } = setup();
    const html = renderToStaticMarkup(dialog);
    expect(html.match(/type="checkbox"/g)).toHaveLength(3);
    expect(html.match(/checked=""/g)).toHaveLength(1);
    expect(html).toContain("Alice");
    expect(html).toContain("event名: 組合BYOC");
    expect(html).not.toContain("Bob");
    expect(html).not.toContain("Carol");
    expect(onPendingChange).toHaveBeenCalledWith(true);
  });

  it("fetches the event URL without importing until confirmed", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ eventName: "組合BYOC", users });
    const { form, setUsers, onImport, setLoading } = setup({ source: null });
    form.props.onSubmit({ preventDefault: vi.fn() });
    await vi.waitFor(() => expect(setLoading).toHaveBeenLastCalledWith(false));
    expect(invoke).toHaveBeenCalledWith("fetch_twipla_users", { url: "https://twipla.jp/events/123" });
    expect(setUsers).toHaveBeenLastCalledWith({ eventName: "組合BYOC", users });
    expect(onImport).not.toHaveBeenCalled();
  });

  it("renders selected users in a table with name and participation status columns", () => {
    const { dialog } = setup({ statuses: ["interested", "notAttending"] });
    const html = renderToStaticMarkup(dialog);
    expect(html).toContain('<table class="twipla-import-table" aria-label="取り込み対象ユーザー">');
    expect(html).toContain('<th scope="col">ユーザー名</th><th scope="col">参加区分</th>');
    expect(html).toContain('<tbody><tr><td>Bob</td><td>興味あり</td></tr><tr><td>Carol</td><td>不参加</td></tr></tbody>');
    expect(html).not.toContain("Alice");
  });

  it("reports fetch failures and resets loading", async () => {
    vi.mocked(invoke).mockRejectedValueOnce("HTTP 404");
    const { form, setError, setLoading } = setup({ source: null });
    form.props.onSubmit({ preventDefault: vi.fn() });
    await vi.waitFor(() => expect(setLoading).toHaveBeenLastCalledWith(false));
    expect(setError).toHaveBeenLastCalledWith("Twiplaから取得できませんでした: HTTP 404");
  });

  it("imports only selected statuses and closes", async () => {
    const { actions, onImport, setOpen } = setup({ statuses: ["interested", "notAttending"] });
    await actions[1].props.onClick();
    expect(onImport.mock.calls[0][0].map((participant: { name: string }) => participant.name)).toEqual(["Bob", "Carol"]);
    expect(onImport.mock.calls[0][1]).toBe("組合BYOC");
    expect(setOpen).toHaveBeenCalledWith(false);
  });

  it("does not replace existing participants when confirmation is declined", async () => {
    vi.stubGlobal("window", { confirm: vi.fn().mockResolvedValue(false) });
    const { actions, onImport } = setup({ existing: true });
    await actions[1].props.onClick();
    expect(window.confirm).toHaveBeenCalledOnce();
    expect(onImport).not.toHaveBeenCalled();
  });

  it("cancels without importing", () => {
    const { dialog, onImport, setOpen } = setup();
    dialog.props.onCancel({ preventDefault: vi.fn() });
    expect(setOpen).toHaveBeenCalledWith(false);
    expect(onImport).not.toHaveBeenCalled();
  });

  it.each([{ source: null }, { source: [] }, { statuses: [] }, { loading: true }])("disables invalid or pending imports (%j)", (options) => {
    expect(setup(options).actions[1].props.disabled).toBe(true);
  });
});