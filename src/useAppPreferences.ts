import { useEffect, useState } from "react";

export const STARTGG_FETCH_PER_PAGE_DEFAULT = 50;
export const MOBILE_INPUT_POLLING_MS_MIN = 500;
export const MOBILE_INPUT_POLLING_MS_MAX = 10000;
export const MOBILE_INPUT_POLLING_MS_DEFAULT = 1500;
export const BRACKET_ZOOM_LEVELS = [1, 0.7, 0.5] as const;

const BRACKET_SIDE_ORDER_DISPLAY_STORAGE_KEY = "savakan-gg.bracket-side-order-display.v1";
const BRACKET_ZOOM_LEVEL_STORAGE_KEY = "savakan-gg.bracket-zoom-level.v1";
const STARTGG_FETCH_PER_PAGE_STORAGE_KEY = "savakan-gg.startgg-fetch-per-page.v1";
const MOBILE_INPUT_POLLING_MS_STORAGE_KEY = "savakan-gg.mobile-input-polling-ms.v1";
const LOCAL_COMMUNICATION_DISABLED_STORAGE_KEY = "savakan-gg.local-communication-disabled.v1";

export function normalizeStartggFetchPerPage(
  rawValue: unknown,
  fallback = STARTGG_FETCH_PER_PAGE_DEFAULT,
): number {
  const numeric = Number(rawValue);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  const rounded = Math.trunc(numeric);
  if (rounded < 1) {
    return 1;
  }

  return rounded;
}

export function normalizeMobileInputPollingMs(
  rawValue: unknown,
  fallback = MOBILE_INPUT_POLLING_MS_DEFAULT,
): number {
  const numeric = Number(rawValue);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  const rounded = Math.trunc(numeric);
  if (rounded < MOBILE_INPUT_POLLING_MS_MIN) {
    return MOBILE_INPUT_POLLING_MS_MIN;
  }
  if (rounded > MOBILE_INPUT_POLLING_MS_MAX) {
    return MOBILE_INPUT_POLLING_MS_MAX;
  }

  return rounded;
}

export function normalizeBracketZoomLevel(value: unknown): number {
  if (typeof value === "string" || typeof value === "number") {
    const parsed = typeof value === "string" ? Number.parseFloat(value) : Number(value);
    if (Number.isFinite(parsed)) {
      let nearest: number = Number(BRACKET_ZOOM_LEVELS[0]);
      for (const candidate of BRACKET_ZOOM_LEVELS) {
        if (Math.abs(Number(candidate) - parsed) < Math.abs(nearest - parsed)) {
          nearest = Number(candidate);
        }
      }
      return nearest;
    }
  }

  return Number(BRACKET_ZOOM_LEVELS[0]);
}

export function useAppPreferences() {
  const [startggFetchPerPage, setStartggFetchPerPage] = useState(STARTGG_FETCH_PER_PAGE_DEFAULT);
  const [displayBracketPlayersBySide, setDisplayBracketPlayersBySide] = useState(true);
  const [bracketZoomLevel, setBracketZoomLevel] = useState<number>(Number(BRACKET_ZOOM_LEVELS[0]));
  const [mobileInputPollingMs, setMobileInputPollingMs] = useState(MOBILE_INPUT_POLLING_MS_DEFAULT);
  const [disableLocalCommunication, setDisableLocalCommunication] = useState(false);

  useEffect(() => {
    try {
      const rawValue = window.localStorage.getItem(BRACKET_SIDE_ORDER_DISPLAY_STORAGE_KEY);
      setDisplayBracketPlayersBySide(rawValue === null ? true : rawValue === "true");
    } catch {
    }

    try {
      const rawValue = window.localStorage.getItem(BRACKET_ZOOM_LEVEL_STORAGE_KEY);
      if (rawValue !== null) {
        setBracketZoomLevel(normalizeBracketZoomLevel(rawValue));
      }
    } catch {
    }

    try {
      const rawValue = window.localStorage.getItem(STARTGG_FETCH_PER_PAGE_STORAGE_KEY);
      if (rawValue !== null) {
        setStartggFetchPerPage(normalizeStartggFetchPerPage(rawValue));
      }
    } catch {
    }

    try {
      const rawValue = window.localStorage.getItem(LOCAL_COMMUNICATION_DISABLED_STORAGE_KEY);
      if (rawValue !== null) {
        setDisableLocalCommunication(rawValue === "true");
      }
    } catch {
    }

    try {
      const rawValue = window.localStorage.getItem(MOBILE_INPUT_POLLING_MS_STORAGE_KEY);
      if (rawValue !== null) {
        setMobileInputPollingMs(normalizeMobileInputPollingMs(rawValue));
      }
    } catch {
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        BRACKET_SIDE_ORDER_DISPLAY_STORAGE_KEY,
        displayBracketPlayersBySide ? "true" : "false",
      );
    } catch {
    }
  }, [displayBracketPlayersBySide]);

  useEffect(() => {
    try {
      window.localStorage.setItem(BRACKET_ZOOM_LEVEL_STORAGE_KEY, String(bracketZoomLevel));
    } catch {
    }
  }, [bracketZoomLevel]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        STARTGG_FETCH_PER_PAGE_STORAGE_KEY,
        String(normalizeStartggFetchPerPage(startggFetchPerPage)),
      );
    } catch {
    }
  }, [startggFetchPerPage]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        LOCAL_COMMUNICATION_DISABLED_STORAGE_KEY,
        disableLocalCommunication ? "true" : "false",
      );
    } catch {
    }
  }, [disableLocalCommunication]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        MOBILE_INPUT_POLLING_MS_STORAGE_KEY,
        String(normalizeMobileInputPollingMs(mobileInputPollingMs)),
      );
    } catch {
    }
  }, [mobileInputPollingMs]);

  return {
    startggFetchPerPage,
    setStartggFetchPerPage,
    displayBracketPlayersBySide,
    setDisplayBracketPlayersBySide,
    bracketZoomLevel,
    setBracketZoomLevel,
    mobileInputPollingMs,
    setMobileInputPollingMs,
    disableLocalCommunication,
    setDisableLocalCommunication,
  };
}
