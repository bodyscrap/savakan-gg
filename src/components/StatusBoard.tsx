import { t } from "../i18n";
import type { CSSProperties } from "react";
import type { FeatureMessage } from "../domain/messages";

export type CallListPlayer = {
  messageId: string;
  entrantId: string;
  entrantName: string;
  createdAt: string;
  senderName: string;
  isOwn: boolean;
  isPlaying: boolean;
  playingUntil: string;
  playingCommunication: string;
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
    return t("00時間00分経過");
  }

  const elapsedMs = Math.max(0, referenceMs - createdMs);
  const totalMinutes = Math.floor(elapsedMs / 60000);
  const elapsedHours = Math.floor(totalMinutes / 60);
  const elapsedMinutes = totalMinutes % 60;

  return t("{value1}時間{value2}分経過", { value1: String(elapsedHours).padStart(2, "0"), value2: String(elapsedMinutes).padStart(2, "0") });
}

export function callElapsedSeconds(createdAt: string, referenceMs: number): number {
  const createdMs = Date.parse(createdAt);
  if (!Number.isFinite(createdMs)) {
    return 0;
  }
  return Math.max(0, (referenceMs - createdMs) / 1000);
}

function formatPlayingStatus(until: string, referenceMs: number): string {
  if (until === "") {
    return t("プレイ中(終了未定)");
  }
  const untilMs = Date.parse(until);
  if (!Number.isFinite(untilMs)) {
    return t("プレイ中（終了時間不明）");
  }
  if (untilMs <= referenceMs) {
    return t("プレイ中（解除通知待ち）");
  }
  return t("プレイ中（あと約{value1}分）", { value1: Math.ceil((untilMs - referenceMs) / 60_000) });
}

