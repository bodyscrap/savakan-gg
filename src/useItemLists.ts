import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { normalizeItemListConfig, parseLinesToUniqueList, type ItemListConfig } from "./itemList";

const ITEM_LIST_STORAGE_KEY = "savakan-gg.item-lists.v1";

type UseItemListsOptions = {
  onError: (error: string) => void;
  onMessage: (message: string) => void;
};

export function useItemLists({ onError, onMessage }: UseItemListsOptions) {
  const [itemLists, setItemLists] = useState<ItemListConfig[]>([]);
  const [itemListsReady, setItemListsReady] = useState(false);
  const [editingItemListId, setEditingItemListId] = useState<string | null>(null);
  const [itemListName, setItemListName] = useState("");
  const [itemCategoryName, setItemCategoryName] = useState("");
  const [itemListText, setItemListText] = useState("");
  const [itemListSearchInput, setItemListSearchInput] = useState("");

  useEffect(() => {
    let alive = true;

    void (async () => {
      let savedItemLists: ItemListConfig[] | null = null;
      let loadError: unknown = null;

      try {
        savedItemLists = await invoke<ItemListConfig[] | null>("load_item_lists");
      } catch (error) {
        loadError = error;
      }

      if (!alive) {
        return;
      }

      if (savedItemLists !== null) {
        setItemLists(savedItemLists.map(normalizeItemListConfig));
      } else {
        let restoredFromLocalStorage = false;
        try {
          const raw = window.localStorage.getItem(ITEM_LIST_STORAGE_KEY);
          if (raw) {
            const parsed: unknown = JSON.parse(raw);
            if (Array.isArray(parsed)) {
              setItemLists(parsed.map(normalizeItemListConfig));
              restoredFromLocalStorage = true;
            }
          }
        } catch {
          // Ignore malformed fallback data.
        }

        if (loadError !== null && !restoredFromLocalStorage) {
          onError(String(loadError));
        }
      }

      setItemListsReady(true);
    })();

    return () => {
      alive = false;
    };
  }, [onError]);

  useEffect(() => {
    if (!itemListsReady) {
      return;
    }

    try {
      window.localStorage.setItem(ITEM_LIST_STORAGE_KEY, JSON.stringify(itemLists));
    } catch {
      // Ignore local storage failures; Tauri storage remains available.
    }

    void invoke("save_item_lists", { itemLists }).catch((error) => {
      onError(String(error));
    });
  }, [itemLists, itemListsReady, onError]);

  const filteredItemLists = useMemo(() => {
    const normalizedQuery = itemListSearchInput.trim().toLocaleLowerCase();
    if (normalizedQuery === "") {
      return [...itemLists].sort((left, right) => left.name.localeCompare(right.name, "ja"));
    }

    return [...itemLists]
      .filter((itemList) => {
        const itemNames = itemList.items.map((itemName) => itemName.toLocaleLowerCase()).join(" ");
        return itemList.name.toLocaleLowerCase().includes(normalizedQuery)
          || itemList.categoryName.toLocaleLowerCase().includes(normalizedQuery)
          || itemNames.includes(normalizedQuery);
      })
      .sort((left, right) => left.name.localeCompare(right.name, "ja"));
  }, [itemListSearchInput, itemLists]);

  function resetItemListEditor() {
    setEditingItemListId(null);
    setItemListName("");
    setItemCategoryName("");
    setItemListText("");
  }

  function editItemList(itemList: ItemListConfig) {
    setEditingItemListId(itemList.id);
    setItemListName(itemList.name);
    setItemCategoryName(itemList.categoryName);
    setItemListText(itemList.items.join("\n"));
  }

  function saveItemList() {
    const name = itemListName.trim();
    const categoryName = itemCategoryName.trim();
    if (name === "" || categoryName === "") {
      onError("アイテムリスト名とカテゴリ名を入力してください。");
      return;
    }

    const items = parseLinesToUniqueList(itemListText);
    onError("");

    if (editingItemListId) {
      setItemLists((current) =>
        current.map((list) =>
          list.id === editingItemListId ? { ...list, name, categoryName, items } : list,
        ),
      );
      onMessage("アイテムリストを更新しました。");
      resetItemListEditor();
      return;
    }

    setItemLists((current) => [...current, {
      id: crypto.randomUUID(),
      name,
      categoryName,
      items,
    }]);
    onMessage("アイテムリストを作成しました。");
    resetItemListEditor();
  }

  function removeItemList(itemListId: string) {
    setItemLists((current) => current.filter((list) => list.id !== itemListId));
    if (editingItemListId === itemListId) {
      resetItemListEditor();
    }
  }

  return {
    itemLists,
    setItemListName,
    itemListName,
    itemCategoryName,
    setItemCategoryName,
    itemListText,
    setItemListText,
    itemListSearchInput,
    setItemListSearchInput,
    editingItemListId,
    filteredItemLists,
    resetItemListEditor,
    editItemList,
    saveItemList,
    removeItemList,
  };
}