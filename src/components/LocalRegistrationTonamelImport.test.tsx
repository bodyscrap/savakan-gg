import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { invoke } from "@tauri-apps/api/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalRegistrationTonamelImport } from "./LocalRegistrationTonamelImport";
import { defaultLocalEventRegistration } from "../domain/localEventRegistration";
import type { TonamelEvent } from "../domain/localRegistrationTonamel";

vi.mock("react", { spy: true });
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const source: TonamelEvent = { eventName: "20260726第2回2XKO中級者大会", users: [
  { id: "entrant-1", name: "テンカク", serialNumber: 1, status: "ENTRY" },
  { id: "entrant-2", name: "フルネームのエントリー", serialNumber: 2, status: "ENTRY" },
] };

function setup({ data = source as TonamelEvent | null, existing = false } = {}) {
  const registration = defaultLocalEventRegistration();
  if (existing) registration.participants = [{ entrantId: "old", name: "Old", categorySelections: [[], [], []], selectionsConfirmed: false }];
  const onImport = vi.fn();
  const onPendingChange = vi.fn();
  const setOpen = vi.fn();
  const setSource = vi.fn();
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
    .mockImplementationOnce(() => [false, setLoading])
    .mockImplementationOnce(() => ["", setError]);
  const dialog = element.type(element.props);
  const form = dialog.props.children;
  const actions = form.props.children[2].props.children;
  return { dialog, form, actions, onImport, onPendingChange, setOpen, setSource, setError, setLoading };
}

describe("Tonamel import dialog", () => {
  it("shows the event title and full entry names in a table", () => {
    const { dialog, onPendingChange } = setup();
    const html = renderToStaticMarkup(dialog);
    expect(html).toContain("event名: 20260726第2回2XKO中級者大会");
    expect(html).toContain('<th scope="col">ユーザー名</th><th scope="col">参加区分</th>');
    expect(html).toContain("フルネームのエントリー");
    expect(html.match(/<tr>/g)).toHaveLength(3);
    expect(html).toContain("出場");
    expect(onPendingChange).toHaveBeenCalledWith(true);
  });

  it("fetches participants from a competition top-page URL", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(source);
    const { form, setSource, setLoading } = setup({ data: null });
    form.props.onSubmit({ preventDefault: vi.fn() });
    await vi.waitFor(() => expect(setLoading).toHaveBeenLastCalledWith(false));
    expect(invoke).toHaveBeenCalledWith("fetch_tonamel_participants", { url: "https://tonamel.com/competition/GGzJP" });
    expect(setSource).toHaveBeenLastCalledWith(source);
  });

  it("imports participants and passes the competition title", async () => {
    const { actions, onImport, setOpen } = setup();
    await actions[1].props.onClick();
    expect(onImport.mock.calls[0][0].map((participant: { name: string }) => participant.name))
      .toEqual(["テンカク", "フルネームのエントリー"]);
    expect(onImport.mock.calls[0][1]).toBe(source.eventName);
    expect(setOpen).toHaveBeenCalledWith(false);
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