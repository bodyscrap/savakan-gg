export type SettingsNetworkCandidate = {
  key: string;
  label: string;
};

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
  normalizedBindIp: string;
  normalizedSubnetMask: string;
  senderSettingsStatus: string;
  onRefreshNetworkCandidates: () => void;
  onRandomizeSenderUserId: () => void;
  onSaveSenderProfile: () => void;
  canSaveSenderProfile: boolean;
  startggFetchPerPage: number;
  onStartggFetchPerPageChange: (value: string) => void;
  onStartggFetchPerPageBlur: (value: string) => void;
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
  callListRotateSecondsDisplay: number;
  callListColorToRedSeconds: number;
  hasCallListMessages: boolean;
  onClearCallList: () => void;
  hasMessages: boolean;
  onForceClearMessages: () => void;
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
  normalizedBindIp,
  normalizedSubnetMask,
  senderSettingsStatus,
  onRefreshNetworkCandidates,
  onRandomizeSenderUserId,
  onSaveSenderProfile,
  canSaveSenderProfile,
  startggFetchPerPage,
  onStartggFetchPerPageChange,
  onStartggFetchPerPageBlur,
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
  callListRotateSecondsDisplay,
  callListColorToRedSeconds,
  hasCallListMessages,
  onClearCallList,
  hasMessages,
  onForceClearMessages,
}: SettingsScreenProps) {
  return (
    <>
      <section className="panel">
        <h2>送信者設定</h2>
        <p className="meta">各クライアントを識別するための送信者名と8桁ユーザーIDを設定します。</p>
        <p className="meta">IPとサブネットマスクは選択したネットワークデバイスから自動反映されます。個別調整はOS側のネットワーク設定で行ってください。</p>
        <p className="meta">ユーザーIDはクライアント間で重複しないよう運用してください。ランダム決定ボタンで簡単に採番できます。</p>
        <p className="meta">注意: 運用開始後（メッセージ履歴あり）に送信者名/IDを変更する場合は、先にメッセージボックスの強制クリア実行を推奨します（最終実行はユーザー操作）。</p>

        <label className="checkbox-row" style={{ marginTop: "0.6rem" }}>
          <input
            type="checkbox"
            checked={disableLocalCommunication}
            onChange={(event) => onDisableLocalCommunicationChange(event.currentTarget.checked)}
          />
          ローカル通信を行わない
        </label>
        <p className="meta">
          ON中はメッセージ機能とプレイヤーリストの送受信系操作を無効化します。既存データの閲覧は可能です。解決・スレッド削除は不可ですが、下部の「メッセージボックスを強制クリア」は実行できます。
        </p>

        <div className="form" style={{ marginTop: "0.65rem" }}>
          <label htmlFor="sender-name-input" style={{ display: "grid", gap: "0.3rem" }}>
            <span className="meta">送信者名</span>
            <input
              id="sender-name-input"
              value={senderNameDraft}
              onChange={(e) => onSenderNameChange(e.currentTarget.value)}
              placeholder="例: 配信PC-A"
            />
          </label>
          <label htmlFor="sender-user-id-input" style={{ display: "grid", gap: "0.3rem" }}>
            <span className="meta">ユーザーID (8桁数字)</span>
            <input
              id="sender-user-id-input"
              value={senderUserIdDraft}
              onChange={(e) => onSenderUserIdChange(e.currentTarget.value)}
              placeholder="例: 12345678"
              inputMode="numeric"
              maxLength={8}
            />
          </label>
          <label htmlFor="sender-network-device-select" style={{ display: "grid", gap: "0.3rem" }}>
            <span className="meta">ネットワークデバイス</span>
            <select
              id="sender-network-device-select"
              value={selectedNetworkCandidateKey}
              onChange={(e) => onNetworkCandidateChange(e.currentTarget.value)}
              disabled={networkCandidatesLoading || networkCandidates.length === 0}
            >
              {networkCandidates.length === 0 ? (
                <option value="">利用可能なデバイスがありません</option>
              ) : (
                networkCandidates.map((candidate) => (
                  <option key={candidate.key} value={candidate.key}>{candidate.label}</option>
                ))
              )}
            </select>
          </label>
          <p className="meta" style={{ margin: 0 }}>
            適用中IP: {normalizedBindIp || "(未選択)"} / サブネット: {normalizedSubnetMask || "(未選択)"}
          </p>
        </div>

        <div className="panel-toolbar compact">
          <p className="meta">{senderSettingsStatus}</p>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button
              type="button"
              className="ghost"
              onClick={onRefreshNetworkCandidates}
              disabled={networkCandidatesLoading}
            >
              {networkCandidatesLoading ? "デバイス検索中..." : "デバイス再検索"}
            </button>
            <button type="button" className="ghost" onClick={onRandomizeSenderUserId}>
              ランダム決定
            </button>
            <button type="button" onClick={onSaveSenderProfile} disabled={!canSaveSenderProfile}>
              保存
            </button>
          </div>
        </div>
      </section>

      <section className="panel">
        <h2>start.gg取得設定</h2>
        <p className="meta">イベント取得・更新時の1ページあたり件数です。通常は既定値のままで問題ありません。</p>

        <div className="form" style={{ marginTop: "0.6rem" }}>
          <label htmlFor="startgg-fetch-per-page-input" style={{ display: "grid", gap: "0.3rem" }}>
            <span className="meta">1ページ件数 (1以上 / 既定値: 50)</span>
            <input
              id="startgg-fetch-per-page-input"
              type="number"
              min={1}
              step={1}
              value={startggFetchPerPage}
              onChange={(e) => onStartggFetchPerPageChange(e.currentTarget.value)}
              onBlur={(e) => onStartggFetchPerPageBlur(e.currentTarget.value)}
            />
          </label>
        </div>

        <p className="meta">現在値: {startggFetchPerPage} 件</p>
      </section>

      <section className="panel">
        <h2>スマホ入力同期設定</h2>
        <p className="meta">スマホ入力画面とブラケット画面の自動更新間隔をミリ秒で設定します。</p>

        <div className="form" style={{ marginTop: "0.6rem" }}>
          <label htmlFor="mobile-input-polling-ms-input" style={{ display: "grid", gap: "0.3rem" }}>
            <span className="meta">ポーリング周期 (ms / 500-10000 / 既定値: 1500)</span>
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

        <p className="meta">現在値: {mobileInputPollingMs} ms</p>
        <p className="meta">次回URL発行時にスマホ側へ同じ周期を配布します。</p>
      </section>

      <section className="panel">
        <h2>呼び出しリスト表示設定</h2>
        <p className="meta">呼び出しリストのページ切替間隔と、カード色が赤になるまでの時間を秒単位で設定します。</p>

        <div className="form" style={{ marginTop: "0.6rem" }}>
          <label htmlFor="call-list-rotate-seconds-input" style={{ display: "grid", gap: "0.3rem" }}>
            <span className="meta">切替間隔 (秒 / 1-180)</span>
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
            <span className="meta">赤化までの時間 (秒 / 30-3600)</span>
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
        </div>

        <p className="meta">現在値: {callListRotateSecondsDisplay} 秒</p>
        <p className="meta">赤化まで: {callListColorToRedSeconds} 秒</p>
      </section>

      <section className="panel">
        <h2>呼び出しリスト管理</h2>
        <p className="meta">他PCの切断や大会切替に備えて、表示中の呼び出しリストを初期化できます。</p>
        <p className="meta">全クリア後は現在保持している呼び出しデータから再描画します（メッセージは削除しません）。</p>

        <div className="panel-toolbar compact">
          <p className="meta">過去大会の呼び出し残りが表示される場合に実行してください。</p>
          <button type="button" className="ghost" onClick={onClearCallList} disabled={!hasCallListMessages}>
            呼び出し一覧を全クリア
          </button>
        </div>
      </section>

      <section className="panel">
        <h2>メッセージボックス管理</h2>
        <p className="meta">危険操作: 保存済みメッセージを含む全メッセージを強制削除します。</p>
        <p className="meta">確認ダイアログと確認文字入力の後に実行され、元に戻せません。</p>

        <div className="panel-toolbar compact">
          <p className="meta">不整合解消や初期化が必要な場合のみ実行してください。</p>
          <button type="button" className="ghost" onClick={onForceClearMessages} disabled={!hasMessages}>
            メッセージボックスを強制クリア
          </button>
        </div>
      </section>
    </>
  );
}