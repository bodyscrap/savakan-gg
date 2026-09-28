export type ItemListConfig = {
  id: string;
  name: string;
  categoryName: string;
  items: string[];
};

export const MAX_CATEGORY_SLOTS = 3;

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