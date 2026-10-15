import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { canBroadcastCallListSync } from "../domain/messageUtils";
import type { SenderProfile } from "./useSenderProfile";

export type SenderUserListEntry = {
  senderName: string;
  senderUserId: string;
  senderIp: string;
};

type SenderUserListResponse = SenderUserListEntry & {
  requestId: string;
};

export function useSenderUserList({
  senderProfile,
  communicationDisabled,
  onError,
  onMessage,
}: {
  senderProfile: SenderProfile;
  communicationDisabled: boolean;
  onError: (error: string) => void;
  onMessage: (message: string) => void;
}) {
  const [senderUsers, setSenderUsers] = useState<SenderUserListEntry[]>([]);
  const activeRequestId = useRef("");
  const activeRequestDeadline = useRef(0);
  const responseWindowTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let active = true;
    const unlisten = listen<SenderUserListResponse>("sender_user_list_response", (event) => {
      const response = event.payload;
      if (
        !active
        || response.requestId !== activeRequestId.current
        || Date.now() > activeRequestDeadline.current
      ) {
        return;
      }

      setSenderUsers((current) => {
        if (current.some((user) =>
          user.senderUserId === response.senderUserId && user.senderIp === response.senderIp
        )) {
          return current;
        }
        return [...current, {
          senderName: response.senderName,
          senderUserId: response.senderUserId,
          senderIp: response.senderIp,
        }];
      });
    });

    void unlisten.catch((error) => onError(String(error)));
    return () => {
      active = false;
      activeRequestId.current = "";
      activeRequestDeadline.current = 0;
      if (responseWindowTimer.current !== null) {
        clearTimeout(responseWindowTimer.current);
        responseWindowTimer.current = null;
      }
      void unlisten.then((stop) => stop()).catch((error) => onError(String(error)));
    };
  }, [onError]);

  async function refreshSenderUsers() {
    onError("");
    onMessage("");
    if (communicationDisabled) {
      onError("ローカル通信を行わない設定のため、ユーザー一覧を更新できません。");
      return;
    }
    if (!canBroadcastCallListSync(senderProfile, communicationDisabled)) {
      onError("送信者情報とネットワークデバイスを保存してからユーザー一覧を更新してください。");
      return;
    }

    const requestId = crypto.randomUUID();
    activeRequestId.current = requestId;
    activeRequestDeadline.current = Date.now() + 1000;
    setSenderUsers([]);
    if (responseWindowTimer.current !== null) {
      clearTimeout(responseWindowTimer.current);
    }
    responseWindowTimer.current = setTimeout(() => {
      if (activeRequestId.current === requestId) {
        activeRequestId.current = "";
        activeRequestDeadline.current = 0;
        responseWindowTimer.current = null;
      }
    }, 1000);

    try {
      await invoke("send_mailbox_message", {
        input: {
          destination: "sender_users",
          profile: senderProfile,
          messageType: "normal",
          method: "sender_user_list_request",
          subject: "ユーザー一覧の問い合わせ",
          body: "現在利用中の送信者情報を返信してください。",
          messageMeta: { requestId },
          deliveryTargetMode: "broadcast",
          deliveryTargetIp: null,
          threadId: requestId,
          parentMessageId: null,
        },
      });
      onMessage("ユーザー一覧の問い合わせをブロードキャストしました。");
    } catch (error) {
      if (activeRequestId.current === requestId) {
        activeRequestId.current = "";
        activeRequestDeadline.current = 0;
        if (responseWindowTimer.current !== null) {
          clearTimeout(responseWindowTimer.current);
          responseWindowTimer.current = null;
        }
      }
      onError(String(error));
    }
  }

  return { senderUsers, refreshSenderUsers };
}
