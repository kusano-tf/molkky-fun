import { describe, expect, it } from "vitest";
import {
  createGame, getGameAnalysis, getGameStatus, getInputMode, getPlayerCareerAnalysis,
  getThrowPoints, isAppData, type Game,
} from "./game";
import { readMatchData } from "./match";
import { decodeSnapshot, encodeSnapshot } from "./liveProtocol";

function detailedGame(team = false): Game {
  return {
    id: "legacy", ruleVersion: 2, mode: team ? "team" : "individual",
    startedAt: "2026-11-16T00:00:00Z",
    players: [{ id: "a", name: "Alice", ...(team ? { teamId: "red" } : {}) },
      { id: "b", name: "Bob", ...(team ? { teamId: "blue" } : {}) }],
    ...(team ? { teams: [{ id: "red", name: "Red" }, { id: "blue", name: "Blue" }] } : {}),
    turns: [
      { playerId: "a", pins: [12], playedAt: "1" },
      { playerId: "b", pins: [], playedAt: "2" },
      { playerId: "a", pins: [3, 4], playedAt: "3" },
      { playerId: "b", pins: [], playedAt: "4" },
      { playerId: "a", pins: [12], playedAt: "5" },
      { playerId: "b", pins: [], playedAt: "6" },
    ],
  };
}
function asSimple(game: Game): Game {
  return { ...game, id: "simple", inputMode: "simple", turns: game.turns.map((turn) => ({
    playerId: turn.playerId, playedAt: turn.playedAt, points: getThrowPoints(turn),
  })) };
}
const valid = (game: unknown) => isAppData({ version: 1, currentGame: game, history: [] });

describe("fixed scoring input modes", () => {
  it("keeps legacy detailed records readable without rewriting them", () => {
    const old = detailedGame();
    const serialized = JSON.stringify(old);
    expect(getInputMode(old)).toBe("detailed");
    expect(valid(old)).toBe(true);
    expect(getGameAnalysis(old).units[0].totalPoints).toBe(26);
    expect(JSON.stringify(old)).toBe(serialized);
    expect(createGame(old.players, "individual", [], "simple").inputMode).toBe("simple");
  });

  it.each([false, true])("preserves common results and analysis in both modes (team: %s)", (team) => {
    const detailed = detailedGame(team);
    const simple = asSimple(detailed);
    expect(valid(simple)).toBe(true);
    expect(getGameStatus(simple)).toEqual(getGameStatus(detailed));
    expect(getGameAnalysis(simple)).toEqual(getGameAnalysis(detailed));
    const common = (game: Game) => getPlayerCareerAnalysis([game]).map(({
      detailedGames: _games, detailedThrows: _throws, singlePinThrows: _single,
      multiPinThrows: _multi, pinCounts: _counts, ...stats
    }) => stats);
    expect(common(simple)).toEqual(common(detailed));
  });

  it("handles a bust, undo, resumption and an exact checkout with score-only records", () => {
    const game = asSimple({ ...detailedGame(), turns: [12, 1, 12, 1, 12, 1, 12, 1, 3].map((points, i) => ({
      playerId: i % 2 ? "b" : "a", playedAt: String(i), pins: [points],
    })) });
    expect(getGameStatus(game).scores.a.score).toBe(25);
    const undone = { ...game, turns: game.turns.slice(0, -1) };
    expect(getGameStatus(undone).scores.a.score).toBe(48);
    const finished: Game = { ...undone, turns: [...undone.turns, { playerId: "a", points: 2, playedAt: "9" }] };
    expect(getGameStatus(finished).winnerId).toBe("a");
    const data = JSON.parse(JSON.stringify({ version: 1, currentGame: finished, history: [finished] }));
    expect(isAppData(data)).toBe(true);
    expect(getGameAnalysis(data.currentGame).units[0].totalPoints).toBe(50);
  });

  it("never infers pins or counts missing pin details as failures", () => {
    const detailed = detailedGame();
    const simple = asSimple(detailed);
    expect(simple.turns.every((turn) => !("pins" in turn))).toBe(true);
    const [alice] = getPlayerCareerAnalysis([simple, detailed]);
    expect(alice).toMatchObject({ gamesPlayed: 2, throws: 6, detailedGames: 1,
      detailedThrows: 3, singlePinThrows: 2, multiPinThrows: 1 });
    expect(alice.pinCounts).toEqual([0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 2]);
    const [quickOnly] = getPlayerCareerAnalysis([simple]);
    expect(quickOnly.detailedThrows).toBe(0);
    expect(quickOnly.detailedGames).toBe(0);
  });

  it.each([-1, 13, 1.5, null, "3", undefined])("rejects invalid score-only values: %s", (points) => {
    expect(valid({ ...asSimple(detailedGame()), turns: [{ playerId: "a", playedAt: "1", points }] })).toBe(false);
  });

  it("rejects mode mixing and inconsistent detailed scores", () => {
    const detailed = detailedGame();
    const turn = detailed.turns[0];
    expect(valid({ ...detailed, turns: [{ ...turn, points: 12 }] })).toBe(true);
    expect(valid({ ...detailed, turns: [{ ...turn, points: 3 }] })).toBe(false);
    expect(valid({ ...detailed, turns: [{ playerId: "a", playedAt: "1", points: 12 }] })).toBe(false);
    expect(valid({ ...detailed, inputMode: "simple" })).toBe(false);
    expect(valid({ ...detailed, inputMode: "other" })).toBe(false);
    expect(valid({ ...asSimple(detailed), turns: [{ ...turn, points: 12 }] })).toBe(false);
  });

  it("shares both modes and score-only undo without adding fabricated pins", () => {
    const simple = asSimple(detailedGame());
    for (const game of [detailedGame(), simple, { ...simple, turns: simple.turns.slice(0, -1) }]) {
      const match = readMatchData({ version: 1, currentGame: game, history: [] })!.currentMatch!;
      expect(decodeSnapshot(encodeSnapshot("session", 1, match), "session", 0)?.game).toEqual(match);
    }
    const received = decodeSnapshot(encodeSnapshot("session", 1, readMatchData({ version: 1, currentGame: simple, history: [] })!.currentMatch!), "session", 0)!;
    expect(received.game!.sets[0].turns[0]).not.toHaveProperty("pins");
  });
});
