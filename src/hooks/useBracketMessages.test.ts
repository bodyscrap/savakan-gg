import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import type { FeatureMessage } from "../domain/messages";
import { createBracketMessaging } from "./useBracketMessages";
import { getExternalEditRequest, getExternalScoreReportBatch, normalizeFeatureMessage, type ExternalScoreReport } from "../domain/messageUtils";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const request: FeatureMessage = {
  destination: "bracket", messageId: "request", threadId: "unused", parentMessageId: null,
  messageType: "normal", method: "external_edit_request", subject: "Request", body: "Request",
  senderName: "Reporter", senderUserId: "87654321", senderIp: "192.168.1.20",
  createdAt: "2026-10-14T00:00:00Z",
  messageMeta: {
    externalEditRequest: true, externalEditTournamentId: "tournament", externalEditSlug: "slug",
    externalEditEventId: "event", externalEditEventName: "Event", externalEditPhaseName: "Main",
    externalEditPhaseGroupId: "pool", externalEditPhaseGroupName: "A",
    externalEditorName: "Reporter", externalEditorSenderUserId: "87654321",
  },
};

const report: ExternalScoreReport = {
  tournamentId: "tournament", slug: "slug", eventId: "event", eventName: "Event",
  phaseName: "Main", phaseGroupId: "pool", phaseGroupName: "A", sequence: 1,
  setId: "set", winnerId: "entrant-1", directWin: false,
  slotScores: [{ entrantId: "entrant-1", score: 2 }, { entrantId: "entrant-2", score: 1 }],
};

function setup(disabled = false) {
  const options = {
    senderProfile: {
      senderName: "Operator", senderUserId: "12345678",
      bindIp: "192.168.1.10", broadcastSubnetMask: "255.255.255.0",
    },
    scope: { tournamentId: "tournament", slug: "slug", eventId: "event", phaseName: "Main", phaseGroupName: "A" },
    communicationDisabled: disabled,
    refresh: vi.fn(async () => undefined),
    onError: vi.fn(), onMessage: vi.fn(),
  };
  return { options, ...createBracketMessaging(options) };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(invoke).mockResolvedValue(undefined);
});

describe("feature-routed external report messaging", () => {
  it("broadcasts requests directly to bracket without starting a thread", async () => {
    const target = getExternalEditRequest(request);
    expect(target).not.toBeNull();
    const actions = setup();
    expect(await actions.sendExternalEditRequest(target!)).toBe(true);
    expect(invoke).toHaveBeenCalledWith("send_mailbox_message", {
      input: expect.objectContaining({
        destination: "bracket", method: "external_edit_request", deliveryTargetMode: "broadcast",
        deliveryTargetIp: null, parentMessageId: null, threadId: null,
        messageMeta: expect.objectContaining({ externalEditPhaseGroupId: "pool" }),
      }),
    });
    expect(actions.options.refresh).toHaveBeenCalledOnce();
  });

  it.each([true, false])("sends accepted=%s only to the applicant, with independent correlation", async (accepted) => {
    const actions = setup();
    expect(await actions.replyToExternalEditRequest(request, accepted)).toBe(true);
    expect(invoke).toHaveBeenCalledWith("send_mailbox_message", {
      input: expect.objectContaining({
        destination: "bracket", method: "external_edit_request_response",
        deliveryTargetMode: "direct", deliveryTargetIp: "192.168.1.20",
        parentMessageId: null, threadId: null,
        messageMeta: expect.objectContaining({
          requestMessageId: "request",
          externalEditRequestResponse: accepted ? "accepted" : "rejected",
          externalEditEventId: "event", externalEditPhaseGroupId: "pool",
        }),
      }),
    });
  });

  it("broadcasts normal reports without changing their result payload", async () => {
    await setup().sendExternalScoreReport(report);
    const [, args] = vi.mocked(invoke).mock.calls[0];
    expect(args).toEqual({
      input: expect.objectContaining({
        destination: "bracket", method: "external_score_report",
        deliveryTargetMode: "broadcast", deliveryTargetIp: null,
        messageMeta: expect.objectContaining({
          externalScoreReports: [report], externalScoreReportResend: false,
        }),
      }),
    });
    if (!args || !("input" in args)) throw new Error("Expected invocation arguments");
    const input = args.input;
    if (!input || typeof input !== "object" || !("messageMeta" in input)) {
      throw new Error("Expected a structured message");
    }
    const envelope = normalizeFeatureMessage({
      ...request, method: "external_score_report", messageMeta: input.messageMeta,
    });
    expect(envelope && getExternalScoreReportBatch(envelope)?.reports).toEqual([report]);
  });

  it("keeps synchronization resends direct, including the pool reset flag", async () => {
    await setup().sendExternalScoreReports([report], "192.168.1.30", true);
    expect(invoke).toHaveBeenCalledWith("send_mailbox_message", {
      input: expect.objectContaining({
        destination: "bracket", deliveryTargetMode: "direct", deliveryTargetIp: "192.168.1.30",
        messageMeta: expect.objectContaining({ externalScoreReportResend: true, externalScoreReportResetPool: true }),
      }),
    });
  });

  it("requests a full pool sync directly from the external reporter", async () => {
    await setup().sendExternalScoreSyncRequest({
      tournamentId: "tournament", slug: "slug", eventId: "event", phaseGroupId: "pool",
      fromSequence: 1, resetPool: true,
    }, "192.168.1.20");
    expect(invoke).toHaveBeenCalledWith("send_mailbox_message", {
      input: expect.objectContaining({
        destination: "bracket", method: "external_score_sync_request",
        deliveryTargetMode: "direct", deliveryTargetIp: "192.168.1.20",
        messageMeta: expect.objectContaining({
          externalScoreSyncTournamentId: "tournament",
          externalScoreSyncEventId: "event",
          externalScoreSyncPhaseGroupId: "pool",
          externalScoreSyncFromSequence: 1,
          externalScoreSyncResetPool: true,
        }),
      }),
    });
  });

  it("correlates report acknowledgements without a thread", async () => {
    expect(await setup().replyToExternalScoreReport({ ...request, method: "external_score_report" }, false, "reason")).toBe(true);
    expect(invoke).toHaveBeenCalledWith("send_mailbox_message", {
      input: expect.objectContaining({
        method: "external_score_report_response", destination: "bracket",
        deliveryTargetIp: request.senderIp, parentMessageId: null, threadId: null,
        messageMeta: expect.objectContaining({ requestMessageId: "request", externalScoreReportResponse: "rejected" }),
      }),
    });
  });

  it("rejects disabled communication without sending or clearing requests", async () => {
    const actions = setup(true);
    expect(await actions.replyToExternalEditRequest(request, true)).toBe(false);
    expect(invoke).not.toHaveBeenCalled();
    expect(actions.options.refresh).not.toHaveBeenCalled();
    expect(actions.options.onError).toHaveBeenLastCalledWith(expect.stringContaining("応答"));
    await expect(actions.sendExternalScoreReport(report)).rejects.toThrow("ローカル通信");
  });

  it("reports a failed response and does not claim that the request was processed", async () => {
    vi.mocked(invoke).mockRejectedValue(new Error("UDP failure"));
    const actions = setup();
    expect(await actions.replyToExternalEditRequest(request, false)).toBe(false);
    expect(actions.options.onError).toHaveBeenLastCalledWith("Error: UDP failure");
    expect(actions.options.refresh).not.toHaveBeenCalled();
    expect(actions.options.onMessage).toHaveBeenCalledExactlyOnceWith("");
  });
});
