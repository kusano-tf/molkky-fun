import { useState } from "react";
import { getGameStatus, getScoreUnits } from "./game";
import { getMatchStatus, getSetGame, suggestedOrders, type Match, type MatchSettings } from "./match";
import { setLanguage, t, useLanguage } from "./i18n";

export function MatchSettingsPanel({ settings, onChange }: { settings: MatchSettings; onChange: (settings: MatchSettings) => void }) {
  const language = useLanguage();
  return <section className="match-settings-panel app-guide">
    <p>{t("試合の設定は次に始める試合に適用されます。進行中の試合は変更しません。")}</p>
    <label className="language-setting"><span>{t("先取セット数")}</span>
      <select value={settings.winsRequired} onChange={(e) => onChange({ ...settings, winsRequired: Number(e.target.value) })}>
        {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{t("{0}セット先取", [n])}</option>)}
      </select>
    </label>
    <label className="language-setting"><span>{t("入力モード")}</span>
      <select value={settings.inputMode} onChange={(e) => onChange({ ...settings, inputMode: e.target.value === "simple" ? "simple" : "detailed" })}>
        <option value="simple">{t("簡易入力")}</option><option value="detailed">{t("詳細入力")}</option>
      </select>
    </label>
    <p>{settings.inputMode === "simple" ? t("得点をタップするだけで記録。基本の分析ができます。") : t("倒れたピンを選んで記録。ピン別の追加分析ができます。")}</p>
    <label className="language-setting"><span>{t("言語 / Language")}</span>
      <select value={language} onChange={(e) => setLanguage(e.target.value === "en" ? "en" : "ja")}><option value="ja">日本語</option><option value="en">English</option></select>
    </label>
  </section>;
}

export function MatchProgress({ match }: { match: Match }) {
  const status = getMatchStatus(match);
  return <section className="match-progress">
    <div className="section-heading"><strong>{t("第{0}セット", [match.sets.length])}</strong><span>{t("{0}セット先取", [match.settings.winsRequired])}</span></div>
    <ul>{getScoreUnits(getSetGame(match)).map((unit) => <li key={unit.id}><span>{unit.name}</span><strong>{t("{0}セット獲得", [status.wins[unit.id]])}</strong></li>)}</ul>
  </section>;
}

export function SetReview({ match, onUndo, onConfirm }: { match: Match; onUndo?: () => void; onConfirm?: () => void }) {
  const game = getSetGame(match), status = getGameStatus(game);
  const winner = getScoreUnits(game).find((unit) => unit.id === status.winnerId);
  const willFinish = getScoreUnits(game).some((unit) => getMatchStatus(match).wins[unit.id] + (unit.id === status.winnerId ? 1 : 0) >= match.settings.winsRequired);
  return <section className="set-review setup-card">
    <p className="eyebrow">SET COMPLETE</p>
    <h1>{t("第{0}セット終了", [match.sets.length])}</h1>
    <p>{winner ? t("{0} の勝ち！", [winner.name]) : t("全員が失格となりました。")}</p>
    <ul className="set-final-scores">{getScoreUnits(game).map((unit) => <li key={unit.id}><span>{unit.name}</span><strong>{t("{0}点", [status.scores[unit.id].score])}</strong></li>)}</ul>
    <p className="helper-text">{onConfirm ? t("最後の投球を確認してください。確定するまでは取り消せます。") : t("親端末でのセット確定を待っています。")}</p>
    {onUndo && <button type="button" className="undo-throw-button" onClick={onUndo}>{t("↶ 直前を取り消す")}</button>}
    {onConfirm && <button type="button" className="primary-button" onClick={onConfirm}>{willFinish || match.settings.winsRequired === 1 ? t("確定して試合結果へ") : t("確定して次セットの準備へ")}</button>}
  </section>;
}

export function NextSetSetup({ match, onStart }: { match: Match; onStart: (teams: string[], players: string[]) => void }) {
  const initial = suggestedOrders(match);
  const [teamOrder, setTeamOrder] = useState(initial.teamOrder);
  const [playerOrder, setPlayerOrder] = useState(initial.playerOrder);
  const shift = (ids: string[], id: string, direction: number) => {
    const index = ids.indexOf(id), target = index + direction;
    if (target < 0 || target >= ids.length) return ids;
    const next = [...ids]; [next[index], next[target]] = [next[target], next[index]];
    return next;
  };
  const playerName = (id: string) => match.players.find((p) => p.id === id)!.name;
  const teamName = (id: string) => match.teams.find((team) => team.id === id)!.name;
  const controls = (id: string, name: string, ids: string[], move: (direction: number) => void) => <div className="order-buttons">
    <button type="button" disabled={ids[0] === id} aria-label={t("{0}を先にする", [name])} onClick={() => move(-1)}>↑</button>
    <button type="button" disabled={ids[ids.length - 1] === id} aria-label={t("{0}を後にする", [name])} onClick={() => move(1)}>↓</button>
  </div>;
  const members = (teamId?: string) => {
    const ids = playerOrder.filter((id) => !teamId || match.players.find((p) => p.id === id)!.teamId === teamId);
    return <ol className="next-set-order">{ids.map((id) => <li key={id}><span>{playerName(id)}</span>{controls(id, playerName(id), ids, (direction) => {
      const reordered = shift(ids, id, direction); let position = 0;
      setPlayerOrder(playerOrder.map((existing) => ids.includes(existing) ? reordered[position++] : existing));
    })}</li>)}</ol>;
  };
  return <section className="setup-card next-set-setup">
    <h1>{t("第{0}セットの準備", [match.sets.length + 1])}</h1>
    <p className="helper-text">{t("先攻順は大会や対戦相手との取り決めに合わせて調整してください。チーム内の順番もセット開始前に変更できます。")}</p>
    {match.mode === "team" ? <ol className="next-team-order">{teamOrder.map((id) => <li key={id}>
      <div className="section-heading"><strong>{teamName(id)}</strong>{controls(id, teamName(id), teamOrder, (direction) => setTeamOrder(shift(teamOrder, id, direction)))}</div>
      {members(id)}
    </li>)}</ol> : members()}
    <button type="button" className="primary-button" onClick={() => onStart(teamOrder, playerOrder)}>{t("この順番で次セットを始める")}</button>
  </section>;
}
