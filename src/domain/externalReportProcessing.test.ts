import { describe, expect, it } from "vitest";
import type { FeatureMessage } from "./messages";
import type { SetSnapshot } from "./bracketProgression";
import type { EventLocalMeta } from "./tournamentWorkspaceRepository";
import { getExternalReportRejectionReason, getLatestPoolExternalRequest } from "./externalReportProcessing";
import type { ExternalScoreReport } from "./messageUtils";

const set: SetSnapshot = {
  setId: "set", phaseGroupId: "pool", fullRoundText: "Final", round: 1,
  phaseName: "Main", phaseGroupName: "A", phaseOrder: 1, phaseGroupDisplayIdentifier: "A",
  state: 1, winnerId: null, entrant1Source: null, entrant2Source: null,
  slots: ["entrant-1", "entrant-2"].map((entrantId) => ({
    entrantId, entrantName: entrantId, seedId: null, seedNum: null, score: null,
  })),
};
const event = { eventId: "event", name: "Event", sets: [set] };
const meta: EventLocalMeta = {
  eventId: "event", eventName: "Event", eventAlias: null, entrants: [],
  scoreEditEnabledPhaseGroupIds: [],
  externalEditors: [{ phaseGroupId: "pool", senderName: "Reporter", senderUserId: "87654321" }],
};
const baseMessage: FeatureMessage = {
  destination: "bracket", messageId: "report", threadId: "unused", parentMessageId: null,
  messageType: "normal", method: "external_score_report", subject: "Report", body: "Report",
  senderName: "Reporter", senderUserId: "87654321", senderIp: "192.168.1.20",
  createdAt: "2026-10-14T00:00:00Z", messageMeta: null,
};
function report(overrides: Partial<ExternalScoreReport> = {}): FeatureMessage {
  return {
    ...baseMessage,
    messageMeta: {
      externalScoreReport: true,
      externalScoreReports: [{
        tournamentId: "tournament", slug: "slug", eventId: "event", eventName: "Event",
        phaseName: "Main", phaseGroupId: "pool", phaseGroupName: "A",
        setId: "set", winnerId: "entrant-1", directWin: false,
        slotScores: [{ entrantId: "entrant-1", score: 2 }, { entrantId: "entrant-2", score: 1 }],
        ...overrides,
        sequence: overrides.sequence ?? 1,
      }],
    },
  };
}
function reason(message = report(), metadata = meta) {
  return getExternalReportRejectionReason(message, "tournament", event, metadata, new Map([["set", set]]));
}

describe("preserved external report acceptance rules", () => {
  it("accepts an authorized reporter only on a locked matching pool", () => {
    expect(reason()).toBeNull();
    expect(reason(report(), { ...meta, scoreEditEnabledPhaseGroupIds: ["pool"] })).toContain("ロック");
    expect(reason(report(), { ...meta, externalEditors: [] })).toContain("承認済み");
  });
  it("rejects mismatched tournament, event, pool and unknown sets", () => {
    expect(reason(report({ tournamentId: "other" }))).toContain("一致");
    expect(reason(report({ eventId: "other" }))).toContain("一致");
    expect(reason(report({ phaseGroupId: "other" }))).toContain("Pool");
    expect(reason(report({ setId: "missing" }))).toContain("対象set");
  });
  it("does not accept messages routed to another feature", () => {
    expect(reason({ ...report(), destination: "message" })).not.toBeNull();
  });
  it("defers sequenced roster checks to ordered graph application, as before", () => {
    expect(reason(report({
      slotScores: [{ entrantId: "entrant-1", score: 2 }, { entrantId: "upcoming", score: 1 }],
      sequence: 2,
    }))).toBeNull();
  });
  it("checks both participants for legacy reports without a sequence", () => {
    const legacy = {
      ...baseMessage,
      messageMeta: {
        externalScoreReport: true,
        externalScoreReportTournamentId: "tournament", externalScoreReportEventId: "event",
        externalScoreReportSetId: "set", externalScoreReportPhaseGroupId: "pool",
        externalScoreReportWinnerId: "entrant-1", externalScoreReportDirectWin: false,
        externalScoreReportSlotScores: [
          { entrantId: "entrant-1", score: 2 }, { entrantId: "entrant-2", score: 1 },
        ],
      },
    };
    expect(reason(legacy)).toBeNull();
    expect(reason({
      ...legacy,
      messageMeta: {
        ...legacy.messageMeta,
        externalScoreReportSlotScores: [
          { entrantId: "entrant-1", score: 2 }, { entrantId: "other", score: 1 },
        ],
      },
    })).toContain("参加者");
  });
  it("requires snapshot and event metadata", () => {
    expect(getExternalReportRejectionReason(report(), null, event, meta, new Map())).not.toBeNull();
    expect(reason(report(), { ...meta, eventId: "other" })).toContain("一致");
  });
});

describe("latest request selection", () => {
  function request(id: string, pool = "pool"): FeatureMessage {
    return {
      ...baseMessage, messageId: id, method: "external_edit_request",
      messageMeta: {
        externalEditRequest: true, externalEditTournamentId: "tournament", externalEditSlug: "slug",
        externalEditEventId: "event", externalEditEventName: "Event", externalEditPhaseName: "Main",
        externalEditPhaseGroupId: pool, externalEditPhaseGroupName: "A",
        externalEditorName: "Reporter", externalEditorSenderUserId: "87654321",
      },
    };
  }
  it("selects only the last received request for the selected pool", () => {
    const latest = { ...request("latest"), createdAt: "2020-01-01T00:00:00Z" };
    expect(getLatestPoolExternalRequest(
      [request("old"), latest, request("other-pool", "other"), report()], "tournament", "event", "pool",
    )?.messageId).toBe("latest");
    expect(getLatestPoolExternalRequest([latest], "other", "event", "pool")).toBeNull();
    expect(getLatestPoolExternalRequest([latest], "tournament", "other", "pool")).toBeNull();
  });
});
