import type { CSSProperties } from "react";
import type { FeatureMessage } from "../domain/messages";

export type CallListPlayer = {
  messageId: string;
  entrantId: string;
  entrantName: string;
  createdAt: string;
  senderName: string;
  isOwn: boolean;
  dqRequest: FeatureMessage | null;
};

export type CallListEventGroup = {
  key: string;
  eventAlias: string;
  tournamentName: string;
  tournamentId: string;
  eventName: string;
  eventId: string;
  phaseName: string;
  phaseGroupName: string;
  players: CallListPlayer[];
};

export type CallListEventSortStrategy = "alias" | "max-elapsed";

export function formatCallElapsedTime(createdAt: string, referenceMs: number): string {
  const createdMs = Date.parse(createdAt);
  if (!Number.isFinite(createdMs)) {
    return "00時間00分経過";
  }

  const elapsedMs = Math.max(0, referenceMs - createdMs);
  const totalMinutes = Math.floor(elapsedMs / 60000);
  const elapsedHours = Math.floor(totalMinutes / 60);
  const elapsedMinutes = totalMinutes % 60;

  return `${String(elapsedHours).padStart(2, "0")}時間${String(elapsedMinutes).padStart(2, "0")}分経過`;
}

export function callElapsedSeconds(createdAt: string, referenceMs: number): number {
  const createdMs = Date.parse(createdAt);
  if (!Number.isFinite(createdMs)) {
    return 0;
  }
  return Math.max(0, (referenceMs - createdMs) / 1000);
}

function buildCallListPlayerChipStyle(elapsedSeconds: number, redAfterSeconds: number): CSSProperties {
  const threshold = Math.max(1, redAfterSeconds);
  const progress = Math.min(Math.max(elapsedSeconds / threshold, 0), 1);
  const hue = Math.round((1 - progress) * 120);

  return {
    backgroundColor: `hsl(${hue} 82% 91%)`,
    borderColor: `hsl(${hue} 74% 43%)`,
    color: `hsl(${hue} 66% 20%)`,
  };
}

type StatusBoardHeroProps = {
  currentPage: number;
  totalPages: number;
  sortStrategy: CallListEventSortStrategy;
  onToggleSort: () => void;
  canBroadcastSync: boolean;
  onBroadcastSync: () => void;
  onNextPage: () => void;
  pageProgressPercent: number;
};

export function StatusBoardHero({
  currentPage,
  totalPages,
  sortStrategy,
  onToggleSort,
  canBroadcastSync,
  onBroadcastSync,
  onNextPage,
  pageProgressPercent,
}: StatusBoardHeroProps) {
  return (
    <>
      <div className="hero-call-list-head">
        <h2 className="call-list-hero-title">プレイヤー呼び出し(イベント名/フェーズ名/プール名)</h2>
        <p className="call-list-page-big">{currentPage}/{totalPages}</p>
      </div>
      <div className="hero-call-list-toolbar">
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
          <button type="button" className="ghost" onClick={onToggleSort}>
            並び替え: {sortStrategy === "alias" ? "エイリアス順" : "最大経過時間順"}
          </button>
          <button type="button" className="ghost" disabled={!canBroadcastSync} onClick={onBroadcastSync}>
            呼び出しの同期
          </button>
          {totalPages > 1 && (
            <button type="button" className="ghost" onClick={onNextPage}>
              次ページ
            </button>
          )}
        </div>
      </div>
      {totalPages > 1 && (
        <div
          className="call-list-rotate-progress"
          role="progressbar"
          aria-label="次ページ切替までの進捗"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(pageProgressPercent)}
        >
          <div className="call-list-rotate-progress-track">
            <div className="call-list-rotate-progress-fill" style={{ width: `${pageProgressPercent}%` }} />
          </div>
        </div>
      )}
    </>
  );
}

type StatusBoardProps = {
  eventGroups: CallListEventGroup[];
  activePage: CallListEventGroup[];
  hiddenUnresolvedCount: number;
  focusOwnUnresolved: boolean;
  onShowAllUnresolved: () => void;
  resolvePhaseName: (eventId: string, phaseName: string) => string;
  pageSwitchedAtMs: number;
  colorToRedSeconds: number;
  resolvePlayerName: (group: CallListEventGroup, player: CallListPlayer) => string;
  onResolveOwnCall: (group: CallListEventGroup, player: CallListPlayer) => void;
  onRequestDq: (messageId: string) => void;
  communicationDisabled: boolean;
  disableOwnCallActions: boolean;
  disableOtherCallActions: boolean;
};

