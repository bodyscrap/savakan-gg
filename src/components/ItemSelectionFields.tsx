import { useEffect, useId, useRef, useState } from "react";
import { t } from "../i18n";
import { FREE_TEXT_LIST_ID, type ItemListConfig } from "../domain/itemList";
import type { EventSettingProps, EventSettingCategorySlot } from "./EventSetting";

type CategorySettingsProps = {
  rules: Pick<EventSettingProps["rules"],
    "itemLists" | "categorySlotListIds" | "categorySlotMinCounts" | "categorySlotMaxCounts"
    | "categorySlotAllowDuplicates" | "totalItemMinCount" | "totalItemMaxCount">;
  actions: Pick<EventSettingProps["actions"],
    "onCategoryListChange" | "onCategoryMinChange" | "onCategoryMaxChange"
    | "onCategoryAllowDuplicatesChange" | "onTotalItemMinChange" | "onTotalItemMaxChange">;
};

export function ItemListPicker({ id, lists, value, onChange }: {
  id: string;
  lists: ItemListConfig[];
  value: string;
  onChange: (value: string) => void;
}) {
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [query, setQuery] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [dropAbove, setDropAbove] = useState(false);
  const search = (query ?? "").trim().toLowerCase();
  const label = (list: ItemListConfig) => `${list.name} / ${list.categoryName} (${list.items.length})`;
  const options = [
    { value: "", label: t("未選択") },
    ...(!search || t("自由記入").toLowerCase().includes(search)
      ? [{ value: FREE_TEXT_LIST_ID, label: t("自由記入") }] : []),
    ...lists.slice().sort((a, b) => a.name.localeCompare(b.name, "ja"))
      .filter((list) => list.id !== FREE_TEXT_LIST_ID)
      .filter((list) => list.name.toLowerCase().includes(search) || list.categoryName.toLowerCase().includes(search))
      .map((list) => ({ value: list.id, label: label(list) })),
  ];
  const selected = lists.find((list) => list.id === value);
  const selectedLabel = value === FREE_TEXT_LIST_ID ? t("自由記入") : selected ? label(selected) : t("未選択");

  useEffect(() => {
    if (open && activeIndex >= 0) listRef.current?.children.item(activeIndex)?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex, query]);

  function updatePlacement() {
    const rect = inputRef.current?.getBoundingClientRect();
    setDropAbove(!!rect && window.innerHeight - rect.bottom < Math.min(224, window.innerHeight * 0.4)
      && rect.top > window.innerHeight - rect.bottom);
  }
  function closePicker() {
    setQuery(null);
    setOpen(false);
    setActiveIndex(-1);
  }
  function openPicker() {
    if (inputRef.current?.matches(":disabled")) return;
    updatePlacement();
    setQuery(null);
    setOpen(true);
    const sorted = lists.filter((list) => list.id !== FREE_TEXT_LIST_ID)
      .sort((a, b) => a.name.localeCompare(b.name, "ja"));
    setActiveIndex(value === FREE_TEXT_LIST_ID ? 1 : value ? sorted.findIndex((list) => list.id === value) + 2 : 0);
  }
  function choose(index: number) {
    if (inputRef.current?.matches(":disabled")) return;
    const option = options[index];
    if (!option) return;
    onChange(option.value);
    closePicker();
  }
  return <div className="item-list-picker" onBlur={(event) => {
    if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) closePicker();
  }}>
    <div className="searchable-select-input">
      <input id={id} ref={inputRef} type="search" role="combobox" autoComplete="off"
        value={query ?? selectedLabel} placeholder={t("リスト名・カテゴリ名で絞り込み")}
        aria-autocomplete="list" aria-expanded={open} aria-controls={listId}
        aria-activedescendant={open && options[activeIndex] ? `${listId}-${activeIndex}` : undefined}
        onFocus={(event) => { openPicker(); event.currentTarget.select(); }}
        onClick={() => { if (!open) openPicker(); }}
        onChange={(event) => {
          updatePlacement();
          setQuery(event.currentTarget.value);
          setOpen(true);
          setActiveIndex(1);
        }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            if (!open) { openPicker(); return; }
            setActiveIndex((current) => Math.max(0, Math.min(options.length - 1,
              current + (event.key === "ArrowDown" ? 1 : -1))));
          } else if (event.key === "Enter") {
            event.preventDefault();
            if (open) choose(activeIndex);
          } else if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            closePicker();
          }
        }} />
      <button type="button" tabIndex={-1} aria-label={t("使用リストの候補を表示")}
        aria-controls={listId} aria-expanded={open}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          if (inputRef.current?.matches(":disabled")) return;
          if (open) closePicker();
          else { openPicker(); inputRef.current?.focus(); }
        }}>▾</button>
    </div>
    <ul id={listId} ref={listRef} role="listbox" aria-label={t("使用リストの候補")}
      className={`searchable-select-options${dropAbove ? " above" : ""}`} hidden={!open}>
      {options.map((option, index) => <li key={option.value} id={`${listId}-${index}`} role="option"
        aria-selected={option.value === value} className={`searchable-select-option${index === activeIndex ? " active" : ""}`}
        onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => setActiveIndex(index)}
        onClick={() => choose(index)}>{option.label}</li>)}
      {options.length === 1 && search !== "" && <li role="presentation" className="searchable-select-empty">
        {t("一致するリストがありません。")}
      </li>}
    </ul>
  </div>;
}

