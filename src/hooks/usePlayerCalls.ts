import { useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useFeatureInbox } from "./useFeatureInbox";
import type { FeatureMessage } from "../domain/messages";
import type { SenderProfile } from "./useSenderProfile";

export type PlayerCall = {
  message: FeatureMessage;
  receivedAt: string;
};

export function buildPlayerCallDisplayMessages(calls: PlayerCall[]): FeatureMessage[] {
  return calls.map(({ message, receivedAt }) => ({
    ...message,
    createdAt: message.createdAt.trim() !== "" ? message.createdAt : receivedAt,
  }));
}

type Options = {
  senderProfile: SenderProfile;
  communicationDisabled: boolean;
  onError: (error: string) => void;
};

export function usePlayerCalls({ senderProfile, communicationDisabled, onError }: Options) {
  const { data: calls, refresh } = useFeatureInbox<PlayerCall[]>(
    "load_player_calls", "player_calls_changed", [], onError,
  );

  const displayMessages = useMemo(() => buildPlayerCallDisplayMessages(calls), [calls]);

  async function resolveCall(messageId: string): Promise<boolean> {
    onError("");
    if (communicationDisabled) {
      onError("ローカル通信を行わない設定のため、呼び出しの解決は無効です。");
      return false;
    }
    const call = calls.find((item) => item.message.messageId === messageId);
    if (!call || call.message.senderUserId !== senderProfile.senderUserId) {
      onError("自分が発行した未解決の呼び出しのみ解決できます。");
      return false;
    }
    try {
      await invoke<FeatureMessage>("send_mailbox_message", {
        input: {
          destination: "call_list",
          profile: senderProfile,
          method: "call_player",
          subject: `Resolved: ${call.message.subject}`,
          body: "呼び出しを解決しました。",
          messageType: "resolve",
          messageMeta: call.message.messageMeta,
          deliveryTargetMode: "broadcast",
          deliveryTargetIp: null,
          parentMessageId: null,
          threadId: null,
        },
      });
      await refresh();
      return true;
    } catch (error) {
      onError(String(error));
      return false;
    }
  }

  return {
    calls,
    displayMessages,
    refresh,
    resolveCall,
  };
}
