import type { ItemListConfig } from "../domain/itemList";

export type EventSettingEntrant = {
  entrantId: string;
  entrantName: string;
};

export type EventSettingCategorySlot = {
  slotIndex: number;
  list: ItemListConfig;
  minCount: number;
  maxCount: number;
  allowDuplicates: boolean;
};

export type EventSettingCategoryUsage = {
  slotIndex: number;
  categoryName: string;
  listName: string;
  entries: Array<{ itemName: string; count: number; rate: number }>;
};

export type SideDecisionMethod = "upper_1p" | "upper_2p" | "random";

export type EventSettingProps = {
  event: {
    hasSelectedEvent: boolean;
    eventAlias: string;
    tournamentName: string;
    eventName: string;
    busy: boolean;
    canUpdateSnapshot: boolean;
    eventAliasDraft: string;
  };
  rules: {
    sideDecisionMethod: SideDecisionMethod;
    itemLists: ItemListConfig[];
    categorySlotListIds: string[];
    categorySlotMinCounts: number[];
    categorySlotMaxCounts: number[];
    categorySlotAllowDuplicates: boolean[];
    totalItemMinCount: number;
    totalItemMaxCount: number;
  };
  playerMeta: {
    selectedEventEntrants: EventSettingEntrant[];
    selectedEventMetaEntrantCount: number;
    selectedEntrantId: string;
    selectedEntrantName: string;
    configuredCategorySlots: EventSettingCategorySlot[];
    selectedCategoryUsageList: EventSettingCategoryUsage[];
    draftSelectionsBySlot: string[][];
    validationErrors: string[];
    canSavePlayerMeta: boolean;
  };
  actions: {
    onUpdateSnapshot: () => void;
    onEventAliasDraftChange: (value: string) => void;
    onSaveEventAlias: () => void;
    onSideDecisionMethodChange: (method: SideDecisionMethod) => void;
    onApplySideDecisionMethod: () => void;
    onCategoryListChange: (slotIndex: number, listId: string) => void;
    onCategoryMinChange: (slotIndex: number, value: string) => void;
    onCategoryMaxChange: (slotIndex: number, value: string) => void;
    onCategoryAllowDuplicatesChange: (slotIndex: number, allowed: boolean) => void;
    onTotalItemMinChange: (value: string) => void;
    onTotalItemMaxChange: (value: string) => void;
    onSaveEventManagementSetting: () => void;
    onSelectEntrant: (entrantId: string) => void;
    onAddDraftSelection: (slot: EventSettingCategorySlot, itemName: string) => void;
    onRemoveDraftSelection: (slotIndex: number, selectionIndex: number) => void;
    onSavePlayerMeta: () => void;
  };
};

