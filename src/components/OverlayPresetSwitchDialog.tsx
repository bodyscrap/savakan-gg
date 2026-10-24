import { useEffect, useRef } from "react";
import { t } from "../i18n";

type Props = {
  onConfirm: () => void;
  onDiscard: () => void;
  onCancel: () => void;
};

export function OverlayPresetSwitchDialog({ onConfirm, onDiscard, onCancel }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => { dialog?.close(); };
  }, []);

  return <dialog ref={dialogRef} className="dialog-panel overlay-preset-switch-dialog"
    aria-labelledby="overlay-component-switch-title"
    onKeyDown={(event) => {
      if (event.key === "Escape") { event.preventDefault(); onCancel(); }
    }}
    onCancel={(event) => { event.preventDefault(); onCancel(); }}>
    <div className="dialog-head"><h3 id="overlay-preset-switch-title">{t("未保存の変更があります")}</h3></div>
    <div className="dialog-body">
      <p>{t("別のプリセットを選択する前に、現在の編集内容をどうしますか？")}</p>
    </div>
    <div className="dialog-actions">
      <button type="button" className="ghost" onClick={onCancel}>{t("切り替えをキャンセル")}</button>
      <button type="button" className="ghost" onClick={onDiscard}>{t("破棄して切り替え")}</button>
      <button type="button" onClick={onConfirm}>{t("保存して切り替え")}</button>
    </div>
  </dialog>;
}
