import type { LocalSetResultMeta } from "./useTournamentWorkspace";
import type {
  RoundRobinStanding,
  RoundRobinTieBreakRule,
  SetEntrantSource,
  SetSlot,
  SetSnapshot,
} from "./bracketProgression";
import type { RoundRobinMatrixRowView } from "./RoundRobinMatrix";
import {
  getPendingSetChangeClass,
  getSetResultVisualStatus,
  getSetScoresForDisplay,
} from "./setResultDrafts";
import type { SetScoreDraft } from "./useSetResultDrafts";
import type { ObsOverlayState } from "./useObsOverlay";

export type RoundRobinBoardData = {
  entrants: string[];
  entrantNames: Map<string, string>;
  entrantIdsByColumnKey: Map<string, string | null>;
  entrantSeedIds: Map<string, string>;
  entrantSeedNumbers: Map<string, number>;
  sourceDiagnostics: string[];
  setsByPair: Map<string, SetSnapshot>;
  candidateSetCount: number;
  twoSlotSetCount: number;
  resolvedSetCount: number;
  registeredSetCount: number;
  unresolvedSetIds: string[];
  unresolvedSetReasons: string[];
  standings: RoundRobinStanding[];
  qualifyingCount: number;
  tieBreakRules: RoundRobinTieBreakRule[];
};

export function roundRobinPairKey(leftEntrantId: string, rightEntrantId: string): string {
  return [leftEntrantId, rightEntrantId].sort((left, right) => left.localeCompare(right, "ja")).join("::");
}

export function roundRobinPlaceholderId(slot: SetSlot, source?: SetEntrantSource | null): string {
  const sourceIdentity = source?.typeId
    ? `${source.typeId}:${source.condition?.trim().toLowerCase() || "source"}`
    : null;
  const identity = slot.seedId
    || sourceIdentity
    || slot.seedPlaceholderName?.trim()
    || source?.placeholderName?.trim()
    || slot.entrantName
    || "unknown";
  return `placeholder:${identity}`;
}

type BuildRoundRobinMatrixRowsInput = {
  boardData: RoundRobinBoardData;
  pendingResultBySetId: Map<string, LocalSetResultMeta>;
  interimScoreDraftsBySetId: Record<string, SetScoreDraft>;
  obsOverlayState: Pick<ObsOverlayState, "active" | "currentSetId"> | null;
  setDisplayCodeById: Map<string, string>;
};

