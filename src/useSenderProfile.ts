import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { isValidIpv4, isValidSenderUserId } from "./messageUtils";
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
    ? source.senderUserId.replace(/\D/g, "").slice(0, 8)
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

export function useSenderProfile(onError: (error: string) => void, activeTab: string) {
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
  const autoIpFillTriedRef = useRef(false);

  const selectedNetworkCandidate = networkCandidates.find(
    (candidate) => localNetworkCandidateKey(candidate) === selectedNetworkCandidateKey,
  ) ?? null;

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

  return {
    senderProfile,
    setSenderProfile,
    senderProfileReady,
    senderNameDraft,
    setSenderNameDraft,
    senderUserIdDraft,
    setSenderUserIdDraft,
    senderBindIpDraft,
    senderBroadcastSubnetMaskDraft,
    networkCandidates,
    selectedNetworkCandidateKey,
    setSelectedNetworkCandidateKey,
    networkCandidatesLoading,
    selectedNetworkCandidate,
    refreshNetworkCandidates,
  };
}
