import { t } from "../i18n";
export type ItemListConfig = {
  id: string;
  name: string;
  categoryName: string;
  items: string[];
};

export const MAX_CATEGORY_SLOTS = 3;
export const FREE_TEXT_LIST_ID = "__free_text__";

export function freeTextCategory(slotIndex: number): ItemListConfig {
  return {
    id: FREE_TEXT_LIST_ID,
    name: t("自由記入"),
    categoryName: t("カテゴリ{value1}", { value1: slotIndex + 1 }),
    items: [],
  };
}

export function collectFreeTextItems(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

export function normalizeItemListConfig(rawValue: unknown): ItemListConfig {
  const source = rawValue && typeof rawValue === "object"
    ? (rawValue as Partial<ItemListConfig>)
    : {};

  const id = typeof source.id === "string" ? source.id.trim() : "";
  const name = typeof source.name === "string" ? source.name.trim() : "";
  const categoryName = typeof source.categoryName === "string" ? source.categoryName.trim() : "";
  const items = Array.isArray(source.items)
    ? source.items
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter((item) => item !== "")
    : [];

  return {
    id,
    name,
    categoryName,
    items: [...new Set(items)],
  };
}

export function createImportedItemList(
  rawValue: unknown,
  existingLists: readonly ItemListConfig[] = [],
): ItemListConfig {
  if (
    rawValue === null
    || typeof rawValue !== "object"
    || Array.isArray(rawValue)
  ) {
    throw new Error(t("インポートするアイテムリストの形式が不正です。"));
  }

  const source = rawValue as Partial<ItemListConfig>;
  if (
    typeof source.name !== "string"
    || source.name.trim() === ""
    || typeof source.categoryName !== "string"
    || source.categoryName.trim() === ""
    || !Array.isArray(source.items)
    || source.items.some((item) => typeof item !== "string")
  ) {
    throw new Error(t("アイテムリスト名、カテゴリ名、アイテム一覧を含むJSONを指定してください。"));
  }

  const normalized = normalizeItemListConfig(rawValue);
  return {
    ...normalized,
    id: normalized.id === "" || normalized.id === FREE_TEXT_LIST_ID
      || existingLists.some((itemList) => itemList.id === normalized.id)
      ? crypto.randomUUID()
      : normalized.id,
  };
}

export function parseLinesToUniqueList(value: string): string[] {
  const seen = new Set<string>();
  const items: string[] = [];
  for (const line of value.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "" || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    items.push(trimmed);
  }
  return items;
}

export function resolveEventItemList(
  listId: string,
  eventSnapshots: ItemListConfig[],
  itemLists: ItemListConfig[],
): ItemListConfig | null {
  const normalizedId = listId.trim();
  if (normalizedId === "") {
    return null;
  }

  return eventSnapshots.find((item) => item.id === normalizedId)
    ?? itemLists.find((item) => item.id === normalizedId)
    ?? null;
}