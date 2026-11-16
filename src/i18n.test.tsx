import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import App from "./App";
import { STORAGE_KEY, type Game } from "./game";
import { AppGuide } from "./AppGuide";
import { MolkkyIntroduction } from "./MolkkyIntroduction";
import { LiveGameView } from "./LiveGameView";
import { getLanguage, getLocale, LANGUAGE_STORAGE_KEY, readLanguage, setLanguage, t, translate } from "./i18n";
import { en } from "./locales/en";

const japanese = /[ぁ-んァ-ヶ一-龠]/;

afterEach(() => { setLanguage("ja"); vi.unstubAllGlobals(); });

describe("language settings", () => {
  it("defaults to Japanese for missing, unsupported or inaccessible settings", () => {
    for (const value of [null, "fr", "ja"]) {
      expect(readLanguage({ getItem: () => value })).toBe("ja");
    }
    expect(readLanguage({ getItem: () => { throw new Error("denied"); } })).toBe("ja");
    expect(readLanguage({ getItem: () => "en" })).toBe("en");
  });

  it("persists the selected language separately from match data and updates the document language", () => {
    const setItem = vi.fn();
    const document = { documentElement: { lang: "ja" } };
    vi.stubGlobal("localStorage", { setItem });
    vi.stubGlobal("document", document);
    setLanguage("en");
    expect(getLanguage()).toBe("en");
    expect(getLocale()).toBe("en-US");
    expect(setItem).toHaveBeenCalledExactlyOnceWith(LANGUAGE_STORAGE_KEY, "en");
    expect(document.documentElement.lang).toBe("en");
    setLanguage("ja");
    expect(getLocale()).toBe("ja-JP");
    expect(document.documentElement.lang).toBe("ja");
  });

  it("can switch even when storage is unavailable", () => {
    vi.stubGlobal("localStorage", { setItem: () => { throw new Error("denied"); } });
    expect(() => setLanguage("en")).not.toThrow();
    expect(t("モルック入門")).toBe("Mölkky basics");
  });
});

describe("translations", () => {
  it("preserves Japanese and substitutes entire messages without translating player names", () => {
    expect(translate("{0} の勝ち！", ["草野 {1}"], "ja")).toBe("草野 {1} の勝ち！");
    expect(translate("{0} の勝ち！", ["草野 {1}"], "en")).toBe("草野 {1} wins!");
    expect(translate("リーチ！ あと {0} 点で勝利", [5], "en")).toBe("Checkout! 5 points to win");
    expect(translate("unknown key", [], "en")).toBe("unknown key");
  });

  it("keeps every translation nonempty and preserves all placeholders", () => {
    const placeholders = (value: string) => [...value.matchAll(/\{\d+\}/g)].map((m) => m[0]).sort();
    for (const [source, translated] of Object.entries(en)) {
      expect(translated.trim(), source).not.toBe("");
      expect(placeholders(translated), source).toEqual(placeholders(source));
      expect(japanese.test(translated), source).toBe(false);
    }
  });

  it("renders the introduction and help entirely in English and can switch back", () => {
    setLanguage("en");
    const intro = renderToStaticMarkup(<MolkkyIntroduction />);
    const help = renderToStaticMarkup(<AppGuide />);
    expect(intro).toContain("Mölkkaari");
    expect(intro).toContain("Lahti throw");
    expect(help).toContain("Checkout rate");
    expect(japanese.test(intro + help)).toBe(false);
    setLanguage("ja");
    expect(renderToStaticMarkup(<MolkkyIntroduction />)).toContain("基本ルール");
  });

  it("localizes live errors created before a language switch", () => {
    const state = { phase: "error" as const, error: "ライブ観戦を開始できませんでした。", updatedAt: null };
    setLanguage("en");
    const html = renderToStaticMarkup(<LiveGameView game={null} state={state} onRetry={() => {}} onLeave={() => {}} />);
    expect(html).toContain("Could not start watching live.");
    expect(japanese.test(html)).toBe(false);
  });
});


describe("English match screens", () => {
  const game: Game = {
    id: "match", mode: "individual", ruleVersion: 2,
    startedAt: "2026-11-16T00:00:00Z",
    players: [{ id: "a", name: "Alice" }, { id: "b", name: "Bob" }],
    turns: [],
  };

  function renderMatch(currentGame: Game | null) {
    const saved = JSON.stringify({ version: 1, currentGame, history: [] });
    const getItem = vi.fn((key: string) => key === STORAGE_KEY ? saved : null);
    vi.stubGlobal("localStorage", { getItem, setItem: vi.fn() });
    setLanguage("en");
    // The selector intentionally includes the native name 日本語 in both languages.
    return renderToStaticMarkup(<App />).replace("日本語", "");
  }

  it("renders registration, menu and the live match without untranslated UI", () => {
    const setup = renderMatch(null);
    expect(setup).toContain("Start game");
    expect(setup).toContain("Mölkky basics");
    expect(japanese.test(setup)).toBe(false);
    const active = renderMatch(game);
    expect(active).toContain("Select fallen pins");
    expect(active).toContain("Record a miss");
    expect(active).toContain("Alice");
    expect(japanese.test(active)).toBe(false);
  });

  it("renders completed results in English while keeping Japanese player names intact", () => {
    const turns = ["a", "b", "a", "b", "a", "b", "a", "b", "a"].map((playerId) => ({
      playerId, pins: [10], playedAt: "2026-11-16T00:01:00Z",
    }));
    const html = renderMatch({ ...game, players: [{ id: "a", name: "草野" }, game.players[1]], turns });
    expect(html).toContain("草野 wins!");
    expect(html).toContain("Final scores &amp; stats");
    expect(html).toContain("Share match results");
    expect(japanese.test(html.replaceAll("草野", ""))).toBe(false);
  });

  it("renders quick scoring with no pin selection controls or invented pin history", () => {
    const quick: Game = { ...game, inputMode: "simple", turns: [{ playerId: "a", points: 3, playedAt: "2026-11-16T00:01:00Z" }] };
    const html = renderMatch(quick);
    expect(html).toContain("Tap a score to record");
    expect(html).toContain('aria-label="Record 12 points"');
    expect(html).toContain("Score only");
    expect(html).not.toContain("Select fallen pins");
    expect(html).not.toContain('aria-pressed=');
    expect(japanese.test(html)).toBe(false);
    const live = renderToStaticMarkup(<LiveGameView game={quick} state={{ phase: "live", error: "", updatedAt: null }} onRetry={() => {}} onLeave={() => {}} />);
    expect(live).toContain("Score only");
    expect(live).toContain("+3");
    expect(japanese.test(live)).toBe(false);
  });

});
