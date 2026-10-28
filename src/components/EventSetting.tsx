import { t } from "../i18n";
import type { ItemListConfig } from "../domain/itemList";
import { YoutubeChapters } from "./YoutubeChapters";
import { CategorySettingsFields, PlayerItemSelectionFields } from "./ItemSelectionFields";

export type EventSettingEntrant = {
  entrantId: string;
  entrantName: string;
  aliasName: string;
  skill?: number | null;
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
    slug: string;
    eventId: string;
    hasSelectedEvent: boolean;
    tournamentName: string;
    eventName: string;
    busy: boolean;
    canUpdateSnapshot: boolean;
    eventAliasDraft: string;
    initialSeedPhaseName: string;
    initialSeedEntrantCount: number;
    canShuffleInitialSeeds: boolean;
    canRestoreInitialSeeds: boolean;
    isLocalEvent?: boolean;
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
    useAliasName: boolean;
  };
  playerMeta: {
    selectedEventEntrants: EventSettingEntrant[];
    selectedEventMetaEntrantCount: number;
    selectedEntrantId: string;
    selectedEntrantName: string;
    selectedEntrantAliasName: string;
    selectedEntrantSkillTier: string;
    skillTierErrors: string[];
    canRestoreSkillTier: boolean;
    configuredCategorySlots: EventSettingCategorySlot[];
    selectedCategoryUsageList: EventSettingCategoryUsage[];
    draftSelectionsBySlot: string[][];
    validationErrors: string[];
    canSavePlayerMeta: boolean;
  };
  actions: {
    onUpdateSnapshot: () => void;
    onShuffleInitialSeeds: () => void;
    onRestoreInitialSeeds: () => void;
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
    onUseAliasNameChange: (enabled: boolean) => void;
    onRefreshPlayerDisplay: () => void;
    onSaveEventManagementSetting: () => void;
    onSelectEntrant: (entrantId: string) => void;
    onAddDraftSelection: (slot: EventSettingCategorySlot, itemName: string) => void;
    onRemoveDraftSelection: (slotIndex: number, selectionIndex: number) => void;
    onSavePlayerAliasName: () => void;
    onSavePlayerSkillTier: () => void;
    onRestorePlayerSkillTier: () => void;
    onSkillTierChange: (value: string) => void;
    onSavePlayerSelections: () => void;
    onEntrantAliasNameChange: (value: string) => void;
  };
};

