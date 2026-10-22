import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { t } from "../i18n";

type Props = {
  fontFamily: string;
  fontSize: number;
  onFontFamilyChange: (value: string) => void;
  onFontSizeChange: (value: number) => void;
  disabled?: boolean;
  children?: ReactNode;
};

const genericFamilies = ["sans-serif", "serif", "monospace", "system-ui", "cursive", "fantasy"];

export function OverlayFontControls({ fontFamily, fontSize, onFontFamilyChange, onFontSizeChange, disabled = false, children }: Props) {
  const statusId = useId();
  const inputId = useId();
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [query, setQuery] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [dropAbove, setDropAbove] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [families, setFamilies] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const fontOptions = [
    ...genericFamilies.map((name) => ({ name, value: name })),
    ...families.map((name) => ({
      name, value: `"${name.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`,
    })).filter((item) => item.value.length <= 256),
  ];
  const options = fontOptions.filter((item) => item.name.toLowerCase().includes((query ?? "").trim().toLowerCase()));
  const selectedName = fontOptions.find((item) => item.value === fontFamily)?.name ?? fontFamily;
  const expanded = open && !disabled;

  useEffect(() => {
    let alive = true;
    void invoke<string[]>("list_overlay_fonts").then((names) => {
      if (alive) { setFamilies(names); setLoading(false); }
    }).catch((cause) => {
      if (alive) {
        setError(t("フォント一覧を取得できませんでした。汎用フォントは選択できます: {error}", { error: String(cause) }));
        setLoading(false);
      }
    });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (expanded && activeIndex >= 0) listRef.current?.children.item(activeIndex)?.scrollIntoView({ block: "nearest" });
  }, [expanded, activeIndex, query, options.length]);

  useEffect(() => {
    if (disabled) closePicker();
  }, [disabled]);

  function closePicker() {
    setOpen(false);
    setQuery(null);
    setActiveIndex(-1);
  }
  function openPicker() {
    if (disabled || inputRef.current?.matches(":disabled")) return;
    updatePlacement();
    setQuery(null);
    setOpen(true);
    const selected = fontOptions.findIndex((item) => item.value === fontFamily);
    setActiveIndex(selected < 0 ? 0 : selected);
  }
  function updatePlacement() {
    const rect = inputRef.current?.getBoundingClientRect();
    setDropAbove(!!rect && window.innerHeight - rect.bottom < Math.min(224, window.innerHeight * 0.4)
      && rect.top > window.innerHeight - rect.bottom);
  }
  function chooseFont(index: number) {
    if (disabled || inputRef.current?.matches(":disabled")) return;
    const option = options[index];
    if (!option) return;
    onFontFamilyChange(option.value);
    closePicker();
    requestAnimationFrame(() => {
      if (document.activeElement === inputRef.current) inputRef.current?.select();
    });
  }

  return <div className="overlay-font-controls">
    <div className="overlay-font-family" onBlur={(event) => {
      if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) closePicker();
    }}>
      <label htmlFor={inputId}>{t("フォント名")}</label>
      <div className="overlay-font-combobox">
        <input ref={inputRef} id={inputId} role="combobox" type="search" maxLength={256} autoComplete="off"
          disabled={disabled} value={query ?? selectedName} aria-autocomplete="list" aria-expanded={expanded}
          aria-controls={listId} aria-describedby={statusId}
          aria-activedescendant={expanded && options[activeIndex] ? `${listId}-${activeIndex}` : undefined}
          onFocus={(event) => { openPicker(); event.currentTarget.select(); }}
          onClick={() => { if (!expanded) openPicker(); }}
          onChange={(event) => { updatePlacement(); setQuery(event.target.value); setOpen(true); setActiveIndex(0); }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              if (!expanded) { openPicker(); return; }
              const last = options.length - 1;
              setActiveIndex((current) => last < 0 ? -1 : current < 0
                ? event.key === "ArrowDown" ? 0 : last
                : Math.max(0, Math.min(last, current + (event.key === "ArrowDown" ? 1 : -1))));
            } else if (event.key === "Enter") {
              event.preventDefault();
              if (expanded) chooseFont(activeIndex);
            } else if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              closePicker();
            }
          }} />
        <button type="button" tabIndex={-1} disabled={disabled} aria-label={t("フォント候補を表示")}
          aria-controls={listId} aria-expanded={expanded}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            if (expanded) closePicker();
            else { openPicker(); inputRef.current?.focus(); }
          }}>▾</button>
      </div>
      <ul ref={listRef} id={listId} role="listbox" aria-label={t("フォント候補")}
        className={`overlay-font-options${dropAbove ? " above" : ""}`} hidden={!expanded}>
        {options.map((item, index) => <li key={item.value} id={`${listId}-${index}`} role="option"
          aria-selected={item.value === fontFamily} title={item.name}
          className={`overlay-font-option${index === activeIndex ? " active" : ""}`}
          onMouseEnter={() => setActiveIndex(index)}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => chooseFont(index)}>{item.name}</li>)}
        {options.length === 0 && <li role="presentation" className="overlay-font-empty">{t("該当するフォントがありません。")}</li>}
      </ul>
    </div>
    <label className="overlay-font-size">{t("文字サイズ")}<input type="number" required min={1} max={1000} disabled={disabled} value={fontSize}
      onChange={(event) => { if (Number.isFinite(event.target.valueAsNumber)) onFontSizeChange(event.target.valueAsNumber); }} /></label>
    {children}
    <p id={statusId} role="status" className="meta">
      {loading ? t("フォント一覧を取得しています…") : t("フォント候補: {count}件", { count: options.length })}
      {!loading && options.length === 0 && ` ${t("該当するフォントがありません。")}`}
    </p>
    <p className="meta">{t("入力は候補の絞り込み専用です。候補を選ぶと正式なフォント名で入力欄を置き換えます。↑↓とEnterでも選択でき、Escで絞り込みを取り消します。")}</p>
    {error && <p role="alert" className="error">{error}</p>}
  </div>;
}
