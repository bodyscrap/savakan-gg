import type {
  LocalGrandFinalResetResultMeta,
  LocalSetResultMeta,
  PlaySide,
} from "./useTournamentWorkspace";
import type { SetResultDraftState, SetScoreDraft } from "./useSetResultDrafts";
import type { SetSlot, SetSnapshot } from "./bracketProgression";
import { isCompletedSet } from "./bracketDisplay";

export type SetResultVisualStatus = "inprogress" | "draft" | "confirmed" | "reset" | null;

export function buildPendingSetResultsById(
  pendingSetResults: LocalSetResultMeta[],
  pendingGrandFinalResetResults: LocalGrandFinalResetResultMeta[],
): Map<string, LocalSetResultMeta> {
  const resultsBySetId = new Map<string, LocalSetResultMeta>();
  for (const pending of pendingSetResults) {
    resultsBySetId.set(pending.setId, pending);
  }
  for (const pending of pendingGrandFinalResetResults) {
    const setId = `virtual_gf_reset_${pending.sourceGrandFinalSetId}`;
    resultsBySetId.set(setId, {
      eventId: pending.eventId,
      eventName: pending.eventName,
      setId,
      winnerId: pending.winnerId,
      scoreCsv: pending.scoreCsv,
      directWin: pending.directWin,
      confirmed: pending.confirmed,
      slotScores: pending.slotScores,
      recordedAt: pending.recordedAt,
    });
  }
  return resultsBySetId;
}

export function resolveSetSlotSideLabel(
  entrantId: string | null,
  side: PlaySide | "",
  options?: { fallbackBySlotIndex?: number; finishedSet?: boolean; matchupReady?: boolean },
): string {
  if (!entrantId || (!options?.finishedSet && !options?.matchupReady)) {
    return "-";
  }

  if (side !== "") {
    return side;
  }

  if (options.fallbackBySlotIndex === 0) {
    return "1P";
  }
  if (options.fallbackBySlotIndex === 1) {
    return "2P";
  }

  return "-";
}

export function isConfirmedSetResult(result: { confirmed?: boolean }): boolean {
  return result.confirmed !== false;
}

export function isResetPendingResult(result: {
  confirmed?: boolean;
  winnerId: string;
  scoreCsv: string;
  slotScores?: unknown[];
}): boolean {
  return isConfirmedSetResult(result)
    && result.winnerId.trim() === ""
    && result.scoreCsv.trim() === ""
    && (result.slotScores?.length ?? 0) === 0;
}

export function getPendingSetChangeClass(result: LocalSetResultMeta): string {
  if (isResetPendingResult(result)) {
    return "set-card-changed-reset";
  }
  return isConfirmedSetResult(result) ? "set-card-changed-confirmed" : "set-card-changed-draft";
}

export function getSetResultVisualStatus(
  set: SetSnapshot,
  pending: LocalSetResultMeta | undefined,
  interimDrafts?: SetScoreDraft,
): SetResultVisualStatus {
  if (pending) {
    if (isResetPendingResult(pending)) {
      return "reset";
    }
    return isConfirmedSetResult(pending) ? "confirmed" : "draft";
  }

  if (interimDrafts) {
    return "inprogress";
  }

  const hasSnapshotScores = set.slots.some((slot) => slot.score !== null);
  if (!set.winnerId && hasSnapshotScores) {
    return "inprogress";
  }

  if (isCompletedSet(set) && Boolean(set.winnerId?.trim())) {
    return "confirmed";
  }

  return null;
}