export function StatusBoard({
  eventGroups,
  activePage,
  hiddenUnresolvedCount,
  focusOwnUnresolved,
  onShowAllUnresolved,
  resolvePhaseName,
  pageSwitchedAtMs,
  colorToRedSeconds,
  resolvePlayerName,
  onResolveOwnCall,
  onRequestDq,
  communicationDisabled,
  disableOwnCallActions,
  disableOtherCallActions,
}: StatusBoardProps) {
  return (
    <section className="panel call-list-panel">
      {eventGroups.length === 0 ? (
        <div style={{ display: "grid", gap: "0.5rem" }}>
          <p className="meta">現在未解決の呼び出しはありません。</p>
          {focusOwnUnresolved && hiddenUnresolvedCount > 0 && (
            <>
              <p className="meta">
                他ユーザー起点の未解決呼び出し {hiddenUnresolvedCount} 件は、全クリア後の自分起点フィルタにより非表示です。
              </p>
              <div>
                <button type="button" className="ghost" onClick={onShowAllUnresolved}>
                  全未解決を表示する
                </button>
              </div>
            </>
          )}
        </div>
      ) : (
        <div
          className="call-list-event-grid"
          style={{ gridTemplateRows: `repeat(${Math.max(activePage.length, 1)}, minmax(0, 1fr))` }}
        >
          {activePage.map((group) => (
            <article className="event-list-item" key={`call-list-${group.key}`}>
              <div className="event-list-head">
                <p className="call-list-event-summary">
                  <span className="call-list-event-alias">
                    {group.eventAlias !== "" ? group.eventAlias : "(イベントエイリアス未設定)"}
                    {"("}
                    {resolvePhaseName(group.eventId, group.phaseName)}
                    {"/"}
                    {group.phaseGroupName !== "" ? group.phaseGroupName : "-"}
                    {")"}
                  </span>
                </p>
                <span className="meta">
                  {group.players[0]?.isOwn ? "自分の呼び出し" : "他端末の呼び出し"} / {group.players.length} 件
                </span>
              </div>
              <div className="call-list-player-tags">
                {group.players
                  .slice()
                  .sort((left, right) => {
                    const leftElapsed = callElapsedSeconds(left.createdAt, pageSwitchedAtMs);
                    const rightElapsed = callElapsedSeconds(right.createdAt, pageSwitchedAtMs);
                    if (leftElapsed !== rightElapsed) {
                      return rightElapsed - leftElapsed;
                    }

                    const leftMs = Date.parse(left.createdAt);
                    const rightMs = Date.parse(right.createdAt);
                    if (Number.isFinite(leftMs) && Number.isFinite(rightMs) && leftMs !== rightMs) {
                      return leftMs - rightMs;
                    }

                    return left.messageId.localeCompare(right.messageId, "ja");
                  })
                  .map((player) => {
                    const elapsedSeconds = callElapsedSeconds(player.createdAt, pageSwitchedAtMs);
                    const chipStyle = buildCallListPlayerChipStyle(elapsedSeconds, colorToRedSeconds);

                    const className = `call-list-player-chip${player.isOwn ? " call-list-player-chip--own" : ""}`;
                    const name = resolvePlayerName(group, player);
                    const elapsed = formatCallElapsedTime(player.createdAt, pageSwitchedAtMs);

                    return player.isOwn ? (
                      <button
                        type="button"
                        className={className}
                        key={`${group.key}-${player.messageId}`}
                        style={chipStyle}
                        onClick={() => onResolveOwnCall(group, player)}
                        disabled={communicationDisabled || disableOwnCallActions}
                        aria-label={player.dqRequest
                          ? `${name} のDQ申請を確認`
                          : `${name} の呼び出しを解決`}
                        title={disableOwnCallActions ? "設定で自端末呼び出しへの操作が禁止されています" : undefined}
                      >
                        <span className="call-list-player-chip-name">
                          {name}
                          {player.dqRequest && (
                            <span className="call-list-dq-request-badge" aria-label="DQ申請あり">
                              DQ申請
                            </span>
                          )}
                        </span>
                        <span className="call-list-player-chip-elapsed">{elapsed}</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        className={className}
                        key={`${group.key}-${player.messageId}`}
                        style={chipStyle}
                        disabled={communicationDisabled || disableOtherCallActions}
                        onClick={() => onRequestDq(player.messageId)}
                        aria-label={`${name} のDQ申請`}
                        title={disableOtherCallActions
                          ? "設定で他端末呼び出しへの操作が禁止されています"
                          : "クリックしてPLAYER ID認証付きDQ申請"}
                      >
                        <span className="call-list-player-chip-name">{name}</span>
                        <span className="call-list-player-chip-elapsed">{elapsed}</span>
                      </button>
                    );
                  })}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}