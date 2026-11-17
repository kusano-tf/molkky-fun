import { t, getLocale, useLanguage } from "./i18n";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { toBlob } from "html-to-image";
import { OverlayDialog } from "./OverlayDialog";
import { AppGuide } from "./AppGuide";
import { MolkkyIntroduction } from "./MolkkyIntroduction";
import { useLiveSharing } from "./useLiveSharing";
import { LiveSharingPanel } from "./LiveSharingPanel";
import { LiveGameView } from "./LiveGameView";
import { addMatchThrow, confirmMatchSet, createMatch, emptyMatchData, getMatchCareerAnalysis,
  getMatchStatus, getSetGame, readMatchData, startNextSet, undoMatchThrow,
  type Match, type MatchData } from "./match";
import { readDeviceSettings, saveDeviceSettings } from "./deviceSettings";
import { MatchProgress, MatchSettingsPanel, NextSetSetup, SetReview } from "./MatchPanels";
import { TeamThrowingOrder } from "./TeamThrowingOrder";
import {
  getGameAnalysis,
  getGameStatus,
  scoreThrow,
  getThrowPoints,
  getInputMode,
  STORAGE_KEY,
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
    ? t("日時不明")
    : date.toLocaleString(getLocale(), { dateStyle: "medium", timeStyle: "short" });
}

function formatDuration(startedAt: string, completedAt: string): string {
  const start = new Date(startedAt).getTime();
  const end = new Date(completedAt).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return "—";
  const minutes = Math.floor((end - start) / 60_000);
  const seconds = Math.floor((end - start) / 1_000) % 60;
  return minutes ? t("{0}分{1}秒", [minutes, seconds]) : t("{0}秒", [seconds]);
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
    <svg className="career-radar-chart" viewBox="0 0 300 240" role="img" aria-label={t("プレイヤーの全試合レーダーチャート")}>
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
            >{t(axis.label)}</text>
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

function loadData(): { data: MatchData; error: string | null } {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return { data: emptyMatchData(), error: null };
    const parsed: unknown = JSON.parse(stored);
    const normalized = readMatchData(parsed);
    if (!normalized) {
      return { data: emptyMatchData(), error: "保存データを読み込めません。インポートから復元してください。" };
    }
    return { data: normalized, error: null };
  } catch {
    return { data: emptyMatchData(), error: "保存データを読み込めません。ブラウザーの保存領域を確認してください。" };
  }
}

function makeDefaultTeams(): Team[] {
  return [
    { id: "team-1", name: t("チーム 1") },
    { id: "team-2", name: t("チーム 2") },
  ];
}