export function getSetScoresForDisplay(
  set: SetSnapshot,
  result?: LocalSetResultMeta,
  interimDrafts?: SetScoreDraft,
): { scores: Record<string, string>; isDq: boolean; winnerId: string | null } {
  if (!result && interimDrafts) {
    const directWinner = set.slots.find((slot) => slot.entrantId && interimDrafts[slot.entrantId] === "W")?.entrantId;
    if (directWinner) {
      return {
        scores: Object.fromEntries(
          set.slots
            .filter((slot) => slot.entrantId)
            .map((slot) => [slot.entrantId as string, slot.entrantId === directWinner ? "W" : "L"]),
        ),
        isDq: false,
        winnerId: directWinner,
      };
    }
    const scores: Record<string, string> = {};
    let hasDq = false;

    for (const slot of set.slots) {
      if (!slot.entrantId) {
        continue;
      }

      const parsed = parseDraftScoreValue(interimDrafts[slot.entrantId] ?? "");
      if (parsed === null) {
        continue;
      }

      if (parsed < 0) {
        scores[slot.entrantId] = "DQ";
        hasDq = true;
      } else {
        scores[slot.entrantId] = String(parsed);
      }
    }

    const resolvedWinnerId = resolveWinnerIdFromDrafts(set, interimDrafts);
    return {
      scores,
      isDq: hasDq,
      winnerId: resolvedWinnerId === "" ? null : resolvedWinnerId,
    };
  }

  if (!result) {
    const winnerId = set.winnerId;
    if (winnerId) {
      const winnerSlot = set.slots.find((slot) => slot.entrantId === winnerId);
      const loserSlot = set.slots.find((slot) => slot.entrantId !== null && slot.entrantId !== winnerId);
      const winnerScore = winnerSlot ? toIntegerScore(winnerSlot.score) : null;
      const loserScore = loserSlot ? toIntegerScore(loserSlot.score) : null;
      const loserIsDq = loserSlot ? isDqScoreValue(loserSlot.score) : false;

      if (winnerSlot && loserSlot && !loserIsDq && (winnerScore === null || loserScore === null)) {
        const scores: Record<string, string> = { [winnerId]: "W" };
        if (loserSlot.entrantId) {
          scores[loserSlot.entrantId] = "L";
        }
        return { scores, isDq: false, winnerId };
      }

      if (winnerScore === null && loserScore === null && !loserIsDq) {
        const scores: Record<string, string> = {};
        for (const slot of set.slots) {
          if (slot.entrantId) {
            scores[slot.entrantId] = slot.entrantId === winnerId ? "W" : "L";
          }
        }
        return { scores, isDq: false, winnerId };
      }

      if (winnerScore !== null && (loserScore === null || loserIsDq)) {
        const scores: Record<string, string> = {};
        for (const slot of set.slots) {
          if (!slot.entrantId) {
            continue;
          }
          scores[slot.entrantId] = slot.entrantId === winnerId ? "✓" : "DQ";
        }
        return { scores, isDq: true, winnerId };
      }
    }

    return { scores: {}, isDq: false, winnerId };
  }

  const slotScores = result.slotScores ?? [];
  if (result.directWin) {
    const scores: Record<string, string> = {};
    for (const slot of set.slots) {
      if (slot.entrantId) {
        scores[slot.entrantId] = slot.entrantId === result.winnerId ? "W" : "L";
      }
    }
    return { scores, isDq: false, winnerId: result.winnerId };
  }

  if (slotScores.length > 0) {
    const scores: Record<string, string> = {};
    const matchedEntrantIds = new Set<string>();
    const unresolvedSlots: SetSlot[] = [];
    for (const slot of set.slots) {
      if (!slot.entrantId) {
        continue;
      }
      const matchedScore = slotScores.find((score) => score.entrantId === slot.entrantId);
      if (matchedScore) {
        scores[slot.entrantId] = matchedScore.score < 0 ? "DQ" : String(matchedScore.score);
        matchedEntrantIds.add(matchedScore.entrantId);
      } else {
        unresolvedSlots.push(slot);
      }
    }

    const unresolvedScores = slotScores.filter((slot) => !matchedEntrantIds.has(slot.entrantId));
    for (const [index, slot] of unresolvedSlots.entries()) {
      const fallbackScore = unresolvedScores[index];
      if (slot.entrantId && fallbackScore) {
        scores[slot.entrantId] = fallbackScore.score < 0 ? "DQ" : String(fallbackScore.score);
      }
    }

    return {
      scores,
      isDq: slotScores.some((slot) => slot.score < 0),
      winnerId: result.winnerId,
    };
  }

  if (isDqScoreCsvText(result.scoreCsv)) {
    const scores: Record<string, string> = {};
    for (const slot of set.slots) {
      if (slot.entrantId) {
        scores[slot.entrantId] = slot.entrantId === result.winnerId ? "✓" : "DQ";
      }
    }
    return { scores, isDq: true, winnerId: result.winnerId };
  }

  const parsed = parseScoreCsvText(result.scoreCsv);
  if (!parsed) {
    return { scores: {}, isDq: false, winnerId: result.winnerId };
  }

  const scores: Record<string, string> = {};
  for (const slot of set.slots) {
    if (!slot.entrantId) {
      continue;
    }
    scores[slot.entrantId] = slot.entrantId === result.winnerId
      ? String(parsed.winnerWins)
      : String(parsed.loserWins);
  }

  return { scores, isDq: false, winnerId: result.winnerId };
}

