import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { t } from "../i18n";
import { importTonamelParticipants, type TonamelEvent } from "../domain/localRegistrationTonamel";
import type { LocalEventRegistration, RegisteredLocalParticipant } from "../domain/localEventRegistration";

type Props = {
  registration: LocalEventRegistration;
  disabled: boolean;
  onImport: (participants: RegisteredLocalParticipant[], eventName: string) => void;
  onPendingChange: (pending: boolean) => void;
};

export function LocalRegistrationTonamelImport({ registration, disabled, onImport, onPendingChange }: Props) {
  const [open, setOpen] = useState(false);
  useEffect(() => onPendingChange(open), [open, onPendingChange]);
  return <>
    <button type="button" className="ghost" disabled={disabled || open}
      onClick={() => setOpen(true)}>{t("Tonamel取り込み")}</button>
    {open && <TonamelImportDialog registration={registration} onClose={() => setOpen(false)}
      onImport={(participants, eventName) => { onImport(participants, eventName); setOpen(false); }} />}
  </>;
}

function TonamelImportDialog({ registration, onClose, onImport }: {
  registration: LocalEventRegistration;
  onClose: () => void;
  onImport: (participants: RegisteredLocalParticipant[], eventName: string) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [url, setUrl] = useState("");
  const [source, setSource] = useState<TonamelEvent | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  const fetchParticipants = async () => {
    setError(""); setSource(null); setLoading(true);
    try { setSource(await invoke<TonamelEvent>("fetch_tonamel_participants", { url: url.trim() })); }
    catch (cause) { setError(t("Tonamelから取得できませんでした: {error}", { error: String(cause) })); }
    finally { setLoading(false); }
  };
  return <dialog ref={dialogRef} className="dialog-panel twipla-import-dialog" aria-label={t("Tonamel取り込み")}
    onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <form onSubmit={(event) => { event.preventDefault(); if (!loading) void fetchParticipants(); }}>
      <div className="dialog-head"><h3>{t("Tonamel取り込み")}</h3></div>
      <div className="dialog-body">
        <fieldset disabled={loading} className="local-registration-fields twipla-import-fields">
          <label>{t("Tonamelの大会URL")}
            <input type="url" required value={url} placeholder="https://tonamel.com/competition/GGzJP"
              onChange={(event) => { setUrl(event.currentTarget.value); setSource(null); setError(""); }} />
          </label>
          <button type="submit" className="ghost" disabled={!url.trim()}>{t("一覧取得")}</button>
        </fieldset>
        {loading && <p role="status" className="meta">{t("取得中...")}</p>}
        {source !== null && <section aria-label={t("取り込み対象ユーザー")}>
          <p className="meta">{t("event名")}: {source.eventName}</p>
          <h4 aria-live="polite">{t("取り込み対象ユーザー")} ({t("{count} 人", { count: source.users.length })})</h4>
          <div className="twipla-import-users">
            <table className="twipla-import-table" aria-label={t("取り込み対象ユーザー")}>
              <thead><tr><th scope="col">{t("ユーザー名")}</th><th scope="col">{t("参加区分")}</th></tr></thead>
              <tbody>{source.users.map((user) => <tr key={user.id}>
                <td>{user.name}</td><td>{t("出場")}</td>
              </tr>)}</tbody>
            </table>
          </div>
          {source.users.length > 512 && <p role="alert" className="error-text">{t("取り込むユーザーは1〜512人にしてください。")}</p>}
        </section>}
        {error && <p role="alert" className="error-text">{error}</p>}
      </div>
      <div className="dialog-actions dialog-actions-split">
        <button type="button" className="ghost" onClick={onClose}>{t("キャンセル")}</button>
        <button type="button" disabled={loading || !source || source.users.length < 1 || source.users.length > 512}
          onClick={async () => {
            if (!source) return;
            if (registration.participants.length > 0 && !await window.confirm(t("登録済みの参加者を取り込み対象ユーザーで置き換えますか？"))) return;
            try { onImport(importTonamelParticipants(source.users, registration), source.eventName); }
            catch (cause) { setError(String(cause)); }
          }}>{t("取り込み")}</button>
      </div>
    </form>
  </dialog>;
}