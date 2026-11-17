import {
  emptyData, getGameStatus, getInputMode, getPlayerCareerAnalysis,
  getScoreUnits, getThrowPoints, isAppData,
  type Game, type GameMode, type InputMode, type Player, type Team, type ThrowRecord,
} from "./game";

export type MatchSettings = { winsRequired: number; inputMode: InputMode };
export const DEFAULT_SETTINGS: MatchSettings = { winsRequired: 1, inputMode: "simple" };
export type MatchThrow = ThrowRecord & { points: number };
export type MatchSet = {
  id: string; startedAt: string; ruleVersion?: 2;
  teamOrder: string[]; playerOrder: string[];
  turns: MatchThrow[]; confirmed: boolean;
};
export type Match = {
  id: string; startedAt: string; mode: GameMode; settings: MatchSettings;
  players: Player[]; teams: Team[]; sets: MatchSet[];
};
export type MatchData = {
  version: 1; currentMatch: Match | null; history: Match[];
};

export function getSetGame(match: Match, set: MatchSet = match.sets[match.sets.length - 1]): Game {
  return {
    id: set.id, startedAt: set.startedAt, ruleVersion: set.ruleVersion,
    mode: match.mode, inputMode: match.settings.inputMode,
    players: set.playerOrder.map((id) => match.players.find((player) => player.id === id)!),
    ...(match.mode === "team" ? { teams: set.teamOrder.map((id) => match.teams.find((team) => team.id === id)!) } : {}),
    turns: set.turns,
  };
}

function newSet(players: Player[], teams: Team[]): MatchSet {
  return { id: crypto.randomUUID(), startedAt: new Date().toISOString(), ruleVersion: 2,
    playerOrder: players.map((p) => p.id), teamOrder: teams.map((t) => t.id), turns: [], confirmed: false };
}
export function createMatch(players: Player[], mode: GameMode, teams: Team[], settings: MatchSettings): Match {
  if (!validSettings(settings)) throw new Error("Invalid match settings");
  return { id: crypto.randomUUID(), startedAt: new Date().toISOString(), mode,
    settings: { ...settings }, players: players.map((p) => ({ ...p })),
    teams: mode === "team" ? teams.map((t) => ({ ...t })) : [], sets: [newSet(players, mode === "team" ? teams : [])] };
}
export function getMatchStatus(match: Match) {
  const units = getScoreUnits(getSetGame(match));
  const wins = Object.fromEntries(units.map((unit) => [unit.id, 0]));
  for (const set of match.sets) {
    if (!set.confirmed) continue;
    const winner = getGameStatus(getSetGame(match, set)).winnerId;
    if (winner) wins[winner] += 1;
  }
  const winnerId = units.find((unit) => wins[unit.id] >= match.settings.winsRequired)?.id ?? null;
  const last = match.sets[match.sets.length - 1];
  // Preserve old completed matches where everyone was eliminated under the old rules.
  const noWinner = match.settings.winsRequired === 1 && last.confirmed && !getGameStatus(getSetGame(match)).winnerId;
  return { wins, winnerId, isFinished: winnerId !== null || noWinner };
}
export function addMatchThrow(match: Match, input: number[] | number): Match {
  const last = match.sets[match.sets.length - 1];
  const game = getSetGame(match), status = getGameStatus(game);
  if (last.confirmed || status.isFinished || !status.currentPlayerId) throw new Error("Set is not accepting throws");
  if ((match.settings.inputMode === "simple") !== (typeof input === "number")) throw new Error("Wrong input mode");
  const points = typeof input === "number" ? input : getThrowPoints({ pins: input, playerId: "", playedAt: "" });
  const record = { playerId: status.currentPlayerId, playedAt: new Date().toISOString(), points,
    ...(Array.isArray(input) ? { pins: [...input] } : {}) } as MatchThrow;
  const next = { ...match, sets: [...match.sets.slice(0, -1), { ...last, turns: [...last.turns, record] }] };
  if (!isValidMatch(next)) throw new Error("Invalid throw");
  return next;
}
export function undoMatchThrow(match: Match): Match {
  const last = match.sets[match.sets.length - 1];
  if (last.confirmed || !last.turns.length) throw new Error("No editable throw");
  return { ...match, sets: [...match.sets.slice(0, -1), { ...last, turns: last.turns.slice(0, -1) }] };
}
export function confirmMatchSet(match: Match): Match {
  const last = match.sets[match.sets.length - 1];
  if (last.confirmed || !getGameStatus(getSetGame(match)).isFinished) throw new Error("Set is not awaiting confirmation");
  return { ...match, sets: [...match.sets.slice(0, -1), { ...last, confirmed: true }] };
}
export function suggestedOrders(match: Match) {
  const last = match.sets[match.sets.length - 1];
  const rotate = (ids: string[]) => [...ids.slice(1), ...ids.slice(0, 1)];
  return { teamOrder: rotate(last.teamOrder), playerOrder: match.mode === "team" ? [...last.playerOrder] : rotate(last.playerOrder) };
}
export function startNextSet(match: Match, teamOrder: string[], playerOrder: string[]): Match {
  if (getMatchStatus(match).isFinished || !match.sets[match.sets.length - 1].confirmed) throw new Error("Cannot start another set");
  const set = { ...newSet(match.players, match.teams), teamOrder: [...teamOrder], playerOrder: [...playerOrder] };
  const next = { ...match, sets: [...match.sets, set] };
  if (!isValidMatch(next)) throw new Error("Invalid throwing order");
  return next;
}
export function getMatchCareerAnalysis(matches: Match[]) {
  const completed = matches.filter((match) => getMatchStatus(match).isFinished);
  const games = completed.flatMap((match) => match.sets.map((set) => getSetGame(match, set)));
  return getPlayerCareerAnalysis(games).map((stats) => {
    const participated = completed.filter((match) => match.players.some((p) => p.id === stats.playerId));
    const won = participated.filter((match) => {
      const winner = getMatchStatus(match).winnerId;
      return getScoreUnits(getSetGame(match)).some((unit) => unit.id === winner && unit.playerIds.includes(stats.playerId));
    });
    return { ...stats, setsPlayed: stats.gamesPlayed, setsWon: stats.gamesWon,
      detailedSets: stats.detailedGames,
      gamesPlayed: participated.length, gamesWon: won.length,
      detailedGames: participated.filter((match) => match.settings.inputMode === "detailed").length };
  });
}

