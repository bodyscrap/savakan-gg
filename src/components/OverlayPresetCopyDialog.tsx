import { useEffect, useRef, useState } from "react";
import { copyOverlayPreset, overlayResolutionAtAspect, type OverlayPreset } from "../domain/overlayLayout";
import { t } from "../i18n";

type Props = {
  source: OverlayPreset;
  onCopy: (preset: OverlayPreset) => boolean;
  onClose: () => void;
};

export function OverlayPresetCopyDialog({ source, onCopy, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const widthRef = useRef<HTMLInputElement>(null);
  const [resolution, setResolution] = useState({ width: String(source.width), height: String(source.height) });
  const [error, setError] = useState("");

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    widthRef.current?.focus();
    return () => { dialog?.close(); };
  }, []);

  return <dialog ref={dialogRef} className="dialog-panel overlay-preset-copy-dialog"
    aria-label={t("プリセットの複製")}
    onKeyDown={(event) => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); }
    }}
    onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <form onSubmit={(event) => {
      event.preventDefault();
      try {
        if (onCopy(copyOverlayPreset(source, { width: Number(resolution.width), height: Number(resolution.height) }))) onClose();
        else setError(t("プリセットは64件まで、コンポーネントは128件までです。"));
      } catch (cause) { setError(String(cause)); }
    }}>
      <div className="dialog-head"><h3>{t("プリセットの複製")}</h3></div>
      <div className="dialog-body">
        {error && <p role="alert" className="error">{error}</p>}
        <p className="meta">{t("複製元: {name} ({width} × {height})", {
          name: source.name, width: source.width, height: source.height,
        })}</p>
        <div className="overlay-layout-toolbar">
          {(["width", "height"] as const).map((key) => <label key={key}>{t(key === "width" ? "画面の幅" : "画面の高さ")}<input
            ref={key === "width" ? widthRef : undefined}
            type="number" min={1} max={16384} step={1} required value={resolution[key]}
            onChange={(event) => {
              const value = event.target.valueAsNumber;
              if (Number.isInteger(value) && value >= 1 && value <= 16384) {
                const next = overlayResolutionAtAspect(source, key, value);
                setResolution({ width: String(next.width), height: String(next.height) });
              } else setResolution({ ...resolution, [key]: event.target.value });
              setError("");
            }} /></label>)}
        </div>
        <p className="meta">{t("幅と高さは元のアスペクト比を保って連動します。上限に達する場合は両方を範囲内に収めます。")}</p>
        <p className="meta">{t("コンポーネントは縦横比を保って中央に配置し、位置・サイズ・文字サイズを整数値に丸めます。")}</p>
        <p className="meta">{t("解像度は作成後に変更できません。異なる解像度を使う場合は、新しいプリセットを作成してください。")}</p>
      </div>
      <div className="dialog-actions dialog-actions-split">
        <button type="button" className="ghost" onClick={onClose}>{t("キャンセル")}</button>
        <button type="submit">{t("この解像度で複製")}</button>
      </div>
    </form>
  </dialog>;
}
