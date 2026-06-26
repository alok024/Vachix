'use client';

/**
 * SpeechTrendsChart — dynamically imported by dashboard/page.tsx.
 * Defers the recharts LineChart bundle until the speech-analytics feature
 * flag is enabled AND the user has 3+ sessions — i.e. never for most users.
 */

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

interface SpeechEntry {
  created_at: string;
  wpm: number;
  filler_count: number;
}

interface SpeechTrendsChartProps {
  speechTrend: SpeechEntry[];
}

export default function SpeechTrendsChart({ speechTrend }: SpeechTrendsChartProps) {
  return (
    <div className="rounded-2xl border overflow-hidden" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: 'var(--border)' }}>
        <span className="text-sm font-semibold flex items-center gap-2" style={{ color: 'var(--text-1)' }}>
          🗣️ Speech Trends
        </span>
        <span
          className="text-[10px] font-bold px-2 py-0.5 rounded-md"
          style={{ background: 'var(--warn-dim)', color: 'var(--warn)' }}
        >
          Beta
        </span>
      </div>

      {/* Charts */}
      <div className="px-4 pt-4 pb-5 space-y-6">

        {/* WPM chart */}
        <div>
          <div className="text-[11px] font-medium uppercase tracking-wide mb-2" style={{ color: 'var(--text-3)' }}>
            Typing Speed (WPM)
          </div>
          <ResponsiveContainer width="100%" height={100}>
            <LineChart data={speechTrend} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis
                dataKey="created_at"
                tickFormatter={(v: string) => new Date(v).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                tick={{ fontSize: 9, fill: 'var(--text-3)' }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 9, fill: 'var(--text-3)' }}
                axisLine={false}
                tickLine={false}
                allowDecimals={false}
              />
              <Tooltip
                contentStyle={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 11 }}
                labelFormatter={(v: string) => new Date(v).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                formatter={(v: number) => [`${v} wpm`, 'Speed']}
              />
              <Line
                type="monotone"
                dataKey="wpm"
                stroke="var(--accent)"
                strokeWidth={2}
                dot={{ r: 3, fill: 'var(--accent)' }}
                activeDot={{ r: 5 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Filler count chart */}
        <div>
          <div className="text-[11px] font-medium uppercase tracking-wide mb-2" style={{ color: 'var(--text-3)' }}>
            Filler Words Per Session
          </div>
          <ResponsiveContainer width="100%" height={100}>
            <LineChart data={speechTrend} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis
                dataKey="created_at"
                tickFormatter={(v: string) => new Date(v).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                tick={{ fontSize: 9, fill: 'var(--text-3)' }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 9, fill: 'var(--text-3)' }}
                axisLine={false}
                tickLine={false}
                allowDecimals={false}
              />
              <Tooltip
                contentStyle={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 11 }}
                labelFormatter={(v: string) => new Date(v).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                formatter={(v: number) => [`${v}`, 'Fillers']}
              />
              <Line
                type="monotone"
                dataKey="filler_count"
                stroke="var(--warn)"
                strokeWidth={2}
                dot={{ r: 3, fill: 'var(--warn)' }}
                activeDot={{ r: 5 }}
              />
            </LineChart>
          </ResponsiveContainer>
          <p className="text-[11px] font-medium mt-2 leading-relaxed" style={{ color: 'var(--text-3)' }}>
            Lower is better. Common fillers include "um", "uh", "like", "basically", "so".
            Detected from your typed answers — estimates only.
          </p>
        </div>

      </div>
    </div>
  );
}
