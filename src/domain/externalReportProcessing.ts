import type { FeatureMessage } from "./messages";
import type { EventSnapshot } from "./bracketDisplay";
import type { SetSnapshot } from "./bracketProgression";
import type { EventLocalMeta } from "./tournamentWorkspaceRepository";
import { getExternalEditRequest, getExternalScoreReport } from "./messageUtils";

export function getLatestPoolExternalRequest(
  messages: FeatureMessage[], tournamentId: string, eventId: string, phaseGroupId: string,
): FeatureMessage | null {
  return messages.slice().reverse().find((message) => {
    const request = getExternalEditRequest(message);
    return request?.tournamentId === tournamentId
      && request.eventId === eventId && request.phaseGroupId === phaseGroupId;
  }) ?? null;
}

export function getExternalReportRejectionReason(
  message: FeatureMessage,
  tournamentId: string | null,
  event: EventSnapshot | null,
  eventMeta: EventLocalMeta | null | undefined,
  sets: ReadonlyMap<string, SetSnapshot>,
): string | null {
  const report = getExternalScoreReport(message);
  if (!report || !tournamentId || !event) {
    return "対象のスナップショットまたはイベントを選択できません。";
  }
  if (
    eventMeta?.eventId !== event.eventId
    || report.tournamentId !== tournamentId
    || report.eventId !== event.eventId
    || message.senderName.trim() === ""
  ) {
    return "対象イベントまたは送信者情報が一致しません。";
  }
  const set = sets.get(report.setId);
  if (!set?.phaseGroupId) {
    return "対象setまたはプールをsnapshot内で特定できません。";
  }
  if (report.phaseGroupId && report.phaseGroupId !== set.phaseGroupId) {
    return "報告されたPoolと対象setのPoolが一致しません。";
  }
  const scoreEditLocked = !(eventMeta.scoreEditEnabledPhaseGroupIds ?? []).includes(set.phaseGroupId);
  if (!scoreEditLocked) {
    return "対象プールのスコア編集がロックされていません。";
  }
  const authorizedEditor = (eventMeta.externalEditors ?? []).some(
    (editor) => editor.phaseGroupId === set.phaseGroupId && editor.senderUserId === message.senderUserId,
  );
  if (!authorizedEditor) {
    return "送信者は対象プールの承認済み外部報告者ではありません。";
  }
  if (report.sequence !== undefined) {
    return null;
  }
  const setEntrantIds = set.slots.map((slot) => slot.entrantId)
    .filter((entrantId): entrantId is string => entrantId !== null).sort();
  const reportEntrantIds = report.slotScores.map((score) => score.entrantId).sort();
  if (
    setEntrantIds.length !== 2
    || setEntrantIds.length !== reportEntrantIds.length
    || !setEntrantIds.every((entrantId, index) => entrantId === reportEntrantIds[index])
    || !report.slotScores.some((score) => score.entrantId === report.winnerId)
  ) {
    return "報告内容と対象setの参加者または勝者が一致しません。";
  }
  return null;
}
