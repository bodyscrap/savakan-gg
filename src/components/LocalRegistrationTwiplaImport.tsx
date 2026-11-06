import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { t } from "../i18n";
import { importTwiplaUsers, selectTwiplaUsers, type TwiplaEvent, type TwiplaStatus } from "../domain/localRegistrationTwipla";
import type { LocalEventRegistration, RegisteredLocalParticipant } from "../domain/localEventRegistration";

type Props = {
  registration: LocalEventRegistration;
  disabled: boolean;
  onImport: (participants: RegisteredLocalParticipant[], eventName: string) => void;
  onPendingChange: (pending: boolean) => void;
};

export function LocalRegistrationTwiplaImport({ registration, disabled, onImport, onPendingChange }: Props) {
  const [open, setOpen] = useState(false);
  useEffect(() => onPendingChange(open), [open, onPendingChange]);
  return <>
    <button type="button" className="ghost" disabled={disabled || open}
      onClick={() => setOpen(true)}>{t("Twipla取り込み")}</button>
    {open && <TwiplaImportDialog registration={registration} onClose={() => setOpen(false)}
      onImport={(participants, eventName) => { onImport(participants, eventName); setOpen(false); }} />}
  </>;
}

function TwiplaImportDialog({ registration, onClose, onImport }: {
  registration: LocalEventRegistration;
  onClose: () => void;
  onImport: (participants: RegisteredLocalParticipant[], eventName: string) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [url, setUrl] = useState("");
  const [statuses, setStatuses] = useState<TwiplaStatus[]>(["attending"]);
  const [source, setSource] = useState<TwiplaEvent | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  const selected = selectTwiplaUsers(source?.users ?? [], statuses);
  const statusOptions: Array<{ value: TwiplaStatus; label: string }> = [
    { value: "attending", label: t("参加者") },
    { value: "interested", label: t("興味あり") },
    { value: "notAttending", label: t("不参加") },
  ];
  const fetchUsers = async () => {
    setError(""); setSource(null); setLoading(true);
    try { setSource(await invoke<TwiplaEvent>("fetch_twipla_users", { url: url.trim() })); }
    catch (cause) { setError(t("Twiplaから取得できませんでした: {error}", { error: String(cause) })); }
    finally { setLoading(false); }
  };
  return <dialog ref={dialogRef} className="dialog-panel twipla-import-dialog" aria-label={t("Twipla取り込み")}
    onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <form onSubmit={(event) => { event.preventDefault(); if (!loading) void fetchUsers(); }}>
      <div className="dialog-head"><h3>{t("Twipla取り込み")}</h3></div>
      <div className="dialog-body">
        <fieldset disabled={loading} className="local-registration-fields twipla-import-fields">
          <label>{t("TwiplaのイベントURL")}
            <input type="url" required value={url} placeholder="https://twipla.jp/events/123456"
              onChange={(event) => { setUrl(event.currentTarget.value); setSource(null); setError(""); }} />
          </label>
          <fieldset className="twipla-import-statuses">
            <legend>{t("取り込むユーザー属性")}</legend>
            {statusOptions.map((option) => <label key={option.value} className="setting-checkbox">
              <input type="checkbox" checked={statuses.includes(option.value)} onChange={(event) => {
                setStatuses(event.currentTarget.checked ? [...statuses, option.value] : statuses.filter((status) => status !== option.value));
                setError("");
              }} />{option.label}
            </label>)}
          </fieldset>
          <button type="submit" className="ghost" disabled={!url.trim() || statuses.length === 0}>{t("一覧取得")}</button>
        </fieldset>
        {loading && <p role="status" className="meta">{t("取得中...")}</p>}
        {source !== null && <section aria-label={t("取り込み対象ユーザー")}>
          <p className="meta">{t("event名")}: {source.eventName}</p>
          <h4 aria-live="polite">{t("取り込み対象ユーザー")} ({t("{count} 人", { count: selected.length })})</h4>
          <div className="twipla-import-users">
            <table className="twipla-import-table" aria-label={t("取り込み対象ユーザー")}>
              <thead><tr><th scope="col">{t("ユーザー名")}</th><th scope="col">{t("参加区分")}</th></tr></thead>
              <tbody>{selected.map((user) => <tr key={user.id}>
                <td>{user.name}</td><td>{statusOptions.find((option) => option.value === user.status)?.label}</td>
              </tr>)}</tbody>
            </table>
          </div>
          {selected.length === 0 && <p role="status" className="meta">{t("選択した属性のユーザーはいません。")}</p>}
          {selected.length > 512 && <p role="alert" className="error-text">{t("取り込むユーザーは1〜512人にしてください。")}</p>}
        </section>}
        {error && <p role="alert" className="error-text">{error}</p>}
      </div>
      <div className="dialog-actions dialog-actions-split">
        <button type="button" className="ghost" onClick={onClose}>{t("キャンセル")}</button>
        <button type="button" disabled={loading || selected.length < 1 || selected.length > 512 || statuses.length === 0}
          onClick={async () => {
            if (!source) return;
            if (registration.participants.length > 0 && !await window.confirm(t("登録済みの参加者を取り込み対象ユーザーで置き換えますか？"))) return;
            try { onImport(importTwiplaUsers(selected, registration), source.eventName); }
            catch (cause) { setError(String(cause)); }
          }}>{t("取り込み")}</button>
      </div>
    </form>
  </dialog>;
}