export function validSettings(value: unknown): value is MatchSettings {
  return record(value) && Number.isInteger(value.winsRequired) && Number(value.winsRequired) >= 1 && Number(value.winsRequired) <= 5 &&
    (value.inputMode === "simple" || value.inputMode === "detailed");
}
function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object"; }
function permutation(value: unknown, ids: string[]): value is string[] {
  return Array.isArray(value) && value.length === ids.length && new Set(value).size === ids.length && value.every((id) => ids.includes(id));
}
export function isValidMatch(value: unknown): value is Match {
  if (!record(value) || typeof value.id !== "string" || typeof value.startedAt !== "string" ||
    (value.mode !== "team" && value.mode !== "individual") || !validSettings(value.settings) ||
    !Array.isArray(value.players) || !Array.isArray(value.teams) || !Array.isArray(value.sets) || !value.sets.length) return false;
  const match = value as Match;
  try {
    if (!match.players.every((p) => record(p) && typeof p.id === "string") || !match.teams.every((t) => record(t) && typeof t.id === "string")) return false;
    if (match.mode === "individual" && match.teams.length) return false;
    if (new Set(match.sets.map((set) => set.id)).size !== match.sets.length) return false;
    const wins = new Map<string, number>();
    for (const [index, set] of match.sets.entries()) {
      if (!record(set) || typeof set.id !== "string" || typeof set.startedAt !== "string" || typeof set.confirmed !== "boolean" ||
        !permutation(set.playerOrder, match.players.map((p) => p.id)) || !permutation(set.teamOrder, match.teams.map((t) => t.id))) return false;
      const game = getSetGame(match, set);
      if (!isAppData({ ...emptyData(), currentGame: game }) || !game.turns.every((turn) => Number.isInteger(turn.points))) return false;
      const status = getGameStatus(game);
      if (set.confirmed && !status.isFinished) return false;
      if (index < match.sets.length - 1 && !set.confirmed) return false;
      if (set.confirmed && status.winnerId) wins.set(status.winnerId, (wins.get(status.winnerId) ?? 0) + 1);
      if (index < match.sets.length - 1 && ([...wins.values()].some((n) => n >= match.settings.winsRequired) || (set.confirmed && !status.winnerId && match.settings.winsRequired === 1))) return false;
    }
    return true;
  } catch { return false; }
}

// Compatibility lives at the read boundary. Every runtime match has explicit settings,
// set orders, confirmation state and points, including files written by earlier apps.
function fromLegacy(game: Game): Match {
  return { id: game.id, startedAt: game.startedAt, mode: game.mode ?? "individual",
    settings: { winsRequired: 1, inputMode: getInputMode(game) },
    players: game.players.map((player) => ({ ...player })), teams: game.mode === "team" ? game.teams!.map((team) => ({ ...team })) : [],
    sets: [{ id: game.id, startedAt: game.startedAt, ruleVersion: game.ruleVersion,
      teamOrder: game.mode === "team" ? game.teams!.map((team) => team.id) : [], playerOrder: game.players.map((p) => p.id),
      turns: game.turns.map((turn) => ({ ...turn, points: getThrowPoints(turn) })), confirmed: getGameStatus(game).isFinished }] };
}
export function readMatchData(value: unknown): MatchData | null {
  if (!record(value) || value.version !== 1 || !Array.isArray(value.history)) return null;
  if (Object.hasOwn(value, "currentMatch")) {
    if ((value.currentMatch !== null && !isValidMatch(value.currentMatch)) ||
      !value.history.every((match) => isValidMatch(match) && getMatchStatus(match).isFinished)) return null;
    return { version: 1, currentMatch: value.currentMatch as Match | null, history: value.history as Match[] };
  }
  if (!isAppData(value)) return null;
  return { version: 1, currentMatch: value.currentGame ? fromLegacy(value.currentGame) : null, history: value.history.map(fromLegacy) };
}
export function emptyMatchData(): MatchData { return { version: 1, currentMatch: null, history: [] }; }
