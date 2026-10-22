import { useEffect, useRef, useState } from "react";
import { newOverlayPreset, type OverlayPreset } from "../domain/overlayLayout";
import { t } from "../i18n";

type Props = {
  onCreate: (preset: OverlayPreset) => boolean;
  onClose: () => void;
};

export function OverlayPresetCreateDialog({ onCreate, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const widthRef = useRef<HTMLInputElement>(null);
  const [resolution, setResolution] = useState({ width: "1920", height: "1080" });
  const [error, setError] = useState("");

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    widthRef.current?.focus();
    return () => { dialog?.close(); };
  }, []);

  return <dialog ref={dialogRef} className="dialog-panel overlay-preset-create-dialog"
    aria-label={t("新規プリセットの解像度")}
    onKeyDown={(event) => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); }
    }}
    onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <form onSubmit={(event) => {
      event.preventDefault();
      try {
        if (onCreate(newOverlayPreset({ width: Number(resolution.width), height: Number(resolution.height) }))) onClose();
        else setError(t("プリセットは64件まで、コンポーネントは128件までです。"));
      } catch (cause) { setError(String(cause)); }
    }}>
      <div className="dialog-head"><h3>{t("新規プリセットの解像度")}</h3></div>
      <div className="dialog-body">
        {error && <p role="alert" className="error">{error}</p>}
        <div className="overlay-layout-toolbar">
          {(["width", "height"] as const).map((key) => <label key={key}>{t(key === "width" ? "画面の幅" : "画面の高さ")}<input
            ref={key === "width" ? widthRef : undefined}
            type="number" min={1} max={16384} step={1} required value={resolution[key]}
            onChange={(event) => {
              setResolution({ ...resolution, [key]: event.target.value });
              setError("");
            }} /></label>)}
        </div>
        <p className="meta">{t("解像度は作成後に変更できません。異なる解像度を使う場合は、新しいプリセットを作成してください。")}</p>
      </div>
      <div className="dialog-actions dialog-actions-split">
        <button type="button" className="ghost" onClick={onClose}>{t("キャンセル")}</button>
        <button type="submit">{t("この解像度で作成")}</button>
      </div>
    </form>
  </dialog>;
}
