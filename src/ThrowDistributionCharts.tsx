import type { PlayerCareerAnalysis } from "./game";
import { t } from "./i18n";

type Distribution = Pick<PlayerCareerAnalysis, "singlePinCounts" | "multiPinCounts" | "singlePinThrows" | "multiPinThrows" | "detailedThrows">;

export function getOutcomeBreakdown(stats: Pick<Distribution, "singlePinThrows" | "multiPinThrows" | "detailedThrows">) {
  const counts = [stats.singlePinThrows, stats.multiPinThrows,
    stats.detailedThrows - stats.singlePinThrows - stats.multiPinThrows];
  if (!stats.detailedThrows) return counts.map((count) => ({ count, percent: 0 }));
  // Largest-remainder rounding keeps displayed percentages at exactly 100.0%.
  const raw = counts.map((count) => count / stats.detailedThrows * 1000);
  const rounded = raw.map(Math.floor);
  const order = raw.map((value, index) => ({ index, remainder: value - rounded[index] }))
    .sort((a, b) => b.remainder - a.remainder);
  const remaining = 1000 - rounded.reduce((sum, value) => sum + value, 0);
  for (let i = 0; i < remaining; i++) rounded[order[i].index] += 1;
  return counts.map((count, index) => ({ count, percent: rounded[index] / 10 }));
}

function OutcomeChart({ stats }: { stats: Distribution }) {
  const categories = [
    { label: t("1本倒し"), color: "#387353" },
    { label: t("複数本倒し"), color: "#b87b49" },
    { label: t("ミス"), color: "#9a5754" },
  ];
  const segments = getOutcomeBreakdown(stats);
  const description = categories.map((category, index) => `${category.label}: ${segments[index].percent.toFixed(1)}%, ${t("{0} 回", [segments[index].count])}`).join("; ");
  let offset = 0;
  return <figure className="throw-distribution outcome-distribution">
    <figcaption><h4>{t("投球結果の割合")}</h4><p>{t("詳細入力の全投球（ミスを含む）：{0} 投", [stats.detailedThrows])}</p></figcaption>
    {!stats.detailedThrows ? <p className="distribution-empty">{t("該当する投球はまだありません。")}</p> : <>
      <svg viewBox="0 0 320 32" role="img" aria-label={description}>
        <title>{t("投球結果の割合")}: {description}</title>
        {segments.map((segment, index) => {
          const width = segment.count / stats.detailedThrows * 320;
          const x = offset; offset += width;
          if (!segment.count) return null;
          return <g key={index}>
            <rect x={x} y="0" width={width} height="32" fill={categories[index].color} />
            {width >= 42 && <text x={x + width / 2} y="20" textAnchor="middle" fill="white" fontFamily="sans-serif" fontSize="10">{segment.percent.toFixed(1)}%</text>}
          </g>;
        })}
      </svg>
      <dl className="outcome-legend">{categories.map((category, index) => <div key={index}>
        <dt><i style={{ background: category.color }} aria-hidden="true" />{category.label}</dt>
        <dd><strong>{segments[index].percent.toFixed(1)}%</strong><span>{t("{0} 回", [segments[index].count])}</span></dd>
      </div>)}</dl>
    </>}
  </figure>;
}

function DistributionChart({ title, counts, first, single, total }: {
  title: string; counts: number[]; first: number; single: boolean; total: number;
}) {
  const step = Math.max(1, Math.ceil(Math.max(...counts) / 3));
  const max = step * 3;
  const left = 28, bottom = 150, height = 116, width = 280;
  const slot = width / counts.length;
  const barWidth = Math.min(18, slot - 5);
  return <figure className="throw-distribution">
    <figcaption><h4>{title}</h4><p>{t("対象：{0} 回", [total])}</p></figcaption>
    {total === 0 ? <p className="distribution-empty">{t("該当する投球はまだありません。")}</p> : <>
      <svg viewBox="0 0 320 192" role="img" aria-label={title}>
        <title>{title}</title>
        <text x={left} y="14" className="distribution-axis">{t("回数")}</text>
        {[0, 1, 2, 3].map((tick) => {
          const value = tick * step, y = bottom - height * value / max;
          return <g key={value}>
            <line x1={left} x2={left + width} y1={y} y2={y} stroke="#e2e7dd" />
            <text x={left - 7} y={y + 3} textAnchor="end" className="distribution-axis">{value}</text>
          </g>;
        })}
        {counts.map((count, index) => {
          const x = left + slot * (index + .5), h = height * count / max;
          const label = single ? t("ピン {0}", [index + first]) : t("{0} 本", [index + first]);
          return <g key={index}>
            <title>{label}: {t("{0} 回", [count])}</title>
            <rect x={x - barWidth / 2} y={bottom - h} width={barWidth} height={h} rx="3" fill={single ? "#387353" : "#b87b49"} />
            <text x={x} y={bottom - h - 5} textAnchor="middle" className="distribution-value">{count}</text>
            <text x={x} y={bottom + 16} textAnchor="middle" className="distribution-axis">{index + first}</text>
          </g>;
        })}
        <text x={left + width / 2} y="187" textAnchor="middle" className="distribution-axis">{single ? t("ピン番号") : t("倒した本数")}</text>
      </svg>
      <details className="distribution-data"><summary>{t("数値で確認")}</summary>
        <dl>{counts.map((count, index) => <div key={index}><dt>{single ? t("ピン {0}", [index + first]) : t("{0} 本", [index + first])}</dt><dd>{t("{0} 回", [count])}</dd></div>)}</dl>
      </details>
    </>}
  </figure>;
}

export function ThrowDistributionCharts({ stats }: { stats: Distribution }) {
  return <div className="throw-distributions">
    <OutcomeChart stats={stats} />
    <DistributionChart title={t("1本倒し：ピン番号別の回数")} counts={stats.singlePinCounts} first={1} single total={stats.singlePinThrows} />
    <DistributionChart title={t("複数本倒し：本数別の回数")} counts={stats.multiPinCounts} first={2} single={false} total={stats.multiPinThrows} />
  </div>;
}
