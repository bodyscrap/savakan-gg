import { useEffect, useState } from "react";
import { t } from "../i18n";
import { emptyCategorySelections, normalizeEventManagementSetting } from "../domain/eventManagement";
import { FREE_TEXT_LIST_ID, freeTextCategory, type ItemListConfig } from "../domain/itemList";
import {
  applyRegistrationSetting, canRegisterParticipant, isRegistrationComplete, registrationCategorySlots, validateRegisteredSelections,
  type LocalEventRegistration as Registration, type RegisteredLocalParticipant,
} from "../domain/localEventRegistration";
import { CategorySettingsFields, PlayerItemSelectionFields } from "./ItemSelectionFields";
import type { EventManagementMeta } from "../domain/tournamentWorkspaceRepository";
import { LocalRegistrationCsvImport } from "./LocalRegistrationCsvImport";

type Props = {
  itemLists: ItemListConfig[];
  registration: Registration;
  onChange: (registration: Registration) => void;
  busy: boolean;
  onPendingChange: (pending: boolean) => void;
  onImportEventName: (name: string) => void;
};

export function LocalEventRegistration({ itemLists, registration, onChange, busy, onPendingChange, onImportEventName }: Props) {
  const [settingDraft, setSettingDraft] = useState(registration.setting);
  const [participantDraft, setDraft] = useState<RegisteredLocalParticipant | null>(null);
  const [skillTierDraft, setSkillTierDraft] = useState("");
  const [notice, setNotice] = useState("");
  const [csvPending, setCsvPending] = useState(false);
  const settingsChanged = JSON.stringify(settingDraft) !== JSON.stringify(registration.setting);
  const editing = participantDraft !== null;
  useEffect(() => onPendingChange(settingsChanged || editing || csvPending), [settingsChanged, editing, csvPending, onPendingChange]);
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
    if (list.id !== FREE_TEXT_LIST_ID
      && listSnapshots.some((other, otherIndex) => otherIndex !== index && other.id === list.id)) {
      settingErrors.push(t("カテゴリは重複して設定できません。"));
    }
  }
  const normalized = normalizeEventManagementSetting({
    ...settingDraft, itemListIds: listSnapshots.map((list) => list.id),
  });
  const setting = { ...settingDraft,
    categoryMinCounts: normalized.categoryMinCounts, categoryMaxCounts: normalized.categoryMaxCounts,
    categoryAllowDuplicates: normalized.categoryAllowDuplicates,
  };
  const activeRegistration = settingsChanged && settingErrors.length === 0
    ? applyRegistrationSetting(registration, setting) : registration;
  const draft = participantDraft && settingsChanged && settingErrors.length === 0
    ? applyRegistrationSetting({ ...registration, participants: [participantDraft] }, setting).participants[0]
    : participantDraft;
  const slots = registrationCategorySlots(activeRegistration.setting);
  const errors = draft ? validateRegisteredSelections(draft, activeRegistration.setting).errors : [];
  const skillTier = skillTierDraft.trim() === "" ? null : Number(skillTierDraft);
  const skillTierError = skillTier !== null
    && (!Number.isSafeInteger(skillTier) || skillTier < 0);
  const applyPendingSetting = () => {
    if (settingsChanged) {
      onChange(activeRegistration);
      setSettingDraft(activeRegistration.setting);
    }
  };
  const saveParticipant = () => {
    if (!draft || !draft.name.trim()) return;
    const participant = {
      ...draft,
      name: draft.name.trim(),
      skill: skillTier,
      selectionsConfirmed: errors.length === 0,
    };
    const existing = registration.participants.some((player) => player.entrantId === participant.entrantId);
    onChange({ ...activeRegistration, participants: existing
      ? activeRegistration.participants.map((player) => player.entrantId === participant.entrantId ? participant : player)
      : [...activeRegistration.participants, participant] });
    setSettingDraft(activeRegistration.setting);
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
            snapshots[index] = id === FREE_TEXT_LIST_ID ? freeTextCategory(index) : itemLists.find((list) => list.id === id)
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
            const next = applyRegistrationSetting(registration, setting);
            onChange(next);
            setSettingDraft(setting);
            setDraft((current) => current
              ? applyRegistrationSetting({ ...registration, participants: [current] }, setting).participants[0]
              : null);
            setNotice(t("カテゴリ設定を適用しました。対象リストにないアイテムは除去しました。選択条件を満たさない参加者は確認してください。"));
          }}>{t("設定の適用&保存")}</button>
        {settingsChanged && <p className="meta">{t("参加者の編集・追加時にもカテゴリ設定の変更を適用します。")}</p>}
        {notice && <p role="status" className="meta">{notice}</p>}
      </div>
      </details>
      <div className="tournament-manager-grid local-registration-grid">
        <section>
          <h3>{t("参加者一覧({count} 人)", { count: registration.participants.length })}</h3>
          <div className="local-registration-actions">
          <button type="button" disabled={settingErrors.length > 0 || registration.participants.length >= 512 || csvPending}
            onClick={() => {
              applyPendingSetting();
              setDraft({ entrantId: crypto.randomUUID(), name: "", categorySelections: emptyCategorySelections(), skill: null, selectionsConfirmed: false });
              setSkillTierDraft("");
            }}>
            {t("参加登録")}
          </button>
          <LocalRegistrationCsvImport registration={{ ...registration, setting }} disabled={busy || settingErrors.length > 0}
            onPendingChange={setCsvPending} onImport={(participants, eventName) => {
              onChange({ ...registration, setting, participants });
              setSettingDraft(setting);
              setDraft(null);
              onImportEventName(eventName);
            }} />
          <button type="button" className="ghost" disabled={csvPending || registration.participants.length === 0}
            onClick={() => {
              onChange({ ...registration, participants: [] });
              setDraft(null);
            }}>{t("参加者を全員クリア")}</button>
          </div>
          <div className="event-list player-list-scroll enabled">
            {activeRegistration.participants.map((player) => {
              const complete = isRegistrationComplete(player, activeRegistration.setting);
              return <button type="button" key={player.entrantId} disabled={settingErrors.length > 0 || csvPending}
                className={`event-list-item local-registration-player ${complete ? "" : "incomplete"} ${draft?.entrantId === player.entrantId ? "selected" : ""}`}
                onClick={() => {
                  applyPendingSetting();
                  setDraft({ ...player, categorySelections: player.categorySelections.map((items) => [...items]) });
                  setSkillTierDraft(player.skill == null ? "" : String(player.skill));
                }}>
                <strong>{player.name}</strong>
                <span className={complete ? "meta" : "error-text"}>{complete ? t("選択完了") : t("選択未完了")}</span>
              </button>;
            })}
          </div>
        </section>
        <section>
          <h3>{t("選択プレイヤー設定")}</h3>
          {!draft ? <p className="meta">{t("参加登録、または一覧のプレイヤーを選択してください。")}</p> : <div className="entrant-meta-editor">
            <div className="local-registration-name-skill-row">
              <label className="meta">{t("プレイヤー名")}<input value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.currentTarget.value })} /></label>
              <label className="meta">{t("Skill Tier")}
                <input className="local-registration-skill-tier-input" type="number" min="0" step="1" value={skillTierDraft}
                  onChange={(event) => setSkillTierDraft(event.currentTarget.value)}
                  placeholder={t("未設定")} />
              </label>
            </div>
            <p className="meta">{t("大きい値ほど高Skillとして扱い、未設定は0として扱います。")}</p>
            {skillTierError && <p role="alert" className="error-text">{t("Skill Tierは0以上の整数で入力してください。")}</p>}
            <PlayerItemSelectionFields key={draft.entrantId} slots={slots} selections={draft.categorySelections}
              onAdd={(slot, item) => {
                if (!item) return;
                setDraft({ ...draft, categorySelections: draft.categorySelections.map((items, index) =>
                  index === slot.slotIndex ? [...items, item] : items) });
              }}
              onRemove={(slotIndex, itemIndex) => setDraft({ ...draft, categorySelections: draft.categorySelections.map((items, index) =>
                index === slotIndex ? items.filter((_, selectedIndex) => selectedIndex !== itemIndex) : items) })} />
            {errors.length > 0 && <p className="error-text">{errors.join(" ")}</p>}
            <div className="entrant-meta-actions">
              <button type="button" disabled={settingErrors.length > 0 || skillTierError || !canRegisterParticipant({ ...draft, skill: skillTier, selectionsConfirmed: errors.length === 0 }, activeRegistration)} onClick={saveParticipant}>{t("参加者を保存")}</button>
              <button type="button" className="ghost" onClick={() => setDraft(null)}>{t("キャンセル")}</button>
              {registration.participants.some((player) => player.entrantId === draft.entrantId) &&
                <button type="button" className="ghost" onClick={() => {
                  onChange({ ...activeRegistration, participants: activeRegistration.participants.filter((player) => player.entrantId !== draft.entrantId) });
                  setSettingDraft(activeRegistration.setting);
                  setDraft(null);
                }}>{t("参加者を削除")}</button>}
            </div>
          </div>}
        </section>
      </div>
    </fieldset>
  </section>;
}