export function EventSetting({ event, rules, playerMeta, actions }: EventSettingProps) {
  const {
    hasSelectedEvent,
    tournamentName,
    eventName,
    busy,
    canUpdateSnapshot,
    eventAliasDraft,
    initialSeedPhaseName,
    initialSeedEntrantCount,
    canShuffleInitialSeeds,
    canRestoreInitialSeeds,
    isLocalEvent,
  } = event;
  const {
    sideDecisionMethod,
    useAliasName,
  } = rules;
  const {
    selectedEventEntrants,
    selectedEventMetaEntrantCount,
    selectedEntrantId,
    selectedEntrantName,
    selectedEntrantAliasName,
    selectedEntrantSkillTier,
    skillTierErrors,
    configuredCategorySlots,
    selectedCategoryUsageList,
    draftSelectionsBySlot,
    validationErrors,
    canSavePlayerMeta,
  } = playerMeta;
  const {
    onUpdateSnapshot,
    onShuffleInitialSeeds,
    onRestoreInitialSeeds,
    onEventAliasDraftChange,
    onSaveEventAlias,
    onSideDecisionMethodChange,
    onApplySideDecisionMethod,
    onUseAliasNameChange,
    onRefreshPlayerDisplay,
    onSaveEventManagementSetting,
    onSelectEntrant,
    onSavePlayerAliasName,
    onSavePlayerSkillTier,
    onSavePlayerSelections,
    onEntrantAliasNameChange,
  } = actions;
  return (
    <section className="panel">
      {!hasSelectedEvent ? (
        <p className="meta">{t("ホームの大会一覧からイベントを選択してください。")}</p>
      ) : (
        <>
          <div className="stats-grid">
            <article className="stat-card">
              <label
                className="meta"
                style={{ display: "grid", gap: "0.3rem" }}
              >{t("エイリアス名")}<input
                  id="event-alias-draft"
                  type="text"
                  value={eventAliasDraft}
                  onChange={(e) => onEventAliasDraftChange(e.currentTarget.value)}
                  placeholder={t("大会一覧に表示する表示名")}
                  autoComplete="off"
                />
              </label>
            </article>
            <article className="stat-card">
              <p className="meta">{t("tournament名 (start.gg)")}</p>
              <h3>{tournamentName || "-"}</h3>
            </article>
            <article className="stat-card">
              <p className="meta">{t("event名 (start.gg)")}</p>
              <h3>{eventName}</h3>
            </article>
          </div>

          <div className="panel-toolbar compact" style={{ justifyContent: "flex-start" }}>
            <button type="button" className="ghost" disabled={busy} onClick={onSaveEventAlias}>{t("エイリアス名を変更")}</button>
            <button type="button" className="ghost" disabled={busy || !canUpdateSnapshot} onClick={onUpdateSnapshot}>{t("スナップショットを更新")}</button>
          </div>

          <div className="tournament-settings" style={{ marginTop: "0.9rem" }}>
            <div className="setting-row">
              <p className="setting-row-title">{t("1P/2P決定方法")}</p>
              <div className="setting-row-fields single" style={{ gridTemplateColumns: "minmax(220px, 340px) auto" }}>
                <select
                  id="side-method"
                  value={sideDecisionMethod}
                  onChange={(e) => onSideDecisionMethodChange(e.currentTarget.value as SideDecisionMethod)}
                >
                  <option value="upper_1p">{t("上側を1P")}</option>
                  <option value="upper_2p">{t("上側を2P")}</option>
                  <option value="random">{t("ランダム")}</option>
                </select>
                <button type="button" className="ghost" disabled={busy} onClick={onApplySideDecisionMethod}>{t("全未確定試合に適用")}</button>
              </div>
            </div>

            <details className="item-category-settings">
            <summary><h3>{t("アイテム選択カテゴリの設定")}</h3></summary>
            <div className="tournament-settings">
            <CategorySettingsFields rules={rules} actions={actions} />

            <div className="setting-row">
              <p className="setting-row-title">{t("プレイヤー表示")}</p>
              <div className="setting-row-fields player-display">
                <label className="setting-checkbox" htmlFor="use-player-alias-name">
                  <input
                    id="use-player-alias-name"
                    type="checkbox"
                    checked={useAliasName}
                    onChange={(e) => onUseAliasNameChange(e.currentTarget.checked)}
                  />{t("エイリアス名を使う")}</label>
                <button type="button" className="ghost" disabled={busy} onClick={onRefreshPlayerDisplay}>{t("プレイヤー表示を更新")}</button>
              </div>
            </div>

            <div className="setting-row save">
              <button type="button" className="ghost" onClick={onSaveEventManagementSetting}>{t("設定の適用&保存")}</button>
            </div>
            </div>
          <p className="meta">{t("カテゴリは最大3つまで設定できます。カテゴリ重複は不可で、カテゴリごとの件数条件と全体件数条件を設定します。")}</p>
            </details>
          </div>

          <div className="setting-row" style={{ marginTop: "0.9rem" }}>
            <p className="setting-row-title">{t("初期PhaseのプレイヤーSeedシャッフル")}</p>
            <div className="setting-row-fields single" style={{ gridTemplateColumns: "minmax(220px, 1fr) auto auto" }}>
              <p className="meta" style={{ gridColumn: "1 / -1" }}>{t("登録したSkill Tier順に並べ、同Tier内はランダムにSeed配置します。")}</p>
              <p className="meta">{isLocalEvent
                ? t("対象: {value1} / {value2}人。 試合開始前のみ実行できます。不戦勝は開始済みに含みません。", { value1: initialSeedPhaseName || "-", value2: initialSeedEntrantCount })
                : t("対象: {value1} / {value2}人。 試合開始前のみ実行でき、結果報告時にstart.ggへSeedを反映します。", { value1: initialSeedPhaseName || "-", value2: initialSeedEntrantCount })}</p>
              <button
                type="button"
                className="ghost"
                disabled={busy || !canShuffleInitialSeeds}
                onClick={onShuffleInitialSeeds}
              >{t("Seedをシャッフル")}</button>
              <button
                type="button"
                className="ghost"
                disabled={busy || !canRestoreInitialSeeds}
                onClick={onRestoreInitialSeeds}
              >{t("スナップショット時に戻す")}</button>
            </div>
          </div>

          {selectedEventEntrants.length === 0 ? (
            <p className="meta" style={{ marginTop: "0.75rem" }}>{t("参加者が見つかりません。")}</p>
          ) : (
            <div className="tournament-manager-grid" style={{ marginTop: "0.8rem" }}>
              <div className="tournament-manager-left-stack">
                <section className="panel" style={{ padding: "0.75rem" }}>
                  <h3>{t("参加者一覧({count} 人)", { count: selectedEventEntrants.length })}</h3>
                  <p className="meta">{t("メタ情報の保存数: {value1}", { value1: selectedEventMetaEntrantCount })}</p>
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
                          {entrant.aliasName.trim() !== "" && <p className="meta">{entrant.aliasName}</p>}
                          {entrant.skill != null && <p className="meta">{t("Skill Tier")}: {entrant.skill}</p>}
                        </article>
                      );
                    })}
                  </div>
                </section>

                <section className="panel" style={{ padding: "0.75rem" }}>
                  <h3>{t("使用率一覧")}</h3>
                  <div className="usage-board">
                    {configuredCategorySlots.length === 0 ? (
                      <p className="meta">{t("カテゴリ設定後に表示されます。")}</p>
                    ) : (
                      <div className="usage-category-list">
                        {selectedCategoryUsageList.map((categoryUsage) => (
                          <article className="usage-category" key={`usage-${categoryUsage.slotIndex}`}>
                            <p className="usage-category-title">
                              {categoryUsage.categoryName} ({categoryUsage.listName})
                            </p>

                            {categoryUsage.entries.length === 0 ? (
                              <p className="meta">{t("このカテゴリの選択データはまだありません。")}</p>
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
                <h3>{t("選択プレイヤー設定")}</h3>
                {selectedEntrantId === "" ? (
                  <p className="meta">{t("プレイヤーを選択してください。")}</p>
                ) : (
                  <>
                    <p className="meta">{selectedEntrantName}</p>
                    <div className="entrant-meta-editor">
                      <div className="entrant-meta-field-row">
                        <label className="meta">{t("エイリアス名")}<input
                            type="text"
                            value={selectedEntrantAliasName}
                            onChange={(e) => onEntrantAliasNameChange(e.currentTarget.value)}
                            placeholder={t("プレイヤーの表示名")}
                            autoComplete="off"
                          />
                        </label>
                        <button type="button" disabled={!canSavePlayerMeta} onClick={onSavePlayerAliasName}>
                          {t("エイリアス名を保存")}
                        </button>
                      </div>
                      <div className="entrant-meta-field-row">
                        <label className="meta">{t("Skill Tier")}
                          <input
                            type="number"
                            min="0"
                            step="1"
                            value={selectedEntrantSkillTier}
                            onChange={(e) => actions.onSkillTierChange(e.currentTarget.value)}
                            placeholder={t("未設定")}
                          />
                        </label>
                        <button type="button" disabled={!canSavePlayerMeta || skillTierErrors.length > 0} onClick={onSavePlayerSkillTier}>
                          {t("Skill Tierを保存")}
                        </button>
                      </div>
                      {playerMeta.canRestoreSkillTier && (
                        <button type="button" disabled={!canSavePlayerMeta} onClick={actions.onRestorePlayerSkillTier}>
                          {t("Skill Tierを最新の取り込み値に戻す")}
                        </button>
                      )}
                      <p className="meta">{t("大きい値ほど高Skillとして扱い、未設定は0として扱います。")}</p>
                      {playerMeta.canRestoreSkillTier && (
                        <p className="meta">{t("start.ggのSkill Tierは初期値として取り込みます。再取得時も編集値は維持し、復元先だけを最新の取り込み値に更新します。")}</p>
                      )}
                      {skillTierErrors.length > 0 && <p className="meta error-text">{skillTierErrors.join(" ")}</p>}
                      <PlayerItemSelectionFields key={selectedEntrantId} slots={configuredCategorySlots} selections={draftSelectionsBySlot}
                        onAdd={actions.onAddDraftSelection} onRemove={actions.onRemoveDraftSelection} />
                    </div>

                    {validationErrors.length > 0 && (
                      <p className="meta error-text" style={{ marginTop: "0.45rem" }}>
                        {validationErrors.join(" ")}
                      </p>
                    )}

                    <div className="entrant-meta-actions" style={{ marginTop: "0.6rem" }}>
                      <button type="button" disabled={!canSavePlayerMeta || validationErrors.length > 0} onClick={onSavePlayerSelections}>
                        {t("アイテムの選択状態を保存")}
                      </button>
                    </div>
                  </>
                )}
              </section>
            </div>
          )}
          <YoutubeChapters
            key={`${event.slug}:${event.eventId}`}
            slug={event.slug}
            eventId={event.eventId}
            useAliasName={useAliasName}
          />
        </>
      )}
    </section>
  );
}