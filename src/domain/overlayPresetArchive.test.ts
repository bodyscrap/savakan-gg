import { describe, expect, it } from "vitest";
import { newOverlayComponent, newOverlayPreset } from "./overlayLayout";
import { createOverlayPresetArchive, parseOverlayPresetArchive } from "./overlayPresetArchive";

describe("overlay preset ZIP archives", () => {
  it("round-trips preset settings and image files", () => {
    const preset = newOverlayPreset({ width: 1920, height: 1080 });
    preset.name = "Archive test";
    const image = newOverlayComponent("image");
    image.image = "data:image/png;base64,aGVsbG8=";
    image.imageFileName = "test.png";
    preset.components = [image];
    const layouts = { version: 1 as const, activePresetId: preset.id, presets: [preset] };

    const archive = createOverlayPresetArchive(layouts);
    const imported = parseOverlayPresetArchive(archive);

    expect(imported).toEqual(layouts);
  });

  it("rejects non-ZIP data", () => {
    expect(() => parseOverlayPresetArchive(new TextEncoder().encode("not a zip"))).toThrow();
  });
});
