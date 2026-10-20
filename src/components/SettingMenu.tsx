import { t, useLanguage, setLanguage } from "../i18n";
export type SettingsNetworkCandidate = {
  key: string;
  label: string;
};

const REFRESH_NETWORK_CANDIDATES_OPTION = "__refresh_network_candidates__";

type SettingsScreenProps = {
  disableLocalCommunication: boolean;
  onDisableLocalCommunicationChange: (checked: boolean) => void;
  senderNameDraft: string;
  onSenderNameChange: (value: string) => void;
  senderUserIdDraft: string;
  onSenderUserIdChange: (value: string) => void;
  networkCandidates: SettingsNetworkCandidate[];
  selectedNetworkCandidateKey: string;
  onNetworkCandidateChange: (key: string) => void;
  networkCandidatesLoading: boolean;
  senderSettingsStatus: string;
  onRefreshNetworkCandidates: () => void;
  onRandomizeSenderUserId: () => void;
  onOpenSenderUserList: () => void;
  onSaveSenderProfile: () => void;
  onCancelSenderProfile: () => void;
  canSaveSenderProfile: boolean;
  canCancelSenderProfile: boolean;
  mobileInputPollingMs: number;
  mobileInputPollingMsMin: number;
  mobileInputPollingMsMax: number;
  onMobileInputPollingMsChange: (value: string) => void;
  onMobileInputPollingMsBlur: (value: string) => void;
  callListPageRotateSeconds: number;
  callListRotateSecondsMin: number;
  callListRotateSecondsMax: number;
  onCallListPageRotateSecondsChange: (value: string) => void;
  onCallListPageRotateSecondsBlur: (value: string) => void;
  callListColorSeconds: number;
  callListColorSecondsMin: number;
  callListColorSecondsMax: number;
  onCallListColorSecondsChange: (value: string) => void;
  onCallListColorSecondsBlur: (value: string) => void;
  hasCallListMessages: boolean;
  onClearCallList: () => void;
  disableOwnCallActions: boolean;
  onDisableOwnCallActionsChange: (checked: boolean) => void;
  disableOtherCallActions: boolean;
  onDisableOtherCallActionsChange: (checked: boolean) => void;
};

