import type { ItemListConfig } from "./itemList";

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
}: ItemListEditorProps) {
  return (
    <>
      <section className="panel">
        <h2>アイテムリストエディタ</h2>

        <div className="form">
          <input
            value={itemListName}
            onChange={(e) => onItemListNameChange(e.currentTarget.value)}
            placeholder="リスト名 (例: S4公式)"
          />
          <input
            value={itemCategoryName}
            onChange={(e) => onItemCategoryNameChange(e.currentTarget.value)}
            placeholder="カテゴリ名 (例:キャラ)"
          />
        </div>
        <div style={{ marginTop: "0.6rem" }}>
          <textarea
            value={itemListText}
            onChange={(e) => onItemListTextChange(e.currentTarget.value)}
            rows={12}
            placeholder="1行に1アイテム名"
            style={{ width: "100%", borderRadius: "10px", border: "1px solid var(--line)", padding: "0.62rem 0.75rem", fontFamily: "inherit", fontSize: "0.92rem" }}
          />
        </div>

        <div className="panel-toolbar compact">
          <p className="meta">重複・空行は保存時に自動整理されます。</p>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button type="button" onClick={onSave}>{isEditing ? "更新" : "作成"}</button>
            <button type="button" className="ghost" onClick={onReset}>クリア</button>
          </div>
        </div>
      </section>

      <section className="panel">
        <h2>登録済みリスト ({filteredItemLists.length})</h2>

        <div className="form" style={{ marginBottom: "0.75rem" }}>
          <input
            type="search"
            value={searchInput}
            onChange={(e) => onSearchInputChange(e.currentTarget.value)}
            placeholder="リスト名 / カテゴリ名 / アイテム名で検索"
            autoComplete="off"
          />
        </div>

        {filteredItemLists.length === 0 ? (
          <p className="meta">一致するリストがありません。</p>
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
                      <p className="meta">{itemList.categoryName} / {itemList.items.length} 件</p>
                    </div>
                    <div style={{ display: "flex", gap: "0.45rem" }}>
                      <button type="button" className="ghost tiny" onClick={() => onEditItemList(itemList)}>
                        編集
                      </button>
                      <button type="button" className="ghost tiny" onClick={() => onDeleteItemList(itemList)}>
                        削除
                      </button>
                    </div>
                  </div>

                  {itemList.items.length > 0 ? (
                    <div className="item-list-preview" aria-label={`${itemList.name} のアイテムプレビュー`}>
                      {previewItems.map((itemName, index) => (
                        <span className="item-list-preview-item" key={`${itemList.id}-${itemName}-${index}`}>
                          {itemName}
                        </span>
                      ))}
                      {remainingCount > 0 && (
                        <span className="item-list-preview-more">他 {remainingCount} 件</span>
                      )}
                    </div>
                  ) : (
                    <p className="meta">アイテムがまだありません。</p>
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