import { afterEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import App from "./App";
import { MatchSettingsPanel, NextSetSetup, SetReview } from "./MatchPanels";
import { getGameStatus, getScoreUnits, STORAGE_KEY } from "./game";
import { addMatchThrow, confirmMatchSet, createMatch, emptyMatchData, getSetGame, readMatchData } from "./match";
import { setLanguage } from "./i18n";

const initial = () => createMatch([{ id: "a", name: "Alice", teamId: "t1" }, { id: "b", name: "Bob", teamId: "t2" }, { id: "c", name: "Carol", teamId: "t3" }],
  "team", [{ id: "t1", name: "Red" }, { id: "t2", name: "Blue" }, { id: "t3", name: "Green" }], { winsRequired: 2, inputMode: "simple" });
function pendingSet() {
  let match = initial();
  while (!getGameStatus(getSetGame(match)).isFinished) {
    const game = getSetGame(match), current = getGameStatus(game).currentPlayerId!;
    const unit = getScoreUnits(game).find((unit) => unit.playerIds.includes(current))!;
    match = addMatchThrow(match, unit.id === "t1" ? 10 : 1);
  }
  return match;
}
afterEach(() => { setLanguage("ja"); vi.unstubAllGlobals(); });

it("restores the review or next-set preparation screen instead of prematurely displaying match results", () => {
  const pending = pendingSet();
  const render = (match: typeof pending) => {
    vi.stubGlobal("localStorage", { getItem: (key: string) => key === STORAGE_KEY ? JSON.stringify({ ...emptyMatchData(), currentMatch: match }) : null });
    setLanguage("en");
    return renderToStaticMarkup(<App />);
  };
  const review = render(pending);
  expect(review).toContain("Set 1 complete");
  expect(review).toContain("Undo last throw");
  expect(review).toContain("Confirm and prepare the next set");
  expect(review).not.toContain("Analysis by set");
  expect(review).not.toContain("Record a miss");
  const prepare = render(confirmMatchSet(pending));
  expect(prepare).toContain("Prepare set 2");
  expect(prepare).toContain("Start the next set in this order");
  expect(prepare).not.toContain("Confirm and prepare");
  expect(prepare).not.toMatch(/[ぁ-んァ-ヶ一-龠]/);
});

it("renders English setup and confirmation messages, and offers order changes only between sets", () => {
  setLanguage("en");
  const match = pendingSet();
  const review = renderToStaticMarkup(<SetReview match={match} onUndo={() => {}} onConfirm={() => {}} />);
  expect(review).not.toMatch(/[ぁ-んァ-ヶ一-龠]/);
  expect(review).not.toContain("Move Alice earlier");
  const setup = renderToStaticMarkup(<NextSetSetup match={confirmMatchSet(match)} onStart={() => {}} />);
  expect(setup).toContain("Alice");
  expect(setup).toContain("Bob");
  expect(setup).toContain("Carol");
  expect(setup).toContain("Move Alice earlier");
  expect(setup).not.toMatch(/[ぁ-んァ-ヶ一-龠]/);
  const settings = renderToStaticMarkup(<MatchSettingsPanel settings={match.settings} onChange={() => {}} />);
  expect(settings).toContain("First to 5 sets");
  expect(settings.replace("日本語", "")).not.toMatch(/[ぁ-んァ-ヶ一-龠]/);
});

it("keeps the viewer's set-review screen read only", () => {
  setLanguage("en");
  const html = renderToStaticMarkup(<SetReview match={pendingSet()} />);
  expect(html).toContain("Waiting for the host to confirm this set.");
  expect(html).not.toContain("<button");
});

it("accepts the published schema's current-format examples", () => {
  const schema = JSON.parse(readFileSync("public/app-data.schema.json", "utf8"));
  for (const example of schema.examples) expect(readMatchData(example)).not.toBeNull();
});
