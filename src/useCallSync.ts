import { invoke } from "@tauri-apps/api/core";
import type { GenericMessage } from "./MessageBox";
import { buildCallSyncStatusTargets } from "./messageUtils";
import type { CallListEventGroup } from "./StatusBoard";
import type { SenderProfile } from "./useSenderProfile";

type UseCallSyncOptions = {
  messages: GenericMessage[];
  displayGroups: CallListEventGroup[];
  senderProfile: SenderProfile;
  communicationDisabled: boolean;
  canBroadcastSync: boolean;
  shouldWarnIdentityChange: boolean;
  resetDisplay: (options?: { clearOwnOnly?: boolean; rebuild?: boolean }) => void;
  onError: (error: string) => void;
  onMessage: (message: string) => void;
};

export function useCallSync({
  messages,
  displayGroups,
  senderProfile,
  communicationDisabled,
  canBroadcastSync,
  shouldWarnIdentityChange,
  resetDisplay,
  onError,
  onMessage,
}: UseCallSyncOptions) {
  async function requestUnresolvedCallSyncBroadcast() {
    onError("");
    onMessage("");

    if (communicationDisabled) {
      onError("ローカル通信を行わない設定のため、呼び出し同期は無効です。設定タブで解除してください。");
      return;
    }

    if (!canBroadcastSync) {
      onError("設定タブで送信者名・8桁ユーザーID・自分のIP・ブロードキャスト用サブネットマスクを保存してから実行してください。");
      return;
    }

    try {
      resetDisplay({ clearOwnOnly: true, rebuild: true });
      await invoke<GenericMessage>("send_mailbox_message", {
        input: {
          profile: senderProfile,
          messageType: "normal",
          method: "call_player_sync",
          subject: "呼び出しの同期: 未補足の未解決呼び出しの収集",
          body: "現在未解決のプレイヤー呼び出し情報を返信してください。",
          messageMeta: {
            syncPhase: "collect_unresolved",
            requestedAt: new Date().toISOString(),
          },
          deliveryTargetMode: "broadcast",
          deliveryTargetIp: null,
          threadId: null,
          parentMessageId: null,
        },
      });

      const statusTargets = buildCallSyncStatusTargets(displayGroups, messages);
      if (statusTargets.length > 0) {
        await invoke<GenericMessage>("send_mailbox_message", {
          input: {
            profile: senderProfile,
            messageType: "normal",
            method: "call_player_sync",
            subject: "呼び出しの同期: 掲載済み呼び出しの確認",
            body: "掲載中の呼び出しについて最新状態を確認します。",
            messageMeta: {
              syncPhase: "check_published_status",
              requestedAt: new Date().toISOString(),
              targets: statusTargets,
            },
            deliveryTargetMode: "broadcast",
            deliveryTargetIp: null,
            threadId: null,
            parentMessageId: null,
          },
        });
      }

      onMessage("呼び出しの同期を実行しました。未補足の未解決呼び出しを収集し、掲載済み呼び出しの状態確認を開始しました。");
    } catch (error) {
      onError(String(error));
    }
  }

  function clearCallListThreads() {
    const callRoots = messages.filter((item) =>
      item.parentMessageId === null
      && item.method === "call_player"
      && item.messageType === "normal"
    );
    const callThreadIds = new Set(callRoots.map((root) => root.threadId));

    if (shouldWarnIdentityChange) {
      window.alert("送信者情報が変更されています。意図しない挙動になることがあります。");
    }

    const confirmed = window.confirm(
      "呼び出しリスト表示をいったん全クリアします。\n保持中の呼び出しデータから再描画します。\nメッセージデータ自体は削除しません。実行しますか？",
    );
    if (!confirmed) {
      return;
    }

    const unresolvedCount = callRoots.filter((root) =>
      !messages.some((item) => item.threadId === root.threadId && item.messageType === "resolve")
    ).length;

    onError("");
    onMessage("");
    resetDisplay({ rebuild: true });
    onMessage(`呼び出しリスト表示を初期化しました（未解決 ${unresolvedCount} 件 / 全呼び出しスレッド ${callThreadIds.size} 件保持）。`);
  }

  return {
    requestUnresolvedCallSyncBroadcast,
    clearCallListThreads,
  };
}
