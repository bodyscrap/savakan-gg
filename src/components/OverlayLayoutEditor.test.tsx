import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import capability from "../../src-tauri/capabilities/default.json";
import { newOverlayPreset, type OverlayLayouts } from "../domain/overlayLayout";
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
