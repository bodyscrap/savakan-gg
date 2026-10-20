import { buildEventManagementSettingKey } from "./eventManagement";

export type VideoChapterSettings = {
  openingText: string;
  referenceVideoTime: string;
  referenceSetId: string;
  selectedCategorySlots: number[];
  showResults: boolean;
};

export function defaultVideoChapterSettings(): VideoChapterSettings {
  return {
    openingText: "オープニング",
    referenceVideoTime: "",
    referenceSetId: "",
    selectedCategorySlots: [],
    showResults: false,
  };
}

function storageKey(slug: string, eventId: string): string {
  return `savakan-gg.video-chapter-settings.v1:${buildEventManagementSettingKey(slug, eventId)}`;
}

export function loadVideoChapterSettings(slug: string, eventId: string): VideoChapterSettings {
  if (typeof window === "undefined") {
    return defaultVideoChapterSettings();
  }
  const raw = window.localStorage.getItem(storageKey(slug, eventId));
  if (raw === null) {
    return defaultVideoChapterSettings();
  }
  const value: unknown = JSON.parse(raw);
  if (typeof value !== "object" || value === null
    || !("openingText" in value) || typeof value.openingText !== "string"
    || !("referenceVideoTime" in value) || typeof value.referenceVideoTime !== "string"
    || !("referenceSetId" in value) || typeof value.referenceSetId !== "string"
    || !("showResults" in value) || typeof value.showResults !== "boolean"
    || !("selectedCategorySlots" in value) || !Array.isArray(value.selectedCategorySlots)
    || !value.selectedCategorySlots.every((slot: unknown) => slot === 0 || slot === 1 || slot === 2)) {
    throw new Error("保存された動画チャプター設定の形式が不正です。");
  }
  return {
    openingText: value.openingText,
    referenceVideoTime: value.referenceVideoTime,
    referenceSetId: value.referenceSetId,
    showResults: value.showResults,
    selectedCategorySlots: [...new Set<number>(value.selectedCategorySlots)],
  };
}

export function saveVideoChapterSettings(slug: string, eventId: string, settings: VideoChapterSettings): void {
  window.localStorage.setItem(storageKey(slug, eventId), JSON.stringify(settings));
}
