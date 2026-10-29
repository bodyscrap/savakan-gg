import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalRegistrationCsvImport } from "./LocalRegistrationCsvImport";
import { defaultLocalEventRegistration } from "../domain/localEventRegistration";
import { parseRegistrationCsv, type RegistrationCsvMapping } from "../domain/localRegistrationCsv";

vi.mock("react", { spy: true });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

function setup(mapping: RegistrationCsvMapping = { name: 0, categories: [1, null, null] }, prefixDate = false) {
  const registration = defaultLocalEventRegistration();
  registration.setting.itemListSnapshots = [{ id: "items", name: "Items", categoryName: "Type", items: ["A"] }];
  registration.setting.categoryMaxCounts = [1, 0, 0];
  const source = { csv: parseRegistrationCsv("name,items\nAlice,A"), fileName: "大会.CSV" };
  const setSource = vi.fn();
  const onImport = vi.fn();
  const onPendingChange = vi.fn();
  vi.mocked(React.useState)
    .mockImplementationOnce(() => [source, setSource])
    .mockImplementationOnce(() => [false, vi.fn()])
    .mockImplementationOnce(() => ["", vi.fn()]);
  vi.mocked(React.useRef).mockReturnValue({ current: null });
  vi.mocked(React.useEffect).mockImplementation((effect) => { effect(); });
  const tree = LocalRegistrationCsvImport({ registration, disabled: false, onImport, onPendingChange });
  const dialogElement = tree.props.children[3];
  vi.mocked(React.useState)
    .mockImplementationOnce(() => [mapping, vi.fn()])
    .mockImplementationOnce(() => ["", vi.fn()])
    .mockImplementationOnce(() => [prefixDate, vi.fn()]);
  const dialog = dialogElement.type(dialogElement.props);
  return { tree, dialog, onImport, setSource, onPendingChange };
}

describe("CSV import dialog", () => {
  it.each([false, true])("previews and imports the event name with date prefix=%s", (enabled) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 2, 23, 45));
    const { dialog, onImport } = setup(undefined, enabled);
    const expected = enabled ? "2026-01-02 大会" : "大会";
    expect(renderToStaticMarkup(dialog)).toContain(`event名: ${expected}`);
    dialog.props.children.props.onSubmit({ preventDefault: vi.fn() });
    expect(onImport.mock.calls[0][1]).toBe(expected);
  });

  it("only enables mapping for configured categories and reports pending import", () => {
    const { dialog, onPendingChange } = setup();
    const html = renderToStaticMarkup(dialog);
    expect(html).toContain("CSV取り込み設定");
    expect(html.match(/<select disabled=""/g)).toHaveLength(2);
    expect(html).toContain("カテゴリ1");
    expect(html).toContain("Items");
    expect(html).toContain("Skill Tier");
    expect(html).toContain('<option value="">割り当てなし</option>');
    expect(onPendingChange).toHaveBeenCalledWith(true);
  });

  it("imports mapped participants and passes the filename without its extension", () => {
    const { dialog, onImport, setSource } = setup();
    dialog.props.children.props.onSubmit({ preventDefault: vi.fn() });
    expect(onImport).toHaveBeenCalledOnce();
    expect(onImport.mock.calls[0][0]).toHaveLength(1);
    expect(onImport.mock.calls[0][0][0]).toMatchObject({ name: "Alice", categorySelections: [["A"], [], []] });
    expect(onImport.mock.calls[0][1]).toBe("大会");
    expect(setSource).toHaveBeenCalledWith(null);
  });

  it("cancels without importing participants or renaming the event", () => {
    const { dialog, onImport, setSource } = setup();
    dialog.props.onCancel({ preventDefault: vi.fn() });
    expect(setSource).toHaveBeenCalledWith(null);
    expect(onImport).not.toHaveBeenCalled();
  });

  it("disables import until a player-name column is assigned", () => {
    const { dialog } = setup({ name: -1, categories: [null, null, null] });
    expect(renderToStaticMarkup(dialog)).toContain('<button type="submit" disabled="">取り込み</button>');
  });
});
