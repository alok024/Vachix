'use client';

/**
 * ScoreHistoryChart — dynamically imported by dashboard/page.tsx.
 * Contains all recharts AreaChart code plus custom dot/tooltip sub-components
 * so the ~120 kB recharts bundle is deferred until after the above-the-fold
 * content has rendered.
 */

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

// ── Custom dot components ─────────────────────────────────────────────────

interface CustomDotProps { cx?: number; cy?: number; payload?: { score: number }; dataKey?: string }

function ScoreDot(props: CustomDotProps) {
  const { cx = 0, cy = 0 } = props;
  return (
    <g>
      <circle cx={cx} cy={cy} r={5} fill="var(--accent)" stroke="var(--surface)" strokeWidth={2} />
    </g>
  );
}

function ScoreActiveDot(props: CustomDotProps) {
  const { cx = 0, cy = 0 } = props;
  return (
    <g>
      <circle cx={cx} cy={cy} r={8} fill="var(--accent)" fillOpacity={0.15} />
      <circle cx={cx} cy={cy} r={5} fill="var(--accent)" stroke="var(--surface)" strokeWidth={2.5} />
    </g>
  );
}

// ── Custom tooltip ────────────────────────────────────────────────────────

interface TooltipPayloadItem { value: number; payload: { profession?: string; created_at?: string; score: number } }
interface CustomTooltipProps { active?: boolean; payload?: TooltipPayloadItem[]; label?: string; prevScores?: number[] }

function ScoreTooltip({ active, payload, prevScores = [] }: CustomTooltipProps) {
  if (!active || !payload?.length) return null;
  const item  = payload[0].payload;
  const score = item.score;
  const rawIdx: number = (payload[0] as unknown as { index?: number }).index ?? prevScores.indexOf(score);
  const prev  = rawIdx > 0 ? prevScores[rawIdx - 1] : null;
  const delta = prev != null ? +(score - prev).toFixed(1) : null;
  const date  = item.created_at
    ? new Date(item.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
    : '';
  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--border2)',
      borderRadius: 10,
      padding: '10px 14px',
      boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
      minWidth: 140,
    }}>
      <div style={{ fontSize: 10, color: 'var(--text-3)', marginBottom: 4 }}>{date}</div>
      <div style={{ fontSize: 20, fontWeight: 700, fontFamily: 'var(--mono)', color: 'var(--accent)', lineHeight: 1 }}>
        {score.toFixed(1)}<span style={{ fontSize: 12, color: 'var(--text-3)' }}>/10</span>
      </div>
      {item.profession && (
        <div style={{ fontSize: 11, color: 'var(--text-2)', marginTop: 3 }}>{item.profession}</div>
      )}
      {delta != null && (
        <div style={{
          fontSize: 11, fontWeight: 600, marginTop: 6, paddingTop: 6,
          borderTop: '1px solid var(--border)',
          color: delta >= 0 ? 'var(--success)' : 'var(--error)',
        }}>
          {delta >= 0 ? `↑ +${delta}` : `↓ ${delta}`} from prev
        </div>
      )}
    </div>
  );
}

// ── Public component ──────────────────────────────────────────────────────

interface ScoreEntry { score: number; created_at?: string; profession?: string }

interface ScoreHistoryChartProps {
  chartData: ScoreEntry[];
  chartScores: number[];
}

export default function ScoreHistoryChart({ chartData, chartScores }: ScoreHistoryChartProps) {
  const last  = chartData[chartData.length - 1]?.score ?? 0;
  const prev  = chartData[chartData.length - 2]?.score ?? 0;
  const delta = +(last - prev).toFixed(1);

  return (
    <div className="rounded-2xl border overflow-hidden" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
      <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: 'var(--border)' }}>
        <span className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>Score history</span>
        {delta !== 0 && (
          <span
            className="text-xs font-semibold px-2.5 py-0.5 rounded-full"
            style={{
              background: delta > 0 ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.12)',
              color: delta > 0 ? 'var(--success)' : 'var(--error)',
              border: `1px solid ${delta > 0 ? 'rgba(16,185,129,0.25)' : 'rgba(239,68,68,0.25)'}`,
            }}
          >
            {delta > 0 ? `↑ +${delta}` : `↓ ${delta}`} trending
          </span>
        )}
      </div>
      <div className="px-4 pt-4 pb-2">
        <ResponsiveContainer width="100%" height={140}>
          <AreaChart data={chartData} margin={{ top: 6, right: 8, bottom: 0, left: -20 }}>
            <defs>
              <linearGradient id="scoreGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"   stopColor="var(--accent)" stopOpacity={0.25} />
                <stop offset="100%" stopColor="var(--accent)" stopOpacity={0}    />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis
              dataKey="created_at"
              tickFormatter={(v: string) => new Date(v).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
              tick={{ fontSize: 9, fill: 'var(--text-3)' }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              domain={[0, 10]}
              ticks={[0, 5, 10]}
              tick={{ fontSize: 9, fill: 'var(--text-3)' }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              content={<ScoreTooltip prevScores={chartScores} />}
              cursor={{ stroke: 'var(--border2)', strokeWidth: 1, strokeDasharray: '4 2' }}
            />
            <Area
              type="monotone"
              dataKey="score"
              stroke="var(--accent)"
              strokeWidth={2}
              fill="url(#scoreGradient)"
              dot={<ScoreDot />}
              activeDot={<ScoreActiveDot />}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
