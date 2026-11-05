import { t } from "../i18n";
import {
  isCompletedSet,
  resolveEntrantDisplayName,
  type FirstToNWinsPhaseSnapshot,
} from "../domain/bracketDisplay";
import type { SetSnapshot } from "../domain/bracketProgression";
import type { CSSProperties, MouseEvent } from "react";

type Props = {
  settings: FirstToNWinsPhaseSnapshot;
  sets: SetSnapshot[];
  allSets: SetSnapshot[];
  directWinSetIds?: ReadonlySet<string>;
  aliasNamesByEntrantId?: Record<string, string | undefined>;
  useAliasName?: boolean;
  activeOverlaySetId?: string | null;
  scaleStyle: CSSProperties;
  interactionDisabled?: boolean;
  streamStartUpdateDisabled?: boolean;
  onUpdateStreamStart?: () => void;
  getSetSlotSide: (setId: string, entrantId: string) => "1P" | "2P" | "";
  onActivateSet: (set: SetSnapshot, event: MouseEvent<HTMLElement>) => void;
};

export function FirstToNWinsBracket({
  settings,
  sets,
  allSets,
  directWinSetIds = new Set(),
  aliasNamesByEntrantId = {},
  useAliasName = false,
  activeOverlaySetId = null,
  scaleStyle,
  interactionDisabled,
  streamStartUpdateDisabled,
  onUpdateStreamStart,
  getSetSlotSide,
  onActivateSet,
}: Props) {
  const displayName = (slot: SetSnapshot["slots"][number] | undefined) => slot
    ? resolveEntrantDisplayName(
      slot.entrantName,
      slot.entrantId ? aliasNamesByEntrantId[slot.entrantId] : undefined,
      useAliasName,
    )
    : "";
  const eventOrder = new Map(allSets.map((set, index) => [set.setId, index + 1]));
  const setOrder = (set: SetSnapshot) => {
    const identity = Number(set.identifier);
    return Number.isSafeInteger(identity) && identity > 0
      ? identity
      : eventOrder.get(set.setId) ?? Number.MAX_SAFE_INTEGER;
  };
  const orderedAllSets = [...allSets].sort((left, right) =>
    setOrder(left) - setOrder(right) || (eventOrder.get(left.setId) ?? 0) - (eventOrder.get(right.setId) ?? 0));
  const sequenceBySetId = new Map(orderedAllSets.map((set, index) => [set.setId, index + 1]));
  const nextUncompletedSet = orderedAllSets.find((set) => !isCompletedSet(set));
  const orderedSets = [...sets].sort((left, right) => setOrder(left) - setOrder(right));
  const playerOneSlot = orderedSets
    .flatMap((set) => set.slots)
    .find((slot) => slot.entrantId === settings.playerOneEntrantId);
  const playerTwoSlot = orderedSets
    .flatMap((set) => set.slots)
    .find((slot) => slot.entrantId !== settings.playerOneEntrantId && slot.entrantId !== null);
  const playerOneName = displayName(playerOneSlot);
  const playerTwoName = displayName(playerTwoSlot);
  let playerOneWins = 0;
  let playerTwoWins = 0;
  let clinchedSequence: number | null = null;
  let clinchedWinnerId: string | null = null;
  for (const [index, set] of orderedSets.entries()) {
    if (set.winnerId === settings.playerOneEntrantId) {
      playerOneWins += 1;
    } else if (set.winnerId) {
      playerTwoWins += 1;
    } else if (isCompletedSet(set) && settings.drawCountsAsWin) {
      playerOneWins += 1;
      playerTwoWins += 1;
    }

    if (
      clinchedSequence === null
      && ((playerOneWins >= settings.winsRequired && playerOneWins > playerTwoWins)
        || (playerTwoWins >= settings.winsRequired && playerTwoWins > playerOneWins))
    ) {
      clinchedSequence = sequenceBySetId.get(set.setId) ?? index + 1;
      clinchedWinnerId = playerOneWins > playerTwoWins
        ? settings.playerOneEntrantId
        : set.winnerId;
    }
  }
  const clinchedWinnerSlot = orderedSets.flatMap((set) => set.slots)
    .find((slot) => slot.entrantId === clinchedWinnerId);
  const clinchedWinnerName = displayName(clinchedWinnerSlot);
  const nextUncompletedSequence = nextUncompletedSet
    ? sequenceBySetId.get(nextUncompletedSet.setId) ?? null
    : null;
  const lastActiveSequence = settings.playAllMatches
    ? nextUncompletedSequence
    : nextUncompletedSequence === null
      ? clinchedSequence
      : clinchedSequence === null
        ? nextUncompletedSequence
        : Math.min(nextUncompletedSequence, clinchedSequence);
  const isDraw = (set: SetSnapshot) => isCompletedSet(set) && !set.winnerId;

  return (
    <div className="first-to-n-wins-board" style={scaleStyle}>
      <header className="first-to-n-wins-header">
        <div>
          <h3>First to N wins</h3>
          <button
            type="button"
            disabled={interactionDisabled || streamStartUpdateDisabled || !onUpdateStreamStart
              || !sets.some((set) => set.setId === activeOverlaySetId)}
            onClick={onUpdateStreamStart}
          >
            {t("記録時間を更新")}
          </button>
          <p className="meta">
            {t("目標{wins}勝 / 予定試合数{sets} / 初期1P: {playerOne} / 2P: {playerTwo}", {
              wins: settings.winsRequired,
              sets: orderedAllSets.length,
              playerOne: playerOneName || t("未設定"),
              playerTwo: playerTwoName || t("未設定"),
            })}
          </p>
          <p className="meta">
            {settings.playAllMatches
              ? t("勝利確定後も全試合を実施します。")
              : t("目標勝利数に達した時点で終了します。")}
            {" "}
            {settings.drawCountsAsWin
              ? t("ドローは両者に1勝を加算します。")
              : t("ドローは勝利に加算せず、追加試合を行います。")}
            {settings.suddenDeath ? ` ${t("同点時はサドンデスを行います。")}` : ""}
          </p>
          <p className="first-to-n-wins-score">
            {t("現在の勝利数: {playerOne} {playerOneWins} - {playerTwoWins} {playerTwo}", {
              playerOne: playerOneName || t("未設定"),
              playerOneWins,
              playerTwoWins,
              playerTwo: playerTwoName || t("未設定"),
            })}
          </p>
          {clinchedWinnerId && (
            <p className="first-to-n-wins-champion" role="status">
              {t("勝者確定: {winner}", { winner: clinchedWinnerName })}
            </p>
          )}
        </div>
        <span className="first-to-n-wins-cap">{t("基本{count}試合", { count: settings.phaseSetCount })}</span>
      </header>
      <div className="first-to-n-wins-matches">
        {orderedSets.map((set, index) => {
          const sequence = sequenceBySetId.get(set.setId) ?? index + 1;
          const playerOne = set.slots.find((slot) => slot.entrantId === settings.playerOneEntrantId);
          const playerTwo = set.slots.find((slot) =>
            slot.entrantId !== settings.playerOneEntrantId && slot.entrantId !== null);
          const playerOneDisplayName = displayName(playerOne) || playerOneName;
          const playerTwoDisplayName = displayName(playerTwo) || playerTwoName;
          const isPlayableSet = !isCompletedSet(set)
            && sequence === nextUncompletedSequence
            && (lastActiveSequence === null || sequence <= lastActiveSequence);
          const playerOneSide = (isCompletedSet(set) || isPlayableSet) && playerOne?.entrantId
            ? getSetSlotSide(set.setId, playerOne.entrantId)
              || (playerOne.entrantId === settings.playerOneEntrantId ? "1P" : "2P")
            : "";
          const playerTwoSide = (isCompletedSet(set) || isPlayableSet) && playerTwo?.entrantId
            ? getSetSlotSide(set.setId, playerTwo.entrantId)
              || (playerTwo.entrantId === settings.playerOneEntrantId ? "1P" : "2P")
            : "";
          const nextSequence = nextUncompletedSequence;
          const isDirectWin = directWinSetIds.has(set.setId);
          const isCompleted = isCompletedSet(set);
          return (
            <button
              type="button"
              className={`first-to-n-wins-match${isCompleted ? " first-to-n-wins-match-completed" : ""}${activeOverlaySetId === set.setId ? " set-card-live" : ""}`}
              key={set.setId}
              disabled={interactionDisabled
                || (lastActiveSequence !== null && sequence > lastActiveSequence)
                || (nextSequence !== null && sequence > nextSequence && !isCompletedSet(set))}
              onClick={(event) => onActivateSet(set, event)}
              aria-label={t("Set {number}: {playerOne} 対 {playerTwo}", {
                number: sequence,
                playerOne: playerOneDisplayName,
                playerTwo: playerTwoDisplayName,
              })}
            >
              <span className="first-to-n-wins-match-number">
                {t("Set {number}", { number: sequence })}
              </span>
              {activeOverlaySetId === set.setId && <span className="set-live-badge">{t("配信中")}</span>}
              <span className="first-to-n-wins-player-row">
                <span className={`side-badge ${playerOneSide === "1P" ? "side-1p" : playerOneSide === "2P" ? "side-2p" : "side-none"}`}>
                  {playerOneSide}
                </span>
                <span
                  className={`simple-player-name${set.winnerId === playerOne?.entrantId ? " first-to-n-wins-winner" : ""}`}
                  title={playerOneDisplayName}
                >
                  {playerOneDisplayName}
                </span>
                <span
                  className={`simple-games${isDraw(set) ? " draw" : set.winnerId === playerOne?.entrantId ? " win" : set.winnerId ? " lose" : ""}`}
                  title={isDraw(set) ? t("ドロー") : undefined}
                >
                  {isDraw(set) ? "D" : isDirectWin ? set.winnerId === playerOne?.entrantId ? "W" : "L" : playerOne?.score ?? "—"}
                </span>
              </span>
              <span className="first-to-n-wins-player-row">
                <span className={`side-badge ${playerTwoSide === "1P" ? "side-1p" : playerTwoSide === "2P" ? "side-2p" : "side-none"}`}>
                  {playerTwoSide}
                </span>
                <span
                  className={`simple-player-name${set.winnerId === playerTwo?.entrantId ? " first-to-n-wins-winner" : ""}`}
                  title={playerTwoDisplayName}
                >
                  {playerTwoDisplayName}
                </span>
                <span
                  className={`simple-games${isDraw(set) ? " draw" : set.winnerId === playerTwo?.entrantId ? " win" : set.winnerId ? " lose" : ""}`}
                  title={isDraw(set) ? t("ドロー") : undefined}
                >
                  {isDraw(set) ? "D" : isDirectWin ? set.winnerId === playerTwo?.entrantId ? "W" : "L" : playerTwo?.score ?? "—"}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
