import { useEffect, useMemo, useState } from "react";
import type { GenericMessage } from "../components/MessageBox";
import type { CallListEventGroup, CallListEventSortStrategy } from "../components/StatusBoard";
import {
  buildCallListDedupKey,
  compareCallListEventGroup,
  compareCallListEventGroupByMaxElapsed,
  extractCallEventMeta,
  extractCallThreadIdentity,
  extractMetaString,
} from "../domain/messageUtils";

export const CALL_LIST_ROTATE_SECONDS_MIN = 1;
export const CALL_LIST_ROTATE_SECONDS_MAX = 180;
export const CALL_LIST_ROTATE_SECONDS_DEFAULT = 7;
export const CALL_LIST_COLOR_SECONDS_MIN = 30;
export const CALL_LIST_COLOR_SECONDS_MAX = 3600;
export const CALL_LIST_COLOR_SECONDS_DEFAULT = 600;

const CALL_LIST_EVENT_PAGE_SIZE = 3;
const CALL_LIST_ROTATE_SECONDS_STORAGE_KEY = "savakan-gg.call-list-rotate-seconds.v1";
const CALL_LIST_COLOR_SECONDS_STORAGE_KEY = "savakan-gg.call-list-color-seconds.v1";

export function normalizeCallListRotateSeconds(rawValue: unknown, fallback = CALL_LIST_ROTATE_SECONDS_DEFAULT): number {
  const numeric = Number(rawValue);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  const rounded = Math.trunc(numeric);
  if (rounded < CALL_LIST_ROTATE_SECONDS_MIN) {
    return CALL_LIST_ROTATE_SECONDS_MIN;
  }
  if (rounded > CALL_LIST_ROTATE_SECONDS_MAX) {
    return CALL_LIST_ROTATE_SECONDS_MAX;
  }

  return rounded;
}

export function normalizeCallListColorSeconds(rawValue: unknown, fallback = CALL_LIST_COLOR_SECONDS_DEFAULT): number {
  const numeric = Number(rawValue);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  const rounded = Math.trunc(numeric);
  if (rounded < CALL_LIST_COLOR_SECONDS_MIN) {
    return CALL_LIST_COLOR_SECONDS_MIN;
  }
  if (rounded > CALL_LIST_COLOR_SECONDS_MAX) {
    return CALL_LIST_COLOR_SECONDS_MAX;
  }

  return rounded;
}

type UseCallListOptions = {
  activeTab: string;
  genericMessages: GenericMessage[];
  senderUserId: string;
};

type ResetCallListDisplayOptions = {
  clearOwnOnly?: boolean;
  rebuild?: boolean;
};

