import { t } from "../i18n";
import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  builtInOverlayPreset,
  parseOverlayLayouts,
  type OverlayLayouts,
} from "../domain/overlayLayout";

type OverlayVisibilityButtonsProps = {
  visibilityOverrides: Record<string, boolean>;
  disabled?: boolean;
};

export function OverlayVisibilityButtons({
  visibilityOverrides: currentOverrides,
  disabled = false,
}: OverlayVisibilityButtonsProps) {
  const [layouts, setLayouts] = useState<OverlayLayouts>();
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [error, setError] = useState("");
  const defaultPreset = useMemo(() => builtInOverlayPreset(), []);
  const activePreset = layouts?.presets.find((preset) => preset.id === layouts.activePresetId);
  const preset = activePreset ?? defaultPreset;
  const controlIds = activePreset?.visibilityControlIds ?? layouts?.defaultVisibilityControlIds ?? [];
  const overridesKey = JSON.stringify(Object.entries(currentOverrides).sort(([a], [b]) => a.localeCompare(b)));

  useEffect(() => {
    let alive = true;
    void invoke<unknown>("get_overlay_layouts").then((value) => {
      if (alive) setLayouts(parseOverlayLayouts(value));
    }).catch((cause) => {
      if (alive) setError(String(cause));
    });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    setOverrides(Object.fromEntries(JSON.parse(overridesKey) as [string, boolean][]));
  }, [overridesKey]);

  async function toggle(componentId: string, initialVisible: boolean) {
    const visible = !(overrides[componentId] ?? initialVisible);
    setError("");
    try {
      const result = await invoke<boolean>("set_overlay_component_visibility", {
        componentId,
        visible,
      });
      setOverrides((current) => ({ ...current, [componentId]: result }));
    } catch (cause) {
      setError(String(cause));
    }
  }

  if (!layouts || !controlIds.some(Boolean)) {
    return error ? <p role="alert" className="error">{error}</p> : null;
  }

  return (
    <div className="overlay-visibility-control">
      <strong>{t("表示切替コンポーネント")}</strong>
      {error && <p role="alert" className="error">{error}</p>}
      <div className="overlay-visibility-buttons">
        {Array.from({ length: 6 }, (_, index) => {
          const id = controlIds[index];
          if (!id) return <button key={index} type="button" disabled>{index + 1}</button>;
          const component = preset.components.find((item) => item.id === id);
          if (!component) return null;
          const visible = overrides[id] ?? component.visible;
          return (
            <button
              key={id}
              type="button"
              className={!visible ? "ghost" : ""}
              aria-pressed={visible}
              aria-label={t("{number}: {name}の表示切替", { number: index + 1, name: component.name })}
              title={component.name}
              disabled={disabled}
              onClick={() => void toggle(id, component.visible)}
            >
              {index + 1}
            </button>
          );
        })}
      </div>
    </div>
  );
}
