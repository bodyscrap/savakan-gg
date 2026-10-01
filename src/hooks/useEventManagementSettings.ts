import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  clampNonNegativeInteger,
  normalizeAllowDuplicatesArray,
  normalizeEventManagementSetting,
  normalizeSelectionCountArrays,
  removeItemListFromEventManagementSettings,
  buildCategoryUsageList,
  buildConfiguredCategorySlots,
  type EventManagementSetting,
} from "../domain/eventManagement";
import type { EventSnapshot } from "../domain/bracketDisplay";
import {
  MAX_CATEGORY_SLOTS,
  normalizeItemListConfig,
  resolveEventItemList,
  type ItemListConfig,
} from "../domain/itemList";
import type { EventLocalMeta, EventManagementMeta } from "./useTournamentWorkspace";

const EVENT_MGMT_STORAGE_KEY = "savakan-gg.event-mgmt.v1";

function normalizeSettingStorageKey(rawKey: string): string {
  const [slugPart, ...rest] = rawKey.split("::");
  if (!slugPart) {
    return rawKey.trim();
  }
  const normalizedSlug = slugPart.trim().replace(/^tournament\//, "").replace(/^\/+|\/+$/g, "");
  const eventId = rest.join("::").trim();
  return eventId === "" ? normalizedSlug : `${normalizedSlug}::${eventId}`;
}

function normalizeApiSlug(rawSlug: string): string {
  const trimmed = rawSlug.trim();
  const withoutPrefix = trimmed.startsWith("tournament/")
    ? trimmed.slice("tournament/".length)
    : trimmed;
  const normalized = withoutPrefix.replace(/^\/+|\/+$/g, "");
  return normalized === "" ? "" : `tournament/${normalized}`;
}

function sameSetting(leftRaw: EventManagementSetting | undefined, rightRaw: EventManagementSetting): boolean {
  if (!leftRaw) {
    return false;
  }
  const left = normalizeEventManagementSetting(leftRaw);
  const right = normalizeEventManagementSetting(rightRaw);
  return JSON.stringify(left) === JSON.stringify(right);
}

export function shouldHydrateEventManagementSettings(
  ready: boolean,
  selectedEventSettingKey: string,
  hydratedEventSettingKey: string,
): boolean {
  return ready
    && selectedEventSettingKey !== ""
    && selectedEventSettingKey !== hydratedEventSettingKey;
}

export function resolveCommittedEventManagementSetting(
  eventManagement: EventManagementMeta | null | undefined,
): EventManagementSetting | null {
  if (!eventManagement) {
    return null;
  }

  return normalizeEventManagementSetting({
    sideDecisionMethod: eventManagement.sideDecisionMethod,
    itemListIds: (eventManagement.itemListSnapshots ?? []).map((item) => normalizeItemListConfig(item).id),
    categoryMinCounts: eventManagement.categoryMinCounts,
    categoryMaxCounts: eventManagement.categoryMaxCounts,
    categoryAllowDuplicates: eventManagement.categoryAllowDuplicates,
    totalMinCount: eventManagement.totalMinCount,
    totalMaxCount: eventManagement.totalMaxCount,
  });
}

type UseEventManagementSettingsOptions = {
  selectedEventSettingKey: string;
  selectedEventMeta: EventLocalMeta | null;
  selectedEvent: EventSnapshot | null;
  slug: string;
  itemLists: ItemListConfig[];
  saveEventManagementMeta: (input: {
    slug: string;
    eventId: string;
    eventName: string;
    setting: EventManagementMeta;
  }) => Promise<unknown>;
  setBusy: (busy: boolean) => void;
  setError: (error: string) => void;
  setMessage: (message: string) => void;
};

export function useEventManagementSettings({
  selectedEventSettingKey,
  selectedEventMeta,
  selectedEvent,
  slug,
  itemLists,
  saveEventManagementMeta,
  setBusy,
  setError,
  setMessage,
}: UseEventManagementSettingsOptions) {
  const [eventMgmtSettings, setEventMgmtSettings] = useState<Record<string, EventManagementSetting>>({});
  const [appliedEventMgmtSettings, setAppliedEventMgmtSettings] = useState<Record<string, EventManagementSetting>>({});
  const [eventMgmtSettingsReady, setEventMgmtSettingsReady] = useState(false);
  const [sideDecisionMethod, setSideDecisionMethod] = useState<EventManagementSetting["sideDecisionMethod"]>("upper_1p");
  const [categorySlotListIds, setCategorySlotListIds] = useState<string[]>(["", "", ""]);
  const [categorySlotMinCounts, setCategorySlotMinCounts] = useState<number[]>([0, 0, 0]);
  const [categorySlotMaxCounts, setCategorySlotMaxCounts] = useState<number[]>([1, 1, 1]);
  const [categorySlotAllowDuplicates, setCategorySlotAllowDuplicates] = useState<boolean[]>([false, false, false]);
  const [totalItemMinCount, setTotalItemMinCount] = useState(0);
  const [totalItemMaxCount, setTotalItemMaxCount] = useState(3);
  const eventSettingHydratedKeyRef = useRef("");
  const suppressEventSettingAutosaveRef = useRef(false);
  const selectedEventItemListSnapshots = useMemo(() => {
    const snapshots = selectedEventMeta?.eventManagement?.itemListSnapshots;
    return snapshots
      ? snapshots.slice(0, MAX_CATEGORY_SLOTS).map(normalizeItemListConfig)
      : [];
  }, [selectedEventMeta]);
  const configuredCategorySlots = useMemo(
    () => buildConfiguredCategorySlots(
      appliedEventMgmtSettings[selectedEventSettingKey],
      (listId) => resolveEventItemList(listId, selectedEventItemListSnapshots, itemLists),
    ),
    [appliedEventMgmtSettings, itemLists, selectedEventItemListSnapshots, selectedEventSettingKey],
  );
  const selectedCategoryUsageList = useMemo(
    () => buildCategoryUsageList(configuredCategorySlots, selectedEventMeta?.entrants ?? []),
    [configuredCategorySlots, selectedEventMeta],
  );

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const fromRust = await invoke<Record<string, unknown> | null>("load_event_mgmt_settings");
        if (!alive) {
          return;
        }
        if (fromRust && typeof fromRust === "object") {
          const normalized: Record<string, EventManagementSetting> = {};
          for (const [key, value] of Object.entries(fromRust)) {
            normalized[normalizeSettingStorageKey(key)] = normalizeEventManagementSetting(value);
          }
          setEventMgmtSettings(normalized);
          return;
        }

        const raw = window.localStorage.getItem(EVENT_MGMT_STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as Record<string, unknown>;
          if (parsed && typeof parsed === "object") {
            const normalized: Record<string, EventManagementSetting> = {};
            for (const [key, value] of Object.entries(parsed)) {
              normalized[normalizeSettingStorageKey(key)] = normalizeEventManagementSetting(value);
            }
            setEventMgmtSettings(normalized);
          }
        }
      } catch {
        // Ignore unavailable native storage and malformed local fallback data.
      } finally {
        if (alive) {
          setEventMgmtSettingsReady(true);
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!eventMgmtSettingsReady) {
      return;
    }
    try {
      window.localStorage.setItem(EVENT_MGMT_STORAGE_KEY, JSON.stringify(eventMgmtSettings));
    } catch {
      // Ignore local storage failures.
    }
    void invoke("save_event_mgmt_settings", { settings: eventMgmtSettings })
      .catch((error) => setError(String(error)));
  }, [eventMgmtSettings, eventMgmtSettingsReady]);

  useEffect(() => {
    if (selectedEventSettingKey === "") {
      eventSettingHydratedKeyRef.current = "";
      return;
    }
    if (!shouldHydrateEventManagementSettings(
      eventMgmtSettingsReady,
      selectedEventSettingKey,
      eventSettingHydratedKeyRef.current,
    )) {
      return;
    }

    const committedSetting = resolveCommittedEventManagementSetting(selectedEventMeta?.eventManagement);
    const rawSetting = committedSetting ?? eventMgmtSettings[selectedEventSettingKey];
    if (!rawSetting) {
      suppressEventSettingAutosaveRef.current = true;
      eventSettingHydratedKeyRef.current = selectedEventSettingKey;
      setAppliedEventMgmtSettings((current) => {
        if (!(selectedEventSettingKey in current)) {
          return current;
        }
        const next = { ...current };
        delete next[selectedEventSettingKey];
        return next;
      });
      setSideDecisionMethod("upper_1p");
      setCategorySlotListIds(["", "", ""]);
      setCategorySlotMinCounts([0, 0, 0]);
      setCategorySlotMaxCounts([1, 1, 1]);
      setCategorySlotAllowDuplicates([false, false, false]);
      setTotalItemMinCount(0);
      setTotalItemMaxCount(3);
      return;
    }

    const setting = normalizeEventManagementSetting(rawSetting);
    setAppliedEventMgmtSettings((current) => {
      if (committedSetting) {
        return { ...current, [selectedEventSettingKey]: committedSetting };
      }
      if (!(selectedEventSettingKey in current)) {
        return current;
      }
      const next = { ...current };
      delete next[selectedEventSettingKey];
      return next;
    });
    const nextIds = setting.itemListIds.slice(0, MAX_CATEGORY_SLOTS);
    while (nextIds.length < MAX_CATEGORY_SLOTS) {
      nextIds.push("");
    }
    suppressEventSettingAutosaveRef.current = true;
    eventSettingHydratedKeyRef.current = selectedEventSettingKey;
    setSideDecisionMethod(setting.sideDecisionMethod);
    setCategorySlotListIds(nextIds);
    setCategorySlotMinCounts(normalizeSelectionCountArrays(setting.categoryMinCounts, 0));
    setCategorySlotMaxCounts(normalizeSelectionCountArrays(setting.categoryMaxCounts, 1));
    setCategorySlotAllowDuplicates(normalizeAllowDuplicatesArray(setting.categoryAllowDuplicates));
    setTotalItemMinCount(clampNonNegativeInteger(Number(setting.totalMinCount ?? 0), 0));
    setTotalItemMaxCount(clampNonNegativeInteger(Number(setting.totalMaxCount ?? 3), 3));
  }, [eventMgmtSettingsReady, selectedEventSettingKey]);

  useEffect(() => {
    if (
      selectedEventSettingKey === ""
      || eventSettingHydratedKeyRef.current !== selectedEventSettingKey
    ) {
      return;
    }
    if (suppressEventSettingAutosaveRef.current) {
      suppressEventSettingAutosaveRef.current = false;
      return;
    }

    const itemListIds = categorySlotListIds.slice(0, MAX_CATEGORY_SLOTS).map((id) => id.trim());
    const normalizedMinCounts = normalizeSelectionCountArrays(categorySlotMinCounts, 0);
    const normalizedMaxCounts = normalizeSelectionCountArrays(categorySlotMaxCounts, 1);
    const normalizedAllowDuplicates = normalizeAllowDuplicatesArray(categorySlotAllowDuplicates);
    for (let index = 0; index < itemListIds.length; index += 1) {
      if (itemListIds[index] === "") {
        normalizedMinCounts[index] = 0;
        normalizedMaxCounts[index] = 0;
        normalizedAllowDuplicates[index] = false;
      } else if (normalizedMaxCounts[index] < normalizedMinCounts[index]) {
        normalizedMaxCounts[index] = normalizedMinCounts[index];
      }
    }
    const totalMinCount = clampNonNegativeInteger(totalItemMinCount, 0);
    const totalMaxCount = Math.max(clampNonNegativeInteger(totalItemMaxCount, 0), totalMinCount);
    const nextSetting = normalizeEventManagementSetting({
      sideDecisionMethod,
      itemListIds,
      categoryMinCounts: normalizedMinCounts,
      categoryMaxCounts: normalizedMaxCounts,
      categoryAllowDuplicates: normalizedAllowDuplicates,
      totalMinCount,
      totalMaxCount,
    });
    setEventMgmtSettings((current) => sameSetting(current[selectedEventSettingKey], nextSetting)
      ? current
      : { ...current, [selectedEventSettingKey]: nextSetting });
  }, [
    categorySlotAllowDuplicates,
    categorySlotListIds,
    categorySlotMaxCounts,
    categorySlotMinCounts,
    selectedEventSettingKey,
    sideDecisionMethod,
    totalItemMaxCount,
    totalItemMinCount,
  ]);

  function setCategoryListSlot(slotIndex: number, itemListId: string) {
    setCategorySlotListIds((current) => {
      const next = [...current];
      while (next.length < MAX_CATEGORY_SLOTS) {
        next.push("");
      }
      if (itemListId !== "") {
        for (let index = 0; index < next.length; index += 1) {
          if (index !== slotIndex && next[index] === itemListId) {
            next[index] = "";
          }
        }
      }
      next[slotIndex] = itemListId;
      return next.slice(0, MAX_CATEGORY_SLOTS);
    });
    if (itemListId.trim() === "") {
      setCategorySlotMinCounts((current) => current.map((value, index) => index === slotIndex ? 0 : value));
      setCategorySlotMaxCounts((current) => current.map((value, index) => index === slotIndex ? 0 : value));
      setCategorySlotAllowDuplicates((current) => current.map((value, index) => index === slotIndex ? false : value));
      return;
    }
    setCategorySlotMaxCounts((current) => current.map((value, index) => index === slotIndex && value < 1 ? 1 : value));
  }

  function handleCategorySlotMinChange(slotIndex: number, value: string) {
    const nextMin = clampNonNegativeInteger(Number(value), 0);
    setCategorySlotMinCounts((current) => {
      const next = [...current];
      next[slotIndex] = nextMin;
      return next;
    });
    setCategorySlotMaxCounts((current) => {
      const next = [...current];
      if ((next[slotIndex] ?? 0) < nextMin) {
        next[slotIndex] = nextMin;
      }
      return next;
    });
  }

  function handleCategorySlotMaxChange(slotIndex: number, value: string) {
    const rawMax = clampNonNegativeInteger(Number(value), 0);
    const ensuredMax = Math.max(rawMax, categorySlotMinCounts[slotIndex] ?? 0);
    setCategorySlotMaxCounts((current) => {
      const next = [...current];
      next[slotIndex] = ensuredMax;
      return next;
    });
  }

  function handleCategorySlotAllowDuplicatesChange(slotIndex: number, allowed: boolean) {
    setCategorySlotAllowDuplicates((current) => {
      const next = [...current];
      next[slotIndex] = allowed;
      return next;
    });
  }

  function handleTotalItemMinChange(value: string) {
    const nextMin = clampNonNegativeInteger(Number(value), 0);
    setTotalItemMinCount(nextMin);
    setTotalItemMaxCount((current) => Math.max(current, nextMin));
  }

  function handleTotalItemMaxChange(value: string) {
    const nextMax = clampNonNegativeInteger(Number(value), 0);
    setTotalItemMaxCount(Math.max(nextMax, totalItemMinCount));
  }

  function removeItemListSettings(itemListId: string) {
    setEventMgmtSettings((current) => removeItemListFromEventManagementSettings(current, itemListId));
    setAppliedEventMgmtSettings((current) => removeItemListFromEventManagementSettings(current, itemListId));
    const nextListIds = categorySlotListIds.map((id) => id === itemListId ? "" : id);
    setCategorySlotListIds(nextListIds);
    setCategorySlotMinCounts((current) => current.map((value, index) => nextListIds[index] === "" && categorySlotListIds[index] === itemListId ? 0 : value));
    setCategorySlotMaxCounts((current) => current.map((value, index) => nextListIds[index] === "" && categorySlotListIds[index] === itemListId ? 0 : value));
    setCategorySlotAllowDuplicates((current) => current.map((value, index) => nextListIds[index] === "" && categorySlotListIds[index] === itemListId ? false : value));
  }

  async function saveEventManagementSetting() {
    if (selectedEventSettingKey === "" || !selectedEvent) {
      setError("先にイベントを選択してください。");
      return;
    }
    const itemListIds = categorySlotListIds.slice(0, MAX_CATEGORY_SLOTS).map((id) => id.trim());
    const normalizedMinCounts = normalizeSelectionCountArrays(categorySlotMinCounts, 0);
    const normalizedMaxCounts = normalizeSelectionCountArrays(categorySlotMaxCounts, 1);
    const normalizedAllowDuplicates = normalizeAllowDuplicatesArray(categorySlotAllowDuplicates);
    const seen = new Set<string>();
    for (let index = 0; index < itemListIds.length; index += 1) {
      if (itemListIds[index] === "") {
        normalizedMinCounts[index] = 0;
        normalizedMaxCounts[index] = 0;
        normalizedAllowDuplicates[index] = false;
        continue;
      }
      if (seen.has(itemListIds[index])) {
        setError("カテゴリは重複して設定できません。");
        return;
      }
      seen.add(itemListIds[index]);
      if (normalizedMaxCounts[index] < normalizedMinCounts[index]) {
        setError(`カテゴリ${index + 1}: 上限は下限以上にしてください。`);
        return;
      }
    }
    const totalMinCount = clampNonNegativeInteger(totalItemMinCount, 0);
    const totalMaxCount = Math.max(clampNonNegativeInteger(totalItemMaxCount, 0), totalMinCount);
    const nextSetting: EventManagementSetting = normalizeEventManagementSetting({
      sideDecisionMethod,
      itemListIds,
      categoryMinCounts: normalizedMinCounts,
      categoryMaxCounts: normalizedMaxCounts,
      categoryAllowDuplicates: normalizedAllowDuplicates,
      totalMinCount,
      totalMaxCount,
    });

    setBusy(true);
    setError("");
    setMessage("");
    try {
      const itemListSnapshots = itemListIds.map((listId) => {
        if (listId === "") {
          return { id: "", name: "", categoryName: "", items: [] };
        }
        const source = selectedEventItemListSnapshots.find((item) => item.id === listId)
          ?? itemLists.find((item) => item.id === listId);
        if (!source) {
          throw new Error(`選択中のカテゴリ設定に存在しないアイテムリストがあります: ${listId}`);
        }
        return normalizeItemListConfig(source);
      });
      await saveEventManagementMeta({
        slug: normalizeApiSlug(slug),
        eventId: selectedEvent.eventId,
        eventName: selectedEvent.name,
        setting: {
          sideDecisionMethod,
          itemListSnapshots,
          categoryMinCounts: normalizedMinCounts,
          categoryMaxCounts: normalizedMaxCounts,
          categoryAllowDuplicates: normalizedAllowDuplicates,
          totalMinCount,
          totalMaxCount,
        },
      });
      setEventMgmtSettings((current) => ({ ...current, [selectedEventSettingKey]: nextSetting }));
      setAppliedEventMgmtSettings((current) => ({ ...current, [selectedEventSettingKey]: nextSetting }));
      setMessage("大会管理設定を保存しました。");
    } catch (error) {
      setError(String(error));
    } finally {
      setBusy(false);
    }
  }

  return {
    eventMgmtSettings,
    appliedEventMgmtSettings,
    selectedEventItemListSnapshots,
    configuredCategorySlots,
    selectedCategoryUsageList,
    eventMgmtSettingsReady,
    sideDecisionMethod,
    setSideDecisionMethod,
    categorySlotListIds,
    setCategorySlotListIds,
    categorySlotMinCounts,
    setCategorySlotMinCounts,
    categorySlotMaxCounts,
    setCategorySlotMaxCounts,
    categorySlotAllowDuplicates,
    setCategorySlotAllowDuplicates,
    totalItemMinCount,
    setTotalItemMinCount,
    totalItemMaxCount,
    setTotalItemMaxCount,
    setEventMgmtSettings,
    setCategoryListSlot,
    handleCategorySlotMinChange,
    handleCategorySlotMaxChange,
    handleCategorySlotAllowDuplicatesChange,
    handleTotalItemMinChange,
    handleTotalItemMaxChange,
    removeItemListSettings,
    saveEventManagementSetting,
  };
}