export function toIntegerScore(value: number | null): number | null {
  if (value === null) {
    return null;
  }

  const rounded = Math.round(value);
  if (Math.abs(value - rounded) > 0.000_001) {
    return null;
  }

  return rounded;
}

export function isDqScoreValue(value: number | null): boolean {
  return value !== null && value < 0;
}

export function parseDraftScoreValue(rawValue: string): number | null {
  const trimmed = rawValue.trim();
  if (trimmed === "") {
    return null;
  }

  if (trimmed === "-") {
    return -1;
  }

  const parsed = Number(trimmed);
  return Number.isInteger(parsed) ? parsed : null;
}

export function formatDraftScoreValue(value: number): string {
  return value < 0 ? "-" : String(Math.trunc(value));
}

export function stepScoreDraftValue(currentRaw: string, delta: number): string {
  const trimmed = currentRaw.trim();
  const parsed = Number(trimmed);
  const base = Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
  const next = Math.max(0, base + delta);
  return String(next);
}

export function applyScoreDraftWithOpponentDefault(
  set: SetSnapshot,
  current: SetScoreDraft,
  entrantId: string,
  nextValue: string,
): SetScoreDraft {
  const nextDrafts: SetScoreDraft = {
    ...current,
    [entrantId]: nextValue,
  };

  const parsedNext = parseDraftScoreValue(nextValue);
  if (parsedNext === null || parsedNext < 0) {
    return nextDrafts;
  }

  const otherEntrantId = set.slots.find((slot) => slot.entrantId !== null && slot.entrantId !== entrantId)?.entrantId;
  if (!otherEntrantId) {
    return nextDrafts;
  }

  const otherRaw = nextDrafts[otherEntrantId] ?? "";
  if (otherRaw.trim() !== "") {
    return nextDrafts;
  }

  nextDrafts[otherEntrantId] = "0";
  return nextDrafts;
}

export function parseScoreCsvText(rawScoreCsv: string): { winnerWins: number; loserWins: number } | null {
  const trimmed = rawScoreCsv.trim();
  if (trimmed === "") {
    return null;
  }

  const parts = trimmed.split("-").map((value) => value.trim());
  if (parts.length !== 2) {
    return null;
  }

  const winnerWins = Number(parts[0]);
  const loserWins = Number(parts[1]);
  if (!Number.isFinite(winnerWins) || !Number.isFinite(loserWins)) {
    return null;
  }

  return { winnerWins, loserWins };
}

export function isDqScoreCsvText(rawScoreCsv: string): boolean {
  const normalized = rawScoreCsv.trim().toLowerCase().replace(/\s+/g, "");
  return normalized === "dq" || /^\d+-dq$/.test(normalized);
}

export function buildScoreDraftsFromSet(set: SetSnapshot): SetScoreDraft {
  const drafts: SetScoreDraft = {};

  for (const slot of set.slots) {
    if (!slot.entrantId || slot.score === null) {
      continue;
    }

    drafts[slot.entrantId] = formatDraftScoreValue(slot.score);
  }

  return drafts;
}

export function buildScoreDraftsFromResult(set: SetSnapshot, result: LocalSetResultMeta): SetScoreDraft {
  const slotScores = result.slotScores ?? [];

  if (slotScores.length > 0) {
    const drafts = buildScoreDraftsFromSet(set);
    for (const slot of slotScores) {
      if (!(slot.entrantId in drafts)) {
        drafts[slot.entrantId] = slot.score < 0 ? "-" : formatDraftScoreValue(slot.score);
      }
    }
    return drafts;
  }

  if (isDqScoreCsvText(result.scoreCsv)) {
    const drafts: SetScoreDraft = {};
    for (const slot of set.slots) {
      if (!slot.entrantId) {
        continue;
      }
      drafts[slot.entrantId] = slot.entrantId === result.winnerId ? "0" : "-1";
    }
    return drafts;
  }

  const parsed = parseScoreCsvText(result.scoreCsv);
  if (!parsed) {
    return buildScoreDraftsFromSet(set);
  }

  const drafts: SetScoreDraft = {};
  for (const slot of set.slots) {
    if (!slot.entrantId) {
      continue;
    }

    drafts[slot.entrantId] = slot.entrantId === result.winnerId
      ? String(parsed.winnerWins)
      : String(parsed.loserWins);
  }

  return drafts;
}

