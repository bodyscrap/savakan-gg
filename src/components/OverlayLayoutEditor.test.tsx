import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import capability from "../../src-tauri/capabilities/default.json";
import { newOverlayComponent, newOverlayPreset, type OverlayLayouts } from "../domain/overlayLayout";
import { OverlayComponentDialog } from "./OverlayComponentDialog";
import { OverlayLayoutEditor } from "./OverlayLayoutEditor";

function renderEditor(savedLayouts: OverlayLayouts, disabled = false) {
  return renderToStaticMarkup(<OverlayLayoutEditor
    state={{
      active: false, fullyStopped: false, redPlayerName: "", bluePlayerName: "",
      redSetWins: 0, blueSetWins: 0, roundText: null, eventName: null, eventAlias: null,
    }}
    savedLayouts={savedLayouts} disabled={disabled} onSave={async (layouts) => layouts} />);
}

describe("overlay preset workspace", () => {
  it.each([
    { source: "firstToNWinsPlayerOneWins", label: "1P F2NW 取得Set数" },
    { source: "firstToNWinsPlayerTwoWins", label: "2P F2NW 取得Set数" },
  ] as const)("shows $label for its numeric display source", ({ source, label }) => {
    const preset = newOverlayPreset();
    preset.components = [{ ...newOverlayComponent("number"), source }];
    const html = renderEditor({ version: 1, activePresetId: preset.id, presets: [preset] });
    expect(html).toContain(`<td>数値</td><td title="${label}">${label}</td>`);
  });
  it("places the workspace button beside the preset name in a non-stretching toolbar", () => {
    const preset = newOverlayPreset();
    const html = renderEditor({ version: 1, activePresetId: null, presets: [preset] });
    expect(html).toMatch(
      /<div class="overlay-layout-toolbar"><label>プリセット名<input[^>]*\/><\/label><button type="button">ワークディレクトリを開く<\/button><\/div>/,
    );
  });

  it("keeps the default layout read-only without a workspace button", () => {
    const html = renderEditor({ version: 1, activePresetId: null, presets: [] });
    expect(html).not.toContain("ワークディレクトリを開く");
  });

  it("shows First to N wins as the information name while keeping its horizontal type label", () => {
    const preset = newOverlayPreset();
    preset.components = [newOverlayComponent("firstToNWins")];
    const html = renderEditor({ version: 1, activePresetId: preset.id, presets: [preset] });
    expect(html).toContain("<td>F2NW(横)</td><td title=\"First to N wins\">First to N wins</td>");
  });

  it("shows the vertical N wins type label", () => {
    const preset = newOverlayPreset();
    preset.components = [newOverlayComponent("firstToNWinsVertical")];
    const html = renderEditor({ version: 1, activePresetId: preset.id, presets: [preset] });
    expect(html).toContain("<td>F2NW(縦)</td><td title=\"First to N wins\">First to N wins</td>");
  });
  it("shows the line chart type label", () => {
    const preset = newOverlayPreset();
    preset.components = [newOverlayComponent("firstToNWinsLine")];
    const html = renderEditor({ version: 1, activePresetId: preset.id, presets: [preset] });
    expect(html).toContain("<td>F2NW(線)</td><td title=\"First to N wins\">First to N wins</td>");
  });

  it("offers the line chart in the component creation dialog", () => {
    const html = renderToStaticMarkup(<OverlayComponentDialog onCreate={() => true} onClose={() => {}} />);
    expect(html).toContain('<option value="firstToNWinsLine">F2NW(線)</option>');
  });

  it("disables workspace actions while the editor is busy", () => {
    const preset = newOverlayPreset();
    const html = renderEditor({ version: 1, activePresetId: null, presets: [preset] }, true);
    expect(html).toContain('<fieldset disabled="">');
    expect(html).toContain("ワークディレクトリを開く");
  });

  it("permits opening only preset workspaces with the default application", () => {
    const permission = capability.permissions.find((entry) =>
      typeof entry === "object" && entry.identifier === "opener:allow-open-path");
    expect(permission).toEqual({
      identifier: "opener:allow-open-path",
      allow: [{ path: "$APPDATA/overlay-presets/preset-*" }],
    });
    expect(capability.permissions).not.toContain("opener:allow-open-path");
  });
});
