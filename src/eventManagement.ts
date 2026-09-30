import { MAX_CATEGORY_SLOTS, type ItemListConfig } from "./itemList";

export type EventManagementSetting = {
  sideDecisionMethod: "upper_1p" | "upper_2p" | "random";
  itemListIds: string[];
  categoryMinCounts?: number[];
  categoryMaxCounts?: number[];
  categoryAllowDuplicates?: boolean[];
  totalMinCount?: number;
  totalMaxCount?: number;
};

export type PlaySideAssignment = {
  upperSide: "1P" | "2P";
  lowerSide: "1P" | "2P";
};

export function resolveSwappedMatchSideAssignment(
  upperDraft: PlaySideAssignment["upperSide"] | "",
  lowerDraft: PlaySideAssignment["lowerSide"] | "",
  upperSaved: PlaySideAssignment["upperSide"] | "",
  lowerSaved: PlaySideAssignment["lowerSide"] | "",
): PlaySideAssignment {
  const upperCurrent = upperDraft || upperSaved || "1P";
  const lowerCurrent = lowerDraft || lowerSaved || "2P";
  return { upperSide: lowerCurrent, lowerSide: upperCurrent };
}

export function resolveRandomMatchSideAssignment(randomValue: number): PlaySideAssignment {
  const upperSide = randomValue < 0.5 ? "1P" : "2P";
  return {
    upperSide,
    lowerSide: upperSide === "1P" ? "2P" : "1P",
  };
}

export function resolveMatchSideAssignment(
  upperCandidate: PlaySideAssignment["upperSide"] | "",
  lowerCandidate: PlaySideAssignment["lowerSide"] | "",
): PlaySideAssignment | null {
  const upperSide = upperCandidate !== ""
    ? upperCandidate
    : lowerCandidate === "1P"
      ? "2P"
      : lowerCandidate === "2P"
        ? "1P"
        : "";

  if (upperSide === "") {
    return null;
  }

  return {
    upperSide,
    lowerSide: upperSide === "1P" ? "2P" : "1P",
  };
}

export type CategoryUsageSlot = {
  slotIndex: number;
  list: Pick<ItemListConfig, "categoryName" | "name" | "items">;
};

export type CategoryUsageEntrant = {
  characterNames: string[];
};

export type CategoryUsage = {
  slotIndex: number;
  categoryName: string;
  listName: string;
  entries: Array<{ itemName: string; count: number; rate: number }>;
};

export type ConfiguredCategorySlot = {
  slotIndex: number;
  list: ItemListConfig;
  minCount: number;
  maxCount: number;
  allowDuplicates: boolean;
};

export function buildConfiguredCategorySlots(
  setting: EventManagementSetting | undefined,
  resolveItemList: (listId: string) => ItemListConfig | null,
): ConfiguredCategorySlot[] {
  const slots: ConfiguredCategorySlot[] = [];

  for (let slotIndex = 0; slotIndex < MAX_CATEGORY_SLOTS; slotIndex += 1) {
    const listId = setting?.itemListIds[slotIndex] ?? "";
    if (listId.trim() === "") {
      continue;
    }

    const list = resolveItemList(listId);
    if (!list) {
      continue;
    }

    const minCount = clampNonNegativeInteger(setting?.categoryMinCounts?.[slotIndex] ?? 0, 0);
    const maxCount = Math.max(
      clampNonNegativeInteger(setting?.categoryMaxCounts?.[slotIndex] ?? 1, 1),
      minCount,
    );

    slots.push({
      slotIndex,
      list,
      minCount,
      maxCount,
      allowDuplicates: Boolean(setting?.categoryAllowDuplicates?.[slotIndex]),
    });
  }

  return slots;
}

export function buildCategoryUsageList(
  configuredSlots: CategoryUsageSlot[],
  entrants: CategoryUsageEntrant[],
): CategoryUsage[] {
  const denominator = Math.max(entrants.length, 1);

  return configuredSlots.map((slot) => {
    const itemCounts = new Map<string, number>();
    const items = slot.list.items
      .map((itemName) => itemName.trim())
      .filter((itemName) => itemName !== "");

    for (const itemName of items) {
      itemCounts.set(itemName, 0);
    }

    for (const entrant of entrants) {
      const chosen = entrant.characterNames
        .map((itemName) => itemName.trim())
        .filter((itemName) => itemCounts.has(itemName));

      for (const itemName of new Set(chosen)) {
        itemCounts.set(itemName, (itemCounts.get(itemName) ?? 0) + 1);
      }
    }

    const entries = [...itemCounts.entries()]
      .map(([itemName, count]) => ({
        itemName,
        count,
        rate: (count / denominator) * 100,
      }))
      .filter((entry) => entry.count > 0)
      .sort((left, right) => right.rate - left.rate || left.itemName.localeCompare(right.itemName, "ja"));

    return {
      slotIndex: slot.slotIndex,
      categoryName: slot.list.categoryName,
      listName: slot.list.name,
      entries,
    };
  });
}

