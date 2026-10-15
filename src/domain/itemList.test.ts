import { describe, expect, it } from "vitest";
import { createImportedItemList } from "./itemList";

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
