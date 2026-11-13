import { describe, expect, it } from "vitest";
import {
  getGameAnalysis,
  getGameStatus,
  getPlayerCareerAnalysis,
  isAppData,
  scoreThrow,
  type Game,
} from "./game";

function gameWith(...throws: Array<[string, number[]]>): Game {
  return {
    id: "game",
    ruleVersion: 2,
    startedAt: "2026-01-01T00:00:00.000Z",
    players: [
      { id: "a", name: "A" },
      { id: "b", name: "B" },
    ],
    turns: throws.map(([playerId, pins], index) => ({
      playerId,
      pins,
      playedAt: `2026-01-01T00:00:0${index}.000Z`,
    })),
  };
}

function teamGame(...throws: Array<[string, number[]]>): Game {
  return {
    id: "team-game",
    ruleVersion: 2,
    mode: "team",
    startedAt: "2026-01-01T00:00:00.000Z",
    teams: [
      { id: "red", name: "Red" },
      { id: "blue", name: "Blue" },
    ],
    players: [
      { id: "red-1", name: "Red 1", teamId: "red" },
      { id: "red-2", name: "Red 2", teamId: "red" },
      { id: "blue-1", name: "Blue 1", teamId: "blue" },
    ],
    turns: throws.map(([playerId, pins], index) => ({
      playerId,
      pins,
      playedAt: `2026-01-01T00:00:0${index}.000Z`,
    })),
  };
}

describe("scoreThrow", () => {
  it("scores a single fallen pin by its number and multiple pins by their count", () => {
    expect(scoreThrow([8])).toBe(8);
    expect(scoreThrow([2, 5, 9])).toBe(3);
  });
});

describe("getGameStatus", () => {
  it("resets a score above 50 to 25", () => {
    const status = getGameStatus(
      gameWith(["a", [12]], ["b", [1]], ["a", [12]], ["b", [1]], ["a", [12]], ["b", [1]], ["a", [12]], ["b", [1]], ["a", [1, 2, 3]]),
    );
    expect(status.scores.a.score).toBe(25);
    expect(status.winnerId).toBeNull();
  });

  it("declares a winner at exactly 50 points", () => {
    const status = getGameStatus(
      gameWith(["a", [10]], ["b", [1]], ["a", [10]], ["b", [1]], ["a", [10]], ["b", [1]], ["a", [10]], ["b", [1]], ["a", [10]]),
    );
    expect(status.winnerId).toBe("a");
  });

  it("declares the remaining player the winner after three consecutive misses", () => {
    const status = getGameStatus(
      gameWith(["a", []], ["b", [1]], ["a", []], ["b", [1]], ["a", []]),
    );
    expect(status.scores.a.eliminated).toBe(true);
    expect(status.currentPlayerId).toBe("b");
    expect(status.winnerId).toBe("b");
    expect(status.isFinished).toBe(true);
  });

  it("replays saved games without the new rule version using the previous win condition", () => {
    const legacyGame = gameWith(
      ["a", []],
      ["b", [10]],
      ["a", []],
      ["b", [10]],
      ["a", []],
      ["b", [10]],
      ["b", [10]],
      ["b", [10]],
    );
    delete legacyGame.ruleVersion;
    const status = getGameStatus(legacyGame);

    expect(status.winnerId).toBe("b");
    expect(status.scores.b.score).toBe(50);
    expect(
      isAppData({
        version: 1,
        currentGame: null,
        history: [legacyGame],
      }),
    ).toBe(true);
  });

  it("keeps the previous no-winner outcome for saved games where everyone is disqualified", () => {
    const legacyGame = gameWith(["a", []], ["b", []], ["a", []], ["b", []], ["a", []], ["b", []]);
    delete legacyGame.ruleVersion;
    const status = getGameStatus(legacyGame);

    expect(status.scores.b.eliminated).toBe(true);
    expect(status.isFinished).toBe(true);
    expect(status.winnerId).toBeNull();
  });

  it("alternates teams and rotates members in team registration order", () => {
    const status = getGameStatus(
      teamGame(["red-1", [8]], ["blue-1", [2]], ["red-2", [5]]),
    );
    expect(status.currentPlayerId).toBe("blue-1");
    expect(status.scores.red.score).toBe(13);
    expect(status.scores.blue.score).toBe(2);
  });

  it("declares the remaining team the winner after three shared misses", () => {
    const status = getGameStatus(
      teamGame(
        ["red-1", []],
        ["blue-1", [1]],
        ["red-2", []],
        ["blue-1", [1]],
        ["red-1", []],
      ),
    );
    expect(status.scores.red.eliminated).toBe(true);
    expect(status.currentPlayerId).toBe("blue-1");
    expect(status.winnerId).toBe("blue");
    expect(status.isFinished).toBe(true);
  });

  it("declares the team winner when a shared team score reaches 50", () => {
    const status = getGameStatus(
      teamGame(
        ["red-1", [12]],
        ["blue-1", [1]],
        ["red-2", [12]],
        ["blue-1", [1]],
        ["red-1", [12]],
        ["blue-1", [1]],
        ["red-2", [12]],
        ["blue-1", [1]],
        ["red-1", [2]],
      ),
    );
    expect(status.scores.red.score).toBe(50);
    expect(status.winnerId).toBe("red");
  });
});

