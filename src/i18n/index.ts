import { useEffect, useSyncExternalStore } from "react";
import { appTranslations } from "./app";
import { componentTranslations } from "./components";

export type Language = "ja" | "en";
export const LANGUAGE_STORAGE_KEY = "savakan-gg.language.v1";
const translations: Readonly<Record<string, string>> = { ...appTranslations, ...componentTranslations };
const listeners = new Set<() => void>();
let language: Language | undefined;

export function getLanguage(): Language {
  if (language === undefined) {
    language = "ja";
    if (typeof window !== "undefined") {
      try {
        if (window.localStorage.getItem(LANGUAGE_STORAGE_KEY) === "en") {
          language = "en";
        }
      } catch (error) {
        console.error("Unable to read the UI language preference.", error);
      }
    }
  }
  return language;
}

export function setLanguage(value: Language): void {
  language = value;
  if (typeof document !== "undefined") {
    document.documentElement.lang = value;
  }
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(LANGUAGE_STORAGE_KEY, value);
    } catch (error) {
      console.error("Unable to save the UI language preference.", error);
    }
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useLanguage(): Language {
  const current = useSyncExternalStore(subscribe, getLanguage, getLanguage);
  useEffect(() => {
    document.documentElement.lang = current;
  }, [current]);
  return current;
}

export function t(source: string, params: Readonly<Record<string, string | number>> = {}): string {
  const text = getLanguage() === "en" ? translations[source] ?? source : source;
  return text.replace(/\{(\w+)\}/g, (placeholder: string, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : placeholder);
}
