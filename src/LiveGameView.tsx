import type { ReactNode } from "react";
import { getGameStatus, getScoreUnits, scoreThrow, type Game } from "./game";
import type { ViewerState } from "./liveTransport";

export function LiveGameView({ game, state, onRetry, onLeave, children }: {
  game: Game | null;
  state: ViewerState;
  onRetry: () => void;
  onLeave: () => void;
  children?: ReactNode;
}) {
  const status = game ? getGameStatus(game) : null;
  const units = game ? getScoreUnits(game) : [];
  const currentPlayer = game?.players.find((player) => player.id === status?.currentPlayerId);
  return (
    <section className="live-game-view">
      <div className="live-view-heading">
        <div><p className="eyebrow">LIVE · 閲覧専用</p><h1>ライブ観戦</h1></div>
        <span className={`live-state ${state.phase === "live" ? "live-connected" : ""}`} role="status">{state.phase === "live" ? "接続中" : state.phase === "connecting" ? "接続を準備中…" : "未接続"}</span>
      </div>
      {state.error && <p className="notice notice-error" role="status">{state.error}</p>}
      {state.updatedAt && <p className="live-updated">最終更新 {new Date(state.updatedAt).toLocaleTimeString("ja-JP")}</p>}
      {!game ? <p className="empty-copy">{state.phase === "live" ? "親端末で試合が始まるのを待っています。" : "共有元の試合情報を待っています。"}</p> : status?.isFinished ? children : <>
        <div className="turn-banner">
          <p className="eyebrow">NOW THROWING</p><h1>{currentPlayer?.name}</h1>
        </div>
        <section className="scoreboard-card">
          <div className="section-heading"><h2>スコア</h2><span className="muted">{game.turns.length} 投</span></div>
          <div className="score-list">
            {units.map((unit, index) => {
              const score = status!.scores[unit.id];
              const current = !!currentPlayer && unit.playerIds.includes(currentPlayer.id);
              const remaining = 50 - score.score;
              return <div className={`score-row ${current ? "is-current" : ""} ${score.eliminated ? "is-eliminated" : ""}`} key={unit.id}>
                <span className={`player-dot dot-${index % 6}`}>{String(index + 1).padStart(2, "0")}</span>
                <div className="score-player"><strong>{unit.name}</strong>
                  <small>{score.eliminated ? "失格" : game.mode === "team" ? unit.playerIds.map((id) => game.players.find((player) => player.id === id)?.name).join(" ・ ") : current ? "投球中" : ""}</small>
                  {!score.eliminated && <div className="score-state-tags">
                    {remaining >= 1 && remaining <= 12 && <span className="reach-label">リーチ · あと{remaining}点</span>}
                    {score.consecutiveMisses === 2 && <span className="danger-label">次のミスで失格</span>}
                  </div>}
                </div>
                <div className="score-progress"><span>{score.score}<small> / 50</small></span></div>
              </div>;
            })}
          </div>
        </section>
        <section className="recent-card">
          <div className="section-heading"><h2>投球履歴</h2></div>
          {!game.turns.length ? <p className="empty-copy">最初の投球を待っています。</p> : <ol className="throw-list">
            {game.turns.slice(-12).reverse().map((turn, index) => <li key={`${game.turns.length - index}`}>
              <span className="throw-index">{game.turns.length - index}</span>
              <strong>{game.players.find((player) => player.id === turn.playerId)?.name}</strong>
              <span>{turn.pins.length ? turn.pins.join("・") : "ミス"}</span>
              <b>{turn.pins.length ? `+${scoreThrow(turn.pins)}` : "—"}</b>
            </li>)}
          </ol>}
        </section>
      </>}
      <div className="bottom-action-bar live-view-actions">
        {(state.phase === "error" || state.phase === "disconnected") && <button className="primary-button" onClick={onRetry}>再接続する</button>}
        <button className="text-button" onClick={onLeave}>観戦を終了する</button>
      </div>
    </section>
  );
}
