import { t } from "../i18n";
import { useRef } from "react";
import type { LocalSnapshotEventListItem } from "../domain/tournamentWorkspaceRepository";
import { localSnapshotAliasLabel, localSnapshotItemKey } from "../domain/snapshotDisplay";

export type { LocalSnapshotEventListItem } from "../domain/tournamentWorkspaceRepository";
export { localSnapshotAliasLabel, localSnapshotItemKey } from "../domain/snapshotDisplay";

type EventSelectorProps = {
  items: LocalSnapshotEventListItem[];
  filteredItems: LocalSnapshotEventListItem[];
  loading: boolean;
  searchInput: string;
  onSearchInputChange: (value: string) => void;
  selectedItem: LocalSnapshotEventListItem | null;
  onSelectedKeyChange: (key: string) => void;
  deletingKey: string;
  busy: boolean;
  onRefresh: () => void;
  onSelectEvent: (item: LocalSnapshotEventListItem) => void;
  onDeleteEvent: (item: LocalSnapshotEventListItem) => void;
  onImportShareFile: (file: File) => void;
  onExportShareFile: (item: LocalSnapshotEventListItem) => void;
};

export function EventSelector({
  items,
  filteredItems,
  loading,
  searchInput,
  onSearchInputChange,
  selectedItem,
  onSelectedKeyChange,
  deletingKey,
  busy,
  onRefresh,
  onSelectEvent,
  onDeleteEvent,
  onImportShareFile,
  onExportShareFile,
}: EventSelectorProps) {
  const shareFileInputRef = useRef<HTMLInputElement>(null);
  const selectedItemKey = selectedItem ? localSnapshotItemKey(selectedItem) : "";
  const refreshButton = (
    <button type="button" className="ghost" disabled={loading} onClick={onRefresh}>
      {loading ? t("更新中...") : t("一覧を更新")}
    </button>
  );

  return (
    <section className="panel">
      <h2>{t("5.スナップショットの選択")}</h2>
      <div className="panel-toolbar compact">
        <button
          type="button"
          className="ghost"
          disabled={busy}
          onClick={() => shareFileInputRef.current?.click()}
        >{t("スナップショットをインポート")}</button>
        <input
          ref={shareFileInputRef}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            if (file) {
              onImportShareFile(file);
            }
            event.currentTarget.value = "";
          }}
        />
      </div>
      {(loading || items.length === 0) && <div className="panel-toolbar compact">{refreshButton}</div>}

      {loading ? (
        <p className="meta">{t("ローカルevent一覧を読み込んでいます...")}</p>
      ) : items.length === 0 ? (
        <p className="meta">{t("保存済みイベントがありません。大会管理タブから start.gg 同期を実行してください。")}</p>
      ) : (
        <>
          <div className="home-selector-grid">
            <label htmlFor="home-snapshot-search-input" style={{ display: "grid", gap: "0.3rem" }}>
              <span className="meta">{t("スナップショット検索")}</span>
              <input
                id="home-snapshot-search-input"
                type="search"
                value={searchInput}
                onChange={(e) => onSearchInputChange(e.currentTarget.value)}
                placeholder={t("エイリアス名 / tournament名 / event名 で検索")}
                autoComplete="off"
              />
            </label>
            <label htmlFor="home-snapshot-select" style={{ display: "grid", gap: "0.3rem" }}>
              <span className="meta">{t("スナップショット選択")}</span>
              <select
                id="home-snapshot-select"
                value={selectedItemKey}
                onChange={(e) => onSelectedKeyChange(e.currentTarget.value)}
              >
                <option value="" disabled>
                  {filteredItems.length === 0 ? t("一致するスナップショットがありません") : t("スナップショットを選択")}
                </option>
                {filteredItems.map((item) => (
                  <option key={localSnapshotItemKey(item)} value={localSnapshotItemKey(item)}>
                    {localSnapshotAliasLabel(item)}
                  </option>
                ))}
              </select>
            </label>
            {refreshButton}
          </div>

          {selectedItem ? (() => {
            const itemKey = localSnapshotItemKey(selectedItem);
            const isDeleting = deletingKey === itemKey;
            const selectedPhaseName = typeof selectedItem.lastSelectedPhaseName === "string"
              ? selectedItem.lastSelectedPhaseName.trim()
              : "";
            const selectedPhaseGroupName = typeof selectedItem.lastSelectedPhaseGroupName === "string"
              ? selectedItem.lastSelectedPhaseGroupName.trim()
              : "";
            const selectedPhasePoolLabel = selectedPhaseName !== "" && selectedPhaseGroupName !== ""
              ? `${selectedPhaseName === "Phase 未設定" ? t("Phase 未設定") : selectedPhaseName} / Pool ${selectedPhaseGroupName === "Pool 未設定" ? t("Pool 未設定") : selectedPhaseGroupName}`
              : "-";

            return (
              <>
                <article className="event-list-item home-detail-card">
                  <div className="event-list-head">
                    <h3>{localSnapshotAliasLabel(selectedItem)}</h3>
                    <span className="meta">{new Date(selectedItem.updatedAt).toLocaleString()}</span>
                  </div>
                  <p className="meta">{t("tournament名: {value1}, event名: {value2}, 前回選択Phase/Pool: {value3}", { value1: selectedItem.tournamentName, value2: selectedItem.eventName, value3: selectedPhasePoolLabel })}</p>
                </article>
                <div className="home-detail-actions">
                  <button type="button" className="ghost" disabled={busy || isDeleting} onClick={() => onSelectEvent(selectedItem)}>{t("スナップショットを選択")}</button>
                  <button type="button" className="ghost" disabled={busy || isDeleting} onClick={() => onDeleteEvent(selectedItem)}>
                    {isDeleting ? t("削除中...") : t("削除")}
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    disabled={busy || isDeleting}
                    onClick={() => onExportShareFile(selectedItem)}
                  >{t("エクスポート")}</button>
                </div>
              </>
            );
          })() : (
            <p className="meta" style={{ marginTop: "0.7rem" }}>{t("一致する大会がありません。")}</p>
          )}
        </>
      )}
    </section>
  );
}