export function CategorySettingsFields({ rules, actions }: CategorySettingsProps) {
  return <>
    {Array.from({ length: 3 }, (_, slotIndex) => {
      const listId = rules.categorySlotListIds[slotIndex] ?? "";
      const disabled = listId.trim() === "";
      return <div className="setting-row" key={slotIndex}>
        <p className="setting-row-title">{t("カテゴリ{value1}", { value1: slotIndex + 1 })}</p>
        <div className="setting-row-fields">
          <label htmlFor={`item-list-slot-${slotIndex}`}>{t("使用リスト")}</label>
          <ItemListPicker id={`item-list-slot-${slotIndex}`} lists={rules.itemLists} value={listId}
            onChange={(value) => actions.onCategoryListChange(slotIndex, value)} />
          <label htmlFor={`item-list-slot-min-${slotIndex}`}>{t("カテゴリ下限")}</label>
          <input id={`item-list-slot-min-${slotIndex}`} type="number" min={0} step={1}
            value={rules.categorySlotMinCounts[slotIndex] ?? 0} disabled={disabled}
            onChange={(event) => actions.onCategoryMinChange(slotIndex, event.currentTarget.value)} />
          <label htmlFor={`item-list-slot-max-${slotIndex}`}>{t("カテゴリ上限")}</label>
          <input id={`item-list-slot-max-${slotIndex}`} type="number" min={0} step={1}
            value={rules.categorySlotMaxCounts[slotIndex] ?? 0} disabled={disabled}
            onChange={(event) => actions.onCategoryMaxChange(slotIndex, event.currentTarget.value)} />
          <label htmlFor={`item-list-slot-allow-dup-${slotIndex}`}>{t("重複可否")}</label>
          <label className="setting-checkbox" htmlFor={`item-list-slot-allow-dup-${slotIndex}`}>
            <input id={`item-list-slot-allow-dup-${slotIndex}`} type="checkbox"
              checked={rules.categorySlotAllowDuplicates[slotIndex] ?? false} disabled={disabled}
              onChange={(event) => actions.onCategoryAllowDuplicatesChange(slotIndex, event.currentTarget.checked)} />
            {t("許可")}
          </label>
        </div>
      </div>;
    })}
    <div className="setting-row">
      <p className="setting-row-title">{t("アイテム全体選択")}</p>
      <div className="setting-row-fields total">
        <label htmlFor="total-item-min">{t("下限")}</label>
        <input id="total-item-min" type="number" min={0} step={1} value={rules.totalItemMinCount}
          onChange={(event) => actions.onTotalItemMinChange(event.currentTarget.value)} />
        <label htmlFor="total-item-max">{t("上限")}</label>
        <input id="total-item-max" type="number" min={0} step={1} value={rules.totalItemMaxCount}
          onChange={(event) => actions.onTotalItemMaxChange(event.currentTarget.value)} />
      </div>
    </div>
  </>;
}

type PlayerItemSelectionProps = {
  slots: EventSettingCategorySlot[];
  selections: string[][];
  onAdd: (slot: EventSettingCategorySlot, itemName: string) => void;
  onRemove: (slotIndex: number, selectionIndex: number) => void;
};

export function PlayerItemSelectionFields({ slots, selections, onAdd, onRemove }: PlayerItemSelectionProps) {
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  if (slots.length === 0) {
    return <p className="meta">{t("先に上部でカテゴリ(最大3つ)を選択してください。")}</p>;
  }
  return <>{slots.map((slot) => {
    const selected = selections[slot.slotIndex] ?? [];
    const items = slot.allowDuplicates ? slot.list.items : slot.list.items.filter((item) => !selected.includes(item));
    return <div key={`${slot.list.id}-${slot.slotIndex}`} className="player-item-selection-field">
      <p className="meta" style={{ marginBottom: "0.35rem" }}>{t("{value1} ({value2}) / {value3} 件{value4}", {
        value1: slot.list.categoryName, value2: slot.list.name, value3: selected.length,
        value4: t(" / 下限 {value1} / 上限 {value2} / 重複 {value3}", {
          value1: slot.minCount, value2: slot.maxCount, value3: slot.allowDuplicates ? t("可") : t("不可"),
        }),
      })}</p>
      {slot.list.id === FREE_TEXT_LIST_ID ? <div className="free-text-item-input">
        <input aria-label={t("カテゴリ{value1}", { value1: slot.slotIndex + 1 })}
          value={drafts[slot.slotIndex] ?? ""} disabled={selected.length >= slot.maxCount}
          onChange={(event) => setDrafts({ ...drafts, [slot.slotIndex]: event.currentTarget.value })}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
            event.preventDefault();
            const value = (drafts[slot.slotIndex] ?? "").trim();
            if (!value || (!slot.allowDuplicates && selected.includes(value))) return;
            onAdd(slot, value);
            setDrafts({ ...drafts, [slot.slotIndex]: "" });
          }} />
        <button type="button" className="ghost" disabled={selected.length >= slot.maxCount
          || !(drafts[slot.slotIndex] ?? "").trim()
          || (!slot.allowDuplicates && selected.includes((drafts[slot.slotIndex] ?? "").trim()))}
          onClick={() => {
            onAdd(slot, (drafts[slot.slotIndex] ?? "").trim());
            setDrafts({ ...drafts, [slot.slotIndex]: "" });
          }}>{t("追加")}</button>
      </div> : <select aria-label={t("カテゴリ{value1}", { value1: slot.slotIndex + 1 })} value=""
        disabled={selected.length >= slot.maxCount || items.length === 0}
        onChange={(event) => onAdd(slot, event.currentTarget.value)}>
        <option value="">{t("アイテムを追加")}</option>
        {items.map((item) => <option key={item} value={item}>{item}</option>)}
      </select>}
      {selected.length > 0 && <div className="player-item-selection-tags">
        {selected.map((item, index) =>
          <button key={`${item}-${index}`} type="button" className="ghost tiny"
            onClick={() => onRemove(slot.slotIndex, index)}>{item} ×</button>)}
      </div>}
    </div>;
  })}</>;
}
