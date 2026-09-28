import type { UserCardPlayer } from "./userCardCanvas";

export type { UserCardPlayer } from "./userCardCanvas";

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
  onSelectAllPlayers,
  onClearPlayerSelection,
  onSelectPlayer,
}: PlayerListInfoProps) {
  return (
    <>
      <section className="panel">
        <h2>プレイヤーリストの出力</h2>
        {disableLocalCommunication && (
          <p className="meta meta-attention">ローカル通信OFF中のため、プレイヤーリスト機能は停止中です。</p>
        )}
        {!hasSelectedEvent ? (
          <p className="meta">ホームの大会一覧からイベントを選択してください。</p>
        ) : (
          <>
            <p className="meta">対象イベント: {selectedEventLabel} / プレイヤー数: {players.length}</p>

            <div className="form" style={{ marginTop: "0.65rem" }}>
              <button
                type="button"
                disabled={disableLocalCommunication || userCardBusy || !selectedPlayer}
                onClick={onSaveSelectedCard}
              >
                選択カードを保存
              </button>
              <button
                type="button"
                className="ghost"
                disabled={disableLocalCommunication || userCardBusy || players.length === 0}
                onClick={onExportA4Sheet}
              >
                A4シートを作成
              </button>
            </div>
          </>
        )}
      </section>

      {hasSelectedEvent && (
        <section className="panel users-grid-panel">
          <section className="users-player-list">
            <div className="users-player-list-head">
              <h3>プレイヤー一覧</h3>
              <button
                type="button"
                className="ghost"
                disabled={disableLocalCommunication || userCardBusy || players.length === 0}
                onClick={onSelectAllPlayers}
              >
                全選択
              </button>
              <button
                type="button"
                className="ghost"
                disabled={disableLocalCommunication || userCardBusy || selectedPlayerIds.length === 0}
                onClick={onClearPlayerSelection}
              >
                全解除
              </button>
            </div>
            {players.length === 0 ? (
              <p className="meta">プレイヤーが存在しません。</p>
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
                      <p className="meta user-id">playerId: {player.playerId}</p>
                    </article>
                  );
                })}
              </div>
            )}
          </section>

          <section className="users-card-preview">
            <h3>プレイヤーカードプレビュー</h3>
            {!selectedPlayer || selectedPlayerPreviewUrl === "" ? (
              <p className="meta">プレイヤーを選択してください。</p>
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