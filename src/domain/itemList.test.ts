import { describe, expect, it } from "vitest";
import { collectFreeTextItems, createImportedItemList, FREE_TEXT_LIST_ID } from "./itemList";
import { buildCategoryUsageList, buildConfiguredCategorySlots, validateCategorySelections } from "./eventManagement";

describe("free text categories", () => {
  it("accepts independent free text categories without an item list", () => {
    const resolve = () => null;
    const slots = buildConfiguredCategorySlots({ sideDecisionMethod: "upper_1p",
      itemListIds: [FREE_TEXT_LIST_ID, "", FREE_TEXT_LIST_ID] }, resolve);
    const result = validateCategorySelections([[" Alpha "], [], ["Beta"]], slots, 0, 3);
    expect(result.errors).toEqual([]);
    expect(result.normalizedBySlot).toEqual([["Alpha"], [], ["Beta"]]);
  });

  it("deduplicates whole entries without splitting punctuation", () => {
    expect(collectFreeTextItems([" A / B ", "A / B", "", "C"])).toEqual(["A / B", "C"]);
    expect(collectFreeTextItems([" A.*B ", "B, C", ""])).toEqual(["A.*B", "B, C"]);
  });

  it("counts free text usage independently by category", () => {
    const slots = buildConfiguredCategorySlots({ sideDecisionMethod: "upper_1p",
      itemListIds: [FREE_TEXT_LIST_ID, FREE_TEXT_LIST_ID] }, () => null);
    const usage = buildCategoryUsageList(slots, [{ characterNames: ["A", "B"], categorySelections: [["A"], ["B"], []] }]);
    expect(usage.map((slot) => slot.entries.map((entry) => entry.itemName))).toEqual([["A"], ["B"]]);
  });
});

describe("createImportedItemList", () => {
  it("normalizes list data and retains its ID when it is unused", () => {
    const imported = createImportedItemList({
      id: "exported-list-id",
      name: "  キャラ  ",
      categoryName: "  使用キャラ ",
      items: [" マリオ ", "", "マリオ", "ルイージ"],
    });

    expect(imported).toEqual({
      id: "exported-list-id",
      name: "キャラ",
      categoryName: "使用キャラ",
      items: ["マリオ", "ルイージ"],
    });
  });

  it("assigns a new ID when the imported ID is already in use", () => {
    const imported = createImportedItemList({
      id: "existing-id",
      name: "キャラ",
      categoryName: "使用キャラ",
      items: ["マリオ"],
    }, [{
      id: "existing-id",
      name: "既存",
      categoryName: "カテゴリ",
      items: [],
    }]);

    expect(imported.id).not.toBe("existing-id");
  });

  it("rejects files that do not contain a valid item list", () => {
    expect(() => createImportedItemList(null)).toThrow("形式が不正です");
    expect(() => createImportedItemList({
      name: "キャラ",
      categoryName: "使用キャラ",
      items: ["マリオ", 1],
    })).toThrow("アイテムリスト名、カテゴリ名、アイテム一覧");
  });
});