export function EventSetting({ event, rules, playerMeta, actions }: EventSettingProps) {
  const {
    hasSelectedEvent,
    eventAlias,
    tournamentName,
    eventName,
    busy,
    canUpdateSnapshot,
    eventAliasDraft,
  } = event;
  const {
    sideDecisionMethod,
    itemLists,
    categorySlotListIds,
    categorySlotMinCounts,
    categorySlotMaxCounts,
    categorySlotAllowDuplicates,
    totalItemMinCount,
    totalItemMaxCount,
  } = rules;
  const {
    selectedEventEntrants,
    selectedEventMetaEntrantCount,
    selectedEntrantId,
    selectedEntrantName,
    configuredCategorySlots,
    selectedCategoryUsageList,
    draftSelectionsBySlot,
    validationErrors,
    canSavePlayerMeta,
  } = playerMeta;
  const {
    onUpdateSnapshot,
    onEventAliasDraftChange,
    onSaveEventAlias,
    onSideDecisionMethodChange,
    onApplySideDecisionMethod,
    onCategoryListChange,
    onCategoryMinChange,
    onCategoryMaxChange,
    onCategoryAllowDuplicatesChange,
    onTotalItemMinChange,
    onTotalItemMaxChange,
    onSaveEventManagementSetting,
    onSelectEntrant,
    onAddDraftSelection,
    onRemoveDraftSelection,
    onSavePlayerMeta,
  } = actions;
  return (
    <section className="panel">
      {!hasSelectedEvent ? (
        <p className="meta">ホームの大会一覧からイベントを選択してください。</p>
      ) : (
        <>
          <div className="stats-grid">
            <article className="stat-card">
              <p className="meta">エイリアス名</p>
              <h3>{eventAlias.trim() ? eventAlias : "未設定"}</h3>
            </article>
            <article className="stat-card">
              <p className="meta">tournament名 (start.gg)</p>
              <h3>{tournamentName || "-"}</h3>
            </article>
            <article className="stat-card">
              <p className="meta">event名 (start.gg)</p>
              <h3>{eventName}</h3>
            </article>
          </div>

          <div className="panel-toolbar compact">
            <button type="button" className="ghost" disabled={busy || !canUpdateSnapshot} onClick={onUpdateSnapshot}>
              スナップショットを更新
            </button>
          </div>

          <div className="tournament-settings" style={{ marginTop: "0.9rem" }}>
            <div className="setting-row">
              <p className="setting-row-title">エイリアス名</p>
              <div className="setting-row-fields single" style={{ gridTemplateColumns: "minmax(220px, 420px) auto" }}>
                <input
                  type="text"
                  value={eventAliasDraft}
                  onChange={(e) => onEventAliasDraftChange(e.currentTarget.value)}
                  placeholder="大会一覧に表示する表示名"
                  autoComplete="off"
                />
                <button type="button" className="ghost" disabled={busy} onClick={onSaveEventAlias}>
                  エイリアスを変更
                </button>
              </div>
            </div>

            <div className="setting-row">
              <p className="setting-row-title">1P/2P決定方法</p>
              <div className="setting-row-fields single" style={{ gridTemplateColumns: "minmax(220px, 340px) auto" }}>
                <select
                  id="side-method"
                  value={sideDecisionMethod}
                  onChange={(e) => onSideDecisionMethodChange(e.currentTarget.value as SideDecisionMethod)}
                >
                  <option value="upper_1p">上側を1P</option>
                  <option value="upper_2p">上側を2P</option>
                  <option value="random">ランダム</option>
                </select>
                <button type="button" className="ghost" disabled={busy} onClick={onApplySideDecisionMethod}>
                  全未確定試合に適用
                </button>
              </div>
            </div>

            {Array.from({ length: 3 }, (_, slotIndex) => {
              const listId = categorySlotListIds[slotIndex] ?? "";
              const minCount = categorySlotMinCounts[slotIndex] ?? 0;
              const maxCount = categorySlotMaxCounts[slotIndex] ?? 0;
              const allowDuplicates = categorySlotAllowDuplicates[slotIndex] ?? false;
              const disabledSlot = listId.trim() === "";

              return (
                <div className="setting-row" key={`category-setting-${slotIndex}`}>
                  <p className="setting-row-title">カテゴリ{slotIndex + 1}</p>
                  <div className="setting-row-fields">
                    <label htmlFor={`item-list-slot-${slotIndex}`}>使用リスト</label>
                    <select
                      id={`item-list-slot-${slotIndex}`}
                      value={listId}
                      onChange={(e) => onCategoryListChange(slotIndex, e.currentTarget.value)}
                    >
                      <option value="">未選択</option>
                      {itemLists
                        .slice()
                        .sort((a, b) => a.name.localeCompare(b.name, "ja"))
                        .map((itemList) => (
                          <option key={`slot-${slotIndex}-${itemList.id}`} value={itemList.id}>
                            {itemList.name} / {itemList.categoryName} ({itemList.items.length})
                          </option>
                        ))}
                    </select>

                    <label htmlFor={`item-list-slot-min-${slotIndex}`}>カテゴリ下限</label>
                    <input
                      id={`item-list-slot-min-${slotIndex}`}
                      type="number"
                      min={0}
                      step={1}
                      value={minCount}
                      disabled={disabledSlot}
                      onChange={(e) => onCategoryMinChange(slotIndex, e.currentTarget.value)}
                    />

                    <label htmlFor={`item-list-slot-max-${slotIndex}`}>カテゴリ上限</label>
                    <input
                      id={`item-list-slot-max-${slotIndex}`}
                      type="number"
                      min={0}
                      step={1}
                      value={maxCount}
                      disabled={disabledSlot}
                      onChange={(e) => onCategoryMaxChange(slotIndex, e.currentTarget.value)}
                    />

                    <label htmlFor={`item-list-slot-allow-dup-${slotIndex}`}>重複可否</label>
                    <label className="setting-checkbox" htmlFor={`item-list-slot-allow-dup-${slotIndex}`}>
                      <input
                        id={`item-list-slot-allow-dup-${slotIndex}`}
                        type="checkbox"
                        checked={allowDuplicates}
                        disabled={disabledSlot}
                        onChange={(e) => onCategoryAllowDuplicatesChange(slotIndex, e.currentTarget.checked)}
                      />
                      許可
                    </label>
                  </div>
                </div>
              );
            })}

            <div className="setting-row">
              <p className="setting-row-title">アイテム全体選択</p>
              <div className="setting-row-fields total">
                <label htmlFor="total-item-min">下限</label>
                <input
                  id="total-item-min"
                  type="number"
                  min={0}
                  step={1}
                  value={totalItemMinCount}
                  onChange={(e) => onTotalItemMinChange(e.currentTarget.value)}
                />

                <label htmlFor="total-item-max">上限</label>
                <input
                  id="total-item-max"
                  type="number"
                  min={0}
                  step={1}
                  value={totalItemMaxCount}
                  onChange={(e) => onTotalItemMaxChange(e.currentTarget.value)}
                />
              </div>
            </div>

            <div className="setting-row save">
              <button type="button" className="ghost" onClick={onSaveEventManagementSetting}>
                大会設定を保存
              </button>
            </div>
          </div>
          <p className="meta">カテゴリは最大3つまで設定できます。カテゴリ重複は不可で、カテゴリごとの件数条件と全体件数条件を設定します。</p>

          {selectedEventEntrants.length === 0 ? (
            <p className="meta" style={{ marginTop: "0.75rem" }}>参加者が見つかりません。</p>
          ) : (
            <div className="tournament-manager-grid" style={{ marginTop: "0.8rem" }}>
              <div className="tournament-manager-left-stack">
                <section className="panel" style={{ padding: "0.75rem" }}>
                  <h3>プレイヤー一覧 (seed順)</h3>
                  <p className="meta">参加人数: {selectedEventEntrants.length}</p>
                  <p className="meta">メタ情報の保存数: {selectedEventMetaEntrantCount}</p>
                  <div className={`event-list player-list-scroll ${selectedEventEntrants.length > 8 ? "enabled" : ""}`}>
                    {selectedEventEntrants.map((entrant) => {
                      const isSelected = selectedEntrantId === entrant.entrantId;
                      return (
                        <article
                          key={entrant.entrantId}
                          className={`event-list-item ${isSelected ? "selected" : ""}`}
                          role="button"
                          tabIndex={0}
                          onClick={() => onSelectEntrant(entrant.entrantId)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              onSelectEntrant(entrant.entrantId);
                            }
                          }}
                        >
                          <h4>{entrant.entrantName}</h4>
                        </article>
                      );
                    })}
                  </div>
                </section>

                <section className="panel" style={{ padding: "0.75rem" }}>
                  <h3>使用率一覧</h3>
                  <div className="usage-board">
                    {configuredCategorySlots.length === 0 ? (
                      <p className="meta">カテゴリ設定後に表示されます。</p>
                    ) : (
                      <div className="usage-category-list">
                        {selectedCategoryUsageList.map((categoryUsage) => (
                          <article className="usage-category" key={`usage-${categoryUsage.slotIndex}`}>
                            <p className="usage-category-title">
                              {categoryUsage.categoryName} ({categoryUsage.listName})
                            </p>

                            {categoryUsage.entries.length === 0 ? (
                              <p className="meta">このカテゴリの選択データはまだありません。</p>
                            ) : (
                              <ul className="usage-item-list">
                                {categoryUsage.entries.map((entry) => {
                                  const rate = Math.max(0, Math.min(100, entry.rate));
                                  const rateText = `${rate.toFixed(1)}%`;
                                  const palette = categoryUsage.slotIndex % 3;
                                  const fillColor = palette === 0 ? "#2563eb" : palette === 1 ? "#16a34a" : "#d97706";
                                  const complementColor = palette === 0 ? "#f59e0b" : palette === 1 ? "#a855f7" : "#2563eb";

                                  return (
                                    <li className="usage-item-row" key={`usage-item-${categoryUsage.slotIndex}-${entry.itemName}`}>
                                      <span className="usage-item-name">{entry.itemName}</span>
                                      <div className="usage-bar-track">
                                        <div className="usage-bar-fill" style={{ width: `${rate}%`, backgroundColor: fillColor }}>
                                          {rate >= 50 && (
                                            <span className="usage-rate-text in-bar" style={{ color: complementColor }}>
                                              {rateText}
                                            </span>
                                          )}
                                        </div>
                                        {rate < 50 && (
                                          <span className="usage-rate-text out-bar" style={{ left: `calc(${rate}% + 0.35rem)`, color: fillColor }}>
                                            {rateText}
                                          </span>
                                        )}
                                      </div>
                                    </li>
                                  );
                                })}
                              </ul>
                            )}
                          </article>
                        ))}
                      </div>
                    )}
                  </div>
                </section>
              </div>

              <section className="panel" style={{ padding: "0.75rem" }}>
                <h3>選択プレイヤー設定</h3>
                {selectedEntrantId === "" ? (
                  <p className="meta">プレイヤーを選択してください。</p>
                ) : (
                  <>
                    <p className="meta">{selectedEntrantName}</p>
                    {configuredCategorySlots.length === 0 ? (
                      <p className="meta">先に上部でカテゴリ(最大3つ)を選択してください。</p>
                    ) : (
                      <div className="entrant-meta-editor">
                        {configuredCategorySlots.map((slot) => {
                          const currentSelections = draftSelectionsBySlot[slot.slotIndex] ?? [];
                          const canAddMore = currentSelections.length < slot.maxCount;
                          const selectableItems = slot.allowDuplicates
                            ? slot.list.items
                            : slot.list.items.filter((itemName) => !currentSelections.includes(itemName));

                          return (
                            <div key={`${selectedEntrantId}-${slot.list.id}-${slot.slotIndex}`} style={{ border: "1px solid var(--line)", borderRadius: "10px", padding: "0.55rem" }}>
                              <p className="meta" style={{ marginBottom: "0.35rem" }}>
                                {slot.list.categoryName} ({slot.list.name}) / {currentSelections.length} 件
                                {` / 下限 ${slot.minCount} / 上限 ${slot.maxCount} / 重複 ${slot.allowDuplicates ? "可" : "不可"}`}
                              </p>

                              <select
                                value=""
                                disabled={!canAddMore || selectableItems.length === 0}
                                onChange={(e) => onAddDraftSelection(slot, e.currentTarget.value)}
                              >
                                <option value="">アイテムを追加</option>
                                {selectableItems.map((itemName) => (
                                  <option key={`${slot.list.id}-${slot.slotIndex}-${itemName}`} value={itemName}>
                                    {itemName}
                                  </option>
                                ))}
                              </select>

                              {currentSelections.length > 0 && (
                                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem", marginTop: "0.45rem" }}>
                                  {currentSelections.map((itemName, index) => (
                                    <button
                                      key={`${slot.list.id}-${slot.slotIndex}-${itemName}-${index}`}
                                      type="button"
                                      className="ghost tiny"
                                      onClick={() => onRemoveDraftSelection(slot.slotIndex, index)}
                                    >
                                      {itemName} ×
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {validationErrors.length > 0 && (
                      <p className="meta error-text" style={{ marginTop: "0.45rem" }}>
                        {validationErrors.join(" ")}
                      </p>
                    )}

                    <div className="entrant-meta-actions" style={{ marginTop: "0.6rem" }}>
                      <button type="button" disabled={!canSavePlayerMeta} onClick={onSavePlayerMeta}>
                        このプレイヤーを保存
                      </button>
                    </div>
                  </>
                )}
              </section>
            </div>
          )}
        </>
      )}
    </section>
  );
}