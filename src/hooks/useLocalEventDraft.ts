import { useState } from "react";
import { defaultLocalEventRegistration } from "../domain/localEventRegistration";
import { t } from "../i18n";

export function useLocalEventDraft() {
  const [registration, setRegistration] = useState(defaultLocalEventRegistration);

  const clearParticipants = () => {
    setRegistration((current) => ({ ...current, participants: [] }));
  };
  const confirmDiscardParticipants = async (reason: "metadata" | "creation") => {
    if (registration.participants.length === 0) return true;
    return await window.confirm(reason === "metadata"
      ? t("メタデータ設定に移動すると、作成途中のローカルeventの参加者リストをクリアします。移動しますか？")
      : t("スナップショットの作成に成功すると、作成途中のローカルeventの参加者リストをクリアします。作成しますか？"));
  };

  return { registration, setRegistration, clearParticipants, confirmDiscardParticipants };
}
