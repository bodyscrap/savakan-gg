import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { RestoreAllSeedsDialog } from "./BracketDialogs";

describe("all snapshot restore seed choice", () => {
  it("passes the selected seed policy and does nothing when cancelled", () => {
    const onRestore = vi.fn();
    const onCancel = vi.fn();
    const dialog = RestoreAllSeedsDialog({ busy: false, selectedEventName: "Event", onCancel, onRestore });
    const actions = dialog.props.children.props.children[2];
    actions.props.children[0].props.onClick();
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onRestore).not.toHaveBeenCalled();
    actions.props.children[1].props.onClick();
    expect(onRestore).toHaveBeenLastCalledWith(true);
    actions.props.children[2].props.onClick();
    expect(onRestore).toHaveBeenLastCalledWith(false);
  });

  it("offers preservation, discard, and cancellation as explicit choices", () => {
    const html = renderToStaticMarkup(
      <RestoreAllSeedsDialog
        busy={false}
        selectedEventName="Test Event"
        onCancel={vi.fn()}
        onRestore={vi.fn()}
      />,
    );
    expect(html).toContain('role="dialog"');
    expect(html).toContain("Test Event");
    expect(html).toContain("Seedの並び順を維持して復元");
    expect(html).toContain("Seedの並び替えも破棄して復元");
    expect(html).toContain("キャンセル");
    expect(html).not.toContain("disabled");
  });

  it("disables all choices while restoring", () => {
    const html = renderToStaticMarkup(
      <RestoreAllSeedsDialog busy selectedEventName="Event" onCancel={vi.fn()} onRestore={vi.fn()} />,
    );
    expect(html.match(/disabled=""/g)).toHaveLength(3);
  });
});
