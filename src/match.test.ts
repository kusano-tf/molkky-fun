import { expect, it } from "vitest";
import { getGameStatus, getScoreUnits, type Game } from "./game";
import {
  addMatchThrow, confirmMatchSet, createMatch, emptyMatchData, getMatchCareerAnalysis,
  getMatchStatus, getSetGame, isValidMatch, readMatchData, startNextSet, suggestedOrders, undoMatchThrow,
  type Match,
} from "./match";
import { decodeSnapshot, encodeSnapshot } from "./liveProtocol";

function makeMatch(teams = 2, winsRequired = 2, detailed = false) {
  return createMatch(
    Array.from({ length: teams * 2 }, (_, i) => ({ id: `p${i}`, name: `Player ${i}`, teamId: `t${Math.floor(i / 2)}` })),
    "team", Array.from({ length: teams }, (_, i) => ({ id: `t${i}`, name: `Team ${i}` })),
    { winsRequired, inputMode: detailed ? "detailed" : "simple" },
  );
}
function endSet(match: Match, winner: string): Match {
  let next = match;
  for (let i = 0; i < 100 && !getGameStatus(getSetGame(next)).isFinished; i++) {
    const game = getSetGame(next), status = getGameStatus(game);
    const unit = getScoreUnits(game).find((unit) => unit.playerIds.includes(status.currentPlayerId!))!;
    const points = unit.id === winner ? 10 : 1;
    next = addMatchThrow(next, next.settings.inputMode === "simple" ? points : [points]);
  }
  expect(getGameStatus(getSetGame(next)).winnerId).toBe(winner);
  return next;
}
function nextSet(match: Match): Match {
  const order = suggestedOrders(match);
  return startNextSet(match, order.teamOrder, order.playerOrder);
}

it("supports three or more teams racing to a set target, with no premature match victory", () => {
  let match = makeMatch(3);
  for (const [index, winner] of ["t0", "t1", "t2", "t0"].entries()) {
    match = endSet(match, winner);
    expect(getMatchStatus(match).isFinished).toBe(false);
    match = confirmMatchSet(match);
    expect(getMatchStatus(match).isFinished).toBe(index === 3);
    if (index !== 3) match = nextSet(match);
  }
  expect(getMatchStatus(match)).toMatchObject({ winnerId: "t0", wins: { t0: 2, t1: 1, t2: 1 } });
  expect(isValidMatch(match)).toBe(true);
  expect(() => nextSet(match)).toThrow();
  expect(match.settings.winsRequired).toBe(2);
});

it("persists the final throw pending confirmation and allows undo after a reload", () => {
  const pending = endSet(makeMatch(2, 1), "t0");
  const data = readMatchData(JSON.parse(JSON.stringify({ ...emptyMatchData(), currentMatch: pending })))!;
  expect(data).not.toBeNull();
  expect(getGameStatus(getSetGame(data.currentMatch!)).isFinished).toBe(true);
  expect(getMatchStatus(data.currentMatch!).isFinished).toBe(false);
  const undone = undoMatchThrow(data.currentMatch!);
  expect(getGameStatus(getSetGame(undone)).isFinished).toBe(false);
  expect(undone.sets[0].turns).toHaveLength(pending.sets[0].turns.length - 1);
  const confirmed = confirmMatchSet(pending);
  expect(getMatchStatus(confirmed).isFinished).toBe(true);
  expect(() => undoMatchThrow(confirmed)).toThrow();
  expect(() => confirmMatchSet(undone)).toThrow();
  expect(() => addMatchThrow(confirmed, 1)).toThrow();
  expect(() => startNextSet(pending, [], [])).toThrow();
});

it("resets scores, misses and eliminations and records new per-set team and member orders", () => {
  const match = confirmMatchSet(endSet(makeMatch(3), "t0"));
  const teams = ["t2", "t0", "t1"], players = ["p1", "p0", "p3", "p2", "p5", "p4"];
  const next = startNextSet(match, teams, players);
  const game = getSetGame(next);
  expect(getGameStatus(game).currentPlayerId).toBe("p5");
  expect(Object.values(getGameStatus(game).scores)).toEqual(Array(3).fill({ score: 0, consecutiveMisses: 0, eliminated: false }));
  expect(getScoreUnits(game).map((unit) => unit.id)).toEqual(teams);
  expect(getScoreUnits(game)[0].playerIds).toEqual(["p5", "p4"]);
  expect(match.sets[0].teamOrder).toEqual(["t0", "t1", "t2"]);
  expect(match.sets[0].playerOrder).toEqual(["p0", "p1", "p2", "p3", "p4", "p5"]);
  expect(() => startNextSet(match, ["t0", "t0", "t2"], players)).toThrow();
  expect(() => startNextSet(match, teams, players.slice(1))).toThrow();
  expect(suggestedOrders(match).teamOrder).toEqual(["t1", "t2", "t0"]);
});