describe("getGameAnalysis", () => {
  it("summarizes team statistics and score progression for an ended game", () => {
    const game = teamGame(
      ["red-1", [12]],
      ["blue-1", [1]],
      ["red-2", [12]],
      ["blue-1", [1]],
      ["red-1", [12]],
      ["blue-1", [1]],
      ["red-2", [12]],
      ["blue-1", [1]],
      ["red-1", [2]],
    );
    const analysis = getGameAnalysis(game);
    const red = analysis.units.find((unit) => unit.unit.id === "red");

    expect(analysis.status.winnerId).toBe("red");
    expect(analysis.completedAt).toBe(game.turns.at(-1)?.playedAt);
    expect(red).toMatchObject({
      throws: 5,
      scoringThrows: 5,
      misses: 0,
      totalPoints: 50,
      averagePoints: 10,
      bestThrow: 12,
      accuracy: 100,
      finalScore: 50,
    });
    expect(analysis.progress).toHaveLength(9);
    expect(analysis.progress.at(-1)?.scores.red).toBe(50);
  });

  it("does not produce analysis before the game is finished", () => {
    expect(() => getGameAnalysis(gameWith())).toThrow("試合が終了していないため、分析を作成できません。");
  });
});

describe("getPlayerCareerAnalysis", () => {
  it("includes misses and remaining 13, excludes remaining 12 and busts, then resumes after a bust", () => {
    const turns: Array<[string, number[]]> = [];
    const points = [0, 12, 12, 12, 1, 1, 1, 12, 12, 1, 12];
    points.forEach((score, index) => {
      turns.push(["a", score ? [score] : []]);
      if (index < points.length - 1) turns.push(["b", [1]]);
    });
    const player = getPlayerCareerAnalysis([gameWith(...turns)])[0];
    expect(player).toMatchObject({
      tenPlusThrows: 4,
      tenPlusOpportunities: 8,
      tenPlusRate: 50,
      radarValues: { tenPlusRate: 50 },
    });
  });

  it("counts misses, undershoots and busts only when an exact finish was possible", () => {
    const turns: Array<[string, number[]]> = [];
    const points = [12, 12, 12, 2, 0, 5, 8, 12, 1, 12];
    points.forEach((score, index) => {
      turns.push(["a", score ? [score] : []]);
      if (index < points.length - 1) turns.push(["b", [1]]);
    });
    const analysis = getPlayerCareerAnalysis([gameWith(...turns)]);
    expect(analysis.find((player) => player.playerId === "a")).toMatchObject({
      finishAttempts: 4, exactFinishes: 1, finishRate: 25,
      tenPlusThrows: 4, tenPlusOpportunities: 6, tenPlusRate: (4 / 6) * 100,
      radarValues: { finishRate: 25 },
    });
    expect(analysis.find((player) => player.playerId === "b")).toMatchObject({
      finishAttempts: 0, exactFinishes: 0, finishRate: null,
    });
  });

  it("aggregates player performance across completed matches sharing player IDs", () => {
    const firstGame = gameWith(
      ["a", [10]], ["b", [1]], ["a", [10]], ["b", [1]], ["a", [10]],
      ["b", [1]], ["a", [10]], ["b", [1]], ["a", [10]],
    );
    firstGame.id = "first-game";
    const secondGame = gameWith(
      ["a", [1]], ["b", [10]], ["a", [1]], ["b", [10]], ["a", [1]],
      ["b", [10]], ["a", [1]], ["b", [10]], ["a", [1]], ["b", [10]],
    );
    secondGame.id = "second-game";

    const analysis = getPlayerCareerAnalysis([firstGame, secondGame]);
    const playerA = analysis.find((player) => player.playerId === "a");

    expect(playerA).toMatchObject({
      name: "A",
      gamesPlayed: 2,
      gamesWon: 1,
      throws: 10,
      totalPoints: 55,
      averagePoints: 5.5,
      bestThrow: 10,
      tenPlusThrows: 4,
      tenPlusOpportunities: 9,
      accuracy: 100,
      consistency: 25,
    });
    expect(playerA?.radarValues).toMatchObject({
      accuracy: 100,
      averagePoints: (5.5 / 12) * 100,
      tenPlusRate: (4 / 9) * 100,
    });
  });

  it("counts a team win for each member and excludes unfinished games", () => {
    const game = teamGame(
      ["red-1", [12]],
      ["blue-1", [1]],
      ["red-2", [12]],
      ["blue-1", [1]],
      ["red-1", [12]],
      ["blue-1", [1]],
      ["red-2", [12]],
      ["blue-1", [1]],
      ["red-1", [2]],
    );
    const analysis = getPlayerCareerAnalysis([game, gameWith()]);

    expect(analysis.find((player) => player.playerId === "red-1")).toMatchObject({
      gamesPlayed: 1,
      gamesWon: 1,
      throws: 3,
      tenPlusThrows: 2,
      tenPlusOpportunities: 2,
      tenPlusRate: 100,
      finishAttempts: 1,
      exactFinishes: 1,
      finishRate: 100,
    });
    expect(analysis.find((player) => player.playerId === "red-2")).toMatchObject({
      gamesPlayed: 1,
      gamesWon: 1,
      throws: 2,
      tenPlusThrows: 2,
      tenPlusOpportunities: 2,
      tenPlusRate: 100,
      finishAttempts: 0,
      exactFinishes: 0,
      finishRate: null,
    });
    expect(analysis.find((player) => player.playerId === "blue-1")).toMatchObject({
      gamesPlayed: 1,
      gamesWon: 0,
    });
  });
});

describe("isAppData", () => {
  it("accepts existing version 1 individual games without a mode field", () => {
    expect(
      isAppData({
        version: 1,
        currentGame: gameWith(),
        history: [],
      }),
    ).toBe(true);
  });

  it("rejects team games with unassigned players", () => {
    const invalidTeamGame = teamGame();
    invalidTeamGame.players[0].teamId = "missing-team";
    expect(
      isAppData({
        version: 1,
        currentGame: invalidTeamGame,
        history: [],
      }),
    ).toBe(false);
  });

  it("rejects malformed or out-of-order imported games", () => {
    const malformed = {
      version: 1,
      currentGame: {
        ...gameWith(["b", [1]]),
        id: "bad",
      },
      history: [],
    };
    expect(isAppData(malformed)).toBe(false);
  });
});
