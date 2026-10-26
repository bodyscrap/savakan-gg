import { useEffect, useState } from "react";
import { t } from "../i18n";
import { emptyCategorySelections, normalizeEventManagementSetting } from "../domain/eventManagement";
import { type ItemListConfig } from "../domain/itemList";
import {
  applyRegistrationSetting, canRegisterParticipant, isRegistrationComplete, registrationCategorySlots, validateRegisteredSelections,
  type LocalEventRegistration as Registration, type RegisteredLocalParticipant,
} from "../domain/localEventRegistration";
import { CategorySettingsFields, PlayerItemSelectionFields } from "./ItemSelectionFields";
import type { EventManagementMeta } from "../domain/tournamentWorkspaceRepository";

type Props = {
  itemLists: ItemListConfig[];
  registration: Registration;
  onChange: (registration: Registration) => void;
  busy: boolean;
  onPendingChange: (pending: boolean) => void;
};

export function LocalEventRegistration({ itemLists, registration, onChange, busy, onPendingChange }: Props) {
  const [settingDraft, setSettingDraft] = useState(registration.setting);
  const [draft, setDraft] = useState<RegisteredLocalParticipant | null>(null);
  const [notice, setNotice] = useState("");
  const slots = registrationCategorySlots(registration.setting);
  const errors = draft ? validateRegisteredSelections(draft, registration.setting).errors : [];
  const settingsChanged = JSON.stringify(settingDraft) !== JSON.stringify(registration.setting);
  const editing = draft !== null;
  useEffect(() => onPendingChange(settingsChanged || editing), [settingsChanged, editing, onPendingChange]);
  const listSnapshots = settingDraft.itemListSnapshots;
  const updateSetting = (update: Partial<EventManagementMeta>) => setSettingDraft((current) => ({ ...current, ...update }));
  const updateCount = (key: "categoryMinCounts" | "categoryMaxCounts", index: number, raw: string) => {
    const values = [...settingDraft[key] ?? [0, 0, 0]];
    values[index] = Math.max(0, Math.trunc(Number(raw) || 0));
    updateSetting({ [key]: values });
  };
  const settingErrors: string[] = [];
  if ((settingDraft.totalMinCount ?? 0) > (settingDraft.totalMaxCount ?? 3)) {
    settingErrors.push(t("全体の上限は下限以上にしてください。"));
  }
  for (const [index, list] of listSnapshots.entries()) {
    if (!list.id) continue;
    if ((settingDraft.categoryMinCounts?.[index] ?? 0) > (settingDraft.categoryMaxCounts?.[index] ?? 0)) {
      settingErrors.push(t("カテゴリ{p0}: 上限は下限以上にしてください。", { p0: index + 1 }));
    }
    if (listSnapshots.some((other, otherIndex) => otherIndex !== index && other.id === list.id)) {
      settingErrors.push(t("カテゴリは重複して設定できません。"));
    }
  }
  const saveParticipant = () => {
    if (!draft || !draft.name.trim()) return;
    const participant = { ...draft, name: draft.name.trim(), selectionsConfirmed: errors.length === 0 };
    const existing = registration.participants.some((player) => player.entrantId === participant.entrantId);
    onChange({ ...registration, participants: existing
      ? registration.participants.map((player) => player.entrantId === participant.entrantId ? participant : player)
      : [...registration.participants, participant] });
    setDraft(null);
  };
  return <section className="panel create-layout-full">
    <h2>{t("参加者リストとアイテム設定")}</h2>
    <fieldset disabled={busy} className="local-registration-fields" aria-label={t("参加者リストとアイテム設定")}>
      <details className="item-category-settings">
      <summary><h3>{t("アイテム選択カテゴリの設定")}</h3></summary>
      <label className="setting-checkbox">
        <input type="checkbox" checked={registration.requireItemSelections}
          onChange={(event) => onChange({ ...registration, requireItemSelections: event.currentTarget.checked })} />
        {t("アイテム登録は必須")}
      </label>
      <div className="tournament-settings">
        <CategorySettingsFields rules={{
          itemLists: [...itemLists, ...listSnapshots.filter((list) => list.id && !itemLists.some((item) => item.id === list.id))],
          categorySlotListIds: listSnapshots.map((list) => list.id),
          categorySlotMinCounts: settingDraft.categoryMinCounts ?? [0, 0, 0],
          categorySlotMaxCounts: settingDraft.categoryMaxCounts ?? [0, 0, 0],
          categorySlotAllowDuplicates: settingDraft.categoryAllowDuplicates ?? [false, false, false],
          totalItemMinCount: settingDraft.totalMinCount ?? 0, totalItemMaxCount: settingDraft.totalMaxCount ?? 3,
        }} actions={{
          onCategoryListChange: (index, id) => {
            const snapshots = Array.from({ length: 3 }, (_, slot) =>
              listSnapshots[slot] ?? { id: "", name: "", categoryName: "", items: [] });
            snapshots[index] = itemLists.find((list) => list.id === id)
              ?? listSnapshots.find((list) => list.id === id)
              ?? { id: "", name: "", categoryName: "", items: [] };
            const maxCounts = [...settingDraft.categoryMaxCounts ?? [0, 0, 0]];
            maxCounts[index] = id ? Math.max(1, maxCounts[index]) : 0;
            const minCounts = [...settingDraft.categoryMinCounts ?? [0, 0, 0]];
            if (!id) minCounts[index] = 0;
            updateSetting({ itemListSnapshots: snapshots, categoryMaxCounts: maxCounts, categoryMinCounts: minCounts });
          },
          onCategoryMinChange: (index, value) => updateCount("categoryMinCounts", index, value),
          onCategoryMaxChange: (index, value) => updateCount("categoryMaxCounts", index, value),
          onCategoryAllowDuplicatesChange: (index, value) => {
            const values = [...settingDraft.categoryAllowDuplicates ?? [false, false, false]];
            values[index] = value;
            updateSetting({ categoryAllowDuplicates: values });
          },
          onTotalItemMinChange: (value) => updateSetting({ totalMinCount: Math.max(0, Math.trunc(Number(value) || 0)) }),
          onTotalItemMaxChange: (value) => updateSetting({ totalMaxCount: Math.max(0, Math.trunc(Number(value) || 0)) }),
        }} />
        {settingErrors.length > 0 && <p role="alert" className="error-text">{settingErrors.join(" ")}</p>}
        <button type="button" className="ghost" disabled={!settingsChanged || settingErrors.length > 0}
          onClick={() => {
            const normalized = normalizeEventManagementSetting({
              ...settingDraft, itemListIds: listSnapshots.map((list) => list.id),
            });
            const setting = { ...settingDraft,
              categoryMinCounts: normalized.categoryMinCounts, categoryMaxCounts: normalized.categoryMaxCounts,
              categoryAllowDuplicates: normalized.categoryAllowDuplicates,
            };
            const next = applyRegistrationSetting(registration, setting);
            onChange(next);
            setSettingDraft(setting);
            setDraft((current) => current
              ? applyRegistrationSetting({ ...registration, participants: [current] }, setting).participants[0]
              : null);
            setNotice(t("カテゴリ設定を適用しました。条件に合わない参加者の選択はクリアしました。"));
          }}>{t("設定の適用&保存")}</button>
        {settingsChanged && <p className="meta">{t("カテゴリ設定の変更を適用してから参加登録してください。")}</p>}
        {notice && <p role="status" className="meta">{notice}</p>}
      </div>
      </details>
      <div className="tournament-manager-grid local-registration-grid">
        <section>
          <h3>{t("参加者一覧({count} 人)", { count: registration.participants.length })}</h3>
          <button type="button" disabled={settingsChanged || registration.participants.length >= 512}
            onClick={() => setDraft({ entrantId: crypto.randomUUID(), name: "", categorySelections: emptyCategorySelections(), selectionsConfirmed: false })}>
            {t("参加登録")}
          </button>
          <div className="event-list player-list-scroll enabled">
            {registration.participants.map((player) => {
              const complete = isRegistrationComplete(player, registration.setting);
              return <button type="button" key={player.entrantId} disabled={settingsChanged}
                className={`event-list-item local-registration-player ${complete ? "" : "incomplete"} ${draft?.entrantId === player.entrantId ? "selected" : ""}`}
                onClick={() => setDraft({ ...player, categorySelections: player.categorySelections.map((items) => [...items]) })}>
                <strong>{player.name}</strong>
                <span className={complete ? "meta" : "error-text"}>{complete ? t("選択完了") : t("選択未完了")}</span>
              </button>;
            })}
          </div>
        </section>
        <section>
          <h3>{t("選択プレイヤー設定")}</h3>
          {!draft ? <p className="meta">{t("参加登録、または一覧のプレイヤーを選択してください。")}</p> : <div className="entrant-meta-editor">
            <label className="meta" style={{ display: "grid", gap: "0.3rem" }}>{t("プレイヤー名")}<input value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.currentTarget.value })} /></label>
            <PlayerItemSelectionFields slots={slots} selections={draft.categorySelections}
              onAdd={(slot, item) => {
                if (!item) return;
                setDraft({ ...draft, categorySelections: draft.categorySelections.map((items, index) =>
                  index === slot.slotIndex ? [...items, item] : items) });
              }}
              onRemove={(slotIndex, itemIndex) => setDraft({ ...draft, categorySelections: draft.categorySelections.map((items, index) =>
                index === slotIndex ? items.filter((_, selectedIndex) => selectedIndex !== itemIndex) : items) })} />
            {errors.length > 0 && <p className="error-text">{errors.join(" ")}</p>}
            <div className="entrant-meta-actions">
              <button type="button" disabled={settingsChanged || !canRegisterParticipant({ ...draft, selectionsConfirmed: errors.length === 0 }, registration)} onClick={saveParticipant}>{t("参加者を保存")}</button>
              <button type="button" className="ghost" onClick={() => setDraft(null)}>{t("キャンセル")}</button>
              {registration.participants.some((player) => player.entrantId === draft.entrantId) &&
                <button type="button" className="ghost" onClick={() => {
                  onChange({ ...registration, participants: registration.participants.filter((player) => player.entrantId !== draft.entrantId) });
                  setDraft(null);
                }}>{t("参加者を削除")}</button>}
            </div>
          </div>}
        </section>
      </div>
    </fieldset>
  </section>;
}