it("keeps individual set order editable and the match's settings separate from future defaults", () => {
  const settings = { winsRequired: 2, inputMode: "simple" as const };
  let match = createMatch([{ id: "a", name: "Alice" }, { id: "b", name: "Bob" }], "individual", [], settings);
  settings.winsRequired = 5;
  expect(match.settings.winsRequired).toBe(2);
  match = confirmMatchSet(endSet(match, "a"));
  const next = startNextSet(match, [], ["b", "a"]);
  expect(getGameStatus(getSetGame(next)).currentPlayerId).toBe("b");
  expect(next.settings.winsRequired).toBe(2);
  expect(() => addMatchThrow(next, [12])).toThrow();
});

it("counts matches and set wins independently without double-counting throwing statistics", () => {
  let match = makeMatch(2, 2, true);
  match = nextSet(confirmMatchSet(endSet(match, "t0")));
  match = nextSet(confirmMatchSet(endSet(match, "t1")));
  match = confirmMatchSet(endSet(match, "t0"));
  const stats = getMatchCareerAnalysis([match]);
  const alice = stats.find((player) => player.playerId === "p0")!;
  const opponent = stats.find((player) => player.playerId === "p2")!;
  expect(alice).toMatchObject({ gamesPlayed: 1, gamesWon: 1, setsPlayed: 3, setsWon: 2, detailedGames: 1, detailedSets: 3 });
  expect(opponent).toMatchObject({ gamesPlayed: 1, gamesWon: 0, setsPlayed: 3, setsWon: 1 });
  expect(stats.reduce((n, p) => n + p.throws, 0)).toBe(match.sets.reduce((n, set) => n + set.turns.length, 0));
  expect(alice.throws).toBe(alice.detailedThrows);
  expect(getMatchCareerAnalysis([makeMatch()])).toEqual([]);
});

it("normalizes legacy files at the read boundary, including points and already-completed results", () => {
  const legacy: Game = {
    id: "old", startedAt: "2026-01-01", players: [{ id: "a", name: "A" }, { id: "b", name: "B" }],
    turns: ["a", "b", "a", "b", "a", "b", "a", "b", "a"].map((playerId) => ({ playerId, pins: [10], playedAt: "now" })),
  };
  const original = JSON.stringify(legacy);
  const normalized = readMatchData({ version: 1, currentGame: legacy, history: [legacy] })!;
  expect(normalized.currentMatch!.settings).toEqual({ winsRequired: 1, inputMode: "detailed" });
  expect(normalized.currentMatch!.sets[0].confirmed).toBe(true);
  expect(normalized.currentMatch!.sets[0].turns.every((turn) => turn.points === 10)).toBe(true);
  expect(getMatchStatus(normalized.currentMatch!)).toMatchObject({ isFinished: true, winnerId: "a" });
  expect(JSON.stringify(legacy)).toBe(original);
  expect(readMatchData(JSON.parse(JSON.stringify(normalized)))).toEqual(normalized);
  expect(normalized.currentMatch!.sets[0].ruleVersion).toBeUndefined();
  expect(isValidMatch(normalized.currentMatch)).toBe(true);
});

it("rejects corrupted state, unfinished sets marked confirmed, invalid scores and sets after a match win", () => {
  const match = makeMatch(2, 1);
  expect(isValidMatch({ ...match, sets: [] })).toBe(false);
  expect(isValidMatch({ ...match, settings: { ...match.settings, winsRequired: 0 } })).toBe(false);
  expect(isValidMatch({ ...match, sets: [{ ...match.sets[0], confirmed: true }] })).toBe(false);
  expect(isValidMatch({ ...match, sets: [{ ...match.sets[0], turns: [{ playerId: "p0", points: 13, playedAt: "now" }] }] })).toBe(false);
  expect(() => addMatchThrow(match, 1.5)).toThrow();
  const won = confirmMatchSet(endSet(match, "t0"));
  expect(isValidMatch({ ...won, sets: [...won.sets, { ...match.sets[0], id: "extra" }] })).toBe(false);
  expect(readMatchData({ ...emptyMatchData(), history: [match] })).toBeNull();
});

it("shares confirmation, undo and next-set transitions without losing set history", () => {
  const pending = endSet(makeMatch(3), "t0");
  const confirmed = confirmMatchSet(pending);
  const states = [pending, undoMatchThrow(pending), confirmed, nextSet(confirmed)];
  states.forEach((match, revision) => {
    const snapshot = decodeSnapshot(encodeSnapshot("s", revision, match), "s", revision - 1)!;
    expect(snapshot.game).toEqual(match);
    expect(snapshot.game!.sets[0].turns[0]).toHaveProperty("points");
  });
});
