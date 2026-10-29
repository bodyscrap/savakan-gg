import { t } from "../i18n";
import type { UserCardPlayer } from "../hooks/userCardCanvas";

export type { UserCardPlayer } from "../hooks/userCardCanvas";

type PlayerListInfoProps = {
  disableLocalCommunication: boolean;
  userCardBusy: boolean;
  hasSelectedEvent: boolean;
  selectedEventLabel: string;
  players: UserCardPlayer[];
  selectedPlayerIds: string[];
  selectedPlayer: UserCardPlayer | null;
  selectedPlayerPreviewUrl: string;
  onSaveSelectedCard: () => void;
  onExportA4Sheet: () => void;
  onExportCsv: () => void;
  onSelectAllPlayers: () => void;
  onClearPlayerSelection: () => void;
  onSelectPlayer: (player: UserCardPlayer, multiSelect: boolean) => void;
};

export function PlayerListInfo({
  disableLocalCommunication,
  userCardBusy,
  hasSelectedEvent,
  selectedEventLabel,
  players,
  selectedPlayerIds,
  selectedPlayer,
  selectedPlayerPreviewUrl,
  onSaveSelectedCard,
  onExportA4Sheet,
  onExportCsv,
  onSelectAllPlayers,
  onClearPlayerSelection,
  onSelectPlayer,
}: PlayerListInfoProps) {
  return (
    <>
      <section className="panel">
        <h2>{t("プレイヤーリストの出力")}</h2>
        {disableLocalCommunication && (
          <p className="meta meta-attention">{t("ローカル通信OFF中のため、プレイヤーリスト機能は停止中です。")}</p>
        )}
        {!hasSelectedEvent ? (
          <p className="meta">{t("ホームの大会一覧からイベントを選択してください。")}</p>
        ) : (
          <>
            <p className="meta">{t("対象イベント: {value1} / プレイヤー数: {value2}", { value1: selectedEventLabel, value2: players.length })}</p>

            <div className="form" style={{ marginTop: "0.65rem" }}>
              <button
                type="button"
                disabled={disableLocalCommunication || userCardBusy || !selectedPlayer}
                onClick={onSaveSelectedCard}
              >{t("選択カードを保存")}</button>
              <button
                type="button"
                className="ghost"
                disabled={disableLocalCommunication || userCardBusy || players.length === 0}
                onClick={onExportA4Sheet}
              >{t("A4シートを作成")}</button>
              <button
                type="button"
                className="ghost"
                disabled={disableLocalCommunication || userCardBusy || players.length === 0}
                onClick={onExportCsv}
              >{t("CSVで出力")}</button>
            </div>
          </>
        )}
      </section>

      {hasSelectedEvent && (
        <section className="panel users-grid-panel">
          <section className="users-player-list">
            <div className="users-player-list-head">
              <h3>{t("プレイヤー一覧")}</h3>
              <button
                type="button"
                className="ghost"
                disabled={disableLocalCommunication || userCardBusy || players.length === 0}
                onClick={onSelectAllPlayers}
              >{t("全選択")}</button>
              <button
                type="button"
                className="ghost"
                disabled={disableLocalCommunication || userCardBusy || selectedPlayerIds.length === 0}
                onClick={onClearPlayerSelection}
              >{t("全解除")}</button>
            </div>
            {players.length === 0 ? (
              <p className="meta">{t("プレイヤーが存在しません。")}</p>
            ) : (
              <div className="event-list player-list-scroll enabled">
                {players.map((player) => {
                  const selected = selectedPlayerIds.includes(player.playerId);
                  return (
                    <article
                      key={`${player.eventId}-${player.entrantId}`}
                      className={`event-list-item user-card-entry ${selected ? "selected" : ""}`}
                      role="button"
                      tabIndex={0}
                      onClick={(event) => onSelectPlayer(player, event.ctrlKey || event.metaKey)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          onSelectPlayer(player, false);
                        }
                      }}
                    >
                      <h4>{player.entrantName}</h4>
                      <p className="meta user-id">{t("Skill Tier")}: {player.skill ?? t("未設定")} / Player ID: {player.playerId}</p>
                    </article>
                  );
                })}
              </div>
            )}
          </section>

          <section className="users-card-preview">
            <h3>{t("プレイヤーカードプレビュー")}</h3>
            {!selectedPlayer || selectedPlayerPreviewUrl === "" ? (
              <p className="meta">{t("プレイヤーを選択してください。")}</p>
            ) : (
              <>
                <p className="meta">{selectedPlayer.entrantName} / {selectedPlayer.playerId}</p>
                <img
                  className="player-card-preview-image"
                  src={selectedPlayerPreviewUrl}
                  alt={`${selectedPlayer.entrantName} player card`}
                />
              </>
            )}
          </section>
        </section>
      )}
    </>
  );
}