export function SettingsScreen({
  disableLocalCommunication,
  onDisableLocalCommunicationChange,
  senderNameDraft,
  onSenderNameChange,
  senderUserIdDraft,
  onSenderUserIdChange,
  networkCandidates,
  selectedNetworkCandidateKey,
  onNetworkCandidateChange,
  networkCandidatesLoading,
  senderSettingsStatus,
  onRefreshNetworkCandidates,
  onRandomizeSenderUserId,
  onOpenSenderUserList,
  onSaveSenderProfile,
  onCancelSenderProfile,
  canSaveSenderProfile,
  canCancelSenderProfile,
  mobileInputPollingMs,
  mobileInputPollingMsMin,
  mobileInputPollingMsMax,
  onMobileInputPollingMsChange,
  onMobileInputPollingMsBlur,
  callListPageRotateSeconds,
  callListRotateSecondsMin,
  callListRotateSecondsMax,
  onCallListPageRotateSecondsChange,
  onCallListPageRotateSecondsBlur,
  callListColorSeconds,
  callListColorSecondsMin,
  callListColorSecondsMax,
  onCallListColorSecondsChange,
  onCallListColorSecondsBlur,
  hasCallListMessages,
  onClearCallList,
  disableOwnCallActions,
  onDisableOwnCallActionsChange,
  disableOtherCallActions,
  onDisableOtherCallActionsChange,
}: SettingsScreenProps) {
  const language = useLanguage();
  return (
    <>
      <section className="panel">
        <label htmlFor="ui-language-select">
          <span className="meta">{t("言語 / Language")}</span>
          <select
            id="ui-language-select"
            value={language}
            onChange={(event) => {
              const value = event.currentTarget.value;
              if (value === "ja" || value === "en") {
                setLanguage(value);
              }
            }}
          >
            <option value="ja">{t("日本語")}</option>
            <option value="en">English</option>
          </select>
        </label>
      </section>
      <section className="panel sender-profile-panel">
        <h2>{t("送信者設定")}</h2>

        <label className="checkbox-row" style={{ marginTop: "0.6rem" }}>
          <input
            type="checkbox"
            checked={disableLocalCommunication}
            onChange={(event) => onDisableLocalCommunicationChange(event.currentTarget.checked)}
          />{t("ローカル通信を行わない")}</label>
        <p className="meta">{t("ON中は呼び出し・DQ申請・外部報告とプレイヤーリストの送受信を無効化します。既存データの閲覧は可能ですが、呼び出しの解決や申請への応答はできません。")}</p>

        <div className="form sender-profile-form" style={{ marginTop: "0.65rem" }}>
          <label htmlFor="sender-name-input" style={{ display: "grid", gap: "0.3rem" }}>
            <span className="meta">{t("送信者名")}</span>
            <input
              id="sender-name-input"
              value={senderNameDraft}
              onChange={(e) => onSenderNameChange(e.currentTarget.value)}
              placeholder={t("例: 配信PC-A")}
            />
          </label>
          <div className="sender-id-actions">
            <label htmlFor="sender-user-id-input" className="meta sender-user-id-title">{t("ユーザーID (8桁数字。端末間重複不可)")}</label>
            <div className="sender-id-controls">
              <input
                id="sender-user-id-input"
                className="sender-user-id-input"
                value={senderUserIdDraft}
                onChange={(e) => onSenderUserIdChange(e.currentTarget.value)}
                placeholder={t("例: 12345678")}
                inputMode="numeric"
                maxLength={8}
              />
              <button type="button" className="ghost" onClick={onRandomizeSenderUserId}>{t("ランダム決定")}</button>
              <button type="button" className="ghost" onClick={onOpenSenderUserList}>{t("ユーザー一覧")}</button>
            </div>
          </div>
          <div style={{ display: "grid", gap: "0.3rem" }}>
            <label htmlFor="sender-network-device-select" className="meta">{t("ネットワークデバイス")}</label>
            <div className="sender-network-device-row">
              <select
                id="sender-network-device-select"
                value={selectedNetworkCandidateKey}
                onChange={(e) => {
                  const selectedValue = e.currentTarget.value;
                  if (selectedValue === REFRESH_NETWORK_CANDIDATES_OPTION) {
                    onRefreshNetworkCandidates();
                    return;
                  }
                  onNetworkCandidateChange(selectedValue);
                }}
                disabled={networkCandidatesLoading}
              >
                <option value={REFRESH_NETWORK_CANDIDATES_OPTION}>
                  {networkCandidatesLoading ? t("デバイス検索中...") : t("デバイスの再検索")}
                </option>
                {networkCandidates.length === 0 ? (
                  <option value="">{t("利用可能なデバイスがありません")}</option>
                ) : (
                  networkCandidates.map((candidate) => (
                    <option key={candidate.key} value={candidate.key}>
                      {candidate.key === selectedNetworkCandidateKey ? "✓ " : ""}{candidate.label}
                    </option>
                  ))
                )}
              </select>
              <button type="button" onClick={onSaveSenderProfile} disabled={!canSaveSenderProfile}>{t("保存")}</button>
              <button
                type="button"
                className="ghost"
                onClick={onCancelSenderProfile}
                disabled={!canCancelSenderProfile}
              >{t("キャンセル")}</button>
            </div>
          </div>
        </div>

        {senderSettingsStatus && <p className="meta">{t(senderSettingsStatus)}</p>}
      </section>

      <section className="panel">
        <h2>{t("スマートフォン入力同期設定")}</h2>
        <p className="meta">{t("スマートフォン入力画面とブラケット画面の自動更新間隔をミリ秒で設定します。")}</p>

        <div className="form mobile-input-settings-form" style={{ marginTop: "0.6rem" }}>
          <label htmlFor="mobile-input-polling-ms-input" style={{ display: "grid", gap: "0.3rem" }}>
            <span className="meta setting-field-title">
              <span>{t("ポーリング周期 (ms / 500-10000 / 既定値: 1500)")}</span>
            </span>
            <input
              id="mobile-input-polling-ms-input"
              type="number"
              min={mobileInputPollingMsMin}
              max={mobileInputPollingMsMax}
              step={100}
              value={mobileInputPollingMs}
              onChange={(e) => onMobileInputPollingMsChange(e.currentTarget.value)}
              onBlur={(e) => onMobileInputPollingMsBlur(e.currentTarget.value)}
            />
          </label>
        </div>

      </section>

      <section className="panel">
        <h2>{t("呼出リスト設定")}</h2>
        <p className="meta">{t("呼び出しリストのページ切替間隔と、カード色が赤になるまでの時間を秒単位で設定します。")}</p>

        <div className="form call-list-settings-form" style={{ marginTop: "0.6rem" }}>
          <label htmlFor="call-list-rotate-seconds-input" style={{ display: "grid", gap: "0.3rem" }}>
            <span className="meta setting-field-title">
              <span>{t("切替間隔 (秒 / 1-180)")}</span>
            </span>
            <input
              id="call-list-rotate-seconds-input"
              type="number"
              min={callListRotateSecondsMin}
              max={callListRotateSecondsMax}
              step={1}
              value={callListPageRotateSeconds}
              onChange={(e) => onCallListPageRotateSecondsChange(e.currentTarget.value)}
              onBlur={(e) => onCallListPageRotateSecondsBlur(e.currentTarget.value)}
            />
          </label>
          <label htmlFor="call-list-color-seconds-input" style={{ display: "grid", gap: "0.3rem" }}>
            <span className="meta setting-field-title">
              <span>{t("赤化までの時間 (秒 / 30-3600)")}</span>
            </span>
            <input
              id="call-list-color-seconds-input"
              type="number"
              min={callListColorSecondsMin}
              max={callListColorSecondsMax}
              step={1}
              value={callListColorSeconds}
              onChange={(e) => onCallListColorSecondsChange(e.currentTarget.value)}
              onBlur={(e) => onCallListColorSecondsBlur(e.currentTarget.value)}
            />
          </label>
          <div className="call-list-settings-actions">
            <button type="button" className="ghost" onClick={onClearCallList} disabled={!hasCallListMessages}>{t("呼び出しリストの表示を初期化")}</button>
            <p className="meta call-list-sync-note">{t("他端末の呼び出しを最新化する場合は、呼び出しリスト画面の「呼び出しの同期」を使用してください。")}</p>
          </div>
        </div>

        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={disableOwnCallActions}
            onChange={(event) => onDisableOwnCallActionsChange(event.currentTarget.checked)}
          />{t("自端末呼び出しへのアクション禁止")}</label>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={disableOtherCallActions}
            onChange={(event) => onDisableOtherCallActionsChange(event.currentTarget.checked)}
          />{t("他端末呼び出しへのアクション禁止")}</label>
        <p className="meta">{t("有効にすると、該当する呼び出しカードをクリックしても操作できません。掲示専用端末での誤操作防止に使用してください。")}</p>
      </section>

    </>
  );
}