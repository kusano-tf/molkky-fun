import { useSyncExternalStore } from "react";
import { en } from "./locales/en";

export type Language = "ja" | "en";
export const LANGUAGE_STORAGE_KEY = "molkky-fun.language";

export function readLanguage(storage?: Pick<Storage, "getItem">): Language {
  try {
    return (storage ?? localStorage).getItem(LANGUAGE_STORAGE_KEY) === "en" ? "en" : "ja";
  } catch {
    return "ja";
  }
}

let language: Language = readLanguage();
const listeners = new Set<() => void>();

export function getLanguage(): Language { return language; }
export function getLocale(): string { return language === "en" ? "en-US" : "ja-JP"; }

export function setLanguage(next: Language) {
  language = next;
  try { localStorage.setItem(LANGUAGE_STORAGE_KEY, next); } catch { /* Still switch for this session. */ }
  if (typeof document !== "undefined") document.documentElement.lang = next;
  listeners.forEach((listener) => listener());
}

export function useLanguage(): Language {
  return useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getLanguage,
    () => "ja",
  );
}

// Replace placeholders in one pass: user-supplied text is never interpreted or translated.
export function translate(message: string, values: readonly (string | number)[] = [], locale: Language = language): string {
  const template = locale === "en" ? en[message] ?? message : message;
  return template.replace(/\{(\d+)\}/g, (placeholder, index: string) => String(values[Number(index)] ?? placeholder));
}

export const t = translate;