export function buildRoundRobinMatrixRows({
  boardData,
  pendingResultBySetId,
  interimScoreDraftsBySetId,
  obsOverlayState,
  setDisplayCodeById,
}: BuildRoundRobinMatrixRowsInput): RoundRobinMatrixRowView[] {
  return boardData.entrants.map((rowEntrantId) => {
    const rowSeedId = rowEntrantId.startsWith("seed:")
      ? rowEntrantId.slice("seed:".length)
      : boardData.entrantSeedIds.get(rowEntrantId);
    const rowColumnEntrantId = boardData.entrantIdsByColumnKey.get(rowEntrantId);
    const standing = boardData.standings.find((item) =>
      item.entrantId === rowColumnEntrantId
      || (rowSeedId !== undefined
        && boardData.entrantSeedIds.get(item.entrantId) === rowSeedId)
      || (!rowEntrantId.startsWith("seed:") && item.entrantId === rowEntrantId),
    );

    const cells = boardData.entrants.map((columnEntrantId) => {
      const isDiagonal = rowEntrantId === columnEntrantId;
      const columnSeedId = columnEntrantId.startsWith("seed:")
        ? columnEntrantId.slice("seed:".length)
        : boardData.entrantSeedIds.get(columnEntrantId);
      const set = isDiagonal
        ? null
        : boardData.setsByPair.get(roundRobinPairKey(
          boardData.entrantIdsByColumnKey.get(rowEntrantId) ?? rowEntrantId,
          boardData.entrantIdsByColumnKey.get(columnEntrantId) ?? columnEntrantId,
        ))
          ?? boardData.setsByPair.get(roundRobinPairKey(
            rowSeedId ?? rowEntrantId,
            columnSeedId ?? columnEntrantId,
          ));

      if (!set) {
        return {
          key: columnEntrantId,
          kind: isDiagonal ? "diagonal" as const : "empty" as const,
        };
      }

      const setDisplay = getSetScoresForDisplay(
        set,
        pendingResultBySetId.get(set.setId),
        interimScoreDraftsBySetId[set.setId],
      );
      const pendingResult = pendingResultBySetId.get(set.setId);
      const resultStatus = getSetResultVisualStatus(
        set,
        pendingResult,
        interimScoreDraftsBySetId[set.setId],
      );
      const resultStatusClass = resultStatus ? `set-card-status-${resultStatus}` : "";
      const resultStatusLabel = resultStatus === "confirmed"
        ? "確定"
        : resultStatus === "reset"
          ? "取消待ち"
          : resultStatus === "draft"
            ? "下書き"
            : resultStatus === "inprogress"
              ? "進行中"
              : "";
      const winnerId = setDisplay.winnerId ?? set.winnerId;
      const columnColumnEntrantId = boardData.entrantIdsByColumnKey.get(columnEntrantId);
      const rowSlot = set.slots.find((slot) =>
        rowColumnEntrantId !== null && rowColumnEntrantId !== undefined
        && slot.entrantId === rowColumnEntrantId,
      ) ?? set.slots.find((slot) => rowSeedId && slot.seedId === rowSeedId);
      const columnSlot = set.slots.find((slot) =>
        columnColumnEntrantId !== null && columnColumnEntrantId !== undefined
        && slot.entrantId === columnColumnEntrantId,
      ) ?? set.slots.find((slot) => columnSeedId && slot.seedId === columnSeedId);
      const rowEntrantIdForSet = rowSlot?.entrantId ?? null;
      const columnEntrantIdForSet = columnSlot?.entrantId ?? null;
      const rowGameScore = rowEntrantIdForSet
        ? setDisplay.scores[rowEntrantIdForSet]
          ?? (rowSlot?.score !== null && rowSlot?.score !== undefined ? String(rowSlot.score) : "-")
        : "-";
      const columnGameScore = columnEntrantIdForSet
        ? setDisplay.scores[columnEntrantIdForSet]
          ?? (columnSlot?.score !== null && columnSlot?.score !== undefined ? String(columnSlot.score) : "-")
        : "-";
      const changeClass = pendingResult ? getPendingSetChangeClass(pendingResult) : "";
      const outcomeClass = winnerId === null
        ? ""
        : winnerId === rowEntrantIdForSet
          ? "round-robin-match-win"
          : winnerId === columnEntrantIdForSet
            ? "round-robin-match-loss"
            : "";
      const isLiveOverlaySet = Boolean(
        obsOverlayState?.active
        && obsOverlayState.currentSetId === set.setId
        && obsOverlayState.currentSetId !== "__test__",
      );
      const roundLabel = set.fullRoundText.trim() || `Round ${set.round ?? "-"}`;
      const setLabel = `Set ${setDisplayCodeById.get(set.setId) ?? set.identifier?.trim() ?? "-"}`;

      return {
        key: columnEntrantId,
        kind: "match" as const,
        match: {
          set,
          className: `round-robin-match ${outcomeClass} ${changeClass} ${resultStatusClass} ${isLiveOverlaySet ? "set-card-live" : ""}`,
          title: `${roundLabel} / ${setLabel}: ${boardData.entrantNames.get(rowEntrantId) || "-"} vs ${boardData.entrantNames.get(columnEntrantId) || "-"}`,
          roundLabel,
          setLabel,
          resultStatus,
          resultStatusLabel,
          isLiveOverlaySet,
          rowGameScore,
          columnGameScore,
        },
      };
    });

    return {
      key: rowEntrantId,
      entrantName: boardData.entrantNames.get(rowEntrantId) || "-",
      cells,
      setSummary: standing ? `${standing.wins}-${standing.losses}` : "-",
      gameSummary: standing ? `${standing.gameWins}-${standing.gameLosses}` : "-",
    };
  });
}