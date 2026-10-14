import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { sendPlayerDqRequest } from "./usePlayerDqRequest";
import type { FeatureMessage } from "../domain/messages";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const profile = {
  senderName: "Requester", senderUserId: "12345678",
  bindIp: "192.168.1.10", broadcastSubnetMask: "255.255.255.0",
};
const call: FeatureMessage = {
  messageId: "call", threadId: "unused", parentMessageId: null, messageType: "normal",
  method: "call_player", destination: "call_list",
  messageMeta: {
    scopeEventId: "event", phaseId: "phase", phaseGroupId: "pool",
    playerId: "PG-PLAYER", setId: "set", callEntrantId: "entrant", callEntrantName: "Player",
  },
  subject: "Call", body: "Call", senderName: "Caller", senderUserId: "87654321",
  senderIp: "192.168.1.20", createdAt: "2026-10-14T00:00:00Z",
};
beforeEach(() => { vi.clearAllMocks(); vi.mocked(invoke).mockResolvedValue(undefined); });

describe("DQ requests from remote call cards", () => {
  it("authenticates and sends directly to the caller without a thread", async () => {
    await sendPlayerDqRequest(profile, call, " pg-player ", " absent ");
    expect(invoke).toHaveBeenCalledWith("send_mailbox_message", {
      input: expect.objectContaining({
        destination: "bracket", method: "player_dq_request", messageType: "dq_request",
        profile, deliveryTargetMode: "direct", deliveryTargetIp: call.senderIp,
        threadId: null, parentMessageId: null,
        messageMeta: {
          ...call.messageMeta, dqCallMessageId: "call", dqCallerSenderUserId: "87654321",
          dqPlayerId: "PG-PLAYER", dqCallEntrantId: "entrant", dqCallEntrantName: "Player",
          dqSetId: "set", dqReason: "absent",
        },
      }),
    });
  });
  it.each(["PG-WRONG", "", "invalid"])("rejects invalid or mismatched authentication: %s", async (id) => {
    await expect(sendPlayerDqRequest(profile, call, id, "")).rejects.toThrow("PLAYER ID");
    expect(invoke).not.toHaveBeenCalled();
  });
  it("rejects own calls, invalid contacts, and disabled communication", async () => {
    await expect(sendPlayerDqRequest(profile, { ...call, senderUserId: profile.senderUserId }, "PG-PLAYER", "")).rejects.toThrow();
    await expect(sendPlayerDqRequest(profile, { ...call, senderIp: "" }, "PG-PLAYER", "")).rejects.toThrow();
    await expect(sendPlayerDqRequest(profile, call, "PG-PLAYER", "", true)).rejects.toThrow("ローカル通信");
    expect(invoke).not.toHaveBeenCalled();
  });
  it("rejects an unconfigured sender and scopes calls containing legacy event metadata", async () => {
    await expect(sendPlayerDqRequest({ ...profile, bindIp: "" }, call, "PG-PLAYER", "")).rejects.toThrow("設定");
    expect(invoke).not.toHaveBeenCalled();
    await sendPlayerDqRequest(profile, {
      ...call, messageMeta: { ...call.messageMeta, scopeEventId: undefined, eventId: "event" },
    }, "PG-PLAYER", "");
    expect(invoke).toHaveBeenCalledWith("send_mailbox_message", {
      input: expect.objectContaining({ messageMeta: expect.objectContaining({ scopeEventId: "event" }) }),
    });
  });
  it("surfaces backend rejection of a resolved call", async () => {
    vi.mocked(invoke).mockRejectedValue(new Error("Call no longer active"));
    await expect(sendPlayerDqRequest(profile, call, "PG-PLAYER", "")).rejects.toThrow("Call no longer active");
  });
});
