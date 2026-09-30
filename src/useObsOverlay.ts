import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { AppTab } from "./AppShell";

export type ObsOverlayState = {
  active: boolean;
  fullyStopped: boolean;
  currentSetId: string | null;
  eventName: string | null;
  eventAlias: string | null;
  roundText: string | null;
  redPlayerName: string;
  bluePlayerName: string;
  redSetWins: number;
  blueSetWins: number;
  fontScale: number;
  nameFitMode: "truncate" | "shrink";
  showSetInfo: boolean;
  showEventAlias: boolean;
  overlayUrl: string;
};

export type ObsOverlaySetInput = {
  enabled: boolean;
  setId: string;
  eventName: string;
  eventAlias: string;
  roundText: string;
  redPlayerName: string;
  bluePlayerName: string;
  redSetWins: number;
  blueSetWins: number;
  fontScale: number;
};

const OBS_OVERLAY_STATE_CHANGED_EVENT = "obs_overlay_state_changed";

export function normalizeObsSetWins(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.trunc(value));
}

export function scoreToOverlayGameWins(value: number | null): number {
  if (value === null || value < 0) {
    return 0;
  }
  return normalizeObsSetWins(value);
}

export function abbreviateOverlayRoundText(value: string): string {
  return value
    .replace(/\bGrand\s+Finals?\s+Reset\b/gi, "GF Reset")
    .replace(/\bGF\s+Reset\b/gi, "GF Reset")
    .replace(/\bGrand\s+Finals?\b/gi, "GF")
    .trim();
}

function normalizeObsFontScale(value: number): number {
  if (!Number.isFinite(value)) {
    return 1;
  }
  return Math.min(2, Math.max(0.6, value));
}

function normalizeApiSlug(rawSlug: string): string {
  const trimmed = rawSlug.trim();
  const withoutPrefix = trimmed.startsWith("tournament/")
    ? trimmed.slice("tournament/".length)
    : trimmed;
  const normalized = withoutPrefix.replace(/^\/+|\/+$/g, "");
  return normalized === "" ? "" : `tournament/${normalized}`;
}

type UseObsOverlayOptions = {
  activeTab: AppTab;
  slug: string;
  selectedEventId: string;
  setError: (error: string) => void;
};

