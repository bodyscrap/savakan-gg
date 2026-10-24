import { describe, expect, it } from "vitest";
import { inspectOverlayImageAnimation, setOverlayImageLooping } from "./overlayImageAnimation";

function dataUrl(mime: string, bytes: number[]): string {
  return `data:${mime};base64,${btoa(String.fromCharCode(...bytes))}`;
}

function gif(frameCount: number, loopCount?: number): string {
  const header = [71, 73, 70, 56, 57, 97, 1, 0, 1, 0, 0, 0, 0];
  const loopExtension = loopCount === undefined ? [] : [
    0x21, 0xff, 0x0b, ...Array.from("NETSCAPE2.0", (character) => character.charCodeAt(0)),
    0x03, 0x01, loopCount & 0xff, loopCount >>> 8, 0,
  ];
  const frame = [0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 0x44, 0x01, 0];
  return dataUrl("image/gif", [...header, ...loopExtension, ...Array.from({ length: frameCount }, () => frame).flat(), 0x3b]);
}

function chunk(type: string, data: number[]): number[] {
  const length = data.length;
  return [
    length >>> 24, length >>> 16 & 0xff, length >>> 8 & 0xff, length & 0xff,
    ...Array.from(type, (character) => character.charCodeAt(0)), ...data, 0, 0, 0, 0,
  ];
}

describe("animated overlay images", () => {
  it("detects animated GIFs and changes their looping metadata", () => {
    const original = gif(2);
    expect(inspectOverlayImageAnimation(original)).toEqual({ animated: true, looping: false });

    const looping = setOverlayImageLooping(original, true);
    expect(inspectOverlayImageAnimation(looping)).toEqual({ animated: true, looping: true });

    const singlePlay = setOverlayImageLooping(looping, false);
    expect(inspectOverlayImageAnimation(singlePlay)).toEqual({ animated: true, looping: false });
  });

  it("does not expose looping controls for a single-frame GIF", () => {
    expect(inspectOverlayImageAnimation(gif(1, 0))).toEqual({ animated: false, looping: false });
    expect(setOverlayImageLooping(gif(1), true)).toBe(gif(1));
  });

  it("supports animated WebP loop metadata", () => {
    const anim = [0, 0, 0, 0, 1, 0];
    const frame = [0, 0, 0, 0];
    const chunks = [
      ...Array.from("ANIM", (character) => character.charCodeAt(0)),
      6, 0, 0, 0, ...anim,
      ...Array.from("ANMF", (character) => character.charCodeAt(0)), 4, 0, 0, 0, ...frame,
      ...Array.from("ANMF", (character) => character.charCodeAt(0)), 4, 0, 0, 0, ...frame,
    ];
    const webp = dataUrl("image/webp", [
      ...Array.from("RIFF", (character) => character.charCodeAt(0)), chunks.length + 4, 0, 0, 0,
      ...Array.from("WEBP", (character) => character.charCodeAt(0)), ...chunks,
    ]);
    expect(inspectOverlayImageAnimation(webp)).toEqual({ animated: true, looping: false });
    expect(inspectOverlayImageAnimation(setOverlayImageLooping(webp, true))).toEqual({ animated: true, looping: true });
    expect(inspectOverlayImageAnimation(setOverlayImageLooping(webp, false))).toEqual({ animated: true, looping: false });
  });

  it("supports animated PNG play-count metadata", () => {
    const png = dataUrl("image/png", [
      137, 80, 78, 71, 13, 10, 26, 10,
      ...chunk("acTL", [0, 0, 0, 2, 0, 0, 0, 1]),
      ...chunk("IEND", []),
    ]);
    expect(inspectOverlayImageAnimation(png)).toEqual({ animated: true, looping: false });
    expect(inspectOverlayImageAnimation(setOverlayImageLooping(png, true))).toEqual({ animated: true, looping: true });
    expect(inspectOverlayImageAnimation(setOverlayImageLooping(png, false))).toEqual({ animated: true, looping: false });
  });
});
