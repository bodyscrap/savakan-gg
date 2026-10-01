import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { isValidIpv4, isValidSenderUserId, normalizeSenderUserId } from "./messageUtils";
import {
  localNetworkCandidateKey,
  type LocalNetworkSettingsCandidate,
} from "./localNetworkSettings";

const SENDER_PROFILE_STORAGE_KEY = "savakan-gg.sender-profile.v1";

export type SenderProfile = {
  senderName: string;
  senderUserId: string;
  bindIp: string;
  broadcastSubnetMask: string;
};

function normalizeSenderProfile(rawValue: unknown): SenderProfile {
  const source = rawValue && typeof rawValue === "object"
    ? (rawValue as Partial<SenderProfile>)
    : {};

  const senderName = typeof source.senderName === "string" ? source.senderName.trim() : "";
  const senderUserId = typeof source.senderUserId === "string"
    ? normalizeSenderUserId(source.senderUserId)
    : "";
  const bindIp = typeof source.bindIp === "string" ? source.bindIp.trim() : "0.0.0.0";
  const broadcastSubnetMask = typeof source.broadcastSubnetMask === "string"
    ? source.broadcastSubnetMask.trim()
    : "255.255.255.0";

  return {
    senderName,
    senderUserId,
    bindIp,
    broadcastSubnetMask,
  };
}

