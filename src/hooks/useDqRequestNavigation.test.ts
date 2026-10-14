import { describe, expect, it, vi } from "vitest";
import { useDqRequestNavigation } from "./useDqRequestNavigation";
import type { FeatureMessage } from "../domain/messages";
import type { SetSnapshot } from "../domain/bracketProgression";
import { isDqRequestConfirmed } from "../domain/messageUtils";

const match: SetSnapshot = {
  setId: "set", phaseGroupId: "pool", phaseName: "Main", phaseGroupName: "A", phaseOrder: 1,
  fullRoundText: "Final", round: 1, phaseGroupDisplayIdentifier: "A", state: 1, winnerId: null,
  entrant1Source: null, entrant2Source: null,
  slots: ["player", "opponent"].map((id) => ({
    entrantId: id, entrantName: id, seedId: null, seedNum: null, score: null,
  })),
};
const request: FeatureMessage = {
  messageId: "dq", threadId: "unused", parentMessageId: null,
  method: "player_dq_request", messageType: "dq_request", destination: "bracket",
  messageMeta: { scopeEventId: "event", phaseGroupId: "pool", dqSetId: "set", dqCallEntrantId: "player" },
  subject: "DQ", body: "DQ", senderName: "Requester", senderUserId: "87654321",
  senderIp: "192.168.1.20", createdAt: "2026-10-14T00:00:00Z",
};
function setup() {
  const options = {
    event: { eventId: "event", name: "Event", phases: [], sets: [match] },
    resolvedSetsById: new Map([["set", match]]),
    setSelectedPhaseName: vi.fn(), setSelectedPhasePoolKey: vi.fn(), setActiveTab: vi.fn(),
    openMatchDialog: vi.fn(), onError: vi.fn(), onMessage: vi.fn(),
  };
  return { options, ...useDqRequestNavigation(options) };
}
describe("received DQ navigation", () => {
  it("opens a DQ preset for manual confirmation in its stable pool without mailbox history", () => {
    const { options, processDqRequestFromMessage } = setup();
    processDqRequestFromMessage(request);
    expect(options.setSelectedPhasePoolKey).toHaveBeenCalledWith("id:pool");
    expect(options.openMatchDialog).toHaveBeenCalledWith(match, expect.objectContaining({
      scoreDrafts: expect.objectContaining({ player: "-", opponent: "0" }),
      winnerId: "opponent",
    }));
    expect(options.onMessage).toHaveBeenCalledWith(expect.stringContaining("確定"));
  });
  it.each([
    { scopeEventId: "wrong" }, { phaseGroupId: "wrong" }, { dqSetId: "missing" },
    { dqCallEntrantId: "missing" },
  ])("rejects a wrong target: %j", (meta) => {
    const { options, processDqRequestFromMessage } = setup();
    processDqRequestFromMessage({ ...request, messageMeta: { ...request.messageMeta, ...meta } });
    expect(options.openMatchDialog).not.toHaveBeenCalled();
    expect(options.onError).toHaveBeenCalledWith(expect.stringMatching(/\S/));
  });
  it("processes only confirmation of a DQ for the same event, pool, set, and player", () => {
    const result = {
      eventId: "event", phaseGroupId: "pool", setId: "set",
      slotScores: [{ entrantId: "player", score: -1 }, { entrantId: "opponent", score: 0 }],
    };
    expect(isDqRequestConfirmed(request, result)).toBe(true);
    for (const field of ["eventId", "phaseGroupId", "setId"] as const) {
      expect(isDqRequestConfirmed(request, { ...result, [field]: "wrong" })).toBe(false);
    }
    expect(isDqRequestConfirmed(request, { ...result, slotScores: [{ entrantId: "player", score: 0 }] })).toBe(false);
    expect(isDqRequestConfirmed(request, { ...result, slotScores: [{ entrantId: "opponent", score: -1 }] })).toBe(false);
  });
});