export function useObsOverlay({ activeTab, slug, selectedEventId, setError }: UseObsOverlayOptions) {
  const [obsOverlayState, setObsOverlayState] = useState<ObsOverlayState | null>(null);
  const [obsOverlayBusy, setObsOverlayBusy] = useState(false);
  const [testOverlayRedName, setTestOverlayRedName] = useState("テストプレイヤー1");
  const [testOverlayBlueName, setTestOverlayBlueName] = useState("テストプレイヤー2");
  const [testOverlayRedWins, setTestOverlayRedWins] = useState(0);
  const [testOverlayBlueWins, setTestOverlayBlueWins] = useState(0);
  const [isTestOverlayActive, setIsTestOverlayActive] = useState(false);
  const overlaySelectionKeyRef = useRef<string | null>(null);
  const overlayPreviewWrapRef = useRef<HTMLDivElement | null>(null);
  const overlayPreviewIframeRef = useRef<HTMLIFrameElement | null>(null);

  function applyOverlayState(next: ObsOverlayState) {
    setObsOverlayState(next);
    setIsTestOverlayActive(next.active && next.currentSetId === "__test__");
  }

  async function fetchObsOverlayState() {
    return invoke<ObsOverlayState>("get_obs_overlay_state");
  }

  async function refreshObsOverlayState() {
    const next = await fetchObsOverlayState();
    applyOverlayState(next);
    return next;
  }

  useEffect(() => {
    let alive = true;
    let unlisten: (() => void) | null = null;

    void (async () => {
      try {
        const off = await listen<ObsOverlayState>(OBS_OVERLAY_STATE_CHANGED_EVENT, (event) => {
          if (alive) {
            applyOverlayState(event.payload);
          }
        });
        unlisten = off;
      } catch {
        // Ignore listener setup failure in non-Tauri environments.
      }
    })();

    return () => {
      alive = false;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    const selectionKey = `${normalizeApiSlug(slug)}::${selectedEventId.trim()}`;
    if (overlaySelectionKeyRef.current === null) {
      overlaySelectionKeyRef.current = selectionKey;
      return;
    }
    if (overlaySelectionKeyRef.current === selectionKey) {
      return;
    }

    overlaySelectionKeyRef.current = selectionKey;
    void invoke<ObsOverlayState>("set_obs_overlay_fully_stopped", { fullyStopped: true })
      .then(applyOverlayState)
      .catch((error) => setError(String(error)));
  }, [selectedEventId, slug]);

  useEffect(() => {
    if (activeTab !== "overlay") {
      if (isTestOverlayActive) {
        void stopTestOverlay();
      }
      return;
    }

    let alive = true;
    const loadState = async () => {
      try {
        const next = await fetchObsOverlayState();
        if (alive) {
          applyOverlayState(next);
        }
      } catch (error) {
        if (alive) {
          setError(String(error));
        }
      }
    };

    void loadState();
    const pollId = window.setInterval(() => void loadState(), 1200);
    return () => {
      alive = false;
      window.clearInterval(pollId);
    };
  }, [activeTab, isTestOverlayActive]);

  useEffect(() => {
    if (!isTestOverlayActive || !obsOverlayState?.active || obsOverlayState.currentSetId !== "__test__") {
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const next = await invoke<ObsOverlayState>("toggle_obs_overlay_set", {
            input: {
              enabled: true,
              setId: "__test__",
              eventName: "テスト配信",
              eventAlias: "テスト大会",
              roundText: "Preview / Pool A\nPreview\nSet T",
              redPlayerName: testOverlayRedName.trim() || "テストプレイヤー1",
              bluePlayerName: testOverlayBlueName.trim() || "テストプレイヤー2",
              redSetWins: normalizeObsSetWins(testOverlayRedWins),
              blueSetWins: normalizeObsSetWins(testOverlayBlueWins),
              fontScale: normalizeObsFontScale(obsOverlayState.fontScale),
            },
          });
          if (!cancelled) {
            applyOverlayState(next);
          }
        } catch (error) {
          if (!cancelled) {
            setError(String(error));
          }
        }
      })();
    }, 140);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    isTestOverlayActive,
    obsOverlayState?.active,
    obsOverlayState?.currentSetId,
    obsOverlayState?.fontScale,
    testOverlayRedName,
    testOverlayBlueName,
    testOverlayRedWins,
    testOverlayBlueWins,
  ]);

  useEffect(() => {
    if (activeTab !== "overlay") {
      return;
    }

    const postPreviewSize = () => {
      const width = overlayPreviewWrapRef.current?.clientWidth ?? 0;
      const height = overlayPreviewWrapRef.current?.clientHeight ?? 0;
      if (width <= 0 || height <= 0) {
        return;
      }
      overlayPreviewIframeRef.current?.contentWindow?.postMessage({
        type: "preview-container-width",
        width,
        height,
      }, "*");
    };

    postPreviewSize();
    const timer = window.setInterval(postPreviewSize, 500);
    return () => window.clearInterval(timer);
  }, [activeTab, obsOverlayState?.overlayUrl]);

  async function updateObsOverlayNameFitMode(mode: "truncate" | "shrink") {
    setObsOverlayBusy(true);
    try {
      applyOverlayState(await invoke<ObsOverlayState>("set_obs_overlay_name_fit_mode", { nameFitMode: mode }));
    } catch (error) {
      setError(String(error));
    } finally {
      setObsOverlayBusy(false);
    }
  }

  async function updateObsOverlayShowSetInfo(showSetInfo: boolean) {
    setObsOverlayBusy(true);
    try {
      applyOverlayState(await invoke<ObsOverlayState>("set_obs_overlay_show_set_info", { showSetInfo }));
    } catch (error) {
      setError(String(error));
    } finally {
      setObsOverlayBusy(false);
    }
  }

  async function updateObsOverlayShowEventAlias(showEventAlias: boolean) {
    setObsOverlayBusy(true);
    try {
      applyOverlayState(await invoke<ObsOverlayState>("set_obs_overlay_show_event_alias", { showEventAlias }));
    } catch (error) {
      setError(String(error));
    } finally {
      setObsOverlayBusy(false);
    }
  }

  async function setObsOverlayFullyStopped(fullyStopped: boolean) {
    setObsOverlayBusy(true);
    try {
      applyOverlayState(await invoke<ObsOverlayState>("set_obs_overlay_fully_stopped", { fullyStopped }));
      setError("");
    } catch (error) {
      setError(String(error));
    } finally {
      setObsOverlayBusy(false);
    }
  }

  async function toggleObsOverlaySet(input: ObsOverlaySetInput) {
    setObsOverlayBusy(true);
    try {
      applyOverlayState(await invoke<ObsOverlayState>("toggle_obs_overlay_set", {
        input: {
          ...input,
          redSetWins: normalizeObsSetWins(input.redSetWins),
          blueSetWins: normalizeObsSetWins(input.blueSetWins),
          fontScale: normalizeObsFontScale(input.fontScale),
        },
      }));
      setError("");
    } catch (error) {
      setError(String(error));
    } finally {
      setObsOverlayBusy(false);
    }
  }

  async function startTestOverlay() {
    if (!obsOverlayState) {
      return;
    }
    await toggleObsOverlaySet({
      enabled: true,
      setId: "__test__",
      eventName: "テスト配信",
      eventAlias: "テスト大会",
      roundText: "Preview / Pool A\nPreview\nSet T",
      redPlayerName: testOverlayRedName.trim() || "テストプレイヤー1",
      bluePlayerName: testOverlayBlueName.trim() || "テストプレイヤー2",
      redSetWins: testOverlayRedWins,
      blueSetWins: testOverlayBlueWins,
      fontScale: obsOverlayState.fontScale,
    });
  }

  async function stopTestOverlay() {
    await toggleObsOverlaySet({
      enabled: false,
      setId: "__test__",
      eventName: "",
      eventAlias: "",
      roundText: "",
      redPlayerName: "",
      bluePlayerName: "",
      redSetWins: 0,
      blueSetWins: 0,
      fontScale: obsOverlayState?.fontScale ?? 1,
    });
  }

  function handlePreviewLoad() {
    const width = overlayPreviewWrapRef.current?.clientWidth ?? 0;
    const height = overlayPreviewWrapRef.current?.clientHeight ?? 0;
    if (width <= 0 || height <= 0) {
      return;
    }
    overlayPreviewIframeRef.current?.contentWindow?.postMessage({
      type: "preview-container-width",
      width,
      height,
    }, "*");
  }

  return {
    obsOverlayState,
    applyOverlayState,
    obsOverlayBusy,
    testOverlayRedName,
    setTestOverlayRedName,
    testOverlayBlueName,
    setTestOverlayBlueName,
    testOverlayRedWins,
    setTestOverlayRedWins: (value: number) => setTestOverlayRedWins(normalizeObsSetWins(value)),
    testOverlayBlueWins,
    setTestOverlayBlueWins: (value: number) => setTestOverlayBlueWins(normalizeObsSetWins(value)),
    isTestOverlayActive,
    overlayPreviewWrapRef,
    overlayPreviewIframeRef,
    refreshObsOverlayState,
    updateObsOverlayNameFitMode,
    updateObsOverlayShowSetInfo,
    updateObsOverlayShowEventAlias,
    setObsOverlayFullyStopped,
    toggleObsOverlaySet,
    startTestOverlay,
    stopTestOverlay,
    handlePreviewLoad,
  };
}