import { describe, expect, it } from "vitest";
import type { FeatureMessage } from "../domain/messages";
import { countCallListRootCounts } from "./useCallList";

function call(
  messageId: string,
  senderUserId: string,
  messageMeta: Record<string, unknown> | null = null,
  messageType: FeatureMessage["messageType"] = "normal",
): FeatureMessage {
  return {
    destination: "call_list",
    messageId,
    threadId: messageId,
    parentMessageId: null,
    messageType,
    messageMeta,
    method: "call_player",
    subject: "Player call",
    senderName: "Sender",
    senderUserId,
    senderIp: "192.168.1.10",
    body: "Player call",
    createdAt: "2026-10-14T00:00:00Z",
  };
}

describe("call-list sidebar counts", () => {
  it("counts other-device calls separately from playing notices received from other devices", () => {
    const calls = [
      call("own-call", "local-user", {
        callPlayerPlaying: true,
        callPlayerPlayingSenderUserId: "remote-user",
      }),
      call("remote-call", "remote-user", {
        callPlayerPlaying: true,
        callPlayerPlayingSenderUserId: "local-user",
      }),
      call("remote-call-inactive", "remote-user"),
      call("resolved-call", "remote-user", null, "resolve"),
    ];

    expect(countCallListRootCounts(calls, "local-user")).toEqual({
      total: 3,
      own: 1,
      hidden: 2,
      otherDeviceCalls: 2,
      receivedPlaying: 1,
    });
  });
});
