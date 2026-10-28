import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { useCallMessage } from "./useCallMessage";
import type { SetSlot, SetSnapshot } from "../domain/bracketProgression";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const slot: SetSlot = {
  entrantId: "entrant", entrantName: "Player", seedId: null, seedNum: null, score: null,
};
const match: SetSnapshot = {
  setId: "set", phaseGroupId: "pool-id", fullRoundText: "Final", round: 1,
  phaseName: "Main", phaseGroupName: "A", phaseOrder: 1,
  phaseGroupDisplayIdentifier: "A", state: 1, winnerId: null,
  entrant1Source: null, entrant2Source: null, slots: [slot],
};
const profile = {
  senderName: "Operator", senderUserId: "12345678",
  bindIp: "192.168.1.10", broadcastSubnetMask: "255.255.255.0",
};

function setup(disabled = false) {
  const options = {
    tournament: { tournamentId: "tournament", name: "Tournament" },
    event: {
      eventId: "event", name: "Event", sets: [match],
      phases: [{ phaseId: "phase-id", name: "Main", phaseOrder: 1 }],
    },
    activeMatch: match,
    eventAlias: "Alias",
    senderProfile: profile,
    communicationDisabled: disabled,
    setCallingEntrantId: vi.fn(),
    refreshCalls: vi.fn(async () => undefined),
    onError: vi.fn(),
    onMessage: vi.fn(),
  };
  return { options, ...useCallMessage(options) };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("window", { confirm: vi.fn(() => true) });
  vi.mocked(invoke).mockImplementation(async (command) =>
    command === "derive_player_ids" ? ["PG-PLAYER"] : undefined);
});

describe("direct bracket calls", () => {
  it.each([false, true])("waits for an asynchronous confirmation before sending (%s)", async (confirmed) => {
    let answer!: (value: boolean) => void;
    vi.stubGlobal("window", {
      confirm: vi.fn(() => new Promise<boolean>((resolve) => { answer = resolve; })),
    });
    const { sendCallMessageFromMatch, options } = setup();
    const operation = sendCallMessageFromMatch(slot, "entrant");
    expect(invoke).not.toHaveBeenCalled();
    expect(options.setCallingEntrantId).not.toHaveBeenCalled();
    answer(confirmed);
    await operation;
    expect(invoke).toHaveBeenCalledTimes(confirmed ? 2 : 0);
  });

  it("confirms and broadcasts to call_list without composing a mailbox thread", async () => {
    const { sendCallMessageFromMatch, options } = setup();
    await sendCallMessageFromMatch(slot, "entrant");
    expect(window.confirm).toHaveBeenCalledOnce();
    expect(invoke).toHaveBeenCalledWith("send_mailbox_message", {
      input: expect.objectContaining({
        destination: "call_list", method: "call_player",
        deliveryTargetMode: "broadcast", deliveryTargetIp: null,
        parentMessageId: null, threadId: null,
        messageMeta: expect.objectContaining({
          eventId: "event", phaseId: "phase-id", phaseGroupId: "pool-id",
          setId: "set", playerId: "PG-PLAYER", callEntrantId: "entrant",
        }),
      }),
    });
    expect(options.refreshCalls).toHaveBeenCalledOnce();
    expect(options.setCallingEntrantId).toHaveBeenLastCalledWith("");
  });

  it("does not send or derive IDs when confirmation is cancelled", async () => {
    vi.mocked(window.confirm).mockReturnValue(false);
    await setup().sendCallMessageFromMatch(slot, "entrant");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("rejects disabled communication before confirming", async () => {
    const { options, sendCallMessageFromMatch } = setup(true);
    await sendCallMessageFromMatch(slot, "entrant");
    expect(window.confirm).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
    expect(options.onError).toHaveBeenLastCalledWith(expect.stringContaining("送信できません"));
  });

  it("surfaces delivery errors and releases the sending indicator", async () => {
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "derive_player_ids") {
        return ["PG-PLAYER"];
      }
      throw new Error("UDP failure");
    });
    const { options, sendCallMessageFromMatch } = setup();
    await sendCallMessageFromMatch(slot, "entrant");
    expect(options.onError).toHaveBeenLastCalledWith("Error: UDP failure");
    expect(options.setCallingEntrantId).toHaveBeenLastCalledWith("");
    expect(options.refreshCalls).not.toHaveBeenCalled();
  });
});
