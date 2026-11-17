import { describe, expect, it, vi } from "vitest";
import { readDeviceSettings, saveDeviceSettings, SETTINGS_STORAGE_KEY } from "./deviceSettings";
import { STORAGE_KEY } from "./game";
import { createMatch, DEFAULT_SETTINGS, emptyMatchData, readMatchData } from "./match";

const preferences = { winsRequired: 3, inputMode: "detailed" as const };
function storage(values: Record<string, string> = {}) {
  return { getItem: (key: string) => values[key] ?? null, setItem: vi.fn((key: string, value: string) => { values[key] = value; }) };
}

describe("device settings", () => {
  it("stores device preferences under their own key", () => {
    const local = storage();
    saveDeviceSettings(preferences, local);
    expect(local.setItem).toHaveBeenCalledExactlyOnceWith(SETTINGS_STORAGE_KEY, JSON.stringify(preferences));
    expect(local.getItem(STORAGE_KEY)).toBeNull();
    expect(readDeviceSettings(local)).toEqual(preferences);
  });

  it("migrates the former local top-level preferences without changing match rules", () => {
    const local = storage({ [STORAGE_KEY]: JSON.stringify({ ...emptyMatchData(), settings: preferences }) });
    const migrated = readDeviceSettings(local);
    expect(migrated).toEqual(preferences);
    saveDeviceSettings(migrated, local);
    // Once the game data has been rewritten without preferences, they persist independently.
    local.setItem(STORAGE_KEY, JSON.stringify(emptyMatchData()));
    expect(readDeviceSettings(local)).toEqual(preferences);
  });

  it("prefers the dedicated current value over old embedded settings", () => {
    const local = storage({ [SETTINGS_STORAGE_KEY]: JSON.stringify(preferences),
      [STORAGE_KEY]: JSON.stringify({ ...emptyMatchData(), settings: DEFAULT_SETTINGS }) });
    expect(readDeviceSettings(local)).toEqual(preferences);
  });

  it.each([null, "invalid JSON", '{"winsRequired":0,"inputMode":"simple"}'])('falls back safely for unavailable or invalid preferences: %s', (raw) => {
    const local = storage(raw === null ? {} : { [SETTINGS_STORAGE_KEY]: raw });
    expect(readDeviceSettings(local)).toEqual(DEFAULT_SETTINGS);
    expect(readDeviceSettings({ getItem: () => { throw new Error("Storage blocked"); } })).toEqual(DEFAULT_SETTINGS);
  });

  it("strips imported top-level preferences while preserving the match's rule snapshot", () => {
    const local = storage({ [SETTINGS_STORAGE_KEY]: JSON.stringify(preferences) });
    const rules = { winsRequired: 2, inputMode: "simple" as const };
    const match = createMatch([{ id: "a", name: "Alice" }, { id: "b", name: "Bob" }], "individual", [], rules);
    const imported = readMatchData({ ...emptyMatchData(), settings: { winsRequired: 5, inputMode: "detailed" }, currentMatch: match })!;
    expect(imported).not.toHaveProperty("settings");
    expect(imported.currentMatch!.settings).toEqual(rules);
    expect(JSON.parse(JSON.stringify(imported))).not.toHaveProperty("settings");
    expect(readDeviceSettings(local)).toEqual(preferences);
    expect(local.setItem).not.toHaveBeenCalled();
    expect(readMatchData(imported)).toEqual(imported);
  });
});