function makeDefaultPlayers(teams: Team[]): Player[] {
  return [
    { id: crypto.randomUUID(), name: t("プレイヤー 1"), teamId: teams[0].id },
    { id: crypto.randomUUID(), name: t("プレイヤー 2"), teamId: teams[1].id },
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

function fileTimestamp(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
  return `${date}_${time}`;
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
          <h1>{winner ? t("{0} の勝ち！", [winner.name]) : t("試合終了")}</h1>
          <p className="analysis-result-copy">
            {winner ? t("ナイスゲーム！おめでとうございます。") : t("全員が失格となりました。")}
          </p>
          <div className="analysis-meta">
            <span>{formatDateTime(game.startedAt)}</span>
            <span>{getInputMode(game) === "simple" ? t("簡易入力") : t("詳細入力")}</span>
            <span>{t("{0} 投", [game.turns.length])}</span>
            <span>{formatDuration(game.startedAt, analysis.completedAt)}</span>
          </div>
        </div>
        <span className="winner-icon" aria-hidden="true">✦</span>
      </div>

      <section className="analysis-section">
        <div className="section-heading">
          <div><p className="eyebrow">FINAL SCORE</p><h2>{t("最終スコアと成績")}</h2></div>
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
                  <div><span>{t("投球数")}</span><strong>{unitStats.throws}</strong></div>
                  <div><span>{t("得点した投球")}</span><strong>{unitStats.scoringThrows}</strong></div>
                  <div><span>{t("ミス")}</span><strong>{unitStats.misses}</strong></div>
                  <div><span>{t("成功率")}</span><strong>{unitStats.accuracy === null ? "—" : `${unitStats.accuracy.toFixed(0)}%`}</strong></div>
                  <div><span>{t("平均得点 / 投")}</span><strong>{unitStats.averagePoints === null ? "—" : unitStats.averagePoints.toFixed(1)}</strong></div>
                  <div><span>{t("最高得点")}</span><strong>{unitStats.bestThrow ?? "—"}</strong></div>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="analysis-section">
        <div className="section-heading">
          <div><p className="eyebrow">SCORE PROGRESS</p><h2>{t("得点の推移")}</h2></div>
          <span className="muted">{t("{0} 投", [game.turns.length])}</span>
        </div>
        <svg className="score-chart" viewBox="0 0 360 180" role="img" aria-label={t("試合中の得点推移")}>
          <line x1="34" y1="40" x2="342" y2="40" stroke="#e8ebe4" strokeWidth={1} />
          <line x1="34" y1="90" x2="342" y2="90" stroke="#e8ebe4" strokeWidth={1} />
          <line x1="34" y1="140" x2="342" y2="140" stroke="#e8ebe4" strokeWidth={1} />
          <text x="5" y="44" fill="#9aa198" fontFamily="sans-serif" fontSize={9}>50</text>
          <text x="5" y="94" fill="#9aa198" fontFamily="sans-serif" fontSize={9}>25</text>
          <text x="13" y="144" fill="#9aa198" fontFamily="sans-serif" fontSize={9}>0</text>
          <text x="30" y="165" fill="#9aa198" fontFamily="sans-serif" fontSize={9}>{t("開始")}</text>
          <text x="342" y="165" textAnchor="end" fill="#9aa198" fontFamily="sans-serif" fontSize={9}>{t("{0} 投", [game.turns.length])}</text>
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
            <h2>{game.mode === "team" ? t("チームごとの得点履歴") : t("選手ごとの得点履歴")}</h2>
          </div>
          <span className="muted">{t("{0} 投", [game.turns.length])}</span>
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
                  const points = getThrowPoints(turn);
                  return (
                    <div className="history-matrix-cell" key={unitStats.unit.id}>
                      <div>
                        <b>{getThrowPoints(turn) > 0 ? `+${points}` : t("ミス")}</b>
                        <span>{t("{0} 点", [analysis.progress[turnIndex].scores[unitStats.unit.id]])}</span>
                      </div>
                      <small>
                        {game.mode === "team" ? `${player?.name ?? ""} · ` : ""}
                        {turn.pins?.length ? turn.pins.join("・") : turn.pins ? "—" : t("得点のみ")}
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
        {isSharing ? t("画像を準備中…") : t("試合結果をシェア")} <span>↗</span>
      </button>
      {onNewGame && <div className="bottom-action-bar">
        <button className="primary-button analysis-new-game" onClick={onNewGame}>{t("新しいゲームを始める")}<span>→</span>
        </button>
      </div>}
    </section>
  );
}

function MatchResults({ match, isSharing, onShare, onNewGame }: {
  match: Match; isSharing: boolean; onShare: (target: HTMLDivElement | null) => Promise<void>; onNewGame?: () => void;
}) {
  const target = useRef<HTMLDivElement>(null);
  const status = getMatchStatus(match);
  const winner = getScoreUnits(getSetGame(match)).find((unit) => unit.id === status.winnerId);
  const [setId, setSetId] = useState(match.sets.at(-1)!.id);
  const selected = match.sets.find((set) => set.id === setId) ?? match.sets.at(-1)!;
  return <section className="match-results">
    <div ref={target} className="match-result-summary">
      <h1>{winner ? t("{0} の勝ち！", [winner.name]) : t("試合終了")}</h1>
      <p>{formatDateTime(match.startedAt)}</p>
      <MatchProgress match={match} />
      <ol className="set-result-list">{match.sets.map((set, index) => {
        const game = getSetGame(match, set), result = getGameStatus(game);
        const winner = getScoreUnits(game).find((unit) => unit.id === result.winnerId);
        return <li key={set.id}>{t("第{0}セット", [index + 1])}: {winner?.name ?? t("終了")}</li>;
      })}</ol>
    </div>
    <button className="primary-button analysis-share-button" disabled={isSharing} onClick={() => void onShare(target.current)}>{t("試合結果をシェア")} ↗</button>
    <label className="career-player-picker"><span>{t("セット別の分析")}</span><select value={selected.id} onChange={(e) => setSetId(e.target.value)}>
      {match.sets.map((set, i) => <option key={set.id} value={set.id}>{t("第{0}セット", [i + 1])}</option>)}
    </select></label>
    <GameResults key={selected.id} game={getSetGame(match, selected)} isSharing={isSharing} onShare={onShare} />
    {onNewGame && <div className="bottom-action-bar"><button className="primary-button start-button" onClick={onNewGame}>{t("新しいゲームを始める")} →</button></div>}
  </section>;
}

function App() {
  useLanguage();
  const initial = useRef(loadData()).current;
  const [data, setData] = useState(initial.data);
  const [storageError, setStorageError] = useState(initial.error);
  const [settings, setSettings] = useState(readDeviceSettings);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const persistenceError = storageError || settingsError;
  const skipFirstSave = useRef(Boolean(initial.error));
  const [mode, setMode] = useState<GameMode>("individual");
  const [teams, setTeams] = useState(makeDefaultTeams);
  const [players, setPlayers] = useState(() => makeDefaultPlayers(makeDefaultTeams()));
  const [showSettings, setShowSettings] = useState(false);
  const [selectedPins, setSelectedPins] = useState<number[]>([]);
  const [notice, setNotice] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [showIntroduction, setShowIntroduction] = useState(false);
  const [showLiveSharing, setShowLiveSharing] = useState(false);
  const [selectedHistoryGameId, setSelectedHistoryGameId] = useState<string | null>(null);
  const [showCareerAnalysis, setShowCareerAnalysis] = useState(false);
  const [careerBackTarget, setCareerBackTarget] = useState<"menu" | "history">("menu");
  const [selectedCareerPlayerId, setSelectedCareerPlayerId] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const careerAnalysisImageRef = useRef<HTMLDivElement>(null);
  const [isSharing, setIsSharing] = useState(false);
  const live = useLiveSharing(data.currentMatch);

  useEffect(() => {
    try {
      saveDeviceSettings(settings);
      setSettingsError(null);
    } catch {
      setSettingsError("端末の設定を保存できませんでした。この起動中のみ適用します。");
    }
  }, [settings]);

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

  const match = data.currentMatch;
  const game = match ? getSetGame(match) : null;
  const inputMode = settings.inputMode;
  const matchFinished = match ? getMatchStatus(match).isFinished : false;
  const setConfirmed = match?.sets.at(-1)?.confirmed ?? false;
  const isSimpleInput = game ? getInputMode(game) === "simple" : inputMode === "simple";
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
  const remoteFinished = live.remoteGame ? getMatchStatus(live.remoteGame).isFinished : false;
  const phase = matchFinished ? "result" : setConfirmed ? "prepare" : isFinished ? "review" : "play";
  const remotePhase = remoteFinished ? "result" : live.remoteGame?.sets.at(-1)?.confirmed ? "prepare"
    : live.remoteGame && getGameStatus(getSetGame(live.remoteGame)).isFinished ? "review" : "play";
  const screenKey = live.viewer ? `viewer:${live.remoteGame?.id ?? "waiting"}:${live.remoteGame?.sets.at(-1)?.id}:${remotePhase}`
    : `${game?.id ?? "setup"}:${phase}`;
  const previousScreenKey = useRef(screenKey);

  useEffect(() => {
    if (previousScreenKey.current === screenKey) return;
    previousScreenKey.current = screenKey;
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, [screenKey]);

  const playerCareerStats = useMemo(() => {
    const completedGames =
      match && matchFinished && !data.history.some((pastGame) => pastGame.id === match.id)
        ? [match, ...data.history]
        : data.history;
    return getMatchCareerAnalysis(completedGames);
  }, [data.history, match, matchFinished]);
  const selectedCareerPlayer =
    playerCareerStats.find((player) => player.playerId === selectedCareerPlayerId) ??
    playerCareerStats[0] ??
    null;
  const selectedHistoryGame = data.history.find((pastGame) => pastGame.id === selectedHistoryGameId);

  function startGame(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (live.viewer) return;
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
      currentMatch: createMatch(activePlayers, mode, activeTeams, settings),
    }));
    setSelectedPins([]);
    setNotice("");
  }

  function submitThrow(input: number[] | number) {
    if (live.viewer) return;
    if (!game || !status?.currentPlayerId || status.winnerId) return;
    if (!match) return;
    const nextMatch = addMatchThrow(match, isSimpleInput ? (typeof input === "number" ? input : scoreThrow(input)) : input);
    setData((current) => ({ ...current, currentMatch: nextMatch }));
    setSelectedPins([]);
    setNotice("");
  }

  function undoThrow() {
    if (live.viewer) return;
    if (!game || game.turns.length === 0) return;
    if (!match || setConfirmed) return;
    setData((current) => ({ ...current, currentMatch: undoMatchThrow(match) }));
    setSelectedPins([]);
    setNotice("直前の投球を取り消しました。");
  }

  function confirmSet() {
    if (!match || live.viewer) return;
    const confirmed = confirmMatchSet(match);
    setData((current) => ({ ...current, currentMatch: confirmed,
      history: getMatchStatus(confirmed).isFinished
        ? [confirmed, ...current.history.filter((past) => past.id !== confirmed.id)].slice(0, 50)
        : current.history }));
  }

  function startAnotherGame() {
    if (live.viewer) return;
    if (game && !matchFinished && !window.confirm(t("現在の試合の得点・投球記録を破棄して、プレイヤー登録に戻りますか？ メンバーと投球順は引き継ぎます。"))) {
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
    setData((current) => ({ ...current, currentMatch: null }));
    setSelectedPins([]);
    setNotice("");
    setMenuOpen(false);
  }

  function restartGame() {
    if (live.viewer || !game) return;
    if (!window.confirm(t("同じメンバー・投球順で最初から始めますか？ 現在の試合の全セットの得点・投球記録はリセットされます。終了済みの試合履歴は残ります。"))) return;
    setData((current) => ({
      ...current,
      currentMatch: createMatch(game.players, game.mode ?? "individual", game.teams ?? [], match!.settings),
    }));
    setSelectedPins([]);
    setNotice("");
    setMenuOpen(false);
  }

  function openSettings() {
    setShowHistory(false);
    setSelectedHistoryGameId(null);
    setShowGuide(false);
    setShowIntroduction(false);
    setShowLiveSharing(false);
    setShowSettings(true);
    setMenuOpen(true);
  }

  function openGameActions() {
    setShowSettings(false);
    setShowLiveSharing(false);
    setShowGuide(false); setShowIntroduction(false);
    setShowHistory(false);
    setSelectedHistoryGameId(null);
    setMenuOpen(true);
  }

  function exportData() {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `molkky-fun-${fileTimestamp()}.json`;
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
      setNotice(t("{0}の画像を準備できませんでした。", [contentLabel]));
      return;
    }

    setIsSharing(true);
    setNotice("");
    try {
      const blob = await toBlob(target, { pixelRatio: 2, backgroundColor: "#f7f8f4" });
      if (!blob) throw new Error(t("画像データを作成できませんでした。"));
      const file = new File([blob], fileName, { type: "image/png" });

      if (typeof navigator.share === "function" && navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title });
          setNotice(t("{0}を共有しました。", [contentLabel]));
        } catch (error) {
          if (error instanceof Error && error.name === "AbortError") return;
          downloadBlob(blob, fileName);
          setNotice(t("共有できなかったため、{0}画像を保存しました。Slackなどで添付して共有できます。", [contentLabel]));
        }
      } else {
        downloadBlob(blob, fileName);
        setNotice(t("{0}画像を保存しました。Slackなどで添付して共有できます。", [contentLabel]));
      }
    } catch (error) {
      setNotice(
        error instanceof Error
          ? t("{0}画像を作成できませんでした。{1}", [contentLabel, error.message])
          : t("{0}画像を作成できませんでした。", [contentLabel]),
      );
    } finally {
      setIsSharing(false);
    }
  }

  async function shareAnalysis(target: HTMLDivElement | null) {
    await shareImage(
      target,
      `molkky-fun-result-${fileTimestamp()}.png`,
      t("Molkky Fun 試合結果"),
      t("試合結果"),
    );
  }

  async function shareCareerAnalysis() {
    await shareImage(
      careerAnalysisImageRef.current,
      `molkky-fun-career-${fileTimestamp()}.png`,
      t("Molkky Fun 個人成績"),
      t("個人成績"),
    );
  }

  async function importData(file: File | undefined) {
    if (live.viewer) return;
    if (!file) return;
    try {
      const parsed: unknown = JSON.parse(await file.text());
      const normalized = readMatchData(parsed);
      if (!normalized) {
        throw new Error(t("このファイルは有効な Molkky Fun のデータではありません。"));
      }
      if (!window.confirm(t("現在のゲームデータを、選択したファイルの内容に置き換えますか？"))) return;
      setData(normalized);
      setSelectedPins([]);
      setSelectedHistoryGameId(null);
      setMenuOpen(false);
      setNotice("ゲームデータを読み込みました。");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : t("ファイルを読み込めませんでした。"));
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
        name: t("プレイヤー {0}", [current.length + 1]),
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
    <main className={`app-shell${game && !isFinished && !live.viewer ? " is-playing" : ""}`}>
      <header className="topbar">
        <a className="brand" href="#" onClick={(event) => event.preventDefault()} aria-label="Mölkky Fun">
          <img className="brand-wordmark" src={`${import.meta.env.BASE_URL}icons/wordmark.svg`} alt="Mölkky Fun" />
        </a>
        <div className="toolbar">
          {game && !live.viewer && <button className="text-button game-actions-toggle" onClick={openGameActions} aria-haspopup="dialog">{t("試合の操作")}</button>}
          {live.host && <button className="text-button live-host-status" onClick={() => {
            setShowLiveSharing(true); setMenuOpen(true);
          }}>{live.host.phase === "ready" ? t("共有中 · {0}台", [live.host.viewers]) : live.host.phase === "starting" ? t("共有準備中") : t("共有を確認")}</button>}
          <button className="icon-button menu-toggle" aria-label={t("メニューを開く")} aria-haspopup="dialog" aria-expanded={menuOpen} onClick={() => {
            setShowSettings(false);
    setShowLiveSharing(false);
            setShowGuide(false); setShowIntroduction(false);
            setShowHistory(false);
            setSelectedHistoryGameId(null);
            setMenuOpen(true);
          }}>
            <span aria-hidden="true">☰</span>
          </button>
        </div>
      </header>

      {(persistenceError || notice) && (
        <div className={`notice ${persistenceError ? "notice-error" : ""}`} role="status">
          {t(persistenceError || notice)}
          {persistenceError && <button className="notice-dismiss" onClick={() => { setStorageError(null); setSettingsError(null); }} aria-label={t("閉じる")}>×</button>}
        </div>
      )}

      <OverlayDialog
        open={menuOpen}
        title={showSettings ? t("設定") : showLiveSharing ? t("ライブ共有・観戦") : showIntroduction ? t("モルック入門") : showGuide ? t("使い方・分析指標") : selectedHistoryGame ? t("試合結果") : showHistory ? (showCareerAnalysis ? t("個人分析") : t("試合履歴")) : t("メニュー")}
        pageKey={showSettings ? "settings" : showLiveSharing ? "live" : showIntroduction ? "introduction" : showGuide ? "guide" : selectedHistoryGame?.id ?? (showHistory ? (showCareerAnalysis ? "career" : "history") : "menu")}
        onClose={() => setMenuOpen(false)}
        onBack={showSettings ? () => setShowSettings(false) : showLiveSharing ? () => { setShowLiveSharing(false); setShowGuide(false); setShowIntroduction(false); setShowHistory(false); }
          : showIntroduction ? () => setShowIntroduction(false) : showGuide ? () => setShowGuide(false) : selectedHistoryGame ? () => setSelectedHistoryGameId(null)
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
        {showSettings ? <MatchSettingsPanel settings={settings} onChange={setSettings} /> : showLiveSharing ? <LiveSharingPanel
          host={live.host} viewer={live.viewer}
          onStart={() => void live.startHost()} onStop={live.stopHost}
          onJoin={(invitation) => { void live.join(invitation); setMenuOpen(false); }}
          onLeave={() => { live.leave(); setMenuOpen(false); }} onRetry={live.retry}
        /> : showIntroduction ? <MolkkyIntroduction /> : showGuide ? <AppGuide /> : !showHistory ? (
          <nav className="menu-options" aria-label={t("アプリメニュー")}>
            <button type="button" onClick={openSettings}>{t("設定")}<span>→</span></button>
            {game && !live.viewer && <section className="game-menu-actions" aria-labelledby="game-actions-title">
              <h3 id="game-actions-title">{t("現在の試合")}</h3>
              <button type="button" onClick={restartGame}>{t("同じメンバーで最初から")}<span aria-hidden="true">↶</span></button>
              <button type="button" onClick={startAnotherGame}>{t("試合をクリアして登録へ戻る")}<span aria-hidden="true">→</span></button>
            </section>}
            <button type="button" onClick={() => { setShowCareerAnalysis(false); setShowHistory(true); }}>{t("試合履歴")}<span>{t("{0} 試合 →", [data.history.length])}</span></button>
            <button type="button" onClick={() => { setCareerBackTarget("menu"); setShowCareerAnalysis(true); setShowHistory(true); }}>{t("全試合の個人分析")}<span>→</span></button>
            <button type="button" onClick={() => setShowLiveSharing(true)}>{t("ライブ共有・観戦")}<span>→</span></button>
            <button type="button" onClick={exportData}>{t("データを書き出す")}<span>↓</span></button>
            <button type="button" disabled={!!live.viewer} onClick={() => fileInput.current?.click()}>{t("データを読み込む")}<span>↑</span></button>
            <button type="button" onClick={() => setShowIntroduction(true)}>{t("モルック入門")}<span>→</span></button>
            <button type="button" onClick={() => setShowGuide(true)}>{t("使い方・分析指標")}<span>→</span></button>
          </nav>
        ) : selectedHistoryGame ? (
          <MatchResults match={selectedHistoryGame} isSharing={isSharing} onShare={shareAnalysis} />
        ) : (
        <section className="history-panel">
          {!showCareerAnalysis && <>
          <div className="section-heading">
            <div><p className="eyebrow">PAST GAMES</p><h2>{t("試合履歴")}</h2></div>
            <div className="history-panel-actions">
              <span className="muted">{t("{0} 試合", [data.history.length])}</span>
              <button
                className="text-button"
                type="button"
                onClick={() => { setCareerBackTarget("history"); setShowCareerAnalysis(true); }}
              >{t("全試合の個人分析")}</button>
            </div>
          </div>
          {data.history.length === 0 ? (
            <p className="empty-copy">{t("試合が終わると、ここに記録されます。")}</p>
          ) : (
            <ul className="history-list">
              {data.history.map((pastGame) => {
                const pastStatus = getMatchStatus(pastGame);
                const pastWinner = getScoreUnits(getSetGame(pastGame)).find((unit) => unit.id === pastStatus.winnerId);
                return (
                  <li key={pastGame.id}>
                    <button className="history-result-button" type="button" onClick={() => setSelectedHistoryGameId(pastGame.id)}>
                    <span className="history-date">{formatDateTime(pastGame.startedAt)}</span>
                    <span className="history-names">
                      {pastGame.mode === "team"
                        ? (pastGame.teams ?? []).map((team) => team.name).join(" ・ ")
                        : pastGame.players.map((player) => player.name).join(" ・ ")}
                    </span>
                    <strong>{pastWinner ? t("{0} の勝ち", [pastWinner.name]) : t("終了")} <span aria-hidden="true">→</span></strong>
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
                <div><p className="eyebrow">PLAYER CAREER</p><h3>{t("全試合の個人成績")}</h3></div>
                <span className="muted">{t("{0} 人", [playerCareerStats.length])}</span>
              </div>
              {selectedCareerPlayer ? (
                <>
                  <label className="career-player-picker">
                    <span>{t("プレイヤー")}</span>
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
                      <h3>{t("{0} の全試合成績", [selectedCareerPlayer.name])}</h3>
                    </div>
                    <div className="career-stat-grid">
                      <div><span>{t("参加試合")}</span><strong>{selectedCareerPlayer.gamesPlayed}</strong></div>
                      <div>
                        <span>{t("勝利 / 勝率")}</span>
                        <strong>
                          {selectedCareerPlayer.gamesWon} / {selectedCareerPlayer.gamesPlayed}
                          {" ・ "}
                          {selectedCareerPlayer.gamesPlayed
                            ? `${((selectedCareerPlayer.gamesWon / selectedCareerPlayer.gamesPlayed) * 100).toFixed(0)}%`
                            : "—"}
                        </strong>
                      </div>
                      <div><span>{t("参加セット / 獲得セット")}</span><strong>{selectedCareerPlayer.setsPlayed} / {selectedCareerPlayer.setsWon}</strong></div>
                      <div><span>{t("投球数")}</span><strong>{selectedCareerPlayer.throws}</strong></div>
                      <div><span>{t("合計得点")}</span><strong>{selectedCareerPlayer.totalPoints}</strong></div>
                      <div>
                        <span>{t("成功率")}</span>
                        <strong>{selectedCareerPlayer.accuracy === null ? "—" : `${selectedCareerPlayer.accuracy.toFixed(0)}%`}</strong>
                      </div>
                      <div>
                        <span>{t("平均得点 / 投")}</span>
                        <strong>{selectedCareerPlayer.averagePoints === null ? "—" : selectedCareerPlayer.averagePoints.toFixed(1)}</strong>
                      </div>
                      <div>
                        <span>{t("10点以上率")}</span>
                        <strong>
                          {selectedCareerPlayer.tenPlusRate === null ? "—" : `${selectedCareerPlayer.tenPlusRate.toFixed(0)}%`}
                        </strong>
                        <small>{t("{0} 回 / {1} 機会", [selectedCareerPlayer.tenPlusThrows, selectedCareerPlayer.tenPlusOpportunities])}</small>
                      </div>
                      <div><span>{t("最高得点")}</span><strong>{selectedCareerPlayer.bestThrow ?? "—"}</strong></div>
                      <div>
                        <span>{t("あがり成功率")}</span>
                        <strong>{selectedCareerPlayer.finishRate === null ? "—" : `${selectedCareerPlayer.finishRate.toFixed(0)}%`}</strong>
                        <small>{t("{0} 成功 / {1} 機会", [selectedCareerPlayer.exactFinishes, selectedCareerPlayer.finishAttempts])}</small>
                      </div>
                    </div>
                    <section className="detailed-analysis" aria-labelledby="detailed-analysis-title">
                      <h3 id="detailed-analysis-title">{t("詳細入力の追加分析")}</h3>
                      {selectedCareerPlayer.detailedThrows > 0 ? <>
                        <p className="helper-text">{t("詳細入力 {0} 試合・{1} セット・{2} 投が対象", [selectedCareerPlayer.detailedGames, selectedCareerPlayer.detailedSets, selectedCareerPlayer.detailedThrows])}</p>
                        <div className="career-stat-grid">
                          <div><span>{t("1本倒し")}</span><strong>{t("{0} 回", [selectedCareerPlayer.singlePinThrows])}</strong></div>
                          <div><span>{t("複数本倒し")}</span><strong>{t("{0} 回", [selectedCareerPlayer.multiPinThrows])}</strong></div>
                        </div>
                        <h4>{t("ピン別に倒した回数")}</h4>
                        <dl className="pin-count-grid">
                          {selectedCareerPlayer.pinCounts.map((count, index) => <div key={index}>
                            <dt>{t("ピン {0}", [index + 1])}</dt><dd>{t("{0} 回", [count])}</dd>
                          </div>)}
                        </dl>
                        <p className="helper-text">{t("倒れた結果の集計です。狙ったピンへの命中率ではありません。簡易入力の投球は含みません。")}</p>
                      </> : <p className="helper-text">{t("詳細入力の試合を記録すると、ピン別の集計を確認できます。")}</p>}
                    </section>
                    <div className="career-radar-card">
                      <div className="section-heading">
                        <div><p className="eyebrow">CAREER RADAR</p><h3>{t("得意度バランス")}</h3></div>
                        <span className="muted">{t("{0} 投", [selectedCareerPlayer.throws])}</span>
                      </div>
                      <CareerRadarChart values={selectedCareerPlayer.radarValues} />
                    </div>
                  </div>
                  <button
                    className="primary-button analysis-share-button career-share-button"
                    type="button"
                    onClick={() => void shareCareerAnalysis()}
                    disabled={isSharing}
                  >
                    {isSharing ? t("画像を準備中…") : t("個人分析をシェア")} <span>↗</span>
                  </button>
                </>
              ) : (
                <p className="empty-copy">{t("終了した試合の記録がありません。")}</p>
              )}
            </section>
          )}
        </section>
        )}
        {(persistenceError || notice) && <p className="notice" role="status">{t(persistenceError || notice)}</p>}
      </OverlayDialog>

      {live.viewer ? <>
        {live.remoteGame && <MatchProgress match={live.remoteGame} />}
        <LiveGameView game={live.remoteGame ? getSetGame(live.remoteGame) : null} state={live.viewer} onRetry={live.retry} onLeave={live.leave}>
          {live.remoteGame && (remoteFinished
            ? <MatchResults match={live.remoteGame} isSharing={isSharing} onShare={shareAnalysis} />
            : live.remoteGame.sets.at(-1)!.confirmed
              ? <p className="empty-copy">{t("親端末での次セット開始を待っています。")}</p>
              : <SetReview match={live.remoteGame} />)}
        </LiveGameView>
      </> : inSetup ? (
        <section className="setup-layout">
          <div className="intro-card">
            <p className="eyebrow">MOLKKY SCOREKEEPER</p>
            <h1>{t("今日の一投を、")}<br />{t("気持ちよく記録。")}</h1>
            <p className="intro-copy">{t("得点計算はおまかせ。みんなでゲームに集中しよう。")}</p>
            <div className="pin-illustration" aria-hidden="true">
              <span className="pin pin-one">1</span><span className="pin pin-two">7</span><span className="pin pin-three">12</span>
            </div>
          </div>
          <form className="setup-card" onSubmit={startGame}>
            <div className="section-heading">
              <div><p className="eyebrow">NEW GAME</p><h2>{t("プレイヤーを登録")}</h2></div>
              <span className="muted">{t("{0} 人 {1}", [players.length, mode === "team"
                  ? t("・{0} チーム", [teams.filter((team) => players.some((player) => player.teamId === team.id)).length])
                  : ""])}</span>
            </div>
            <div className="mode-switch" aria-label={t("試合形式")}>
              <button
                type="button"
                className={mode === "individual" ? "mode-selected" : ""}
                aria-pressed={mode === "individual"}
                onClick={() => setMode("individual")}
              >{t("個人戦")}</button>
              <button
                type="button"
                className={mode === "team" ? "mode-selected" : ""}
                aria-pressed={mode === "team"}
                onClick={() => setMode("team")}
              >{t("チーム戦")}</button>
            </div>
            <button type="button" className="match-settings-summary" onClick={openSettings}>
              <span>{t("{0}セット先取", [settings.winsRequired])} · {inputMode === "simple" ? t("簡易入力") : t("詳細入力")}</span><span>{t("変更")} →</span>
            </button>
            {mode === "team" && (
              <div className="team-setup">
                <div className="list-subheading">
                  <strong>{t("チームの先攻順")}</strong>
                  <span>{t("チーム順に投球します")}</span>
                  <button
                    className="randomize-button"
                    type="button"
                    onClick={randomizeTeamOrder}
                    aria-label={t("チームの投球順をランダムにする")}
                  >{t("🎲 ランダム")}</button>
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
                          aria-label={t("チーム {0} の名前", [index + 1])}
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
                            aria-label={t("{0}を先にする", [team.name])}
                          >↑</button>
                          <button
                            type="button"
                            onClick={() => moveTeam(team.id, 1)}
                            disabled={index === teams.length - 1}
                            aria-label={t("{0}を後にする", [team.name])}
                          >↓</button>
                        </div>
                        {teams.length > 2 && (
                          <button
                            className="remove-player"
                            type="button"
                            disabled={hasPlayers}
                            onClick={() => setTeams((current) => current.filter((item) => item.id !== team.id))}
                            aria-label={t("{0}を削除", [team.name])}
                            title={hasPlayers ? t("先に選手を別チームへ移動してください") : undefined}
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
                      { id: crypto.randomUUID(), name: t("チーム {0}", [current.length + 1]) },
                    ])
                  }
                >
                  <span>＋</span>{t("チームを追加")}</button>
                <button
                  className="random-assignment-button"
                  type="button"
                  onClick={randomizeTeamAssignments}
                  aria-label={t("選手をチーム人数が均等になるようランダムに振り分ける")}
                >{t("🎲 選手を均等にランダム振り分け")}</button>
              </div>
            )}
            <div className="list-subheading player-list-heading">
              <strong>{t("選手の投球順")}</strong>
              <span>{t("{0} ・ 上から順", [mode === "team" ? t("チーム内の順番") : t("先頭の選手が先攻")])}</span>
              <button
                className="randomize-button"
                type="button"
                onClick={randomizePlayerOrder}
                aria-label={mode === "team" ? t("チーム内の投球順をランダムにする") : t("選手の投球順をランダムにする")}
              >{t("🎲 ランダム")}</button>
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
                    aria-label={t("プレイヤー {0} の名前", [index + 1])}
                    onChange={(event) =>
                      setPlayers((current) =>
                        current.map((item) =>
                          item.id === player.id ? { ...item, name: event.target.value } : item,
                        ),
                      )
                    }
                    placeholder={t("プレイヤー {0}", [index + 1])}
                  />
                  {mode === "team" && (
                    <select
                      value={player.teamId ?? ""}
                      aria-label={t("{0}のチーム", [player.name])}
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
                      aria-label={t("{0}を先にする", [player.name])}
                    >↑</button>
                    <button
                      type="button"
                      onClick={() => movePlayer(player.id, 1)}
                      disabled={
                        mode === "team"
                          ? teamPosition === teamPlayers.length - 1
                          : index === players.length - 1
                      }
                      aria-label={t("{0}を後にする", [player.name])}
                    >↓</button>
                  </div>
                  <button
                    className="remove-player"
                    type="button"
                    onClick={() => setPlayers((current) => current.filter((item) => item.id !== player.id))}
                    aria-label={t("{0}を削除", [player.name || t("プレイヤー {0}", [index + 1])])}
                  >×</button>
                </div>
                );
              })}
            </div>
            <button className="add-player" type="button" onClick={addPlayer}>
              <span>＋</span>{t("プレイヤーを追加")}</button>
            {data.history.length > 0 && (
              <details className="history-player-picker">
                <summary>{t("試合履歴から追加")}</summary>
                <p className="helper-text">{t("参加者を選んで追加")}</p>
                <div className="history-player-matches">
                  {data.history.map((pastGame) => (
                    <div className="history-player-match" key={pastGame.id}>
                      <p>{formatDateTime(pastGame.startedAt)} · {pastGame.mode === "team" ? t("チーム戦") : t("個人戦")}</p>
                      <div className="history-player-options">
                        {pastGame.players.map((player) => {
                          const added = players.some((item) => item.id === player.id);
                          return (
                            <button
                              type="button"
                              key={player.id}
                              disabled={added}
                              onClick={() => addHistoryPlayer(player)}
                              aria-label={t("{0}{1}", [player.name, added ? t("は追加済み") : t("を参加者に追加")])}
                            >{added ? "✓ " : "＋ "}{player.name}{added ? t("（追加済み）") : ""}</button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </details>
            )}
            <div className="bottom-action-bar">
              <button className="primary-button start-button" type="submit">{t("ゲームを始める")}<span>→</span></button>
            </div>
          </form>
        </section>
      ) : matchFinished ? (
        <MatchResults match={match!} isSharing={isSharing} onShare={shareAnalysis} onNewGame={startAnotherGame} />
      ) : isFinished ? (
        <>
          <MatchProgress match={match!} />
          {setConfirmed
            ? <NextSetSetup key={game!.id} match={match!} onStart={(teamOrder, playerOrder) => {
                setData((current) => ({ ...current, currentMatch: startNextSet(match!, teamOrder, playerOrder) }));
                setSelectedPins([]);
              }} />
            : <SetReview match={match!} onUndo={undoThrow} onConfirm={confirmSet} />}
        </>
      ) : (
        <section className="game-layout">
          <MatchProgress match={match!} />
          <div className="game-main">
            {isFinished ? (
              <div className="winner-banner">
                <span className="winner-icon" aria-hidden="true">✦</span>
                <div>
                  <p className="eyebrow">GAME COMPLETE</p>
                  <h1>{winner ? t("{0} の勝ち！", [winner.name]) : t("ゲーム終了")}</h1>
                  <p>{winner ? t("ナイスゲーム！おめでとうございます。") : t("全員が失格となりました。")}</p>
                </div>
                <button className="primary-button" onClick={startAnotherGame}>{t("新しいゲーム")}<span>→</span></button>
              </div>
            ) : (
              <div className={`turn-banner ${isReach ? "turn-reach" : isLastChance ? "turn-danger" : ""}`}>
                <div className="turn-banner-heading">
                <div><p className="eyebrow">NOW THROWING</p><h1>{currentPlayer?.name ?? t("プレイヤー")}</h1></div>
                <div className="turn-tag"><span className="live-dot" />{t("投球順 {0}", [game!.turns.length + 1])}</div>
                </div>

            <div className="turn-situation" role="status" aria-live="polite" aria-atomic="true">
              {(isReach || isLastChance) && (
                <div className="turn-alerts" key={`${currentPlayer?.id}:${remainingPoints}:${currentScore?.consecutiveMisses}`}>
                  {isReach && (
                    <div className="turn-alert reach-alert">
                      <span className="turn-alert-icon" aria-hidden="true">✦</span>
                      <div><strong>{t("リーチ！ あと {0} 点で勝利", [remainingPoints])}</strong><p>{t("50点ぴったりを狙おう。")}</p></div>
                    </div>
                  )}
                  {isLastChance && (
                    <div className="turn-alert danger-alert">
                      <span className="turn-alert-icon" aria-hidden="true">!</span>
                      <div><strong>{t("次のミスで失格")}</strong><p>{game!.mode === "team" ? t("チームで2回連続ミス。ここが踏ん張りどころ！") : t("2回連続ミス。ここが踏ん張りどころ！")}</p></div>
                    </div>
                  )}
                </div>
              )}
            </div>
              </div>
            )}

            <aside className="throw-card">
              <div className="section-heading">
                <div><p className="eyebrow">YOUR THROW</p><h2>{isSimpleInput ? t("得点をタップして記録") : t("倒れたピンを選ぶ")}</h2></div>
                <span className="muted">{isSimpleInput ? t("簡易入力") : t("詳細入力")}</span>
              </div>
              {isSimpleInput ? <>
                <p className="helper-text">{t("点数を押すとすぐに記録します。0点は「今回はミス」。")}</p>
                <div className="pin-grid simple-score-grid">
                  {Array.from({ length: 12 }, (_, index) => index + 1).map((points) => (
                    <button type="button" className="simple-score-button" key={points} onClick={() => submitThrow(points)} aria-label={t("{0}点を記録する", [points])}>{points}<small>{t("点")}</small></button>
                  ))}
                </div>
              </> : <>
              <p className="helper-text">{t("倒れたピンをすべて選択してください。")}</p>
              <div className="pin-grid">
                {Array.from({ length: 12 }, (_, index) => index + 1).map((pin) => (
                  <button
                    className={`pin-button ${selectedPins.includes(pin) ? "pin-selected" : ""}`}
                    key={pin}
                    onClick={() => togglePin(pin)}
                    disabled={isFinished}
                    aria-pressed={selectedPins.includes(pin)}
                    aria-label={t("ピン {0}{1}", [pin, selectedPins.includes(pin) ? t(" 選択中") : ""])}
                  >
                    {pin}
                  </button>
                ))}
              </div>
              <div className="score-preview">
                <span>{t("今回の得点")}</span>
                <strong>{selectedPins.length ? scoreThrow(selectedPins) : "—"}<small>{t("点")}</small></strong>
                <small>{selectedPins.length === 1 ? t("ピンの数字が得点") : selectedPins.length > 1 ? t("倒れた本数が得点") : t("ピンを選択してください")}</small>
              </div>
              </>}
              <div className="throw-actions bottom-action-bar">
                {(isReach || isLastChance) && <p className="action-situation">
                  {isReach && <span className="reach-label">{t("✦ あと {0} 点で勝利", [remainingPoints])}</span>}
                  {isLastChance && <span className="danger-label">{t("次のミスで失格")}</span>}
                </p>}
                <div className={`throw-record-actions${isSimpleInput ? " simple-record-actions" : ""}`}>
                  {!isSimpleInput && <button className="primary-button record-button" disabled={!selectedPins.length || isFinished} onClick={() => submitThrow(selectedPins)}>
                    {selectedPins.length ? t("{0}点を記録する", [scoreThrow(selectedPins)]) : t("得点を記録する")} <span>→</span>
                  </button>}
                  <button type="button" className={`miss-button ${isLastChance ? "miss-button-danger" : ""}`} disabled={isFinished} onClick={() => submitThrow([])}>{t("今回はミス")}</button>
                </div>
              </div>
            </aside>

            <div className="scoreboard-card">
              <div className="section-heading score-heading">
                <div><p className="eyebrow">SCOREBOARD</p><h2>{t("スコア")}</h2></div>
              </div>
              <TeamThrowingOrder key={game!.id} game={game!} currentPlayerId={status!.currentPlayerId} />
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
                            {unitRemaining >= 1 && unitRemaining <= 12 && <span className="reach-label">{t("リーチ · あと{0}点", [unitRemaining])}</span>}
                            {unitScore.consecutiveMisses === 2 && <span className="danger-label">{t("次のミスで失格")}</span>}
                          </div>
                        )}
                        <small>
                          {unitScore.eliminated
                            ? t("失格")
                            : unitScore.consecutiveMisses > 0
                              ? t("ミス {0}/3", [unitScore.consecutiveMisses])
                              : currentTeamPlayer && !isFinished
                                ? t("{0} が投球中", [currentTeamPlayer])
                                : t("プレイ中")}
                        </small>
                      </div>
                      <div className="score-progress" aria-label={t("{0}点", [unitScore.score])}>
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
                <div><p className="eyebrow">LAST THROWS</p><h2>{t("投球履歴")}</h2></div>
                <div className="throw-history-actions">
                  {game!.turns.length > 0 && <span className="muted">{t("{0} 投", [game!.turns.length])}</span>}
                  <button type="button" className="undo-throw-button" disabled={!game!.turns.length || isFinished} onClick={undoThrow}>{t("↶ 直前を取り消す")}</button>
                </div>
              </div>
              {game!.turns.length === 0 ? (
                <p className="empty-copy">{t("最初の投球を記録しましょう。")}</p>
              ) : (
                <ol className="throw-list">
                  {[...game!.turns].reverse().slice(0, 5).map((turn, index) => {
                    const player = game!.players.find((candidate) => candidate.id === turn.playerId);
                    return (
                      <li key={`${turn.playedAt}-${index}`}>
                        <span className="throw-index">{game!.turns.length - index}</span>
                        <strong>{player?.name}</strong>
                        <span>{getThrowPoints(turn) === 0 ? t("ミス") : turn.pins ? t("{0}を倒した", [turn.pins.length === 1 ? t("ピン {0}", [turn.pins[0]]) : t("{0} 本", [turn.pins.length])]) : t("得点のみ")}</span>
                        <b>{getThrowPoints(turn) > 0 ? `+${getThrowPoints(turn)}` : "—"}</b>
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>
          </div>

        </section>
      )}

    </main>
  );
}

export default App;
