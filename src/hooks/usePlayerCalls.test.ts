import { describe, expect, it } from "vitest";
import { buildPlayerCallDisplayMessages, type PlayerCall } from "./usePlayerCalls";
import type { FeatureMessage } from "../domain/messages";

const callMessage: FeatureMessage = {
  destination: "call_list",
  messageId: "call",
  threadId: "call",
  parentMessageId: null,
  messageType: "normal",
  messageMeta: null,
  method: "call_player",
  subject: "Call",
  senderName: "Operator",
  senderUserId: "12345678",
  senderIp: "192.168.1.10",
  body: "Call",
  createdAt: "2026-10-14T00:00:00Z",
};

describe("player call display timestamps", () => {
  it("keeps the original call issue time when a resend updates the receipt time", () => {
    const calls: PlayerCall[] = [{
      message: callMessage,
      receivedAt: "2026-10-14T01:00:00Z",
    }];
    expect(buildPlayerCallDisplayMessages(calls)[0].createdAt).toBe(callMessage.createdAt);
  });

  it("falls back to the receipt time for a legacy call without an issue timestamp", () => {
    const calls: PlayerCall[] = [{
      message: { ...callMessage, createdAt: "" },
      receivedAt: "2026-10-14T01:00:00Z",
    }];
    expect(buildPlayerCallDisplayMessages(calls)[0].createdAt).toBe("2026-10-14T01:00:00Z");
  });
});
