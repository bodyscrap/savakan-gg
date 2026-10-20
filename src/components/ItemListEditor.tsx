import { t } from "../i18n";
import { useRef } from "react";
import type { ItemListConfig } from "../domain/itemList";

type ItemListEditorProps = {
  itemListName: string;
  onItemListNameChange: (value: string) => void;
  itemCategoryName: string;
  onItemCategoryNameChange: (value: string) => void;
  itemListText: string;
  onItemListTextChange: (value: string) => void;
  isEditing: boolean;
  onSave: () => void;
  onReset: () => void;
  searchInput: string;
  onSearchInputChange: (value: string) => void;
  filteredItemLists: ItemListConfig[];
  onEditItemList: (itemList: ItemListConfig) => void;
  onDeleteItemList: (itemList: ItemListConfig) => void;
  onImportItemList: (file: File) => void;
  onExportItemList: (itemList: ItemListConfig) => void;
  busy: boolean;
};

export function ItemListEditor({
  itemListName,
  onItemListNameChange,
  itemCategoryName,
  onItemCategoryNameChange,
  itemListText,
  onItemListTextChange,
  isEditing,
  onSave,
  onReset,
  searchInput,
  onSearchInputChange,
  filteredItemLists,
  onEditItemList,
  onDeleteItemList,
  onImportItemList,
  onExportItemList,
  busy,
}: ItemListEditorProps) {
  const importFileInputRef = useRef<HTMLInputElement>(null);

  return (
    <>
      <section className="panel">
        <h2>{t("アイテムリストエディタ")}</h2>

        <div className="form">
          <input
            value={itemListName}
            onChange={(e) => onItemListNameChange(e.currentTarget.value)}
            placeholder={t("リスト名 (例: S4公式)")}
          />
          <input
            value={itemCategoryName}
            onChange={(e) => onItemCategoryNameChange(e.currentTarget.value)}
            placeholder={t("カテゴリ名 (例:キャラ)")}
          />
        </div>
        <div style={{ marginTop: "0.6rem" }}>
          <textarea
            value={itemListText}
            onChange={(e) => onItemListTextChange(e.currentTarget.value)}
            rows={12}
            placeholder={t("1行に1アイテム名")}
            style={{ width: "100%", borderRadius: "10px", border: "1px solid var(--line)", padding: "0.62rem 0.75rem", fontFamily: "inherit", fontSize: "0.92rem" }}
          />
        </div>

        <div className="panel-toolbar compact">
          <p className="meta">{t("重複・空行は保存時に自動整理されます。")}</p>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button type="button" onClick={onSave}>{isEditing ? t("更新") : t("作成")}</button>
            <button type="button" className="ghost" onClick={onReset}>{t("クリア")}</button>
          </div>
        </div>
      </section>

      <section className="panel">
        <h2>{t("登録済みリスト ({value1})", { value1: filteredItemLists.length })}</h2>
        <div className="panel-toolbar compact">
          <button type="button" className="ghost" disabled={busy} onClick={() => importFileInputRef.current?.click()}>{t("インポート")}</button>
          <input
            ref={importFileInputRef}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              if (file) {
                onImportItemList(file);
              }
              event.currentTarget.value = "";
            }}
          />
        </div>

        <div className="form" style={{ marginBottom: "0.75rem" }}>
          <input
            type="search"
            value={searchInput}
            onChange={(e) => onSearchInputChange(e.currentTarget.value)}
            placeholder={t("リスト名 / カテゴリ名 / アイテム名で検索")}
            autoComplete="off"
          />
        </div>

        {filteredItemLists.length === 0 ? (
          <p className="meta">{t("一致するリストがありません。")}</p>
        ) : (
          <div className="event-list item-list-compact-list">
            {filteredItemLists.map((itemList) => {
              const previewItems = itemList.items.slice(0, 8);
              const remainingCount = Math.max(0, itemList.items.length - previewItems.length);

              return (
                <article className="event-list-item item-list-compact-card" key={itemList.id}>
                  <div className="event-list-head">
                    <div>
                      <h3>{itemList.name}</h3>
                      <p className="meta">{t("{value1} / {value2} 件", { value1: itemList.categoryName, value2: itemList.items.length })}</p>
                    </div>
                    <div style={{ display: "flex", gap: "0.45rem" }}>
                      <button type="button" className="ghost tiny" onClick={() => onEditItemList(itemList)}>{t("編集")}</button>
                      <button type="button" className="ghost tiny" disabled={busy} onClick={() => onExportItemList(itemList)}>{t("エクスポート")}</button>
                      <button type="button" className="ghost tiny" onClick={() => onDeleteItemList(itemList)}>{t("削除")}</button>
                    </div>
                  </div>

                  {itemList.items.length > 0 ? (
                    <div className="item-list-preview" aria-label={t("{value1} のアイテムプレビュー", { value1: itemList.name })}>
                      {previewItems.map((itemName, index) => (
                        <span className="item-list-preview-item" key={`${itemList.id}-${itemName}-${index}`}>
                          {itemName}
                        </span>
                      ))}
                      {remainingCount > 0 && (
                        <span className="item-list-preview-more">{t("他 {value1} 件", { value1: remainingCount })}</span>
                      )}
                    </div>
                  ) : (
                    <p className="meta">{t("アイテムがまだありません。")}</p>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>
    </>
  );
}