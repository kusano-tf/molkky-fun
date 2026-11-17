import { afterEach, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createGame, getPlayerCareerAnalysis, getThrowPoints, type Game } from "./game";
import { getOutcomeBreakdown, ThrowDistributionCharts } from "./ThrowDistributionCharts";
import { setLanguage } from "./i18n";

afterEach(() => setLanguage("ja"));

function detailedGame(): Game {
  const game = createGame([{ id: "a", name: "Alice" }, { id: "b", name: "Bob" }]);
  const pins = [[1, 2, 3], [1, 2, 3], [12], [12], [12], [8]];
  return { ...game, turns: pins.flatMap((pins, i) => [
    { playerId: "a", pins, playedAt: String(i) },
    ...(i === 5 ? [] : [{ playerId: "b", pins: [1], playedAt: String(i) }]),
  ]) };
}

it("separates a pin's single-hit frequency from multi-pin group sizes, excluding quick scoring", () => {
  const detailed = detailedGame();
  const simple: Game = { ...detailed, inputMode: "simple", turns: detailed.turns.map((turn) => ({
    playerId: turn.playerId, playedAt: turn.playedAt, points: getThrowPoints(turn),
  })) };
  const [alice] = getPlayerCareerAnalysis([simple, detailed]);
  expect(alice.throws).toBe(12);
  expect(alice.singlePinThrows).toBe(4);
  expect(alice.multiPinThrows).toBe(2);
  expect(alice.singlePinCounts).toEqual([0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 3]);
  expect(alice.multiPinCounts).toEqual([0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  expect(alice.singlePinCounts.reduce((a, b) => a + b, 0)).toBe(alice.singlePinThrows);
  expect(alice.multiPinCounts.reduce((a, b) => a + b, 0)).toBe(alice.multiPinThrows);
});

it("renders both labeled distributions with exact counts in English", () => {
  setLanguage("en");
  const [stats] = getPlayerCareerAnalysis([detailedGame()]);
  const html = renderToStaticMarkup(<ThrowDistributionCharts stats={stats} />);
  expect(html.match(/<svg /g)).toHaveLength(3);
  expect(html).toContain("Single-pin throws: by pin number");
  expect(html).toContain("Multi-pin throws: by pin count");
  expect(html).toContain("Pin 12: 3 times");
  expect(html).toContain("3 pins: 2 times");
  expect(html).toContain("Based on 4 throws");
  expect(html).toContain("Based on 2 throws");
  expect(html).not.toMatch(/[ぁ-んァ-ヶ一-龠]|NaN|Infinity/);
});

it("shows an empty message for each distribution with no eligible throws", () => {
  const html = renderToStaticMarkup(<ThrowDistributionCharts stats={{ singlePinCounts: Array(12).fill(0), multiPinCounts: Array(11).fill(0), singlePinThrows: 0, multiPinThrows: 0, detailedThrows: 0 }} />);
  expect(html.match(/該当する投球はまだありません。/g)).toHaveLength(3);
  expect(html).not.toContain("<svg");
  expect(html).not.toMatch(/NaN|Infinity/);
});


it("includes only detailed misses in the 100% breakdown and preserves exact displayed totals", () => {
  const thirds = getOutcomeBreakdown({ singlePinThrows: 1, multiPinThrows: 1, detailedThrows: 3 });
  expect(thirds.map((segment) => segment.count)).toEqual([1, 1, 1]);
  expect(thirds.reduce((sum, segment) => sum + Math.round(segment.percent * 10), 0)).toBe(1000);
  expect(getOutcomeBreakdown({ singlePinThrows: 0, multiPinThrows: 0, detailedThrows: 4 }))
    .toEqual([{ count: 0, percent: 0 }, { count: 0, percent: 0 }, { count: 4, percent: 100 }]);
  expect(getOutcomeBreakdown({ singlePinThrows: 0, multiPinThrows: 0, detailedThrows: 0 }))
    .toEqual(Array(3).fill({ count: 0, percent: 0 }));
});