export function useSenderProfile(
  onError: (error: string) => void,
  onMessage: (message: string) => void,
  activeTab: string,
) {
  const [senderProfile, setSenderProfile] = useState<SenderProfile>({
    senderName: "",
    senderUserId: "",
    bindIp: "0.0.0.0",
    broadcastSubnetMask: "255.255.255.0",
  });
  const [senderProfileReady, setSenderProfileReady] = useState(false);
  const [senderNameDraft, setSenderNameDraft] = useState("");
  const [senderUserIdDraft, setSenderUserIdDraft] = useState("");
  const [senderBindIpDraft, setSenderBindIpDraft] = useState("0.0.0.0");
  const [senderBroadcastSubnetMaskDraft, setSenderBroadcastSubnetMaskDraft] = useState("255.255.255.0");
  const [networkCandidates, setNetworkCandidates] = useState<LocalNetworkSettingsCandidate[]>([]);
  const [selectedNetworkCandidateKey, setSelectedNetworkCandidateKey] = useState("");
  const [networkCandidatesLoading, setNetworkCandidatesLoading] = useState(false);
  const [identityChangedSinceMailboxClear, setIdentityChangedSinceMailboxClear] = useState(false);
  const autoIpFillTriedRef = useRef(false);

  const selectedNetworkCandidate = networkCandidates.find(
    (candidate) => localNetworkCandidateKey(candidate) === selectedNetworkCandidateKey,
  ) ?? null;
  const normalizedSenderNameDraft = senderNameDraft.trim();
  const normalizedSenderUserIdDraft = normalizeSenderUserId(senderUserIdDraft);
  const normalizedBindIpDraft = senderBindIpDraft.trim();
  const normalizedSubnetMaskDraft = senderBroadcastSubnetMaskDraft.trim();
  const currentSenderId = senderProfile.senderUserId.trim();
  const currentSenderName = senderProfile.senderName.trim();
  const senderIdentityChanged = (currentSenderId !== "" || currentSenderName !== "")
    && (normalizedSenderUserIdDraft !== currentSenderId || normalizedSenderNameDraft !== currentSenderName);
  const shouldRecommendMailboxClearForIdentityChange = senderIdentityChanged || identityChangedSinceMailboxClear;

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        const fromRust = await invoke<SenderProfile | null>("load_sender_profile");
        if (!alive) {
          return;
        }

        if (fromRust) {
          const normalized = normalizeSenderProfile(fromRust);
          setSenderProfile(normalized);
          setSenderNameDraft(normalized.senderName);
          setSenderUserIdDraft(normalized.senderUserId);
          setSenderBindIpDraft(normalized.bindIp);
          setSenderBroadcastSubnetMaskDraft(normalized.broadcastSubnetMask);
          return;
        }

        const raw = window.localStorage.getItem(SENDER_PROFILE_STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as unknown;
          const normalized = normalizeSenderProfile(parsed);
          setSenderProfile(normalized);
          setSenderNameDraft(normalized.senderName);
          setSenderUserIdDraft(normalized.senderUserId);
          setSenderBindIpDraft(normalized.bindIp);
          setSenderBroadcastSubnetMaskDraft(normalized.broadcastSubnetMask);
        }
      } catch {
      } finally {
        if (alive) {
          setSenderProfileReady(true);
        }
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!senderProfileReady || autoIpFillTriedRef.current) {
      return;
    }

    autoIpFillTriedRef.current = true;

    void invoke<string | null>("detect_local_ipv4")
      .then((detectedIp) => {
        if (!detectedIp || !isValidIpv4(detectedIp)) {
          return;
        }

        const shouldUpdateDraft = senderBindIpDraft.trim() === ""
          || senderBindIpDraft.trim() === "0.0.0.0"
          || !isValidIpv4(senderBindIpDraft.trim());

        if (shouldUpdateDraft) {
          setSenderBindIpDraft(detectedIp);
        }

        const currentProfileIp = senderProfile.bindIp.trim();
        const shouldUpdateProfile = currentProfileIp === ""
          || currentProfileIp === "0.0.0.0"
          || !isValidIpv4(currentProfileIp);

        if (shouldUpdateProfile) {
          setSenderProfile((current) => ({
            ...current,
            bindIp: detectedIp,
          }));
        }
      })
      .catch(() => {
      });
  }, [senderBindIpDraft, senderProfile, senderProfileReady]);

  useEffect(() => {
    if (!senderProfileReady) {
      return;
    }

    if (senderProfile.senderName.trim() === "" || !isValidSenderUserId(senderProfile.senderUserId)) {
      return;
    }

    try {
      window.localStorage.setItem(SENDER_PROFILE_STORAGE_KEY, JSON.stringify(senderProfile));
    } catch {
    }

    void invoke("save_sender_profile", { profile: senderProfile }).catch((error) => {
      onError(String(error));
    });
  }, [onError, senderProfile, senderProfileReady]);

  async function refreshNetworkCandidates(showError = true) {
    if (networkCandidatesLoading) {
      return;
    }

    setNetworkCandidatesLoading(true);
    try {
      const listed = await invoke<LocalNetworkSettingsCandidate[]>("list_local_network_settings");
      const normalized = Array.isArray(listed) ? listed : [];
      setNetworkCandidates(normalized);

      const selectedStillExists = normalized.some(
        (candidate) => localNetworkCandidateKey(candidate) === selectedNetworkCandidateKey,
      );
      if (selectedStillExists) {
        return;
      }

      const matchedByDraft = normalized.find((candidate) =>
        candidate.bindIp.trim() === senderBindIpDraft.trim()
        && candidate.broadcastSubnetMask.trim() === senderBroadcastSubnetMaskDraft.trim()
      );
      setSelectedNetworkCandidateKey(
        matchedByDraft
          ? localNetworkCandidateKey(matchedByDraft)
          : normalized[0] ? localNetworkCandidateKey(normalized[0]) : "",
      );
    } catch (error) {
      if (showError) {
        onError(`ネットワークデバイス一覧の取得に失敗しました: ${String(error)}`);
      }
    } finally {
      setNetworkCandidatesLoading(false);
    }
  }

  useEffect(() => {
    if (activeTab === "settings") {
      void refreshNetworkCandidates(false);
    }
  }, [activeTab]);

  useEffect(() => {
    if (!selectedNetworkCandidate) {
      return;
    }

    setSenderBindIpDraft(selectedNetworkCandidate.bindIp.trim());
    setSenderBroadcastSubnetMaskDraft(selectedNetworkCandidate.broadcastSubnetMask.trim());
  }, [selectedNetworkCandidate]);

  function canSaveSenderProfile(senderIdCollision: boolean) {
    return normalizedSenderNameDraft !== ""
      && isValidSenderUserId(normalizedSenderUserIdDraft)
      && selectedNetworkCandidate !== null
      && isValidIpv4(normalizedBindIpDraft)
      && isValidIpv4(normalizedSubnetMaskDraft)
      && !senderIdCollision;
  }

  function changeSenderUserIdDraft(value: string) {
    setSenderUserIdDraft(normalizeSenderUserId(value));
  }

  function fillRandomSenderUserId(usedSenderUserIds: string[]) {
    const usedIds = new Set(usedSenderUserIds);
    const generateSenderUserId = () => {
      const randomValues = new Uint32Array(1);
      window.crypto.getRandomValues(randomValues);
      const randomValue = 10_000_000 + (randomValues[0] % 90_000_000);
      return String(randomValue);
    };

    let nextId = generateSenderUserId();
    for (let retry = 0; retry < 40 && usedIds.has(nextId); retry += 1) {
      nextId = generateSenderUserId();
    }

    setSenderUserIdDraft(nextId);
  }

  async function saveSenderProfile(senderIdCollision: boolean) {
    onError("");
    onMessage("");

    if (normalizedSenderNameDraft === "") {
      onError("送信者名を入力してください。");
      return;
    }

    if (!isValidSenderUserId(normalizedSenderUserIdDraft)) {
      onError("ユーザーIDは8桁の数字で入力してください。");
      return;
    }

    if (!selectedNetworkCandidate) {
      onError("ネットワークデバイスを選択してください。");
      return;
    }

    if (!isValidIpv4(normalizedSubnetMaskDraft)) {
      onError("ブロードキャスト用サブネットマスクはIPv4形式で入力してください。例: 255.255.255.0");
      return;
    }

    if (senderIdCollision) {
      onError("既存メッセージ内で同じユーザーIDが別名義に使われています。別のIDを設定してください。");
      return;
    }

    if (senderIdentityChanged) {
      const confirmed = window.confirm(
        "送信者名またはユーザーIDを変更して保存しようとしています。\n"
        + "状態不整合を防ぐため、先に設定タブ下部の「メッセージボックスを強制クリア」を実行することを推奨します。\n"
        + "このまま保存しますか？",
      );
      if (!confirmed) {
        setSenderNameDraft(senderProfile.senderName);
        setSenderUserIdDraft(senderProfile.senderUserId);
        onError("送信者設定の保存を中止し、送信者名/ユーザーIDを元の値に戻しました。");
        return;
      }
    }

    const nextProfile: SenderProfile = {
      senderName: normalizedSenderNameDraft,
      senderUserId: normalizedSenderUserIdDraft,
      bindIp: normalizedBindIpDraft,
      broadcastSubnetMask: normalizedSubnetMaskDraft,
    };

    try {
      await invoke<string>("test_sender_network", { profile: nextProfile });
    } catch (error) {
      onError(`ネットワークテストに失敗したため保存を中止しました: ${String(error)}`);
      return;
    }

    setSenderProfile(nextProfile);
    if (senderIdentityChanged) {
      setIdentityChangedSinceMailboxClear(true);
      onMessage(`送信者設定を保存しました: ${nextProfile.senderName} (${nextProfile.senderUserId}) @ ${nextProfile.bindIp} (ネットワークテストOK) / 注意: 状態整合のため、可能なタイミングでメッセージボックス強制クリアを実行してください。`);
      return;
    }

    onMessage(`送信者設定を保存しました: ${nextProfile.senderName} (${nextProfile.senderUserId}) @ ${nextProfile.bindIp} (ネットワークテストOK)`);
  }

  return {
    senderProfile,
    setSenderProfile,
    senderProfileReady,
    senderNameDraft,
    setSenderNameDraft,
    senderUserIdDraft,
    changeSenderUserIdDraft,
    senderBindIpDraft,
    senderBroadcastSubnetMaskDraft,
    networkCandidates,
    selectedNetworkCandidateKey,
    setSelectedNetworkCandidateKey,
    networkCandidatesLoading,
    selectedNetworkCandidate,
    refreshNetworkCandidates,
    normalizedSenderNameDraft,
    normalizedSenderUserIdDraft,
    normalizedBindIpDraft,
    normalizedSubnetMaskDraft,
    shouldRecommendMailboxClearForIdentityChange,
    setIdentityChangedSinceMailboxClear,
    fillRandomSenderUserId,
    canSaveSenderProfile,
    saveSenderProfile,
  };
}
