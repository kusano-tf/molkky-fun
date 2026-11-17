import { getScoreUnits, type Game } from "./game";
import { t } from "./i18n";

export function TeamThrowingOrder({ game, currentPlayerId }: {
  game: Game;
  currentPlayerId: string | null;
}) {
  if (game.mode !== "team") return null;

  return (
    <details className="team-throwing-order">
      <summary>{t("チーム・投球順")}</summary>
      <p className="team-order-note">{t("チームはこの順で交代し、チーム内は番号順に投げます。")}</p>
      <ol className="team-order-list">
        {getScoreUnits(game).map((unit, index) => (
          <li key={unit.id}>
            <div className="team-order-heading">
              <span className={`player-dot dot-${index % 6}`} aria-hidden="true">{index + 1}</span>
              <strong>{unit.name}</strong>
            </div>
            <ol className="team-member-order">
              {unit.playerIds.map((id) => {
                const player = game.players.find((candidate) => candidate.id === id)!;
                return (
                  <li key={id} aria-current={id === currentPlayerId ? "step" : undefined}>
                    <span>{player.name}</span>
                    {id === currentPlayerId && <span className="team-order-current">{t("投球中")}</span>}
                  </li>
                );
              })}
            </ol>
          </li>
        ))}
      </ol>
    </details>
  );
}
