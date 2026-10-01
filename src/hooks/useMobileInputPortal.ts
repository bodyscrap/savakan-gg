import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import QRCode from "qrcode";
import { toApiSlug } from "../domain/slugUtils";
import type { LocalNetworkSettingsCandidate } from "../domain/localNetworkSettings";

export type MobileInputPortalInfo = {
  url: string;
  accessUrls: string[];
  token: string;
};

type UseMobileInputPortalOptions = {
  slug: string;
  selectionKey: string;
  eventId: string | null;
  pollingMs: number;
  setError: (error: string) => void;
  setMessage: (message: string) => void;
};

function mobileUrlDisplayIp(url: string): string {
  const trimmed = url.trim();
  if (trimmed === "") {
    return "-";
  }

  try {
    const parsed = new URL(trimmed);
    return parsed.hostname || trimmed;
  } catch {
    const normalized = trimmed.replace(/^https?:\/\//i, "");
    const slashIndex = normalized.indexOf("/");
    const hostWithPort = slashIndex >= 0 ? normalized.slice(0, slashIndex) : normalized;
    const colonIndex = hostWithPort.lastIndexOf(":");
    return colonIndex > 0 ? hostWithPort.slice(0, colonIndex) : hostWithPort;
  }
}

function mobileInputUrlHostKey(url: string): string {
  const trimmed = url.trim();
  if (trimmed === "") {
    return "";
  }

  try {
    return new URL(trimmed).hostname.trim();
  } catch {
    return mobileUrlDisplayIp(trimmed).trim();
  }
}

function withMobileInputPollMsParam(url: string, pollingMs: number): string {
  const trimmed = url.trim();
  if (trimmed === "") {
    return trimmed;
  }

  try {
    const parsed = new URL(trimmed);
    parsed.searchParams.set("pollMs", String(pollingMs));
    return parsed.toString();
  } catch {
    return trimmed;
  }
}

export function useMobileInputPortal({
  slug,
  selectionKey,
  eventId,
  pollingMs,
  setError,
  setMessage,
}: UseMobileInputPortalOptions) {
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [portalInfo, setPortalInfo] = useState<MobileInputPortalInfo | null>(null);
  const [candidates, setCandidates] = useState<LocalNetworkSettingsCandidate[]>([]);
  const [issuedUrl, setIssuedUrl] = useState("");
  const [qrUrl, setQrUrl] = useState("");

  useEffect(() => {
    setOpen(false);
    setPortalInfo(null);
    setCandidates([]);
    setIssuedUrl("");
    setQrUrl("");
  }, [slug, selectionKey]);

  useEffect(() => {
    let cancelled = false;

    if (!portalInfo || issuedUrl.trim() === "") {
      setQrUrl("");
      return () => {
        cancelled = true;
      };
    }

    void (async () => {
      try {
        const dataUrl = await QRCode.toDataURL(issuedUrl, {
          errorCorrectionLevel: "M",
          margin: 1,
          width: 320,
          color: {
            dark: "#0f172a",
            light: "#ffffff",
          },
        });
        if (!cancelled) {
          setQrUrl(dataUrl);
        }
      } catch {
        if (!cancelled) {
          setQrUrl("");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [portalInfo, issuedUrl]);

  function closeDialog() {
    setOpen(false);
  }

  async function refreshDialog() {
    if (!eventId) {
      setError("先にイベントを選択してください。");
      return;
    }

    const normalizedSlug = toApiSlug(slug);
    if (normalizedSlug === "") {
      setError("大会IDを入力してください。");
      return;
    }

    const activeHost = mobileInputUrlHostKey(issuedUrl);
    if (activeHost === "") {
      setError("先にURLを発行してください。");
      return;
    }

    setBusy(true);
    setError("");
    setMessage("");

    try {
      const result = await invoke<MobileInputPortalInfo>("get_mobile_input_portal_info", {
        slug: normalizedSlug,
        eventId,
      });
      const patchedUrl = withMobileInputPollMsParam(result.url, pollingMs);
      const patchedAccessUrls = Array.from(new Set(
        result.accessUrls
          .map((item) => withMobileInputPollMsParam(item, pollingMs))
          .filter((item) => item.trim() !== ""),
      ));
      const nextPortalInfo: MobileInputPortalInfo = {
        ...result,
        url: patchedUrl,
        accessUrls: patchedAccessUrls.length > 0 ? patchedAccessUrls : [patchedUrl],
      };
      const refreshedUrl = nextPortalInfo.accessUrls.find((item) => mobileInputUrlHostKey(item) === activeHost)
        ?? nextPortalInfo.url;

      setPortalInfo(nextPortalInfo);
      setIssuedUrl(refreshedUrl);
      setMessage("スマートフォン向けURLを更新しました。新しい2次元コードを共有してください。");
    } catch (error) {
      setError(String(error));
    } finally {
      setBusy(false);
    }
  }

  async function issueUrl(bindIp: string) {
    if (!eventId) {
      setError("先にイベントを選択してください。");
      return;
    }

    const normalizedSlug = toApiSlug(slug);
    if (normalizedSlug === "") {
      setError("大会IDを入力してください。");
      return;
    }

    const selectedHost = bindIp.trim();
    if (selectedHost === "") {
      setError("IPを選択してください。");
      return;
    }

    setBusy(true);
    setError("");
    setMessage("");

    try {
      const result = await invoke<MobileInputPortalInfo>("get_mobile_input_portal_info", {
        slug: normalizedSlug,
        eventId,
      });
      const patchedUrl = withMobileInputPollMsParam(result.url, pollingMs);
      const patchedAccessUrls = Array.from(new Set(
        result.accessUrls
          .map((item) => withMobileInputPollMsParam(item, pollingMs))
          .filter((item) => item.trim() !== ""),
      ));
      const nextPortalInfo: MobileInputPortalInfo = {
        ...result,
        url: patchedUrl,
        accessUrls: patchedAccessUrls.length > 0 ? patchedAccessUrls : [patchedUrl],
      };
      const selectedUrl = nextPortalInfo.accessUrls.find((item) => mobileInputUrlHostKey(item) === selectedHost)
        ?? nextPortalInfo.url;

      setPortalInfo(nextPortalInfo);
      setIssuedUrl(selectedUrl);
      setMessage("スマートフォン向けURLを発行しました。必要に応じてURLを更新できます。");
    } catch (error) {
      setError(String(error));
    } finally {
      setBusy(false);
    }
  }

  async function openDialog() {
    if (!eventId) {
      setError("先にイベントを選択してください。");
      return;
    }

    const normalizedSlug = toApiSlug(slug);
    if (normalizedSlug === "") {
      setError("大会IDを入力してください。");
      return;
    }

    setOpen(true);
    setError("");
    setMessage("");

    if (portalInfo && issuedUrl.trim() !== "") {
      setMessage("発行中のURLを表示しています。必要に応じてURL更新で再発行できます。");
      return;
    }

    try {
      const listed = await invoke<LocalNetworkSettingsCandidate[]>("list_local_network_settings");
      const availableCandidates = Array.isArray(listed) ? listed : [];
      setCandidates(availableCandidates);

      if (availableCandidates.length === 0) {
        setError("利用可能なIP候補が見つかりませんでした。");
        return;
      }

      setMessage("IP候補を表示しました。URL発行を押すと結果を共有できます。");
    } catch (error) {
      setError(String(error));
    } finally {
      setBusy(false);
    }
  }

  async function copyUrl() {
    if (issuedUrl.trim() === "") {
      return;
    }

    try {
      if (!navigator.clipboard || !navigator.clipboard.writeText) {
        throw new Error("この環境ではクリップボードAPIが使用できません。");
      }
      await navigator.clipboard.writeText(issuedUrl);
      setMessage("スマホ入力URLをクリップボードへコピーしました。");
    } catch {
      setError("URLコピーに失敗しました。URLを手動で共有してください。");
    }
  }

  return {
    busy,
    open,
    portalInfo,
    candidates,
    issuedUrl,
    issuedUrlDisplayIp: mobileUrlDisplayIp(issuedUrl),
    qrUrl,
    closeDialog,
    openDialog,
    issueUrl,
    refreshDialog,
    copyUrl,
  };
}
