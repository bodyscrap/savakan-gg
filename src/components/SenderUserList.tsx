import { t } from "../i18n";
import type { SenderUserListEntry } from "../hooks/useSenderUserList";

type SenderUserListProps = {
  localUser: SenderUserListEntry;
  senderUsers: SenderUserListEntry[];
  senderUserIdDraft: string;
  onSenderUserIdChange: (value: string) => void;
  onRandomizeSenderUserId: () => void;
  onSaveSenderProfile: () => void;
  canSaveSenderProfile: boolean;
  onRefresh: () => void;
  onBackToSettings: () => void;
};

export function SenderUserList({
  localUser,
  senderUsers,
  senderUserIdDraft,
  onSenderUserIdChange,
  onRandomizeSenderUserId,
  onSaveSenderProfile,
  canSaveSenderProfile,
  onRefresh,
  onBackToSettings,
}: SenderUserListProps) {
  const users = [
    { ...localUser, key: "local-user", isLocal: true },
    ...senderUsers.map((user) => ({
      ...user,
      key: `${user.senderUserId}-${user.senderIp}`,
      isLocal: false,
    })),
  ];
  const idCounts = new Map<string, number>();
  for (const user of users) {
    if (user.senderUserId !== "") {
      idCounts.set(user.senderUserId, (idCounts.get(user.senderUserId) ?? 0) + 1);
    }
  }
  const duplicateIds = new Set(
    [...idCounts].filter(([, count]) => count > 1).map(([senderUserId]) => senderUserId),
  );

  return (
    <>
      <section className="panel">
        <div className="panel-toolbar compact">
          <h2>{t("ユーザー一覧")}</h2>
          <div className="sender-user-list-actions">
            <button type="button" className="ghost" onClick={onBackToSettings}>{t("設定に戻る")}</button>
            <button type="button" onClick={onRefresh}>{t("更新")}</button>
          </div>
        </div>
        <p className="meta">{t("更新ボタンで問い合わせ、1秒以内に応答したユーザーを表示します。")}</p>
        <p className={duplicateIds.size > 0 ? "meta meta-attention" : "meta"}>
          {duplicateIds.size > 0
            ? t("ユーザーIDが重複しています。重複しているユーザーは赤字で表示されます。")
            : t("ユーザーIDの重複はありません。")}
        </p>
      </section>

      <section className="panel sender-user-list-panel">
        <div className="sender-user-list-table-wrap">
          <table className="sender-user-list-table">
            <thead>
              <tr>
                <th scope="col">{t("送信者名")}</th>
                <th scope="col">{t("ユーザーID")}</th>
                <th scope="col">IP</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => {
                const duplicate = duplicateIds.has(user.senderUserId);
                return (
                  <tr
                    key={user.key}
                    className={duplicate ? "sender-user-entry-duplicate" : ""}
                  >
                    <td>
                      {user.senderName || t("未設定")}
                      {user.isLocal && <span className="meta">{t(" (この端末)")}</span>}
                    </td>
                    <td>
                      {user.isLocal ? (
                        <div className="sender-user-id-editor">
                          <input
                            aria-label={t("この端末のユーザーID")}
                            className={duplicate ? "sender-user-id-input duplicate" : "sender-user-id-input"}
                            value={senderUserIdDraft}
                            onChange={(event) => onSenderUserIdChange(event.currentTarget.value)}
                            inputMode="numeric"
                            maxLength={8}
                          />
                          <button
                            type="button"
                            className="ghost"
                            onClick={onRandomizeSenderUserId}
                          >{t("ランダム決定")}</button>
                          <button
                            type="button"
                            onClick={onSaveSenderProfile}
                            disabled={!canSaveSenderProfile}
                          >{t("保存")}</button>
                        </div>
                      ) : user.senderUserId}
                    </td>
                    <td>{user.senderIp || t("未設定")}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
