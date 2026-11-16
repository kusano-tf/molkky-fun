export type InputMode = "simple" | "detailed";

export type GameMode = "individual" | "team";

export type Player = {
  id: string;
  name: string;
  teamId?: string;
};

export type Team = {
  id: string;
  name: string;
};

export type ThrowRecord = {
  playerId: string;
  playedAt: string;
} & (
  | { points: number; pins?: never }
  | { points?: number; pins: number[] }
);

export type Game = {
  id: string;
  ruleVersion?: 2;
  mode?: GameMode;
  inputMode?: InputMode;
  players: Player[];
  teams?: Team[];
  startedAt: string;
  turns: ThrowRecord[];
};

export type ScoreUnit = {
  id: string;
  name: string;
  playerIds: string[];
};

export type PlayerScore = {
  score: number;
  consecutiveMisses: number;
  eliminated: boolean;
};

export type GameStatus = {
  scores: Record<string, PlayerScore>;
  currentPlayerId: string | null;
  winnerId: string | null;
  isFinished: boolean;
};

export type UnitAnalysis = {
  unit: ScoreUnit;
  throws: number;
  scoringThrows: number;
  misses: number;
  totalPoints: number;
  averagePoints: number | null;
  bestThrow: number | null;
  accuracy: number | null;
  finalScore: number;
};

export type ScoreProgress = {
  turnNumber: number;
  playerId: string;
  scores: Record<string, number>;
};

export type GameAnalysis = {
  status: GameStatus;
  completedAt: string;
  units: UnitAnalysis[];
  progress: ScoreProgress[];
};

export type PlayerCareerAnalysis = {
  playerId: string;
  name: string;
  gamesPlayed: number;
  gamesWon: number;
  throws: number;
  scoringThrows: number;
  misses: number;
  totalPoints: number;
  averagePoints: number | null;
  bestThrow: number | null;
  tenPlusThrows: number;
  tenPlusOpportunities: number;
  accuracy: number | null;
  tenPlusRate: number | null;
  consistency: number | null;
  finishAttempts: number;
  exactFinishes: number;
  finishRate: number | null;
  detailedGames: number;
  detailedThrows: number;
  singlePinThrows: number;
  multiPinThrows: number;
  pinCounts: number[];
  radarValues: {
    accuracy: number;
    averagePoints: number;
    tenPlusRate: number;
    consistency: number;
    finishRate: number;
  };
};

export type AppData = {
  version: 1;
  currentGame: Game | null;
  history: Game[];
};

export const STORAGE_KEY = "molkky-fun:data";

export function createGame(
  players: Player[],
  mode: GameMode = "individual",
  teams: Team[] = [],
  inputMode: InputMode = "detailed",
): Game {
  return {
    id: crypto.randomUUID(),
    ruleVersion: 2,
    mode,
    inputMode,
    players: players.map((player) => ({ ...player })),
    ...(mode === "team" ? { teams: teams.map((team) => ({ ...team })) } : {}),
    startedAt: new Date().toISOString(),
    turns: [],
  };
}

export function getScoreUnits(game: Game): ScoreUnit[] {
  if (game.mode !== "team") {
    return game.players.map((player) => ({
      id: player.id,
      name: player.name,
      playerIds: [player.id],
    }));
  }

  return (game.teams ?? []).map((team) => ({
    id: team.id,
    name: team.name,
    playerIds: game.players.filter((player) => player.teamId === team.id).map((player) => player.id),
  }));
}

export function scoreThrow(pins: number[]): number {
  return pins.length === 1 ? pins[0] : pins.length;
}

export function getThrowPoints(turn: ThrowRecord): number {
  return turn.points ?? scoreThrow(turn.pins ?? []);
}

export function getInputMode(game: Game): InputMode {
  return game.inputMode ?? "detailed";
}

export function getGameStatus(game: Game): GameStatus {
  return replayGame(game);
}

