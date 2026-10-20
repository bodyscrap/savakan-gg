import { isCompletedSet, resolveEntrantDisplayName } from "./bracketDisplay";
import { createSetEntrantResolver, isResolvedEntrantName } from "./bracketProgression";
import { buildPendingSetResultsById, getSetScoresForDisplay, isConfirmedSetResult } from "./setResultDrafts";
import type { TournamentWorkspace } from "./tournamentWorkspaceRepository";
import { resolveOverlaySidesForSet } from "../hooks/useObsOverlay";

export type StreamChapterSet = {
  setId: string;
  setLabel: string;
  startedAt: number;
  matchup: string;
};

function singleLine(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

export function collectStreamChapterSets(
  workspace: TournamentWorkspace,
  eventId: string,
  useAliasName: boolean,
  selectedCategorySlots: readonly number[] = [],
  showResults = false,
): StreamChapterSet[] {
  const event = workspace.snapshot.events.find((item) => item.eventId === eventId);
  if (!event) {
    throw new Error("チャプター生成対象のイベントが見つかりません。");
  }
  const eventMeta = workspace.localMeta.events.find((item) => item.eventId === eventId);
  const aliases = new Map(eventMeta?.entrants.map((entrant) => [entrant.entrantId, entrant.aliasName]));
  const entrants = new Map(eventMeta?.entrants.map((entrant) => [entrant.entrantId, entrant]));
  const categoryLists = eventMeta?.eventManagement?.itemListSnapshots ?? [];
  function playerItems(entrantId: string | null): string[] {
    const chosen = entrantId ? entrants.get(entrantId)?.characterNames ?? [] : [];
    return categoryLists.slice(0, 3).flatMap((_list, slotIndex) => {
      if (!selectedCategorySlots.includes(slotIndex)) {
        return [];
      }
      const items = chosen.map((item) => item.trim()).filter((item) =>
        item !== "" && categoryLists.findIndex((category) => category.items.includes(item)) === slotIndex,
      );
      const categoryItems = eventMeta?.eventManagement?.categoryAllowDuplicates?.[slotIndex] ? items : [...new Set(items)];
      return categoryItems.length > 0 ? [categoryItems.map(singleLine).join(",")] : [];
    });
  }
  const sides = new Map((workspace.localMeta.setPlaySides ?? [])
    .map((side) => [`${side.setId}:${side.entrantId}`, side.playSide]));
  const setsById = new Map(event.sets.map((set) => [set.setId, set]));
  const resolveSet = createSetEntrantResolver(event.sets, event.phaseGroups ?? []);
  const resultsById = buildPendingSetResultsById(
    workspace.localMeta.pendingSetResults.filter((result) => result.eventId === eventId),
    (workspace.localMeta.pendingGrandFinalResetResults ?? []).filter((result) => result.eventId === eventId),
  );

  return (workspace.localMeta.setStreamStarts ?? [])
    .filter((record) => record.eventId === eventId)
    .map((record) => {
      const sourceSet = setsById.get(record.setId);
      if (!sourceSet) {
        throw new Error(`配信開始記録の Set ${record.setId} が見つかりません。`);
      }
      const startedAt = Date.parse(record.lastStartedAt);
      if (!Number.isFinite(startedAt)) {
        throw new Error(`Set ${record.setId} の配信開始時刻が不正です。`);
      }
      const set = resolveSet(sourceSet);
      if (set.slots.length !== 2 || set.slots.some((slot) => !slot.entrantId || !isResolvedEntrantName(slot.entrantName))) {
        throw new Error(`Set ${record.setId} の対戦プレイヤーを特定できません。`);
      }
      const overlaySides = resolveOverlaySidesForSet(set, {
        getSavedSide: (setId, entrantId) => sides.get(`${setId}:${entrantId}`) ?? "",
      });
      const result = resultsById.get(set.setId);
      const resultDisplay = getSetScoresForDisplay(set, result);
      const winnerId = resultDisplay.winnerId;
      const resultConfirmed = result ? isConfirmedSetResult(result) : isCompletedSet(set);
      const showWinner = showResults && resultConfirmed && set.slots.some((slot) => slot.entrantId === winnerId);
      const scores = new Map(set.slots.map((slot) => {
        const displayedScore = slot.entrantId ? resultDisplay.scores[slot.entrantId] : undefined;
        const score = result ? (displayedScore === undefined ? null : Number(displayedScore)) : slot.score;
        return [slot.entrantId, score];
      }));
      const showScores = !result?.directWin
        && !resultDisplay.isDq
        && set.slots.every((slot) => {
          const score = scores.get(slot.entrantId);
          return typeof score === "number" && Number.isFinite(score) && Number.isInteger(score) && score >= 0;
        });
      const playerName = (name: string, entrantId: string | null) => {
        const displayName = singleLine(resolveEntrantDisplayName(
          name,
          entrantId ? aliases.get(entrantId) : undefined,
          useAliasName,
        ));
        const items = playerItems(entrantId);
        const nameWithItems = items.length > 0 ? `${displayName}(${items.join("/")})` : displayName;
        if (!showWinner) {
          return nameWithItems;
        }
        const mark = entrantId === winnerId ? "〇" : "●";
        return `${mark}${showScores ? scores.get(entrantId) : ""} ${nameWithItems}`;
      };
      return {
        setId: set.setId,
        setLabel: [set.phaseName, set.phaseGroupDisplayIdentifier ? `Pool ${set.phaseGroupDisplayIdentifier}` : "",
          `Set ${set.identifier || set.setId}`, set.fullRoundText].filter(Boolean).join(" / "),
        startedAt,
        matchup: `${playerName(overlaySides.redPlayerName, overlaySides.redEntrantId)} vs ${playerName(overlaySides.bluePlayerName, overlaySides.blueEntrantId)}`,
      };
    })
    .sort((left, right) => left.startedAt - right.startedAt || left.setId.localeCompare(right.setId));
}

export function parseChapterVideoTime(value: string): number {
  const match = /^(?:(\d+):)?([0-5]?\d):([0-5]?\d)$/.exec(value.trim());
  if (!match) {
    throw new Error("動画上の開始時刻は hh:mm:ss または mm:ss 形式で入力してください。");
  }
  const seconds = Number(match[1] ?? 0) * 3600 + Number(match[2]) * 60 + Number(match[3]);
  if (!Number.isSafeInteger(seconds)) {
    throw new Error("動画上の開始時刻が大きすぎます。");
  }
  return seconds;
}

function formatVideoTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds / 60) % 60;
  const timeParts = [minutes, seconds % 60].map((value) => String(value).padStart(2, "0"));
  return hours > 0
    ? [String(hours).padStart(2, "0"), ...timeParts].join(":")
    : timeParts.join(":");
}

