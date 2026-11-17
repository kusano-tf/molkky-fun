import { STORAGE_KEY } from "./game";
import { DEFAULT_SETTINGS, validSettings, type MatchSettings } from "./match";

export const SETTINGS_STORAGE_KEY = "molkky-fun.settings";

function parseSettings(text: string | null): MatchSettings | null {
  if (!text) return null;
  try {
    const value: unknown = JSON.parse(text);
    return validSettings(value) ? { winsRequired: value.winsRequired, inputMode: value.inputMode } : null;
  } catch { return null; }
}

// Only local storage is consulted for migration. Imported match files never change
// the device's preferences, even if they contain the former top-level settings.
export function readDeviceSettings(storage?: Pick<Storage, "getItem">): MatchSettings {
  try {
    const source = storage ?? localStorage;
    const settings = parseSettings(source.getItem(SETTINGS_STORAGE_KEY));
    if (settings) return settings;
    const legacy = source.getItem(STORAGE_KEY);
    if (legacy) {
      const value = JSON.parse(legacy);
      if (value && validSettings(value.settings)) {
        return { winsRequired: value.settings.winsRequired, inputMode: value.settings.inputMode };
      }
    }
  } catch { /* Use defaults when storage or old data is unavailable. */ }
  return { ...DEFAULT_SETTINGS };
}

export function saveDeviceSettings(settings: MatchSettings, storage: Pick<Storage, "setItem"> = localStorage) {
  storage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ winsRequired: settings.winsRequired, inputMode: settings.inputMode }));
}