function replayGame(
  game: Game,
  onTurn?: (
    turn: ThrowRecord,
    turnNumber: number,
    scores: Record<string, PlayerScore>,
  ) => void,
): GameStatus {
  const scoreUnits = getScoreUnits(game);
  const unitByPlayerId = new Map(
    scoreUnits.flatMap((unit) => unit.playerIds.map((playerId) => [playerId, unit] as const)),
  );
  const scores: Record<string, PlayerScore> = Object.fromEntries(
    scoreUnits.map((unit) => [
      unit.id,
      { score: 0, consecutiveMisses: 0, eliminated: false },
    ]),
  );
  const nextMemberIndex = new Map(scoreUnits.map((unit) => [unit.id, 0]));
  let currentPlayerId: string | null = scoreUnits[0]?.playerIds[0] ?? null;
  let winnerId: string | null = null;

  for (const [index, turn] of game.turns.entries()) {
    const unit = unitByPlayerId.get(turn.playerId);
    const unitScore = unit ? scores[unit.id] : undefined;
    if (!unit || !unitScore || unitScore.eliminated || turn.playerId !== currentPlayerId || winnerId) {
      throw new Error("試合データの投球順が正しくありません。");
    }

    if (getThrowPoints(turn) === 0) {
      unitScore.consecutiveMisses += 1;
      if (unitScore.consecutiveMisses >= 3) {
        unitScore.eliminated = true;
      }
    } else {
      const points = getThrowPoints(turn);
      const total = unitScore.score + points;
      unitScore.score = total > 50 ? 25 : total;
      unitScore.consecutiveMisses = 0;
    }

    if (unitScore.score === 50) {
      winnerId = unit.id;
    } else {
      const activeUnits = scoreUnits.filter((candidate) => !scores[candidate.id].eliminated);
      if (game.ruleVersion === 2 && activeUnits.length === 1) {
        winnerId = activeUnits[0].id;
      }
      if (activeUnits.length > 0) {
        const currentUnitIndex = scoreUnits.findIndex((candidate) => candidate.id === unit.id);
        const currentMembers = unit.playerIds;
        const memberIndex = currentMembers.indexOf(turn.playerId);
        nextMemberIndex.set(unit.id, (memberIndex + 1) % currentMembers.length);

        for (let offset = 1; offset <= scoreUnits.length; offset += 1) {
          const nextUnit = scoreUnits[(currentUnitIndex + offset) % scoreUnits.length];
          if (!scores[nextUnit.id].eliminated && nextUnit.playerIds.length > 0) {
            currentPlayerId =
              nextUnit.playerIds[nextMemberIndex.get(nextUnit.id)! % nextUnit.playerIds.length];
            break;
          }
        }
      } else {
        currentPlayerId = null;
      }
    }
    onTurn?.(turn, index + 1, scores);
  }

  return {
    scores,
    currentPlayerId,
    winnerId,
    isFinished: winnerId !== null || currentPlayerId === null,
  };
}

export function getGameAnalysis(game: Game): GameAnalysis {
  const units = getScoreUnits(game);
  const unitByPlayerId = new Map(
    units.flatMap((unit) => unit.playerIds.map((playerId) => [playerId, unit] as const)),
  );
  const mutableStats = new Map(
    units.map((unit) => [
      unit.id,
      { throws: 0, scoringThrows: 0, misses: 0, totalPoints: 0, bestThrow: 0 },
    ]),
  );
  const progress: ScoreProgress[] = [];

  const status = replayGame(game, (turn, turnNumber, scores) => {
    const unit = unitByPlayerId.get(turn.playerId);
    if (!unit) {
      throw new Error("投球した選手の所属先を分析できません。");
    }

    const stats = mutableStats.get(unit.id);
    if (!stats) {
      throw new Error("投球結果の集計先を分析できません。");
    }
    const points = getThrowPoints(turn);
    stats.throws += 1;
    stats.totalPoints += points;
    stats.bestThrow = Math.max(stats.bestThrow, points);
    if (getThrowPoints(turn) === 0) {
      stats.misses += 1;
    } else {
      stats.scoringThrows += 1;
    }

    progress.push({
      turnNumber,
      playerId: turn.playerId,
      scores: Object.fromEntries(units.map((scoreUnit) => [scoreUnit.id, scores[scoreUnit.id].score])),
    });
  });
  if (!status.isFinished) {
    throw new Error("試合が終了していないため、分析を作成できません。");
  }

  return {
    status,
    completedAt: game.turns.at(-1)?.playedAt ?? game.startedAt,
    units: units.map((unit) => {
      const stats = mutableStats.get(unit.id);
      if (!stats) {
        throw new Error("選手の成績を分析できません。");
      }
      return {
        unit,
        ...stats,
        averagePoints: stats.throws ? stats.totalPoints / stats.throws : null,
        bestThrow: stats.throws ? stats.bestThrow : null,
        accuracy: stats.throws ? (stats.scoringThrows / stats.throws) * 100 : null,
        finalScore: status.scores[unit.id].score,
      };
    }),
    progress,
  };
}