export function generateYoutubeChapters(
  sets: StreamChapterSet[],
  openingText: string,
  referenceVideoTime: string,
  referenceSetId?: string,
): string {
  if (sets.length === 0) {
    throw new Error("配信開始時刻が記録された Set がありません。");
  }
  const opening = singleLine(openingText);
  if (!opening) {
    throw new Error("00:00 の後ろに表示するテキストを入力してください。");
  }
  const referenceVideoSeconds = parseChapterVideoTime(referenceVideoTime);
  const sortedSets = [...sets].sort((left, right) => left.startedAt - right.startedAt);
  const referenceSet = referenceSetId === undefined
    ? sortedSets[0]
    : sortedSets.find((set) => set.setId === referenceSetId);
  if (!referenceSet) {
    throw new Error("基準の試合が配信開始記録に見つかりません。基準の試合を選び直してください。");
  }
  const lines = sortedSets.map((set) => {
    const seconds = referenceVideoSeconds + Math.floor((set.startedAt - referenceSet.startedAt) / 1000);
    if (!Number.isSafeInteger(seconds)) {
      throw new Error(`Set ${set.setId} の動画上の開始時刻を計算できません。`);
    }
    return `${seconds < 10 ? "(未記録)" : formatVideoTime(seconds)} ${set.matchup}`;
  });
  return [`00:00 ${opening}`, ...lines].join("\n");
}