export function resolveSideDecisionMethod(value: unknown): EventManagementSetting["sideDecisionMethod"] {
  return value === "upper_2p" || value === "random" ? value : "upper_1p";
}

export function resolveSidesByDecisionMethod(
  setId: string,
  method: EventManagementSetting["sideDecisionMethod"],
): PlaySideAssignment {
  if (method === "upper_2p") {
    return { upperSide: "2P", lowerSide: "1P" };
  }

  if (method === "random") {
    let accumulator = 0;
    for (let index = 0; index < setId.length; index += 1) {
      accumulator = (accumulator + setId.charCodeAt(index)) % 9973;
    }
    const upperIsOneP = accumulator % 2 === 0;
    return {
      upperSide: upperIsOneP ? "1P" : "2P",
      lowerSide: upperIsOneP ? "2P" : "1P",
    };
  }

  return { upperSide: "1P", lowerSide: "2P" };
}

export function clampNonNegativeInteger(value: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  const rounded = Math.trunc(value);
  if (rounded < 0) {
    return 0;
  }

  return rounded;
}

export function normalizeSelectionCountArrays(
  value: unknown,
  fallbackValue: number,
): number[] {
  const source = Array.isArray(value) ? value : [];
  const normalized = source
    .slice(0, MAX_CATEGORY_SLOTS)
    .map((item) => clampNonNegativeInteger(Number(item), fallbackValue));

  while (normalized.length < MAX_CATEGORY_SLOTS) {
    normalized.push(fallbackValue);
  }

  return normalized;
}

export function normalizeAllowDuplicatesArray(value: unknown): boolean[] {
  const source = Array.isArray(value) ? value : [];
  const normalized = source
    .slice(0, MAX_CATEGORY_SLOTS)
    .map((item) => Boolean(item));

  while (normalized.length < MAX_CATEGORY_SLOTS) {
    normalized.push(false);
  }

  return normalized;
}

export function normalizeEventManagementSetting(rawValue: unknown): EventManagementSetting {
  const source = rawValue && typeof rawValue === "object"
    ? (rawValue as Partial<EventManagementSetting>)
    : {};

  const sideDecisionMethod = resolveSideDecisionMethod(source.sideDecisionMethod);

  const ids = Array.isArray(source.itemListIds)
    ? source.itemListIds.filter((id): id is string => typeof id === "string").slice(0, MAX_CATEGORY_SLOTS)
    : [];
  while (ids.length < MAX_CATEGORY_SLOTS) {
    ids.push("");
  }

  const categoryMinCounts = normalizeSelectionCountArrays(source.categoryMinCounts, 0);
  const categoryMaxCounts = normalizeSelectionCountArrays(source.categoryMaxCounts, 1)
    .map((maxCount, index) => Math.max(maxCount, categoryMinCounts[index]));
  const categoryAllowDuplicates = normalizeAllowDuplicatesArray(source.categoryAllowDuplicates);

  const enabledSlotCount = ids.filter((id) => id.trim() !== "").length;
  const totalMinCount = clampNonNegativeInteger(Number(source.totalMinCount ?? 0), 0);
  const totalMaxCount = Math.max(
    clampNonNegativeInteger(Number(source.totalMaxCount ?? enabledSlotCount), enabledSlotCount),
    totalMinCount,
  );

  return {
    sideDecisionMethod,
    itemListIds: ids,
    categoryMinCounts,
    categoryMaxCounts,
    categoryAllowDuplicates,
    totalMinCount,
    totalMaxCount,
  };
}

export function removeItemListFromEventManagementSettings(
  settings: Record<string, EventManagementSetting>,
  itemListId: string,
): Record<string, EventManagementSetting> {
  const next: Record<string, EventManagementSetting> = {};
  for (const [key, value] of Object.entries(settings)) {
    const normalized = normalizeEventManagementSetting(value);
    const itemListIds = [...normalized.itemListIds];
    const categoryMinCounts = normalizeSelectionCountArrays(normalized.categoryMinCounts, 0);
    const categoryMaxCounts = normalizeSelectionCountArrays(normalized.categoryMaxCounts, 1);
    const categoryAllowDuplicates = normalizeAllowDuplicatesArray(normalized.categoryAllowDuplicates);

    for (let index = 0; index < MAX_CATEGORY_SLOTS; index += 1) {
      if (itemListIds[index] === itemListId) {
        itemListIds[index] = "";
        categoryMinCounts[index] = 0;
        categoryMaxCounts[index] = 0;
        categoryAllowDuplicates[index] = false;
      }
    }

    next[key] = normalizeEventManagementSetting({
      ...normalized,
      itemListIds,
      categoryMinCounts,
      categoryMaxCounts,
      categoryAllowDuplicates,
    });
  }
  return next;
}

export function emptyCategorySelections(): string[][] {
  return Array.from({ length: MAX_CATEGORY_SLOTS }, () => [] as string[]);
}