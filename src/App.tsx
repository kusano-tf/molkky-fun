import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { toBlob } from "html-to-image";
import { OverlayDialog } from "./OverlayDialog";
import {
  createGame,
  emptyData,
  getGameAnalysis,
  getGameStatus,
  getPlayerCareerAnalysis,
  isAppData,
  scoreThrow,
  STORAGE_KEY,
  type AppData,
  type Game,
  type GameMode,
  type Player,
  type PlayerCareerAnalysis,
  type Team,
  getScoreUnits,
} from "./game";

const ANALYSIS_COLORS = ["#245c46", "#c17a49", "#6476aa", "#9b7650", "#915e8c", "#447a80"];
const CAREER_RADAR_AXES = [
  { key: "accuracy", label: "成功率" },
  { key: "averagePoints", label: "平均得点" },
  { key: "tenPlusRate", label: "10点以上率" },
  { key: "consistency", label: "安定度" },
  { key: "finishRate", label: "あがり成功率" },
] as const;

function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "日時不明"
    : date.toLocaleString("ja-JP", { dateStyle: "medium", timeStyle: "short" });
}

function formatDuration(startedAt: string, completedAt: string): string {
  const start = new Date(startedAt).getTime();
  const end = new Date(completedAt).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return "—";
  const minutes = Math.floor((end - start) / 60_000);
  const seconds = Math.floor((end - start) / 1_000) % 60;
  return minutes ? `${minutes}分${seconds}秒` : `${seconds}秒`;
}

function CareerRadarChart({ values }: { values: PlayerCareerAnalysis["radarValues"] }) {
  const centerX = 150;
  const centerY = 120;
  const radius = 78;
  const getPoint = (index: number, scale: number) => {
    const angle = (index / CAREER_RADAR_AXES.length) * Math.PI * 2 - Math.PI / 2;
    return `${centerX + Math.cos(angle) * radius * scale},${centerY + Math.sin(angle) * radius * scale}`;
  };
  const getPosition = (index: number, scale: number) => {
    const angle = (index / CAREER_RADAR_AXES.length) * Math.PI * 2 - Math.PI / 2;
    return {
      x: centerX + Math.cos(angle) * radius * scale,
      y: centerY + Math.sin(angle) * radius * scale,
    };
  };
  const gridPoints = (scale: number) =>
    CAREER_RADAR_AXES.map((_, index) => getPoint(index, scale)).join(" ");

  return (
    <svg className="career-radar-chart" viewBox="0 0 300 240" role="img" aria-label="プレイヤーの全試合レーダーチャート">
      {[0.25, 0.5, 0.75, 1].map((scale) => (
        <polygon key={scale} points={gridPoints(scale)} fill="none" stroke="#e4e9e2" strokeWidth={1} />
      ))}
      {CAREER_RADAR_AXES.map((axis, index) => {
        const { x, y } = getPosition(index, 1);
        const label = getPosition(index, 1 + 18 / radius);
        return (
          <g key={axis.key}>
            <line x1={centerX} y1={centerY} x2={x} y2={y} stroke="#e4e9e2" strokeWidth={1} />
            <text
              x={label.x}
              y={label.y + (index === 0 ? -3 : index === 2 ? 10 : 4)}
              textAnchor={label.x > centerX + 10 ? "start" : label.x < centerX - 10 ? "end" : "middle"}
              fill="#718075"
              fontFamily="sans-serif"
              fontSize={10}
            >{axis.label}</text>
          </g>
        );
      })}
      <polygon
        points={CAREER_RADAR_AXES.map((axis, index) => getPoint(index, values[axis.key] / 100)).join(" ")}
        fill="#245c46"
        fillOpacity={0.18}
        stroke="#245c46"
        strokeWidth={2}
      />
      {CAREER_RADAR_AXES.map((axis, index) => {
        const point = getPosition(index, values[axis.key] / 100);
        return <circle key={axis.key} cx={point.x} cy={point.y} r={3} fill="#245c46" />;
      })}
    </svg>
  );
}

function loadData(): { data: AppData; error: string | null } {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return { data: emptyData(), error: null };
    const parsed: unknown = JSON.parse(stored);
    if (!isAppData(parsed)) {
      return { data: emptyData(), error: "保存データを読み込めません。インポートから復元してください。" };
    }
    return { data: parsed, error: null };
  } catch {
    return { data: emptyData(), error: "保存データを読み込めません。ブラウザーの保存領域を確認してください。" };
  }
}

function makeDefaultTeams(): Team[] {
  return [
    { id: "team-1", name: "チーム 1" },
    { id: "team-2", name: "チーム 2" },
  ];
}

function makeDefaultPlayers(teams: Team[]): Player[] {
  return [
    { id: crypto.randomUUID(), name: "プレイヤー 1", teamId: teams[0].id },
    { id: crypto.randomUUID(), name: "プレイヤー 2", teamId: teams[1].id },
  ];
}