export function useCallList({ activeTab, genericMessages, senderUserId }: UseCallListOptions) {
  const [pageIndex, setPageIndex] = useState(0);
  const [pageRotateSeconds, setPageRotateSeconds] = useState(CALL_LIST_ROTATE_SECONDS_DEFAULT);
  const [colorSeconds, setColorSeconds] = useState(CALL_LIST_COLOR_SECONDS_DEFAULT);
  const [eventSortStrategy, setEventSortStrategy] = useState<CallListEventSortStrategy>("alias");
  const [focusOwnUnresolved, setFocusOwnUnresolved] = useState(false);
  const [pageSwitchedAtMs, setPageSwitchedAtMs] = useState(() => Date.now());
  const [progressNowMs, setProgressNowMs] = useState(() => Date.now());
  const [displayGroups, setDisplayGroups] = useState<CallListEventGroup[]>([]);
  const [rebuildToken, setRebuildToken] = useState(0);
  const [cycleCount, setCycleCount] = useState(0);

  function changePageRotateSeconds(value: unknown) {
    setPageRotateSeconds((current) => normalizeCallListRotateSeconds(value, current));
  }

  function commitPageRotateSeconds(value: unknown) {
    const normalized = normalizeCallListRotateSeconds(value);
    setPageRotateSeconds((current) => current === normalized ? current : normalized);
  }

  function changeColorSeconds(value: unknown) {
    setColorSeconds((current) => normalizeCallListColorSeconds(value, current));
  }

  function commitColorSeconds(value: unknown) {
    const normalized = normalizeCallListColorSeconds(value);
    setColorSeconds((current) => current === normalized ? current : normalized);
  }

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(CALL_LIST_ROTATE_SECONDS_STORAGE_KEY);
      if (raw !== null) {
        setPageRotateSeconds(normalizeCallListRotateSeconds(raw));
      }
    } catch {
      // Ignore unavailable local storage.
    }

    try {
      const raw = window.localStorage.getItem(CALL_LIST_COLOR_SECONDS_STORAGE_KEY);
      if (raw !== null) {
        setColorSeconds(normalizeCallListColorSeconds(raw));
      }
    } catch {
      // Ignore unavailable local storage.
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        CALL_LIST_ROTATE_SECONDS_STORAGE_KEY,
        String(normalizeCallListRotateSeconds(pageRotateSeconds)),
      );
    } catch {
      // Ignore unavailable local storage.
    }
  }, [pageRotateSeconds]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        CALL_LIST_COLOR_SECONDS_STORAGE_KEY,
        String(normalizeCallListColorSeconds(colorSeconds)),
      );
    } catch {
      // Ignore unavailable local storage.
    }
  }, [colorSeconds]);

  const latestGroups = useMemo(() => {
    const roots = genericMessages.filter((item) =>
      item.parentMessageId === null
      && item.method === "call_player"
      && item.messageType === "normal"
      && (!focusOwnUnresolved || item.senderUserId.trim() === senderUserId.trim())
    );

    const groups = new Map<string, CallListEventGroup>();
    const dedupKeys = new Set<string>();

    for (const root of roots) {
      const resolved = genericMessages.some((item) => item.threadId === root.threadId && item.messageType === "resolve");
      if (resolved) {
        continue;
      }

      const dedupKey = buildCallListDedupKey(root);
      if (!focusOwnUnresolved) {
        if (dedupKeys.has(dedupKey)) {
          continue;
        }
        dedupKeys.add(dedupKey);
      }

      const callIdentity = extractCallThreadIdentity(root);
      const entrantName = callIdentity?.callEntrantName
        || extractMetaString(root.messageMeta, "callEntrantName")
        || extractMetaString(root.messageMeta, "callEntrantId")
        || "不明プレイヤー";
      const eventMeta = extractCallEventMeta(root);
      const groupKey = [
        eventMeta.tournamentId,
        eventMeta.tournamentName,
        eventMeta.eventId,
        eventMeta.eventName,
        eventMeta.eventAlias,
        eventMeta.phaseName,
        eventMeta.phaseGroupName,
      ].join("::") || "__unknown__";
      const found = groups.get(groupKey);

      if (found) {
        found.players.push({
          threadId: root.threadId,
          entrantName,
          createdAt: root.createdAt,
          senderName: root.senderName,
        });
      } else {
        groups.set(groupKey, {
          key: groupKey,
          eventAlias: eventMeta.eventAlias,
          tournamentName: eventMeta.tournamentName,
          eventName: eventMeta.eventName,
          eventId: eventMeta.eventId,
          phaseName: eventMeta.phaseName,
          phaseGroupName: eventMeta.phaseGroupName,
          players: [{
            threadId: root.threadId,
            entrantName,
            createdAt: root.createdAt,
            senderName: root.senderName,
          }],
        });
      }
    }

    return [...groups.values()].map((group) => ({
      ...group,
      players: group.players
        .slice()
        .sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime()),
    }));
  }, [focusOwnUnresolved, genericMessages, senderUserId]);

  const eventGroupComparator = useMemo(() => {
    if (eventSortStrategy === "max-elapsed") {
      return (left: CallListEventGroup, right: CallListEventGroup) =>
        compareCallListEventGroupByMaxElapsed(left, right, pageSwitchedAtMs);
    }

    return compareCallListEventGroup;
  }, [eventSortStrategy, pageSwitchedAtMs]);

  const latestGroupsByKey = useMemo(
    () => new Map(latestGroups.map((group) => [group.key, group] as const)),
    [latestGroups],
  );

  useEffect(() => {
    setDisplayGroups((current) => {
      if (current.length === 0) {
        return [...latestGroups].sort(eventGroupComparator);
      }

      const currentKeys = new Set(current.map((item) => item.key));
      const next = current.map((item) => latestGroupsByKey.get(item.key) ?? item);

      for (const group of latestGroups) {
        if (!currentKeys.has(group.key)) {
          next.push(group);
        }
      }

      return next;
    });
  }, [eventGroupComparator, latestGroups, latestGroupsByKey, rebuildToken]);

  useEffect(() => {
    setDisplayGroups((current) => current.slice().sort(eventGroupComparator));
  }, [eventGroupComparator]);

  const rootCounts = useMemo(() => {
    const unresolvedRoots = genericMessages.filter((root) =>
      root.parentMessageId === null
      && root.method === "call_player"
      && root.messageType === "normal"
      && !genericMessages.some((item) => item.threadId === root.threadId && item.messageType === "resolve")
    );
    const own = unresolvedRoots.filter((root) => root.senderUserId.trim() === senderUserId.trim()).length;

    return {
      total: unresolvedRoots.length,
      own,
      hidden: Math.max(0, unresolvedRoots.length - own),
    };
  }, [genericMessages, senderUserId]);

  const hasCallListMessages = displayGroups.length > 0 || genericMessages.some(
    (item) => item.parentMessageId === null && item.method === "call_player",
  );

  const pages = useMemo(() => {
    const result: CallListEventGroup[][] = [];
    for (let index = 0; index < displayGroups.length; index += CALL_LIST_EVENT_PAGE_SIZE) {
      result.push(displayGroups.slice(index, index + CALL_LIST_EVENT_PAGE_SIZE));
    }
    return result;
  }, [displayGroups]);

  const activePage = pages[pageIndex] ?? [];
  const currentPage = pages.length === 0 ? 0 : Math.min(pageIndex + 1, pages.length);
  const rotateMs = normalizeCallListRotateSeconds(pageRotateSeconds) * 1000;
  const colorToRedSeconds = normalizeCallListColorSeconds(colorSeconds);
  const pageProgressPercent = pages.length === 0
    ? 0
    : Math.max(0, Math.min(100, ((progressNowMs - pageSwitchedAtMs) / rotateMs) * 100));

  useEffect(() => {
    if (cycleCount === 0) {
      return;
    }

    setDisplayGroups([...latestGroups].sort(eventGroupComparator));
  }, [cycleCount, eventGroupComparator, latestGroups]);

  useEffect(() => {
    if (pages.length === 0) {
      if (pageIndex !== 0) {
        setPageIndex(0);
      }
      return;
    }

    if (pageIndex >= pages.length) {
      setPageIndex(0);
    }
  }, [pageIndex, pages.length]);

  useEffect(() => {
    if (activeTab !== "call-list" || pages.length === 0) {
      return;
    }

    const now = Date.now();
    const elapsedMs = Math.max(0, now - pageSwitchedAtMs);
    const missedTurns = Math.floor(elapsedMs / rotateMs);
    if (missedTurns <= 0) {
      return;
    }

    setPageSwitchedAtMs((current) => current + missedTurns * rotateMs);
    setPageIndex((current) => {
      const pageCount = pages.length;
      if (pageCount <= 0) {
        return 0;
      }

      const advanced = current + missedTurns;
      const next = advanced % pageCount;
      const completedCycles = pageCount === 1 ? missedTurns : Math.floor(advanced / pageCount);
      if (completedCycles > 0) {
        setCycleCount((cycle) => cycle + completedCycles);
      }

      return next;
    });
    setProgressNowMs(now);
  }, [activeTab, pageSwitchedAtMs, pages.length, rotateMs]);

  useEffect(() => {
    if (activeTab !== "call-list" || pages.length === 0) {
      setProgressNowMs(Date.now());
      return;
    }

    setProgressNowMs(Date.now());
    const tickerId = window.setInterval(() => {
      setProgressNowMs(Date.now());
    }, 100);

    return () => {
      window.clearInterval(tickerId);
    };
  }, [activeTab, pages.length]);

  useEffect(() => {
    if (activeTab !== "call-list" || pages.length === 0) {
      setProgressNowMs(Date.now());
      return;
    }

    const timerId = window.setInterval(() => {
      setPageSwitchedAtMs(Date.now());
      setPageIndex((current) => {
        const next = (current + 1) % pages.length;
        if (next === 0) {
          setCycleCount((cycle) => cycle + 1);
        }
        return next;
      });
    }, rotateMs);

    return () => {
      window.clearInterval(timerId);
    };
  }, [activeTab, pages.length, rotateMs]);

  function resetDisplay(options: ResetCallListDisplayOptions = {}) {
    const now = Date.now();
    if (options.clearOwnOnly) {
      setFocusOwnUnresolved(false);
    }
    setDisplayGroups([]);
    if (options.rebuild) {
      setRebuildToken((current) => current + 1);
    }
    setPageIndex(0);
    setCycleCount(0);
    setPageSwitchedAtMs(now);
    setProgressNowMs(now);
  }

  function advancePage() {
    setPageSwitchedAtMs(Date.now());
    setPageIndex((current) => {
      const next = (current + 1) % pages.length;
      if (next === 0) {
        setCycleCount((cycle) => cycle + 1);
      }
      return next;
    });
  }

  return {
    displayGroups,
    eventGroups: displayGroups,
    hasCallListMessages,
    activePage,
    rootCounts,
    focusOwnUnresolved,
    setFocusOwnUnresolved,
    eventSortStrategy,
    toggleSort: () => setEventSortStrategy((current) => current === "alias" ? "max-elapsed" : "alias"),
    pageIndex,
    currentPage,
    totalPages: pages.length,
    pageSwitchedAtMs,
    pageProgressPercent,
    pageRotateSeconds,
    changePageRotateSeconds,
    commitPageRotateSeconds,
    colorSeconds,
    changeColorSeconds,
    commitColorSeconds,
    colorToRedSeconds,
    resetDisplay,
    advancePage,
  };
}