export function CallListPlayingCommunication({ communication }: { communication: string }) {
  if (communication.trim() === "") {
    return null;
  }

  return (
    <div className="call-list-playing-communication">
      <span>{t("通信欄")}</span>
      <p>{communication}</p>
    </div>
  );
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

type CallReactionDialogProps = {
  playerName: string;
  senderName: string;
  senderUserId: string;
  senderIp: string;
  isPlaying: boolean;
  playingUntil: string;
  playingCommunication: string;
  playingByMe: boolean;
  referenceMs: number;
  disabled: boolean;
  onRequestDq: () => void;
  onNotifyPlaying: () => void;
  onReleasePlaying: () => void;
  onClose: () => void;
};

export function CallReactionDialog({
  playerName,
  senderName,
  senderUserId,
  senderIp,
  isPlaying,
  playingUntil,
  playingCommunication,
  playingByMe,
  referenceMs,
  disabled,
  onRequestDq,
  onNotifyPlaying,
  onReleasePlaying,
  onClose,
}: CallReactionDialogProps) {
  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <section
        className="dialog-panel"
        role="dialog"
        aria-modal="true"
        aria-label={t("呼び出しへのリアクション({value1})", { value1: playerName })}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="dialog-head">
          <h3>{t("呼び出しへのリアクション({value1})", { value1: playerName })}</h3>
        </div>
        <div className="dialog-body">
          <div className="dialog-summary-box">
            <p className="meta">{t("呼び出し元: {value1} / ID: {value2} / IP: {value3}", { value1: senderName, value2: senderUserId, value3: senderIp })}</p>
          </div>
          {isPlaying && (
            <p className="call-list-playing-badge" style={{ marginTop: "0.75rem" }}>
              {formatPlayingStatus(playingUntil, referenceMs)}
            </p>
          )}
          <CallListPlayingCommunication communication={playingCommunication} />
        </div>
        <div className="dialog-actions dialog-actions-split" style={{ justifyContent: "flex-end" }}>
          <button type="button" className="ghost" onClick={onClose}>{t("閉じる")}</button>
          <button type="button" disabled={disabled} onClick={onRequestDq}>{t("DQ申請")}</button>
          {!isPlaying && (
            <button type="button" disabled={disabled} onClick={onNotifyPlaying}>{t("プレイ中通知")}</button>
          )}
          {isPlaying && playingByMe && (
            <button type="button" disabled={disabled} onClick={onReleasePlaying}>{t("プレイ中通知を解除")}</button>
          )}
        </div>
      </section>
    </div>
  );
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
        <h2 className="call-list-hero-title">{t("プレイヤー呼び出し(イベント名/フェーズ名/プール名)")}</h2>
        <div className="hero-call-list-toolbar">
          <button type="button" className="ghost" onClick={onToggleSort}>{t("並び替え: {value1}", { value1: sortStrategy === "alias" ? t("エイリアス順") : t("最大経過時間順") })}</button>
          <button type="button" className="ghost" disabled={!canBroadcastSync} onClick={onBroadcastSync}>{t("呼び出しの同期")}</button>
          {totalPages > 1 && (
            <button type="button" className="ghost" onClick={onNextPage}>{t("次ページ")}</button>
          )}
        </div>
        <p className="call-list-page-big">{currentPage}/{totalPages}</p>
      </div>
      {totalPages > 1 && (
        <div
          className="call-list-rotate-progress"
          role="progressbar"
          aria-label={t("次ページ切替までの進捗")}
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
  onOpenCallReaction: (group: CallListEventGroup, player: CallListPlayer) => void;
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
  onOpenCallReaction,
  communicationDisabled,
  disableOwnCallActions,
  disableOtherCallActions,
}: StatusBoardProps) {
  return (
    <section className="panel call-list-panel">
      {eventGroups.length === 0 ? (
        <div style={{ display: "grid", gap: "0.5rem" }}>
          <p className="meta">{t("現在未解決の呼び出しはありません。")}</p>
          {focusOwnUnresolved && hiddenUnresolvedCount > 0 && (
            <>
              <p className="meta">{t("他ユーザー起点の未解決呼び出し {value1} 件は、全クリア後の自分起点フィルタにより非表示です。", { value1: hiddenUnresolvedCount })}</p>
              <div>
                <button type="button" className="ghost" onClick={onShowAllUnresolved}>{t("全未解決を表示する")}</button>
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
                    {group.eventAlias !== "" ? group.eventAlias : t("(イベントエイリアス未設定)")}
                    {"("}
                    {group.phaseName === "Phase 未設定" ? t("Phase 未設定") : resolvePhaseName(group.eventId, group.phaseName)}
                    {"/"}
                    {group.phaseGroupName === "Pool 未設定" ? t("Pool 未設定") : group.phaseGroupName !== "" ? group.phaseGroupName : "-"}
                    {")"}
                  </span>
                </p>
                <span className="meta">{t("{origin} / {count} 件", { origin: group.players[0]?.isOwn ? t("自分の呼び出し") : t("他端末の呼び出し"), count: group.players.length })}</span>
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

                    const chip = player.isOwn ? (
                      <button
                        type="button"
                        className={className}
                        style={chipStyle}
                        onClick={() => onResolveOwnCall(group, player)}
                        disabled={communicationDisabled || disableOwnCallActions}
                        aria-label={player.dqRequest
                          ? t("{value1} のDQ申請を確認", { value1: name })
                          : t("{value1} の呼び出しを解決", { value1: name })}
                        title={disableOwnCallActions ? t("設定で自端末呼び出しへの操作が禁止されています") : undefined}
                      >
                        <span className="call-list-player-chip-name">
                          {name}
                          {player.dqRequest && (
                            <span className="call-list-dq-request-badge" aria-label={t("DQ申請あり")}>{t("DQ申請")}</span>
                          )}
                        </span>
                        <span className="call-list-player-chip-elapsed">{elapsed}</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        className={className}
                        style={chipStyle}
                        disabled={communicationDisabled || disableOtherCallActions}
                        onClick={() => onOpenCallReaction(group, player)}
                        aria-label={t("{value1} への呼び出しリアクション", { value1: name })}
                        title={disableOtherCallActions
                          ? t("設定で他端末呼び出しへの操作が禁止されています")
                          : t("クリックして呼び出しへのリアクションを選択")}
                      >
                        <span className="call-list-player-chip-name">{name}</span>
                        <span className="call-list-player-chip-elapsed">{elapsed}</span>
                      </button>
                    );

                    const playingStatus = player.isPlaying
                      ? formatPlayingStatus(player.playingUntil, pageSwitchedAtMs)
                      : "";

                    return (
                      <div className="call-list-player-entry" key={`${group.key}-${player.messageId}`}>
                        {chip}
                        {player.isPlaying && (
                          <span className="call-list-playing-badge">{playingStatus}</span>
                        )}
                      </div>
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