function shuffle<T>(items: T[]): T[] {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

function GameResults({ game, isSharing, onShare, onNewGame }: {
  game: Game;
  isSharing: boolean;
  onShare: (target: HTMLDivElement | null) => Promise<void>;
  onNewGame?: () => void;
}) {
  const analysisImageRef = useRef<HTMLDivElement>(null);
  const analysis = useMemo(() => getGameAnalysis(game), [game]);
  const winner = getScoreUnits(game).find((unit) => unit.id === analysis.status.winnerId);
  const historyColumns = analysis.units.map((unitStats) => ({
    unitStats,
    turns: game.turns.map((turn, turnIndex) => ({ turn, turnIndex }))
      .filter(({ turn }) => unitStats.unit.playerIds.includes(turn.playerId)),
  }));
  const historyRowCount = Math.max(0, ...historyColumns.map((column) => column.turns.length));
  return (
    <section className="analysis-layout">
      <div className="analysis-share-content" ref={analysisImageRef}>
      <div className="analysis-hero">
        <div>
          <p className="eyebrow">MATCH ANALYSIS</p>
          <h1>{winner ? `${winner.name} の勝ち！` : "試合終了"}</h1>
          <p className="analysis-result-copy">
            {winner ? "ナイスゲーム！おめでとうございます。" : "全員が失格となりました。"}
          </p>
          <div className="analysis-meta">
            <span>{formatDateTime(game.startedAt)}</span>
            <span>{game.turns.length} 投</span>
            <span>{formatDuration(game.startedAt, analysis.completedAt)}</span>
          </div>
        </div>
        <span className="winner-icon" aria-hidden="true">✦</span>
      </div>

      <section className="analysis-section">
        <div className="section-heading">
          <div><p className="eyebrow">FINAL SCORE</p><h2>最終スコアと成績</h2></div>
        </div>
        <div className="analysis-unit-list">
          {analysis.units.map((unitStats, index) => {
            const memberNames = unitStats.unit.playerIds
              .map((playerId) => game.players.find((player) => player.id === playerId)?.name)
              .filter((name): name is string => Boolean(name));
            return (
              <article className="analysis-unit-card" key={unitStats.unit.id}>
                <div className="analysis-unit-heading">
                  <span className={`player-dot dot-${index % 6}`}>{String(index + 1).padStart(2, "0")}</span>
                  <div className="analysis-unit-name">
                    <strong>{unitStats.unit.name}</strong>
                    {game.mode === "team" && <small>{memberNames.join(" ・ ")}</small>}
                  </div>
                  <b>{unitStats.finalScore}<small> / 50</small></b>
                </div>
                <div className="analysis-stat-grid">
                  <div><span>投球数</span><strong>{unitStats.throws}</strong></div>
                  <div><span>得点した投球</span><strong>{unitStats.scoringThrows}</strong></div>
                  <div><span>ミス</span><strong>{unitStats.misses}</strong></div>
                  <div><span>成功率</span><strong>{unitStats.accuracy === null ? "—" : `${unitStats.accuracy.toFixed(0)}%`}</strong></div>
                  <div><span>平均得点 / 投</span><strong>{unitStats.averagePoints === null ? "—" : unitStats.averagePoints.toFixed(1)}</strong></div>
                  <div><span>最高得点</span><strong>{unitStats.bestThrow ?? "—"}</strong></div>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="analysis-section">
        <div className="section-heading">
          <div><p className="eyebrow">SCORE PROGRESS</p><h2>得点の推移</h2></div>
          <span className="muted">{game.turns.length} 投</span>
        </div>
        <svg className="score-chart" viewBox="0 0 360 180" role="img" aria-label="試合中の得点推移">
          <line x1="34" y1="40" x2="342" y2="40" stroke="#e8ebe4" strokeWidth={1} />
          <line x1="34" y1="90" x2="342" y2="90" stroke="#e8ebe4" strokeWidth={1} />
          <line x1="34" y1="140" x2="342" y2="140" stroke="#e8ebe4" strokeWidth={1} />
          <text x="5" y="44" fill="#9aa198" fontFamily="sans-serif" fontSize={9}>50</text>
          <text x="5" y="94" fill="#9aa198" fontFamily="sans-serif" fontSize={9}>25</text>
          <text x="13" y="144" fill="#9aa198" fontFamily="sans-serif" fontSize={9}>0</text>
          <text x="30" y="165" fill="#9aa198" fontFamily="sans-serif" fontSize={9}>開始</text>
          <text x="342" y="165" textAnchor="end" fill="#9aa198" fontFamily="sans-serif" fontSize={9}>{game.turns.length} 投</text>
          {analysis.units.map((unitStats, index) => {
            const maxTurn = Math.max(1, analysis.progress.length);
            const chartPoints = [
              "34,140",
              ...analysis.progress.map((snapshot) => {
                const x = 34 + (308 * snapshot.turnNumber) / maxTurn;
                const y = 140 - 2 * snapshot.scores[unitStats.unit.id];
                return `${x},${y}`;
              }),
            ].join(" ");
            const lastScore =
              analysis.progress.at(-1)?.scores[unitStats.unit.id] ?? 0;
            return (
              <g key={unitStats.unit.id}>
                <polyline
                  points={chartPoints}
                  fill="none"
                  stroke={ANALYSIS_COLORS[index % ANALYSIS_COLORS.length]}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2.5}
                />
                <circle
                  cx="342"
                  cy={140 - 2 * lastScore}
                  r="4"
                  fill={ANALYSIS_COLORS[index % ANALYSIS_COLORS.length]}
                  stroke="#fffefa"
                  strokeWidth={2}
                />
              </g>
            );
          })}
        </svg>
        <div className="chart-legend">
          {analysis.units.map((unitStats, index) => (
            <span key={unitStats.unit.id}>
              <i style={{ backgroundColor: ANALYSIS_COLORS[index % ANALYSIS_COLORS.length] }} />
              {unitStats.unit.name}
            </span>
          ))}
        </div>
      </section>

      <section className="analysis-section analysis-history-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">SCORE HISTORY</p>
            <h2>{game.mode === "team" ? "チームごとの得点履歴" : "選手ごとの得点履歴"}</h2>
          </div>
          <span className="muted">{game.turns.length} 投</span>
        </div>
        <div className="analysis-history-scroll">
          <div
            className="analysis-history-grid"
            style={{
              gridTemplateColumns: `26px repeat(${analysis.units.length}, minmax(88px, 1fr))`,
            }}
          >
            <div className="history-matrix-number-heading">#</div>
            {analysis.units.map((unitStats) => (
              <div className="history-matrix-unit-heading" key={unitStats.unit.id}>
                <strong>{unitStats.unit.name}</strong>
                <b>{unitStats.finalScore}<small> / 50</small></b>
              </div>
            ))}
            {Array.from({ length: historyRowCount }, (_, rowIndex) => (
              <Fragment key={rowIndex}>
                <div className="history-matrix-turn-number">{rowIndex + 1}</div>
                {historyColumns.map(({ unitStats, turns }) => {
                  const item = turns[rowIndex];
                  if (!item) {
                    return <div className="history-matrix-empty" key={unitStats.unit.id} aria-hidden="true" />;
                  }
                  const { turn, turnIndex } = item;
                  const player = game.players.find((candidate) => candidate.id === turn.playerId);
                  const points = scoreThrow(turn.pins);
                  return (
                    <div className="history-matrix-cell" key={unitStats.unit.id}>
                      <div>
                        <b>{turn.pins.length ? `+${points}` : "ミス"}</b>
                        <span>{analysis.progress[turnIndex].scores[unitStats.unit.id]} 点</span>
                      </div>
                      <small>
                        {game.mode === "team" ? `${player?.name ?? ""} · ` : ""}
                        {turn.pins.length ? turn.pins.join("・") : "—"}
                      </small>
                    </div>
                  );
                })}
              </Fragment>
            ))}
          </div>
        </div>
      </section>
      </div>

      <button
        className="primary-button analysis-share-button"
        onClick={() => void onShare(analysisImageRef.current)}
        disabled={isSharing}
      >
        {isSharing ? "画像を準備中…" : "試合結果をシェア"} <span>↗</span>
      </button>
      {onNewGame && <div className="bottom-action-bar">
        <button className="primary-button analysis-new-game" onClick={onNewGame}>
          新しいゲームを始める <span>→</span>
        </button>
      </div>}
    </section>
  );
}

function App() {
  const initial = useRef(loadData()).current;
  const [data, setData] = useState(initial.data);
  const [storageError, setStorageError] = useState(initial.error);
  const skipFirstSave = useRef(Boolean(initial.error));
  const [mode, setMode] = useState<GameMode>("individual");
  const [teams, setTeams] = useState(makeDefaultTeams);
  const [players, setPlayers] = useState(() => makeDefaultPlayers(makeDefaultTeams()));
  const [selectedPins, setSelectedPins] = useState<number[]>([]);
  const [notice, setNotice] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [selectedHistoryGameId, setSelectedHistoryGameId] = useState<string | null>(null);
  const [showCareerAnalysis, setShowCareerAnalysis] = useState(false);
  const [careerBackTarget, setCareerBackTarget] = useState<"menu" | "history">("menu");
  const [selectedCareerPlayerId, setSelectedCareerPlayerId] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const careerAnalysisImageRef = useRef<HTMLDivElement>(null);
  const [isSharing, setIsSharing] = useState(false);

  useEffect(() => {
    if (skipFirstSave.current) {
      skipFirstSave.current = false;
      return;
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      setStorageError(null);
    } catch {
      setStorageError("ブラウザーに保存できませんでした。空き容量やプライベートブラウズ設定を確認してください。");
    }
  }, [data]);

  const game = data.currentGame;
  const status = game ? getGameStatus(game) : null;
  const currentPlayer = game?.players.find((player) => player.id === status?.currentPlayerId);
  const scoreUnits = game ? getScoreUnits(game) : [];
  const winner = scoreUnits.find((unit) => unit.id === status?.winnerId);
  const isFinished = status?.isFinished ?? false;
  const currentUnit = scoreUnits.find((unit) => currentPlayer && unit.playerIds.includes(currentPlayer.id));
  const currentScore = currentUnit && status ? status.scores[currentUnit.id] : undefined;
  const remainingPoints = currentScore ? 50 - currentScore.score : 50;
  const isReach = !isFinished && !!currentScore && !currentScore.eliminated && remainingPoints >= 1 && remainingPoints <= 12;
  const isLastChance = !isFinished && !!currentScore && !currentScore.eliminated && currentScore.consecutiveMisses === 2;
  const screenKey = `${game?.id ?? "setup"}:${isFinished ? "result" : "play"}`;
  const previousScreenKey = useRef(screenKey);

  useEffect(() => {
    if (previousScreenKey.current === screenKey) return;
    previousScreenKey.current = screenKey;
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, [screenKey]);

  const playerCareerStats = useMemo(() => {
    const completedGames =
      game && isFinished && !data.history.some((pastGame) => pastGame.id === game.id)
        ? [game, ...data.history]
        : data.history;
    return getPlayerCareerAnalysis(completedGames);
  }, [data.history, game, isFinished]);
  const selectedCareerPlayer =
    playerCareerStats.find((player) => player.playerId === selectedCareerPlayerId) ??
    playerCareerStats[0] ??
    null;
  const selectedHistoryGame = data.history.find((pastGame) => pastGame.id === selectedHistoryGameId);

  function startGame(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const activePlayers = players
      .map((player) => ({
        id: player.id,
        name: player.name.trim(),
        ...(mode === "team" && player.teamId ? { teamId: player.teamId } : {}),
      }))
      .filter((player) => player.name);
    if (activePlayers.length < 2) {
      setNotice("プレイヤーを2人以上入力してください。");
      return;
    }
    const activeTeams = teams
      .filter((team) => team.name.trim() && activePlayers.some((player) => player.teamId === team.id))
      .map((team) => ({ ...team, name: team.name.trim() }));
    if (mode === "team" && activeTeams.length < 2) {
      setNotice("選手が所属するチームを2つ以上用意してください。");
      return;
    }
    if (mode === "team" && activePlayers.some((player) => !activeTeams.some((team) => team.id === player.teamId))) {
      setNotice("選手の所属チーム名を入力してください。");
      return;
    }
    setData((current) => ({
      ...current,
      currentGame: createGame(activePlayers, mode, activeTeams),
    }));
    setSelectedPins([]);
    setNotice("");
  }

  function submitThrow(pins: number[]) {
    if (!game || !status?.currentPlayerId || status.winnerId) return;
    const nextGame: Game = {
      ...game,
      turns: [
        ...game.turns,
        { playerId: status.currentPlayerId, pins, playedAt: new Date().toISOString() },
      ],
    };
    const nextStatus = getGameStatus(nextGame);
    setData((current) => ({
      ...current,
      currentGame: nextGame,
      history: nextStatus.isFinished
        ? [nextGame, ...current.history.filter((item) => item.id !== nextGame.id)].slice(0, 50)
        : current.history,
    }));
    setSelectedPins([]);
    setNotice("");
  }

  function undoThrow() {
    if (!game || game.turns.length === 0) return;
    const previousGame = { ...game, turns: game.turns.slice(0, -1) };
    setData((current) => ({
      ...current,
      currentGame: previousGame,
      history: current.history.filter((item) => item.id !== game.id),
    }));
    setSelectedPins([]);
    setNotice("直前の投球を取り消しました。");
  }

  function startAnotherGame() {
    if (game && !isFinished && !window.confirm("進行中のゲームを終了して、新しいゲームを始めますか？")) {
      return;
    }
    if (game) {
      setMode(game.mode ?? "individual");
      setTeams(game.teams?.map((team) => ({ ...team })) ?? makeDefaultTeams());
      setPlayers(game.players.map((player) => ({ ...player })));
    } else {
      const defaultTeams = makeDefaultTeams();
      setMode("individual");
      setTeams(defaultTeams);
      setPlayers(makeDefaultPlayers(defaultTeams));
    }
    setData((current) => ({ ...current, currentGame: null }));
    setSelectedPins([]);
    setNotice("");
  }

  function exportData() {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `molkky-fun-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    setNotice("ゲームデータを書き出しました。");
  }

  async function shareImage(
    target: HTMLElement | null,
    fileName: string,
    title: string,
    contentLabel: string,
  ) {
    if (!target) {
      setNotice(`${contentLabel}の画像を準備できませんでした。`);
      return;
    }

    setIsSharing(true);
    setNotice("");
    try {
      const blob = await toBlob(target, { pixelRatio: 2, backgroundColor: "#f7f8f4" });
      if (!blob) throw new Error("画像データを作成できませんでした。");
      const file = new File([blob], fileName, { type: "image/png" });

      if (typeof navigator.share === "function" && navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title });
          setNotice(`${contentLabel}を共有しました。`);
        } catch (error) {
          if (error instanceof Error && error.name === "AbortError") return;
          downloadBlob(blob, fileName);
          setNotice(`共有できなかったため、${contentLabel}画像を保存しました。Slackなどで添付して共有できます。`);
        }
      } else {
        downloadBlob(blob, fileName);
        setNotice(`${contentLabel}画像を保存しました。Slackなどで添付して共有できます。`);
      }
    } catch (error) {
      setNotice(
        error instanceof Error
          ? `${contentLabel}画像を作成できませんでした。${error.message}`
          : `${contentLabel}画像を作成できませんでした。`,
      );
    } finally {
      setIsSharing(false);
    }
  }

  async function shareAnalysis(target: HTMLDivElement | null) {
    await shareImage(
      target,
      `molkky-fun-result-${new Date().toISOString().slice(0, 10)}.png`,
      "Molkky Fun 試合結果",
      "試合結果",
    );
  }

  async function shareCareerAnalysis() {
    await shareImage(
      careerAnalysisImageRef.current,
      `molkky-fun-career-${new Date().toISOString().slice(0, 10)}.png`,
      "Molkky Fun 個人成績",
      "個人成績",
    );
  }

  async function importData(file: File | undefined) {
    if (!file) return;
    try {
      const parsed: unknown = JSON.parse(await file.text());
      if (!isAppData(parsed)) {
        throw new Error("このファイルは有効な Molkky Fun のデータではありません。");
      }
      if (!window.confirm("現在のゲームデータを、選択したファイルの内容に置き換えますか？")) return;
      setData(parsed);
      setSelectedPins([]);
      setSelectedHistoryGameId(null);
      setMenuOpen(false);
      setNotice("ゲームデータを読み込みました。");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "ファイルを読み込めませんでした。");
    } finally {
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  function togglePin(pin: number) {
    setSelectedPins((current) =>
      current.includes(pin) ? current.filter((value) => value !== pin) : [...current, pin].sort((a, b) => a - b),
    );
  }

  function movePlayer(playerId: string, direction: -1 | 1) {
    setPlayers((current) => {
      const sourceIndex = current.findIndex((player) => player.id === playerId);
      const sourcePlayer = current[sourceIndex];
      const siblingIndexes = current
        .map((player, index) => ({ player, index }))
        .filter(({ player }) => mode === "individual" || player.teamId === sourcePlayer.teamId)
        .map(({ index }) => index);
      const siblingPosition = siblingIndexes.indexOf(sourceIndex);
      const targetIndex = siblingIndexes[siblingPosition + direction];
      if (targetIndex === undefined) return current;
      const next = [...current];
      [next[sourceIndex], next[targetIndex]] = [next[targetIndex], next[sourceIndex]];
      return next;
    });
  }

  function moveTeam(teamId: string, direction: -1 | 1) {
    setTeams((current) => {
      const sourceIndex = current.findIndex((team) => team.id === teamId);
      const targetIndex = sourceIndex + direction;
      if (targetIndex < 0 || targetIndex >= current.length) return current;
      const next = [...current];
      [next[sourceIndex], next[targetIndex]] = [next[targetIndex], next[sourceIndex]];
      return next;
    });
  }

  function randomizeTeamOrder() {
    setTeams((current) => shuffle(current));
  }

  function randomizeTeamAssignments() {
    const activePlayers = players.filter((player) => player.name.trim());
    const activeTeams = teams.filter((team) => team.name.trim());
    if (activePlayers.length < 2) {
      setNotice("選手を2人以上入力してください。");
      return;
    }
    if (activeTeams.length < 2) {
      setNotice("チーム名を入力して、2チーム以上用意してください。");
      return;
    }

    const teamIds = shuffle(activeTeams.map((team) => team.id));
    const assignments = new Map(
      shuffle(activePlayers).map((player, index) => [player.id, teamIds[index % teamIds.length]]),
    );
    setPlayers((current) =>
      current.map((player) => {
        const teamId = assignments.get(player.id);
        return teamId ? { ...player, teamId } : player;
      }),
    );
    setNotice("");
  }

  function randomizePlayerOrder() {
    if (mode === "individual") {
      setPlayers((current) => shuffle(current));
      return;
    }
    setPlayers((current) => {
      const shuffledByTeam = new Map(
        teams.map((team) => [team.id, shuffle(current.filter((player) => player.teamId === team.id))]),
      );
      const nextPositionByTeam = new Map<string, number>();
      return current.map((player) => {
        const teamId = player.teamId;
        const teamPlayers = teamId ? shuffledByTeam.get(teamId) : undefined;
        if (!teamId || !teamPlayers) return player;
        const position = nextPositionByTeam.get(teamId) ?? 0;
        nextPositionByTeam.set(teamId, position + 1);
        return teamPlayers[position];
      });
    });
  }

  function addPlayer() {
    const defaultTeam = teams.reduce(
      (smallest, team) =>
        players.filter((player) => player.teamId === team.id).length <
        players.filter((player) => player.teamId === smallest.id).length
          ? team
          : smallest,
      teams[0],
    );
    setPlayers((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        name: `プレイヤー ${current.length + 1}`,
        teamId: defaultTeam?.id,
      },
    ]);
  }

  function addHistoryPlayer(player: Player) {
    setPlayers((current) => {
      if (current.some((item) => item.id === player.id)) return current;
      const team = teams.find((candidate) => candidate.id === player.teamId)
        ?? teams.reduce<Team | undefined>((smallest, candidate) => {
          const count = (id: string) => current.filter((item) => item.teamId === id).length;
          return !smallest || count(candidate.id) < count(smallest.id) ? candidate : smallest;
        }, undefined);
      return [...current, { id: player.id, name: player.name, ...(team ? { teamId: team.id } : {}) }];
    });
  }

  const inSetup = !game;

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#" onClick={(event) => event.preventDefault()} aria-label="Mölkky Fun">
          <img className="brand-wordmark" src={`${import.meta.env.BASE_URL}icons/wordmark.svg`} alt="Mölkky Fun" />
        </a>
        <div className="toolbar">
          <button className="icon-button menu-toggle" aria-label="メニューを開く" aria-haspopup="dialog" aria-expanded={menuOpen} onClick={() => {
            setShowHistory(false);
            setSelectedHistoryGameId(null);
            setMenuOpen(true);
          }}>
            <span aria-hidden="true">☰</span>
          </button>
        </div>
      </header>

      {(storageError || notice) && (
        <div className={`notice ${storageError ? "notice-error" : ""}`} role="status">
          {storageError || notice}
          {storageError && <button className="notice-dismiss" onClick={() => setStorageError(null)} aria-label="閉じる">×</button>}
        </div>
      )}

      <OverlayDialog
        open={menuOpen}
        title={selectedHistoryGame ? "試合結果" : showHistory ? (showCareerAnalysis ? "個人分析" : "試合履歴") : "メニュー"}
        pageKey={selectedHistoryGame?.id ?? (showHistory ? (showCareerAnalysis ? "career" : "history") : "menu")}
        onClose={() => setMenuOpen(false)}
        onBack={selectedHistoryGame ? () => setSelectedHistoryGameId(null)
          : showHistory ? () => {
            if (showCareerAnalysis) {
              setShowCareerAnalysis(false);
              setShowHistory(careerBackTarget === "history");
            } else {
              setShowHistory(false);
            }
          } : undefined}
      >
          <input
            ref={fileInput}
            className="visually-hidden"
            type="file"
            accept="application/json,.json"
            onChange={(event) => void importData(event.target.files?.[0])}
          />
        {!showHistory ? (
          <nav className="menu-options" aria-label="アプリメニュー">
            <button type="button" onClick={() => { setShowCareerAnalysis(false); setShowHistory(true); }}>試合履歴 <span>{data.history.length} 試合 →</span></button>
            <button type="button" onClick={() => { setCareerBackTarget("menu"); setShowCareerAnalysis(true); setShowHistory(true); }}>全試合の個人分析 <span>→</span></button>
            <button type="button" onClick={exportData}>データを書き出す <span>↓</span></button>
            <button type="button" onClick={() => fileInput.current?.click()}>データを読み込む <span>↑</span></button>
          </nav>
        ) : selectedHistoryGame ? (
          <GameResults game={selectedHistoryGame} isSharing={isSharing} onShare={shareAnalysis} />
        ) : (
        <section className="history-panel">
          {!showCareerAnalysis && <>
          <div className="section-heading">
            <div><p className="eyebrow">PAST GAMES</p><h2>試合履歴</h2></div>
            <div className="history-panel-actions">
              <span className="muted">{data.history.length} 試合</span>
              <button
                className="text-button"
                type="button"
                onClick={() => { setCareerBackTarget("history"); setShowCareerAnalysis(true); }}
              >全試合の個人分析</button>
            </div>
          </div>
          {data.history.length === 0 ? (
            <p className="empty-copy">試合が終わると、ここに記録されます。</p>
          ) : (
            <ul className="history-list">
              {data.history.map((pastGame) => {
                const pastStatus = getGameStatus(pastGame);
                const pastWinner = getScoreUnits(pastGame).find((unit) => unit.id === pastStatus.winnerId);
                return (
                  <li key={pastGame.id}>
                    <button className="history-result-button" type="button" onClick={() => setSelectedHistoryGameId(pastGame.id)}>
                    <span className="history-date">{formatDateTime(pastGame.startedAt)}</span>
                    <span className="history-names">
                      {pastGame.mode === "team"
                        ? (pastGame.teams ?? []).map((team) => team.name).join(" ・ ")
                        : pastGame.players.map((player) => player.name).join(" ・ ")}
                    </span>
                    <strong>{pastWinner ? `${pastWinner.name} の勝ち` : "終了"} <span aria-hidden="true">→</span></strong>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          </>}
          {showCareerAnalysis && (
            <section className="career-analysis" id="career-analysis">
              <div className="section-heading">
                <div><p className="eyebrow">PLAYER CAREER</p><h3>全試合の個人成績</h3></div>
                <span className="muted">{playerCareerStats.length} 人</span>
              </div>
              {selectedCareerPlayer ? (
                <>
                  <label className="career-player-picker">
                    <span>プレイヤー</span>
                    <select
                      value={selectedCareerPlayer.playerId}
                      onChange={(event) => setSelectedCareerPlayerId(event.target.value)}
                    >
                      {playerCareerStats.map((player) => (
                        <option value={player.playerId} key={player.playerId}>{player.name}</option>
                      ))}
                    </select>
                  </label>
                  <div className="career-share-content" ref={careerAnalysisImageRef}>
                    <div className="career-share-heading">
                      <p className="eyebrow">MOLKKY FUN · PLAYER CAREER</p>
                      <h3>{selectedCareerPlayer.name} の全試合成績</h3>
                    </div>
                    <div className="career-stat-grid">
                      <div><span>参加試合</span><strong>{selectedCareerPlayer.gamesPlayed}</strong></div>
                      <div>
                        <span>勝利 / 勝率</span>
                        <strong>
                          {selectedCareerPlayer.gamesWon} / {selectedCareerPlayer.gamesPlayed}
                          {" ・ "}
                          {selectedCareerPlayer.gamesPlayed
                            ? `${((selectedCareerPlayer.gamesWon / selectedCareerPlayer.gamesPlayed) * 100).toFixed(0)}%`
                            : "—"}
                        </strong>
                      </div>
                      <div><span>投球数</span><strong>{selectedCareerPlayer.throws}</strong></div>
                      <div><span>合計得点</span><strong>{selectedCareerPlayer.totalPoints}</strong></div>
                      <div>
                        <span>成功率</span>
                        <strong>{selectedCareerPlayer.accuracy === null ? "—" : `${selectedCareerPlayer.accuracy.toFixed(0)}%`}</strong>
                      </div>
                      <div>
                        <span>平均得点 / 投</span>
                        <strong>{selectedCareerPlayer.averagePoints === null ? "—" : selectedCareerPlayer.averagePoints.toFixed(1)}</strong>
                      </div>
                      <div>
                        <span>10点以上率</span>
                        <strong>
                          {selectedCareerPlayer.tenPlusRate === null ? "—" : `${selectedCareerPlayer.tenPlusRate.toFixed(0)}%`}
                        </strong>
                        <small>{selectedCareerPlayer.tenPlusThrows} 回 / {selectedCareerPlayer.tenPlusOpportunities} 機会</small>
                      </div>
                      <div><span>最高得点</span><strong>{selectedCareerPlayer.bestThrow ?? "—"}</strong></div>
                      <div>
                        <span>あがり成功率</span>
                        <strong>{selectedCareerPlayer.finishRate === null ? "—" : `${selectedCareerPlayer.finishRate.toFixed(0)}%`}</strong>
                        <small>{selectedCareerPlayer.exactFinishes} 成功 / {selectedCareerPlayer.finishAttempts} 機会</small>
                      </div>
                    </div>
                    <div className="career-radar-card">
                      <div className="section-heading">
                        <div><p className="eyebrow">CAREER RADAR</p><h3>得意度バランス</h3></div>
                        <span className="muted">{selectedCareerPlayer.throws} 投</span>
                      </div>
                      <CareerRadarChart values={selectedCareerPlayer.radarValues} />
                      <p className="career-note">
                        終了済み試合のみを集計。チーム戦の勝利は所属メンバー全員に加算します。平均得点は12点満点換算、安定度は成功投球のばらつきから算出します（2回未満は未計測）。
                        10点以上率は投球前に残り13点以上ある場面だけで集計し、ミスも機会に含めます。対象の投球がない場合は未計測（レーダーでは0）です。
                        あがり成功率は投球前の得点が38〜49点のとき、ぴったり50点で上がれた割合です。ミス・点数不足・50点超過も機会に含め、チーム戦では投げた本人に集計します。狙いの宣言ではなく投球結果に基づく指標です。機会がない場合は未計測（レーダーでは0）です。
                      </p>
                    </div>
                  </div>
                  <button
                    className="primary-button analysis-share-button career-share-button"
                    type="button"
                    onClick={() => void shareCareerAnalysis()}
                    disabled={isSharing}
                  >
                    {isSharing ? "画像を準備中…" : "個人分析をシェア"} <span>↗</span>
                  </button>
                </>
              ) : (
                <p className="empty-copy">終了した試合の記録がありません。</p>
              )}
            </section>
          )}
        </section>
        )}
        {(storageError || notice) && <p className="notice" role="status">{storageError || notice}</p>}
      </OverlayDialog>

      {inSetup ? (
        <section className="setup-layout">
          <div className="intro-card">
            <p className="eyebrow">MOLKKY SCOREKEEPER</p>
            <h1>今日の一投を、<br />気持ちよく記録。</h1>
            <p className="intro-copy">得点計算はおまかせ。みんなでゲームに集中しよう。</p>
            <div className="rule-chips">
              <span>50点ぴったりで勝利</span><span>50点を超えたら25点</span><span>3回ミスで失格</span>
            </div>
            <div className="pin-illustration" aria-hidden="true">
              <span className="pin pin-one">1</span><span className="pin pin-two">7</span><span className="pin pin-three">12</span>
            </div>
          </div>
          <form className="setup-card" onSubmit={startGame}>
            <div className="section-heading">
              <div><p className="eyebrow">NEW GAME</p><h2>プレイヤーを登録</h2></div>
              <span className="muted">
                {players.length} 人
                {mode === "team"
                  ? `・${teams.filter((team) => players.some((player) => player.teamId === team.id)).length} チーム`
                  : ""}
              </span>
            </div>
            <div className="mode-switch" aria-label="試合形式">
              <button
                type="button"
                className={mode === "individual" ? "mode-selected" : ""}
                aria-pressed={mode === "individual"}
                onClick={() => setMode("individual")}
              >
                個人戦
              </button>
              <button
                type="button"
                className={mode === "team" ? "mode-selected" : ""}
                aria-pressed={mode === "team"}
                onClick={() => setMode("team")}
              >
                チーム戦
              </button>
            </div>
            <p className="helper-text">
              {mode === "team"
                ? "チーム順に1投ずつ交代。順番は手動またはランダムで決められます。人数が違っても遊べます。"
                : "選手を上下に並べ替えるか、ランダムにして最初に投げる順番を決めます。"}
            </p>
            {mode === "team" && (
              <div className="team-setup">
                <div className="list-subheading">
                  <strong>チームの先攻順</strong>
                  <span>チーム順に投球します</span>
                  <button
                    className="randomize-button"
                    type="button"
                    onClick={randomizeTeamOrder}
                    aria-label="チームの投球順をランダムにする"
                  >🎲 ランダム</button>
                </div>
                <div className="team-fields">
                  {teams.map((team, index) => {
                    const hasPlayers = players.some((player) => player.teamId === team.id);
                    return (
                      <div className="team-field" key={team.id}>
                        <span className={`player-dot dot-${index % 6}`}>{String(index + 1).padStart(2, "0")}</span>
                        <input
                          value={team.name}
                          maxLength={24}
                          aria-label={`チーム ${index + 1} の名前`}
                          onChange={(event) =>
                            setTeams((current) =>
                              current.map((item) =>
                                item.id === team.id ? { ...item, name: event.target.value } : item,
                              ),
                            )
                          }
                        />
                        <div className="order-buttons">
                          <button
                            type="button"
                            onClick={() => moveTeam(team.id, -1)}
                            disabled={index === 0}
                            aria-label={`${team.name}を先にする`}
                          >↑</button>
                          <button
                            type="button"
                            onClick={() => moveTeam(team.id, 1)}
                            disabled={index === teams.length - 1}
                            aria-label={`${team.name}を後にする`}
                          >↓</button>
                        </div>
                        {teams.length > 2 && (
                          <button
                            className="remove-player"
                            type="button"
                            disabled={hasPlayers}
                            onClick={() => setTeams((current) => current.filter((item) => item.id !== team.id))}
                            aria-label={`${team.name}を削除`}
                            title={hasPlayers ? "先に選手を別チームへ移動してください" : undefined}
                          >×</button>
                        )}
                      </div>
                    );
                  })}
                </div>
                <button
                  className="add-player"
                  type="button"
                  onClick={() =>
                    setTeams((current) => [
                      ...current,
                      { id: crypto.randomUUID(), name: `チーム ${current.length + 1}` },
                    ])
                  }
                >
                  <span>＋</span> チームを追加
                </button>
                <button
                  className="random-assignment-button"
                  type="button"
                  onClick={randomizeTeamAssignments}
                  aria-label="選手をチーム人数が均等になるようランダムに振り分ける"
                >🎲 選手を均等にランダム振り分け</button>
              </div>
            )}
            <div className="list-subheading player-list-heading">
              <strong>選手の投球順</strong>
              <span>{mode === "team" ? "チーム内の順番" : "先頭の選手が先攻"} ・ 上から順</span>
              <button
                className="randomize-button"
                type="button"
                onClick={randomizePlayerOrder}
                aria-label={mode === "team" ? "チーム内の投球順をランダムにする" : "選手の投球順をランダムにする"}
              >🎲 ランダム</button>
            </div>
            <div className="player-fields">
              {players.map((player, index) => {
                const teamPlayers = players.filter((item) => item.teamId === player.teamId);
                const teamPosition = teamPlayers.findIndex((item) => item.id === player.id);
                return (
                <div className="player-field" key={player.id}>
                  <span className={`player-dot dot-${(mode === "team" ? teams.findIndex((team) => team.id === player.teamId) : index) % 6}`}>
                    {String((mode === "team" ? teamPosition : index) + 1).padStart(2, "0")}
                  </span>
                  <input
                    value={player.name}
                    maxLength={24}
                    aria-label={`プレイヤー ${index + 1} の名前`}
                    onChange={(event) =>
                      setPlayers((current) =>
                        current.map((item) =>
                          item.id === player.id ? { ...item, name: event.target.value } : item,
                        ),
                      )
                    }
                    placeholder={`プレイヤー ${index + 1}`}
                  />
                  {mode === "team" && (
                    <select
                      value={player.teamId ?? ""}
                      aria-label={`${player.name}のチーム`}
                      onChange={(event) =>
                        setPlayers((current) =>
                          current.map((item) =>
                            item.id === player.id ? { ...item, teamId: event.target.value } : item,
                          ),
                        )
                      }
                    >
                      {teams.map((team) => <option value={team.id} key={team.id}>{team.name}</option>)}
                    </select>
                  )}
                  <div className="order-buttons">
                    <button
                      type="button"
                      onClick={() => movePlayer(player.id, -1)}
                      disabled={teamPosition === 0 || (mode === "individual" && index === 0)}
                      aria-label={`${player.name}を先にする`}
                    >↑</button>
                    <button
                      type="button"
                      onClick={() => movePlayer(player.id, 1)}
                      disabled={
                        mode === "team"
                          ? teamPosition === teamPlayers.length - 1
                          : index === players.length - 1
                      }
                      aria-label={`${player.name}を後にする`}
                    >↓</button>
                  </div>
                  <button
                    className="remove-player"
                    type="button"
                    onClick={() => setPlayers((current) => current.filter((item) => item.id !== player.id))}
                    aria-label={`${player.name || `プレイヤー ${index + 1}`}を削除`}
                  >×</button>
                </div>
                );
              })}
            </div>
            <button className="add-player" type="button" onClick={addPlayer}>
              <span>＋</span> プレイヤーを追加
            </button>
            {data.history.length > 0 && (
              <details className="history-player-picker">
                <summary>試合履歴から追加</summary>
                <p className="helper-text">参加者を選んで追加できます。過去の個人成績も引き継ぎます。</p>
                <div className="history-player-matches">
                  {data.history.map((pastGame) => (
                    <div className="history-player-match" key={pastGame.id}>
                      <p>{formatDateTime(pastGame.startedAt)} · {pastGame.mode === "team" ? "チーム戦" : "個人戦"}</p>
                      <div className="history-player-options">
                        {pastGame.players.map((player) => {
                          const added = players.some((item) => item.id === player.id);
                          return (
                            <button
                              type="button"
                              key={player.id}
                              disabled={added}
                              onClick={() => addHistoryPlayer(player)}
                              aria-label={`${player.name}${added ? "は追加済み" : "を参加者に追加"}`}
                            >{added ? "✓ " : "＋ "}{player.name}{added ? "（追加済み）" : ""}</button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </details>
            )}
            <div className="bottom-action-bar">
              <button className="primary-button start-button" type="submit">ゲームを始める <span>→</span></button>
            </div>
          </form>
        </section>
      ) : isFinished ? (
        <GameResults game={game!} isSharing={isSharing} onShare={shareAnalysis} onNewGame={startAnotherGame} />
      ) : (
        <section className="game-layout">
          <div className="game-main">
            {isFinished ? (
              <div className="winner-banner">
                <span className="winner-icon" aria-hidden="true">✦</span>
                <div>
                  <p className="eyebrow">GAME COMPLETE</p>
                  <h1>{winner ? `${winner.name} の勝ち！` : "ゲーム終了"}</h1>
                  <p>{winner ? "ナイスゲーム！おめでとうございます。" : "全員が失格となりました。"}</p>
                </div>
                <button className="primary-button" onClick={startAnotherGame}>新しいゲーム <span>→</span></button>
              </div>
            ) : (
              <div className={`turn-banner ${isReach ? "turn-reach" : isLastChance ? "turn-danger" : ""}`}>
                <div className="turn-banner-heading">
                <div><p className="eyebrow">NOW THROWING</p><h1>{currentPlayer?.name ?? "プレイヤー"}</h1></div>
                <div className="turn-tag"><span className="live-dot" />投球順 {game!.turns.length + 1}</div>
                </div>

            <div className="turn-situation" role="status" aria-live="polite" aria-atomic="true">
              {(isReach || isLastChance) && (
                <div className="turn-alerts" key={`${currentPlayer?.id}:${remainingPoints}:${currentScore?.consecutiveMisses}`}>
                  {isReach && (
                    <div className="turn-alert reach-alert">
                      <span className="turn-alert-icon" aria-hidden="true">✦</span>
                      <div><strong>リーチ！ あと {remainingPoints} 点で勝利</strong><p>50点ぴったりを狙おう。</p></div>
                    </div>
                  )}
                  {isLastChance && (
                    <div className="turn-alert danger-alert">
                      <span className="turn-alert-icon" aria-hidden="true">!</span>
                      <div><strong>次のミスで失格</strong><p>{game!.mode === "team" ? "チームで2回連続ミス。ここが踏ん張りどころ！" : "2回連続ミス。ここが踏ん張りどころ！"}</p></div>
                    </div>
                  )}
                </div>
              )}
            </div>
              </div>
            )}

            <aside className="throw-card">
              <div className="section-heading">
                <div><p className="eyebrow">YOUR THROW</p><h2>倒れたピンを選ぶ</h2></div>
              </div>
              <p className="helper-text">倒れたピンをすべて選択してください。</p>
              <div className="pin-grid">
                {Array.from({ length: 12 }, (_, index) => index + 1).map((pin) => (
                  <button
                    className={`pin-button ${selectedPins.includes(pin) ? "pin-selected" : ""}`}
                    key={pin}
                    onClick={() => togglePin(pin)}
                    disabled={isFinished}
                    aria-pressed={selectedPins.includes(pin)}
                    aria-label={`ピン ${pin}${selectedPins.includes(pin) ? " 選択中" : ""}`}
                  >
                    {pin}
                  </button>
                ))}
              </div>
              <div className="score-preview">
                <span>今回の得点</span>
                <strong>{selectedPins.length ? scoreThrow(selectedPins) : "—"}<small> 点</small></strong>
                <small>{selectedPins.length === 1 ? "ピンの数字が得点" : selectedPins.length > 1 ? "倒れた本数が得点" : "ピンを選択してください"}</small>
              </div>
              <div className="throw-actions bottom-action-bar">
                {(isReach || isLastChance) && <p className="action-situation">
                  {isReach && <span className="reach-label">✦ あと {remainingPoints} 点で勝利</span>}
                  {isLastChance && <span className="danger-label">次のミスで失格</span>}
                </p>}
                <button className="primary-button record-button" disabled={!selectedPins.length || isFinished} onClick={() => submitThrow(selectedPins)}>
                  {selectedPins.length ? `${scoreThrow(selectedPins)}点を記録する` : "得点を記録する"} <span>→</span>
                </button>
                <button className={`miss-button ${isLastChance ? "miss-button-danger" : ""}`} disabled={isFinished} onClick={() => submitThrow([])}>今回はミス</button>
              </div>
              <div className="throw-footer">
                <span>3回連続ミスで失格</span>
                <button className="text-button" disabled={!game!.turns.length} onClick={undoThrow}>↶ 1投戻す</button>
              </div>
            </aside>

            <div className="scoreboard-card">
              <div className="section-heading score-heading">
                <div><p className="eyebrow">SCOREBOARD</p><h2>スコア</h2></div>
                <button className="text-button" onClick={startAnotherGame}>新しいゲーム</button>
              </div>
              <div className="score-list">
                {scoreUnits.map((unit, index) => {
                  const unitScore = status!.scores[unit.id];
                  const unitRemaining = 50 - unitScore.score;
                  const isCurrent = currentPlayer ? unit.playerIds.includes(currentPlayer.id) : false;
                  const currentTeamPlayer = isCurrent
                    ? currentPlayer?.name
                    : null;
                  return (
                    <div className={`score-row ${isCurrent && !isFinished ? "is-current" : ""} ${unitScore.eliminated ? "is-eliminated" : ""}`} key={unit.id}>
                      <span className={`player-dot dot-${index % 6}`}>{String(index + 1).padStart(2, "0")}</span>
                      <div className="score-player">
                        <strong>{unit.name}</strong>
                        {!unitScore.eliminated && !isFinished && (
                          <div className="score-state-tags">
                            {unitRemaining >= 1 && unitRemaining <= 12 && <span className="reach-label">リーチ · あと{unitRemaining}点</span>}
                            {unitScore.consecutiveMisses === 2 && <span className="danger-label">次のミスで失格</span>}
                          </div>
                        )}
                        <small>
                          {unitScore.eliminated
                            ? "失格"
                            : unitScore.consecutiveMisses > 0
                              ? `ミス ${unitScore.consecutiveMisses}/3`
                              : currentTeamPlayer && !isFinished
                                ? `${currentTeamPlayer} が投球中`
                                : "プレイ中"}
                        </small>
                      </div>
                      <div className="score-progress" aria-label={`${unitScore.score}点`}>
                        <div className="progress-track"><div style={{ width: `${(unitScore.score / 50) * 100}%` }} /></div>
                        <span>{unitScore.score}<small> / 50</small></span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="recent-card">
              <div className="section-heading">
                <div><p className="eyebrow">LAST THROWS</p><h2>投球履歴</h2></div>
                {game!.turns.length > 0 && <span className="muted">{game!.turns.length} 投</span>}
              </div>
              {game!.turns.length === 0 ? (
                <p className="empty-copy">最初の投球を記録しましょう。</p>
              ) : (
                <ol className="throw-list">
                  {[...game!.turns].reverse().slice(0, 5).map((turn, index) => {
                    const player = game!.players.find((candidate) => candidate.id === turn.playerId);
                    return (
                      <li key={`${turn.playedAt}-${index}`}>
                        <span className="throw-index">{game!.turns.length - index}</span>
                        <strong>{player?.name}</strong>
                        <span>{turn.pins.length ? `${turn.pins.length === 1 ? `ピン ${turn.pins[0]}` : `${turn.pins.length} 本`}を倒した` : "ミス"}</span>
                        <b>{turn.pins.length ? `+${scoreThrow(turn.pins)}` : "—"}</b>
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>
          </div>

        </section>
      )}

      <footer className="app-footer">
        <span>モルックの標準ルールで計算しています。</span>
        <span>この端末に自動保存</span>
      </footer>
    </main>
  );
}

export default App;
