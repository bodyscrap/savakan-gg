import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { useCallSync } from "./useCallSync";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

function setup(canBroadcastSync = true) {
  const options = {
    senderProfile: {
      senderName: "Operator", senderUserId: "12345678",
      bindIp: "192.168.1.10", broadcastSubnetMask: "255.255.255.0",
    },
    communicationDisabled: false,
    canBroadcastSync,
    shouldWarnIdentityChange: false,
    resetDisplay: vi.fn(),
    refreshCalls: vi.fn(async () => undefined),
    onError: vi.fn(),
    onMessage: vi.fn(),
  };
  return { options, ...useCallSync(options) };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(invoke).mockResolvedValue(undefined);
});

describe("call resend requests", () => {
  it("sends one broadcast request instead of thread/status synchronization", async () => {
    const { options, requestUnresolvedCallSyncBroadcast } = setup();
    await requestUnresolvedCallSyncBroadcast();
    expect(invoke).toHaveBeenCalledOnce();
    expect(invoke).toHaveBeenCalledWith("send_mailbox_message", {
      input: expect.objectContaining({
        destination: "call_list", method: "call_player_sync_request",
        deliveryTargetMode: "broadcast", threadId: null, parentMessageId: null,
      }),
    });
    expect(options.refreshCalls).toHaveBeenCalledOnce();
    expect(options.resetDisplay).toHaveBeenCalledWith({ rebuild: true });
  });

  it("does not clear the list when the sender is not configured", async () => {
    const { options, requestUnresolvedCallSyncBroadcast } = setup(false);
    await requestUnresolvedCallSyncBroadcast();
    expect(invoke).not.toHaveBeenCalled();
    expect(options.resetDisplay).not.toHaveBeenCalled();
    expect(options.onError).toHaveBeenLastCalledWith(expect.stringContaining("設定"));
  });

  it("refreshes persisted state and reports failure without claiming success", async () => {
    vi.mocked(invoke).mockRejectedValue(new Error("UDP failure"));
    const { options, requestUnresolvedCallSyncBroadcast } = setup();
    await requestUnresolvedCallSyncBroadcast();
    expect(options.refreshCalls).toHaveBeenCalledOnce();
    expect(options.onError).toHaveBeenLastCalledWith("Error: UDP failure");
    expect(options.onMessage).toHaveBeenCalledTimes(1);
    expect(options.onMessage).toHaveBeenCalledWith("");
  });
});