export function buildDraftStateFromPending(set: SetSnapshot, result: LocalSetResultMeta): SetResultDraftState {
  if (result.directWin) {
    return {
      winnerId: result.winnerId,
      scoreDrafts: Object.fromEntries(
        set.slots
          .filter((slot) => slot.entrantId)
          .map((slot) => [slot.entrantId as string, slot.entrantId === result.winnerId ? "W" : "L"]),
      ),
      directWin: true,
    };
  }
  return {
    winnerId: result.winnerId,
    scoreDrafts: buildScoreDraftsFromResult(set, result),
  };
}

export function buildDqDraftStateForEntrant(set: SetSnapshot, dqEntrantId: string): SetResultDraftState | null {
  const entrantIds = set.slots
    .map((slot) => slot.entrantId)
    .filter((entrantId): entrantId is string => entrantId !== null);

  if (entrantIds.length < 2 || !entrantIds.includes(dqEntrantId)) {
    return null;
  }

  const winnerId = entrantIds.find((entrantId) => entrantId !== dqEntrantId);
  if (!winnerId) {
    return null;
  }

  const scoreDrafts = buildScoreDraftsFromSet(set);
  scoreDrafts[dqEntrantId] = "-";
  scoreDrafts[winnerId] = "0";

  return { winnerId, scoreDrafts };
}

export function resolveWinnerIdFromDrafts(set: SetSnapshot, drafts: SetScoreDraft): string {
  const scored = set.slots
    .map((slot) => {
      if (!slot.entrantId) {
        return null;
      }

      const score = parseDraftScoreValue(drafts[slot.entrantId] ?? "");
      return score === null ? null : { entrantId: slot.entrantId, score };
    })
    .filter((slot): slot is { entrantId: string; score: number } => slot !== null);

  if (scored.length < 2) {
    return "";
  }

  const dqSlot = scored.find((slot) => slot.score < 0);
  const nonDqSlot = scored.find((slot) => slot.score >= 0);
  if (dqSlot && nonDqSlot && scored.length === 2) {
    return nonDqSlot.entrantId;
  }

  const sorted = [...scored].sort((left, right) => right.score - left.score);
  if (sorted[0].score === sorted[1].score) {
    return "";
  }

  return sorted[0].entrantId;
}

export function buildSlotScoresForSave(
  set: SetSnapshot,
  drafts: SetScoreDraft,
): Array<{ entrantId: string; score: number }> {
  const entries = set.slots
    .filter((slot): slot is SetSlot & { entrantId: string } => slot.entrantId !== null)
    .map((slot) => {
      const raw = drafts[slot.entrantId] ?? "";
      return {
        entrantId: slot.entrantId,
        entrantName: slot.entrantName,
        raw,
        score: parseDraftScoreValue(raw),
      };
    });

  if (entries.length < 2) {
    throw new Error("結果入力には少なくとも2人のプレイヤーが必要です。");
  }

  const unfilled = entries.filter((entry) => entry.score === null && entry.raw.trim() === "");
  if (unfilled.length === 1) {
    const hasNonDqScore = entries.some((entry) => entry.score !== null && entry.score >= 0);
    if (hasNonDqScore) {
      unfilled[0].score = 0;
    }
  }

  const slotScores: Array<{ entrantId: string; score: number }> = [];
  for (const entry of entries) {
    if (entry.score === null) {
      throw new Error(`スコアが未入力です: ${entry.entrantName}`);
    }
    slotScores.push({ entrantId: entry.entrantId, score: entry.score });
  }

  return slotScores;
}

export function hasDqScoreInDrafts(set: SetSnapshot, drafts: SetScoreDraft): boolean {
  for (const slot of set.slots) {
    if (!slot.entrantId) {
      continue;
    }

    const parsed = parseDraftScoreValue(drafts[slot.entrantId] ?? "");
    if (parsed !== null && parsed < 0) {
      return true;
    }
  }

  return false;
}