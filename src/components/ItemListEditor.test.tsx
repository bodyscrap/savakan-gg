import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FreeTextImportDialog, ItemListEditor } from "./ItemListEditor";

vi.mock("react", { spy: true });
afterEach(() => vi.restoreAllMocks());

const sources = [
  { id: "event:0", label: "Event / カテゴリ1", values: ["Alpha / Beta", "Alpha / Beta", "Gamma"] },
  { id: "event:2", label: "Event / カテゴリ3", values: ["Other"] },
];

function dialog(selected: string, available = sources) {
  const setSelected = vi.fn();
  vi.mocked(React.useState)
    .mockImplementationOnce(() => [selected, setSelected]);
  vi.mocked(React.useRef).mockReturnValue({ current: null });
  vi.mocked(React.useEffect).mockImplementation(() => {});
  const onImport = vi.fn();
  const onClose = vi.fn();
  const tree = FreeTextImportDialog({ sources: available, onImport, onClose });
  return { tree, html: renderToStaticMarkup(tree), onImport, onClose, setSelected };
}

describe("free text import dialog", () => {
  it("imports only the selected category and removes duplicates without splitting entries", () => {
    const { tree, html, onImport } = dialog("event:0");
    expect(html).toContain("取り込みプレビュー (2 件)");
    expect(html).toContain("Alpha / Beta\nGamma");
    expect(html).not.toContain("区切り文字");
    tree.props.children.props.onSubmit({ preventDefault: vi.fn() });
    expect(onImport).toHaveBeenCalledWith(["Alpha / Beta", "Gamma"]);
  });

  it("uses one radio group and replaces the selected category", () => {
    const { tree, html, setSelected } = dialog("event:0");
    const radios = html.match(/<input[^>]*type="radio"[^>]*>/g) ?? [];
    expect(radios).toHaveLength(2);
    expect(radios.every((radio) => radio.includes('name="free-text-import-category"'))).toBe(true);
    expect(radios.filter((radio) => radio.includes('checked=""'))).toHaveLength(1);
    expect(html).not.toContain('type="checkbox"');
    const options = tree.props.children.props.children[1].props.children[0].props.children[2];
    options[1].props.children[0].props.onChange();
    expect(setSelected).toHaveBeenCalledWith("event:2");
  });

  it("does not mix in entries from the previously selected category", () => {
    const { tree, onImport } = dialog("event:2");
    tree.props.children.props.onSubmit({ preventDefault: vi.fn() });
    expect(onImport).toHaveBeenCalledWith(["Other"]);
  });

  it.each([{ available: [] }, { available: sources }])("does not import when no category is selected", ({ available }) => {
    const { tree, html, onImport } = dialog("", available);
    expect(html).toMatch(/type="submit" disabled=""/);
    tree.props.children.props.onSubmit({ preventDefault: vi.fn() });
    expect(onImport).not.toHaveBeenCalled();
  });

  it("cancels without modifying the editor", () => {
    const { tree, onImport, onClose } = dialog("event:0");
    tree.props.onCancel({ preventDefault: vi.fn() });
    expect(onClose).toHaveBeenCalledOnce();
    expect(onImport).not.toHaveBeenCalled();
  });

  it("merges imported entries into the editor without saving a list", () => {
    vi.mocked(React.useState).mockImplementationOnce(() => [true, vi.fn()]);
    vi.mocked(React.useRef).mockReturnValue({ current: null });
    const change = vi.fn();
    const save = vi.fn();
    const noop = vi.fn();
    const tree = ItemListEditor({
      itemListName: "", onItemListNameChange: noop, itemCategoryName: "", onItemCategoryNameChange: noop,
      itemListText: "Existing\nAlpha", onItemListTextChange: change, isEditing: false, onSave: save, onReset: noop,
      searchInput: "", onSearchInputChange: noop, filteredItemLists: [], onEditItemList: noop,
      onDeleteItemList: noop, onImportItemList: noop, onExportItemList: noop, busy: false, freeTextSources: sources,
    });
    tree.props.children[2].props.onImport(["Alpha", "Beta"]);
    expect(change).toHaveBeenCalledWith("Existing\nAlpha\nBeta");
    expect(save).not.toHaveBeenCalled();
  });
});