export function getPlayerCareerAnalysis(games: Game[]): PlayerCareerAnalysis[] {
  const players = new Map<
    string,
    {
      name: string;
      gamesPlayed: number;
      gamesWon: number;
      throws: number;
      scoringThrows: number;
      misses: number;
      totalPoints: number;
      bestThrow: number | null;
      tenPlusThrows: number;
      tenPlusOpportunities: number;
      throwScores: number[];
      finishAttempts: number;
      exactFinishes: number;
      detailedGames: number;
      detailedThrows: number;
      singlePinThrows: number;
      multiPinThrows: number;
      pinCounts: number[];
    }
  >();

  for (const game of games) {
    const status = getGameStatus(game);
    if (!status.isFinished) continue;

    const winningUnit = getScoreUnits(game).find((unit) => unit.id === status.winnerId);
    for (const player of game.players) {
      let stats = players.get(player.id);
      if (!stats) {
        stats = {
          name: player.name,
          gamesPlayed: 0,
          gamesWon: 0,
          throws: 0,
          scoringThrows: 0,
          misses: 0,
          totalPoints: 0,
          bestThrow: null,
          tenPlusThrows: 0,
          tenPlusOpportunities: 0,
          throwScores: [],
          finishAttempts: 0,
          exactFinishes: 0,
          detailedGames: 0,
          detailedThrows: 0,
          singlePinThrows: 0,
          multiPinThrows: 0,
          pinCounts: Array<number>(12).fill(0),
        };
        players.set(player.id, stats);
      }
      stats.gamesPlayed += 1;
      if (getInputMode(game) === "detailed") stats.detailedGames += 1;
      if (winningUnit?.playerIds.includes(player.id)) stats.gamesWon += 1;
    }

    const unitByPlayer = new Map(getScoreUnits(game).flatMap((unit) =>
      unit.playerIds.map((id) => [id, unit.id] as const)));
    const previousScores = new Map<string, number>();
    replayGame(game, (turn, _turnNumber, scores) => {
      const stats = players.get(turn.playerId);
      if (!stats) {
        throw new Error("試合データの選手を集計できません。");
      }
      const points = getThrowPoints(turn);
      const unitId = unitByPlayer.get(turn.playerId)!;
      const remaining = 50 - (previousScores.get(unitId) ?? 0);
      if (remaining >= 13) {
        stats.tenPlusOpportunities += 1;
        if (points >= 10) stats.tenPlusThrows += 1;
      }
      if (remaining >= 1 && remaining <= 12) {
        stats.finishAttempts += 1;
        if (points === remaining) stats.exactFinishes += 1;
      }
      previousScores.set(unitId, scores[unitId].score);
      stats.throws += 1;
      stats.totalPoints += points;
      stats.throwScores.push(points);
      if (turn.pins !== undefined) {
        stats.detailedThrows += 1;
        if (turn.pins.length === 1) stats.singlePinThrows += 1;
        if (turn.pins.length >= 2) stats.multiPinThrows += 1;
        turn.pins.forEach((pin) => { stats.pinCounts[pin - 1] += 1; });
      }
      stats.bestThrow = Math.max(stats.bestThrow ?? 0, points);
      if (getThrowPoints(turn) === 0) {
        stats.misses += 1;
      } else {
        stats.scoringThrows += 1;
      }
    });
  }

  return [...players.entries()].map(([playerId, stats]) => {
    const averagePoints = stats.throws ? stats.totalPoints / stats.throws : null;
    const accuracy = stats.throws ? (stats.scoringThrows / stats.throws) * 100 : null;
    const tenPlusRate = stats.tenPlusOpportunities
      ? (stats.tenPlusThrows / stats.tenPlusOpportunities) * 100 : null;
    const scoringThrowScores = stats.throwScores.filter((points) => points > 0);
    const scoringAverage = stats.scoringThrows ? stats.totalPoints / stats.scoringThrows : 0;
    const variance = scoringThrowScores.length > 1
      ? scoringThrowScores.reduce((sum, points) => sum + (points - scoringAverage) ** 2, 0) /
        scoringThrowScores.length
      : null;
    const consistency = variance === null ? null : Math.max(0, (1 - Math.sqrt(variance) / 6) * 100);
    const finishRate = stats.finishAttempts ? (stats.exactFinishes / stats.finishAttempts) * 100 : null;

    return {
      playerId,
      name: stats.name,
      gamesPlayed: stats.gamesPlayed,
      gamesWon: stats.gamesWon,
      throws: stats.throws,
      scoringThrows: stats.scoringThrows,
      misses: stats.misses,
      totalPoints: stats.totalPoints,
      averagePoints,
      bestThrow: stats.bestThrow,
      tenPlusThrows: stats.tenPlusThrows,
      tenPlusOpportunities: stats.tenPlusOpportunities,
      accuracy,
      tenPlusRate,
      consistency,
      finishAttempts: stats.finishAttempts,
      exactFinishes: stats.exactFinishes,
      finishRate,
      detailedGames: stats.detailedGames,
      detailedThrows: stats.detailedThrows,
      singlePinThrows: stats.singlePinThrows,
      multiPinThrows: stats.multiPinThrows,
      pinCounts: stats.pinCounts,
      radarValues: {
        accuracy: accuracy ?? 0,
        averagePoints: averagePoints === null ? 0 : (averagePoints / 12) * 100,
        tenPlusRate: tenPlusRate ?? 0,
        consistency: consistency ?? 0,
        finishRate: finishRate ?? 0,
      },
    };
  });
}

