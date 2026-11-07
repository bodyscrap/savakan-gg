import { useEffect, useRef, useState } from "react";
import { t } from "../i18n";
import { FREE_TEXT_LIST_ID } from "../domain/itemList";
import { importRegistrationCsv, parseRegistrationCsv, type RegistrationCsv, type RegistrationCsvMapping } from "../domain/localRegistrationCsv";
import { registrationCategorySlots, type LocalEventRegistration, type RegisteredLocalParticipant } from "../domain/localEventRegistration";
import { playerListCsvCategoryHeader } from "../domain/playerListCsv";

type Props = {
  registration: LocalEventRegistration;
  disabled: boolean;
  onImport: (participants: RegisteredLocalParticipant[], eventName: string) => void;
  onPendingChange: (pending: boolean) => void;
};

export function LocalRegistrationCsvImport({ registration, disabled, onImport, onPendingChange }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState<{ csv: RegistrationCsv; fileName: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => onPendingChange(loading || source !== null), [loading, source, onPendingChange]);
  return <>
    <button type="button" className="ghost" disabled={disabled || loading}
      onClick={() => inputRef.current?.click()}>{t("CSV取り込み")}</button>
    <input ref={inputRef} type="file" accept=".csv,text/csv" hidden onChange={(event) => {
      const file = event.currentTarget.files?.[0];
      event.currentTarget.value = "";
      if (!file) return;
      setError(""); setLoading(true);
      void file.text().then((text) => {
        setSource({ csv: parseRegistrationCsv(text), fileName: file.name });
      }).catch((cause: unknown) => {
        setError(t("CSVを読み込めませんでした: {error}", { error: String(cause) }));
      }).finally(() => setLoading(false));
    }} />
    {error && <p role="alert" className="error-text">{error}</p>}
    {source && <CsvMappingDialog csv={source.csv} fileName={source.fileName} registration={registration}
      onClose={() => setSource(null)} onImport={(participants, eventName) => {
        onImport(participants, eventName);
        setSource(null);
      }} />}
  </>;
}

function CsvMappingDialog({ csv, fileName, registration, onClose, onImport }: {
  csv: RegistrationCsv; fileName: string; registration: LocalEventRegistration;
  onClose: () => void; onImport: (participants: RegisteredLocalParticipant[], eventName: string) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [mapping, setMapping] = useState<RegistrationCsvMapping>({ name: -1, categories: [null, null, null], skill: null });
  const [error, setError] = useState("");
  const [prefixDate, setPrefixDate] = useState(false);
  const now = new Date();
  const date = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, "0"), String(now.getDate()).padStart(2, "0")].join("-");
  const eventName = `${prefixDate ? `${date} ` : ""}${fileName.replace(/\.csv$/i, "")}`;
  const slots = registrationCategorySlots(registration.setting);
  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  const columnOptions = csv.headers.map((header, index) =>
    <option key={index} value={index}>{index + 1}. {header}</option>);
  return <dialog ref={dialogRef} className="dialog-panel csv-import-dialog" aria-label={t("CSV取り込み設定")}
    onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <form onSubmit={(event) => {
      event.preventDefault();
      try { onImport(importRegistrationCsv(csv, mapping, registration), eventName); }
      catch (cause) { setError(String(cause)); }
    }}>
      <div className="dialog-head"><h3>{t("CSV取り込み設定")}</h3></div>
      <div className="dialog-body">
        <p>{fileName} ({t("{count} 人", { count: csv.rows.length })})</p>
        <p className="meta">{t("取り込むと既存の参加登録をすべて置き換え、CSVファイル名（拡張子なし）をevent名に設定します。")}</p>
        <label className="setting-checkbox">
          <input type="checkbox" checked={prefixDate}
            onChange={(event) => setPrefixDate(event.currentTarget.checked)} />
          {t("event名の先頭に日付を付ける")}
        </label>
        <p className="meta">{t("event名")}: {eventName}</p>
        <div className="csv-import-columns">
          <label>{t("プレイヤー名")}<select required value={mapping.name} onChange={(event) =>
            setMapping({ ...mapping, name: Number(event.currentTarget.value) })}>
            <option value={-1} disabled>{t("カラムを選択")}</option>{columnOptions}
          </select></label>
          <label>{t("Skill Tier")}<select value={mapping.skill ?? ""}
            onChange={(event) => setMapping({ ...mapping, skill: event.currentTarget.value === "" ? null : Number(event.currentTarget.value) })}>
            <option value="">{t("割り当てなし")}</option>{columnOptions}
          </select></label>
          {slots.map((slot) => {
            const index = slot.slotIndex;
            const label = slot && slot.list.id !== FREE_TEXT_LIST_ID
              ? playerListCsvCategoryHeader({ ...slot.list, slotIndex: index })
              : `${t("カテゴリ{value1}", { value1: index + 1 })} (${slot.list.name})`;
            return <label key={index}>{label}
              <select value={mapping.categories[index] ?? ""} onChange={(event) => {
                const value = event.currentTarget.value === "" ? null : Number(event.currentTarget.value);
                setMapping((current) => ({ ...current, categories: current.categories.map((column, slotIndex) =>
                  slotIndex === index ? value : column) }));
              }}>
                <option value="">{t("割り当てなし")}</option>{slot && columnOptions}
              </select>
            </label>;
          })}
        </div>
        <p className="meta">{t("カテゴリ欄は改行・カンマで分割し、対象リストに完全一致するアイテムだけ取り込みます。未一致は未設定になります。選択条件を満たさない参加者は取り込み後に編集してください。")}</p>
        {error && <p role="alert" className="error-text">{error}</p>}
      </div>
      <div className="dialog-actions dialog-actions-split">
        <button type="button" className="ghost" onClick={onClose}>{t("キャンセル")}</button>
        <button type="submit" disabled={mapping.name < 0}>{t("取り込み")}</button>
      </div>
    </form>
  </dialog>;
}
