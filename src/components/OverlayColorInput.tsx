import { useEffect, useId, useRef, useState, type FormEvent, type PointerEvent } from "react";
import {
  overlayColorParts, overlayColorWithAlpha, overlayColorHsv, overlayColorFromHsv, type OverlayHsv,
} from "../domain/overlayLayout";
import { t } from "../i18n";

type Props = {
  label: "文字色" | "背景色";
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
};

export function OverlayColorInput({ label, value, onChange, disabled = false }: Props) {
  const labelId = useId();
  const pickerId = useId();
  const alphaErrorId = useId();
  const hexErrorId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const { rgb, alpha } = overlayColorParts(value);
  const code = value === "transparent" ? "#00000000" : value.toUpperCase();
  const [hsv, setHsv] = useState(() => overlayColorHsv(value));
  const [alphaInput, setAlphaInput] = useState(String(alpha));
  const [hexInput, setHexInput] = useState(code);
  const [open, setOpen] = useState(false);
  const validAlpha = alphaInput !== "" && Number.isInteger(Number(alphaInput))
    && Number(alphaInput) >= 0 && Number(alphaInput) <= 255;
  const validHex = /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(hexInput);

  useEffect(() => {
    setAlphaInput(String(alpha));
    setHexInput(code);
    setHsv((current) => {
      if (overlayColorParts(overlayColorFromHsv(current, alpha)).rgb === rgb) return current;
      const next = overlayColorHsv(value);
      return next.s === 0 ? { ...next, h: current.h } : next;
    });
  }, [value, rgb, alpha, code]);

  useEffect(() => {
    if (disabled && pickerRef.current?.matches(":popover-open")) pickerRef.current.hidePopover();
  }, [disabled]);

  useEffect(() => {
    if (!open) return;
    placePicker();
    window.addEventListener("resize", placePicker);
    window.addEventListener("scroll", placePicker, true);
    return () => {
      window.removeEventListener("resize", placePicker);
      window.removeEventListener("scroll", placePicker, true);
    };
  }, [open, validAlpha, validHex]);

  function placePicker() {
    const trigger = triggerRef.current;
    const picker = pickerRef.current;
    if (!trigger || !picker) return;
    const rect = trigger.getBoundingClientRect();
    const { width, height } = picker.getBoundingClientRect();
    const below = window.innerHeight - rect.bottom;
    const top = below >= height + 8 || below >= rect.top ? rect.bottom + 6 : rect.top - height - 6;
    picker.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))}px`;
    picker.style.top = `${Math.max(8, Math.min(top, window.innerHeight - height - 8))}px`;
  }

  function openPicker() {
    if (disabled || triggerRef.current?.matches(":disabled")) return;
    pickerRef.current?.showPopover();
    placePicker();
  }

  function closePicker() {
    if (pickerRef.current?.matches(":popover-open")) pickerRef.current.hidePopover();
    triggerRef.current?.focus({ preventScroll: true });
  }

  function applyColor(next: string) {
    const parts = overlayColorParts(next);
    setHexInput(next.toUpperCase());
    setAlphaInput(String(parts.alpha));
    onChange(next);
  }

  function showInvalid(event: FormEvent<HTMLInputElement>) {
    const form = event.currentTarget.form;
    if (!form || form.querySelector("input:invalid, select:invalid, textarea:invalid") === event.currentTarget) openPicker();
    else event.preventDefault();
  }

  function updateHsv(next: OverlayHsv) {
    setHsv(next);
    applyColor(overlayColorFromHsv(next, alpha));
  }

  function pickSaturation(event: PointerEvent<HTMLDivElement>) {
    if (disabled || triggerRef.current?.matches(":disabled")) return;
    const rect = event.currentTarget.getBoundingClientRect();
    updateHsv({
      ...hsv,
      s: Math.max(0, Math.min(100, (event.clientX - rect.left) / rect.width * 100)),
      v: Math.max(0, Math.min(100, 100 - (event.clientY - rect.top) / rect.height * 100)),
    });
  }

  return <div className="overlay-color-input">
    <span id={labelId} className="overlay-color-label">{t(label)}</span>
    <button ref={triggerRef} type="button" className="overlay-color-trigger" disabled={disabled}
      aria-label={t(label)} aria-haspopup="dialog" aria-expanded={open} aria-controls={pickerId}
      onClick={() => {
        if (pickerRef.current?.matches(":popover-open")) pickerRef.current.hidePopover();
        else openPicker();
      }}>
      <span className="overlay-color-swatch" aria-hidden="true"><span style={{ background: value }} /></span>
      <span className="overlay-color-code">{code}</span>
    </button>
    <div ref={pickerRef} id={pickerId} popover="auto" role="dialog" aria-labelledby={labelId}
      className="overlay-color-picker"
      onToggle={(event) => setOpen(event.newState === "open")}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          closePicker();
        } else if (event.key === "Enter" && event.target instanceof HTMLInputElement) {
          event.preventDefault();
          if (validAlpha && validHex) closePicker();
        }
      }}>
      <div className="overlay-color-picker-head">
        <strong>{t(label)}</strong>
        <button type="button" onClick={closePicker}>{t("閉じる")}</button>
      </div>
      <div className="overlay-color-saturation" aria-hidden="true"
        style={{ backgroundColor: `hsl(${hsv.h} 100% 50%)` }}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          pickSaturation(event);
        }}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) pickSaturation(event);
        }}
        onPointerUp={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        }}>
        <span style={{ left: `${hsv.s}%`, top: `${100 - hsv.v}%` }} />
      </div>
      <label>{t("色相")}<input type="range" min={0} max={360} step={1} value={hsv.h} disabled={disabled}
        className="overlay-color-hue" onChange={(event) => updateHsv({ ...hsv, h: event.target.valueAsNumber })} /></label>
      <div className="overlay-color-picker-row">
        <label>{t("彩度")}<input type="range" min={0} max={100} step={1} value={hsv.s} disabled={disabled}
          onChange={(event) => updateHsv({ ...hsv, s: event.target.valueAsNumber })} /></label>
        <label>{t("明度")}<input type="range" min={0} max={100} step={1} value={hsv.v} disabled={disabled}
          onChange={(event) => updateHsv({ ...hsv, v: event.target.valueAsNumber })} /></label>
      </div>
      <label>{t("透明度")}<input type="range" min={0} max={255} step={1} value={alpha} disabled={disabled}
        className="overlay-color-opacity" aria-label={t("{name}の透明度", { name: t(label) })}
        style={{ backgroundImage: `linear-gradient(to right, ${rgb}00, ${rgb}), repeating-conic-gradient(#fff 0% 25%, #cbd5e1 0% 50%)` }}
        onChange={(event) => applyColor(overlayColorWithAlpha(value, event.target.valueAsNumber))} /></label>
      <div className="overlay-color-picker-row">
        <label>{t("カラーコード")}<input type="text" autoFocus required maxLength={9} spellCheck={false}
          pattern="#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?" value={hexInput} disabled={disabled}
          aria-invalid={!validHex || undefined} aria-describedby={!validHex ? hexErrorId : undefined}
          onInvalid={showInvalid} onChange={(event) => {
            const next = event.target.value;
            setHexInput(next);
            if (/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(next)) applyColor(next.toLowerCase());
            else onChange(value);
          }} /></label>
        <label className="overlay-color-alpha">{t("Alpha値")}<input type="number" min={0} max={255} step={1}
          required value={alphaInput} disabled={disabled} aria-label={t("{name}のAlpha値", { name: t(label) })}
          aria-invalid={!validAlpha || undefined} aria-describedby={!validAlpha ? alphaErrorId : undefined}
          title={t("0は完全透明、255は不透明です。")} onInvalid={showInvalid}
          onChange={(event) => {
            const raw = event.target.value;
            const next = event.target.valueAsNumber;
            setAlphaInput(raw);
            if (raw !== "" && Number.isInteger(next) && next >= 0 && next <= 255) {
              applyColor(overlayColorWithAlpha(value, next));
            } else onChange(value);
          }} /></label>
      </div>
      {!validHex && <p id={hexErrorId} role="alert" className="error overlay-color-error">{t("カラーコードは#RRGGBBまたは#RRGGBBAAで指定してください。")}</p>}
      {!validAlpha && <p id={alphaErrorId} role="alert" className="error overlay-color-error">{t("Alpha値は0〜255の整数で指定してください。")}</p>}
    </div>
  </div>;
}
