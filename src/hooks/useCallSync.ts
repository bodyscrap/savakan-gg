import { invoke } from "@tauri-apps/api/core";
import type { FeatureMessage } from "../domain/messages";
import type { SenderProfile } from "./useSenderProfile";

type UseCallSyncOptions = {
  senderProfile: SenderProfile;
  communicationDisabled: boolean;
  canBroadcastSync: boolean;
  shouldWarnIdentityChange: boolean;
  resetDisplay: (options?: { clearOwnOnly?: boolean; rebuild?: boolean }) => void;
  refreshCalls: () => Promise<void>;
  onError: (error: string) => void;
  onMessage: (message: string) => void;
};

export function useCallSync({
  senderProfile,
  communicationDisabled,
  canBroadcastSync,
  shouldWarnIdentityChange,
  resetDisplay,
  refreshCalls,
  onError,
  onMessage,
}: UseCallSyncOptions) {
  async function requestUnresolvedCallSyncBroadcast() {
    onError("");
    onMessage("");
    if (communicationDisabled || !canBroadcastSync) {
      onError("ローカル通信を有効にし、設定タブで送信者名・8桁ユーザーID・ネットワークデバイスを保存してください。");
      return;
    }
    try {
      await invoke<FeatureMessage>("send_mailbox_message", {
        input: {
          destination: "call_list",
          profile: senderProfile,
          messageType: "normal",
          method: "call_player_sync_request",
          subject: "プレイヤー呼び出しの同期",
          body: "自身が発行した未解決の呼び出しを、この端末に同期してください。",
          messageMeta: null,
          deliveryTargetMode: "broadcast",
          deliveryTargetIp: null,
          threadId: null,
          parentMessageId: null,
        },
      });
      await refreshCalls();
      resetDisplay({ rebuild: true });
      onMessage("他端末の呼び出しをクリアして同期を要求しました。返信を受け取り次第、リストを再構築します。");
    } catch (error) {
      await refreshCalls().catch((refreshError) => onError(String(refreshError)));
      onError(String(error));
    }
  }

  function initializeCallListDisplay() {
    if (shouldWarnIdentityChange) {
      window.alert("送信者情報が変更されています。意図しない挙動になることがあります。");
    }
    if (!window.confirm("呼び出しリストの表示を初期化します。保持中の未解決の呼び出しは削除しません。実行しますか？")) {
      return;
    }
    resetDisplay({ rebuild: true });
    onMessage("未解決の呼び出しから表示を初期化しました。");
  }

  return { requestUnresolvedCallSyncBroadcast, initializeCallListDisplay };
}
