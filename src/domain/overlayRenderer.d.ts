import type { OverlayComponent, OverlayPreset } from "./overlayLayout";

export type OverlayRenderState = {
  active: boolean;
  fullyStopped: boolean;
  animationSessionRevision?: number;
  currentSetId?: string | null;
  redPlayerName: string;
  bluePlayerName: string;
  redSetWins: number;
  blueSetWins: number;
  redItems?: string[][];
  blueItems?: string[][];
  roundText: string | null;
  eventName: string | null;
  eventAlias: string | null;
  visibilityOverrides?: Record<string, boolean>;
  visibilityShowRevisions?: Record<string, number>;
  suppressAnimationTriggers?: boolean;
  animationTestRequest?: { presetId: string; componentId: string; revision: number; playing: boolean };
};
export function formatOverlayClock(format: string, now?: Date): string;
export function resolveOverlayText(component: OverlayComponent, state: OverlayRenderState, now?: Date): string;
export function resolveOverlayBackground(component: Pick<OverlayComponent, "background" | "frame">): string;
export function resolveOverlayFramePadding(component: Pick<OverlayComponent, "frame" | "fontSize">): string;
export function resolveOverlayVerticalAlign(component: Pick<OverlayComponent, "verticalAlign" | "frame">): "top" | "center" | "bottom";
export function resolveOverlayTextOverflow(component: Pick<OverlayComponent, "frame" | "source" | "wrapText" | "shrinkText">): { wrap: boolean; shrink: boolean };
export function fitOverlayText(element: HTMLElement, component: OverlayComponent, text: string): void;
export function renderOverlayPreset(stage: HTMLElement, preset: OverlayPreset, state: OverlayRenderState): (() => void) | void;
