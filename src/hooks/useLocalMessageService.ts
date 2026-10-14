import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { isSenderProfileReadyForMessaging, type SenderMessagingProfile } from "../domain/messageUtils";

export function useLocalMessageService({
  senderProfile, senderProfileReady, communicationDisabled, onError,
}: {
  senderProfile: SenderMessagingProfile;
  senderProfileReady: boolean;
  communicationDisabled: boolean;
  onError: (error: string) => void;
}) {
  useEffect(() => {
    if (!senderProfileReady) return;
    if (communicationDisabled || !isSenderProfileReadyForMessaging(senderProfile)) {
      void invoke("stop_udp_mailbox_service").catch((error) => onError(String(error)));
      return;
    }
    void invoke("start_udp_mailbox_service", { profile: senderProfile })
      .catch((error) => onError(String(error)));
  }, [senderProfile, senderProfileReady, communicationDisabled, onError]);
}
