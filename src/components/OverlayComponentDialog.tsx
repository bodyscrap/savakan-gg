import { useEffect, useRef, useState } from "react";
import { newOverlayComponent, type OverlayComponent } from "../domain/overlayLayout";
import { t } from "../i18n";

type Props = {
  onCreate: (component: OverlayComponent) => boolean;
  onClose: () => void;
};

export function OverlayComponentDialog({ onCreate, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<OverlayComponent["kind"]>("text");
  const [name, setName] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    nameRef.current?.focus();
    return () => { dialog?.close(); };
  }, []);

  return <dialog ref={dialogRef} className="dialog-panel overlay-component-dialog"
    aria-label={t("コンポーネントの作成")}
    onKeyDown={(event) => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); }
    }}
    onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <form onSubmit={(event) => {
      event.preventDefault();
      try {
        if (onCreate(newOverlayComponent(kind, name))) onClose();
        else setError(t("プリセットは64件まで、コンポーネントは128件までです。"));
      } catch (cause) { setError(String(cause)); }
    }}>
      <div className="dialog-head"><h3>{t("コンポーネントの作成")}</h3></div>
      <div className="dialog-body">
        {error && <p role="alert" className="error">{error}</p>}
        <label>{t("コンポーネント種別")}<select value={kind} onChange={(event) => {
          const value = event.target.value;
          if (value === "text" || value === "number" || value === "image" || value === "item" || value === "clock") setKind(value);
        }}>
          <option value="text">{t("テキスト")}</option>
          <option value="number">{t("数値")}</option>
          <option value="item">{t("アイテム")}</option>
          <option value="clock">{t("時計")}</option>
          <option value="image">{t("画像")}</option>
        </select></label>
        <label>{t("コンポーネント名")}<input ref={nameRef} autoFocus required maxLength={256} value={name}
          onChange={(event) => { setName(event.target.value); setError(""); }} /></label>
        <p className="meta">{t("識別用の名称です。オーバーレイには表示されません。")}</p>
      </div>
      <div className="dialog-actions dialog-actions-split">
        <button type="button" className="ghost" onClick={onClose}>{t("キャンセル")}</button>
        <button type="submit">{t("作成")}</button>
      </div>
    </form>
  </dialog>;
}
