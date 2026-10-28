import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setLanguage } from "../i18n";
import { ItemListPicker } from "./ItemSelectionFields";

vi.mock("react", { spy: true });

afterEach(() => {
  vi.restoreAllMocks();
  setLanguage("ja");
});

const lists = [
  { id: "b", name: "Beta", categoryName: "キャラクター", items: ["B"] },
  { id: "a", name: "Alpha", categoryName: "Stage", items: ["A"] },
];

function setup(query: string | null = null, value = "", activeIndex = 1) {
  const setQuery = vi.fn();
  const setOpen = vi.fn();
  const onChange = vi.fn();
  vi.mocked(React.useState)
    .mockImplementationOnce(() => [query, setQuery])
    .mockImplementationOnce(() => [true, setOpen])
    .mockImplementationOnce(() => [activeIndex, vi.fn()])
    .mockImplementationOnce(() => [false, vi.fn()]);
  vi.mocked(React.useId).mockReturnValue("options");
  vi.mocked(React.useRef).mockReturnValue({ current: null });
  vi.mocked(React.useEffect).mockImplementation(() => {});
  const tree = ItemListPicker({ id: "picker", lists, value, onChange });
  const html = renderToStaticMarkup(tree);
  return { tree, html, setQuery, setOpen, onChange };
}

describe("item list combobox", () => {
  it("combines filtering and selection in one input and sorts the options", () => {
    const { html } = setup(null, "b");
    expect(html).toContain('role="combobox"');
    expect(html).toContain('value="Beta / キャラクター (1)"');
    expect(html).not.toContain("<select");
    expect(html.indexOf("Alpha / Stage")).toBeLessThan(html.lastIndexOf("Beta / キャラクター"));
    expect(html).toContain('role="listbox"');
  });

  it.each([" ALP ", "stage"])("filters by list or category name ignoring case: %s", (query) => {
    const { html } = setup(query);
    expect(html).toContain("Alpha / Stage");
    expect(html).not.toContain("Beta / キャラクター");
  });

  it("filters Japanese category names", () => {
    const { html } = setup("キャラ");
    expect(html).toContain("Beta / キャラクター");
    expect(html).not.toContain("Alpha / Stage");
  });

  it("retains an explicit unselected option without changing the selection on no matches", () => {
    const { html, onChange } = setup("missing", "b");
    expect(html).toContain("未選択</li>");
    expect(html).toContain("一致するリストがありません。");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("selects the active result with Enter and resets the search", () => {
    const { tree, onChange, setQuery, setOpen } = setup("alp");
    const input = tree.props.children[0].props.children[0];
    input.props.onKeyDown({ key: "Enter", nativeEvent: { isComposing: false }, preventDefault: vi.fn() });
    expect(onChange).toHaveBeenCalledWith("a");
    expect(setQuery).toHaveBeenCalledWith(null);
    expect(setOpen).toHaveBeenCalledWith(false);
  });

  it("cancels the search on Escape without changing the saved selection", () => {
    const { tree, onChange, setQuery, setOpen } = setup("alp", "b");
    const input = tree.props.children[0].props.children[0];
    input.props.onKeyDown({ key: "Escape", nativeEvent: { isComposing: false },
      preventDefault: vi.fn(), stopPropagation: vi.fn() });
    expect(onChange).not.toHaveBeenCalled();
    expect(setQuery).toHaveBeenCalledWith(null);
    expect(setOpen).toHaveBeenCalledWith(false);
  });

  it("does not commit during IME composition", () => {
    const { tree, onChange } = setup("alp");
    tree.props.children[0].props.children[0].props.onKeyDown({
      key: "Enter", nativeEvent: { isComposing: true }, preventDefault: vi.fn(),
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("can clear the selected list by choosing the unselected option", () => {
    const { tree, onChange } = setup(null, "b", 0);
    tree.props.children[0].props.children[0].props.onKeyDown({
      key: "Enter", nativeEvent: { isComposing: false }, preventDefault: vi.fn(),
    });
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("translates the picker and no-match message", () => {
    setLanguage("en");
    const { html } = setup("missing");
    expect(html).toContain("Show item list options");
    expect(html).toContain("No matching lists.");
  });

  it("offers free text without creating or selecting a stored list", () => {
    const { html } = setup(null, "__free_text__");
    expect(html).toContain('value="自由記入"');
    expect(html).toContain("自由記入</li>");
  });
});
