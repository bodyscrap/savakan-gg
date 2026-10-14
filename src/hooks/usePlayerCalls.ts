import { useCallback, useEffect, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useFeatureInbox } from "./useFeatureInbox";
import type { FeatureMessage } from "../domain/messages";
import type { SenderProfile } from "./useSenderProfile";

export type PlayerCall = {
  message: FeatureMessage;
  receivedAt: string;
};

const MAX_TIMEOUT_MS = 2_147_483_647;

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

  const sendPlayingRelease = useCallback(async (
    messageId: string,
    noticeId: string,
  ): Promise<boolean> => {
    const call = calls.find((item) => item.message.messageId === messageId);
    if (
      !call
      || call.message.senderUserId === senderProfile.senderUserId
      || call.message.messageMeta?.callPlayerPlaying !== true
      || call.message.messageMeta?.callPlayerPlayingSenderUserId !== senderProfile.senderUserId
      || call.message.messageMeta?.callPlayerPlayingNoticeId !== noticeId
    ) {
      return false;
    }
    if (communicationDisabled) {
      onError("ローカル通信を行わない設定のため、プレイ中通知を解除できません。");
      return false;
    }

    onError("");
    try {
      await invoke<FeatureMessage>("send_mailbox_message", {
        input: {
          destination: "call_list",
          profile: senderProfile,
          method: "call_player_playing_release",
          subject: `プレイ中通知解除: ${call.message.subject}`,
          body: "プレイ中通知を解除しました。",
          messageType: "normal",
          messageMeta: {
            ...(call.message.messageMeta ?? {}),
            callMessageId: call.message.messageId,
            callPlayerPlayingNoticeId: noticeId,
          },
          deliveryTargetMode: "direct",
          deliveryTargetIp: call.message.senderIp,
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
  }, [calls, communicationDisabled, onError, refresh, senderProfile]);

  async function notifyPlaying(messageId: string, minutes: number, communication: string): Promise<boolean> {
    onError("");
    if (communicationDisabled) {
      onError("ローカル通信を行わない設定のため、プレイ中通知は無効です。");
      return false;
    }
    const call = calls.find((item) =>
      item.message.messageId === messageId
      && item.message.method === "call_player"
      && item.message.senderUserId !== senderProfile.senderUserId
    );
    if (!call) {
      onError("他端末が発行した未解決の呼び出しが見つかりません。");
      return false;
    }
    if (!Number.isSafeInteger(minutes) || minutes < 0) {
      onError("終了見込み時間は0以上の整数で入力してください。");
      return false;
    }

    const untilDate = minutes === 0 ? null : new Date(Date.now() + minutes * 60_000);
    if (untilDate && !Number.isFinite(untilDate.getTime())) {
      onError("終了見込み時間が大きすぎます。");
      return false;
    }
    try {
      await invoke<FeatureMessage>("send_mailbox_message", {
        input: {
          destination: "call_list",
          profile: senderProfile,
          method: "call_player_playing",
          subject: `プレイ中通知: ${call.message.subject}`,
          body: minutes === 0
            ? "プレイ中です。終了時刻は未定です。"
            : `プレイ中です。約${minutes}分後に通知を解除します。`,
          messageType: "normal",
          messageMeta: {
            ...(call.message.messageMeta ?? {}),
            callMessageId: call.message.messageId,
            callPlayerPlayingUntil: untilDate?.toISOString() ?? "",
            callPlayerPlayingCommunication: communication.trim(),
          },
          deliveryTargetMode: "direct",
          deliveryTargetIp: call.message.senderIp,
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

  function releasePlaying(messageId: string): Promise<boolean> {
    const call = calls.find((item) => item.message.messageId === messageId);
    const noticeId = call?.message.messageMeta?.callPlayerPlayingNoticeId;
    if (
      !call
      || call.message.messageMeta?.callPlayerPlaying !== true
      || call.message.messageMeta.callPlayerPlayingSenderUserId !== senderProfile.senderUserId
      || typeof noticeId !== "string"
      || noticeId === ""
    ) {
      onError("この端末が発行した有効なプレイ中通知が見つかりません。");
      return Promise.resolve(false);
    }
    return sendPlayingRelease(messageId, noticeId);
  }

  useEffect(() => {
    const timers: number[] = [];
    for (const call of calls) {
      const meta = call.message.messageMeta;
      if (
        call.message.method !== "call_player"
        || call.message.senderUserId === senderProfile.senderUserId
        || meta?.callPlayerPlaying !== true
        || meta.callPlayerPlayingSenderUserId !== senderProfile.senderUserId
        || typeof meta.callPlayerPlayingUntil !== "string"
        || meta.callPlayerPlayingUntil === ""
      ) {
        continue;
      }

      const expiresAt = Date.parse(meta.callPlayerPlayingUntil);
      if (!Number.isFinite(expiresAt)) {
        onError("保存されたプレイ中通知の解除予定時刻を読み取れません。");
        continue;
      }
      const noticeId = meta.callPlayerPlayingNoticeId;
      if (typeof noticeId !== "string" || noticeId === "") {
        onError("保存されたプレイ中通知の識別情報がありません。");
        continue;
      }
      const scheduleRelease = () => {
        const remainingMs = expiresAt - Date.now();
        const timer = window.setTimeout(() => {
          if (expiresAt <= Date.now()) {
            void sendPlayingRelease(call.message.messageId, noticeId);
          } else {
            scheduleRelease();
          }
        }, Math.min(Math.max(remainingMs, 0), MAX_TIMEOUT_MS));
        timers.push(timer);
      };
      scheduleRelease();
    }
    return () => timers.forEach(window.clearTimeout);
  }, [calls, onError, sendPlayingRelease, senderProfile.senderUserId]);

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
    notifyPlaying,
    releasePlaying,
  };
}