export function emptyData(): AppData {
  return { version: 1, currentGame: null, history: [] };
}

export function isAppData(value: unknown): value is AppData {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.history)) {
    return false;
  }
  if (value.currentGame !== null && !isGame(value.currentGame)) {
    return false;
  }
  return value.history.every((game) => isGame(game) && getGameStatus(game).isFinished);
}

function isGame(value: unknown): value is Game {
  if (!isRecord(value)) {
    return false;
  }
  const { id, startedAt } = value;
  const mode = value.mode;
  const ruleVersion = value.ruleVersion;
  const players = value.players;
  const teams = value.teams;
  const turns = value.turns;
  if (
    typeof id !== "string" ||
    typeof startedAt !== "string" ||
    (ruleVersion !== undefined && ruleVersion !== 2) ||
    (mode !== undefined && mode !== "individual" && mode !== "team") ||
    (value.inputMode !== undefined && value.inputMode !== "simple" && value.inputMode !== "detailed") ||
    !Array.isArray(players) ||
    players.length < 2 ||
    !players.every(isPlayer) ||
    !Array.isArray(turns)
  ) {
    return false;
  }
  if (
    (mode === "team" &&
      (!Array.isArray(teams) ||
        teams.length < 2 ||
        !teams.every(isTeam) ||
        new Set(teams.map((team) => team.id)).size !== teams.length ||
        new Set([...teams.map((team) => team.id), ...players.map((player) => player.id)]).size !==
          teams.length + players.length ||
        !players.every((player) => teams.some((team) => team.id === player.teamId)) ||
        teams.some((team) => !players.some((player) => player.teamId === team.id)))) ||
    (mode !== "team" && teams !== undefined && !Array.isArray(teams))
  ) {
    return false;
  }
  const playerIds = players.map((player) => player.id);
  if (
    new Set(playerIds).size !== playerIds.length ||
    !turns.every((turn) => isThrowRecord(turn, playerIds, value.inputMode === "simple" ? "simple" : "detailed"))
  ) {
    return false;
  }
  const game: Game = {
    id,
    startedAt,
    players,
    turns,
    ...(value.inputMode ? { inputMode: value.inputMode as InputMode } : {}),
    ...(ruleVersion === 2 ? { ruleVersion } : {}),
    ...(mode ? { mode } : {}),
    ...(Array.isArray(teams) ? { teams } : {}),
  };
  try {
    getGameStatus(game);
    return true;
  } catch {
    return false;
  }
}

function isPlayer(value: unknown): value is Player {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    value.id.length > 0 &&
    typeof value.name === "string" &&
    value.name.trim().length > 0 &&
    (value.teamId === undefined || typeof value.teamId === "string")
  );
}

function isTeam(value: unknown): value is Team {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    value.id.length > 0 &&
    typeof value.name === "string" &&
    value.name.trim().length > 0
  );
}

function isThrowRecord(value: unknown, playerIds: string[], inputMode: InputMode): boolean {
  if (!isRecord(value) || typeof value.playerId !== "string" ||
      !playerIds.includes(value.playerId) || typeof value.playedAt !== "string") return false;
  const validPoints = Number.isInteger(value.points) && Number(value.points) >= 0 && Number(value.points) <= 12;
  if (inputMode === "simple") return validPoints && value.pins === undefined;
  if (!Array.isArray(value.pins) || !value.pins.every(
    (pin: unknown) => Number.isInteger(pin) && Number(pin) >= 1 && Number(pin) <= 12,
  ) || new Set(value.pins).size !== value.pins.length) return false;
  return value.points === undefined || (validPoints && value.points === scoreThrow(value.pins));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
