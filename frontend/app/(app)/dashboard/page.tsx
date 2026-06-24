'use client';

import React, { useEffect, useRef, useState, useMemo } from 'react';
/**
 * app/(app)/dashboard/page.tsx — fully CSS-var themed, no hardcoded hex.
 */

import { useRouter } from 'next/navigation';
import { useMe } from '@/features/user/hooks';
import { useScoreHistory, useReadinessReport } from '@/features/analytics/hooks';
import { useSpeechTrend } from '@/features/speech/hooks';
import { useDailyQuestion } from '@/features/daily-question/hooks';
import { useMyPrepEnrollment } from '@/features/prep-paths/hooks';
import { useAuthStore } from '@/store/auth';
import { useUIStore } from '@/store/ui';
import { ProgressBar, Spinner, ScoreRing } from '@/components/ui';
import { formatDate, scoreColor } from '@/lib/utils';
import { Target, Zap, TrendingUp, Lightbulb, FileText, ExternalLink, Trophy, CalendarCheck } from 'lucide-react';
import { analytics } from '@/lib/analytics';
import { FLAG } from '@/lib/feature-flags'; // Bug #5 fix
import { JobLandedModal } from '@/components/shared/JobLandedModal';
import type { Session, WeakArea } from '@/types';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Area, AreaChart } from 'recharts';

const QUICK_STARTS = [
  { label: 'Software Dev',      desc: 'AI Chat · Friendly',   emoji: '💻', profession: 'Software Developer',        mode: 'chat' },
  { label: 'Bank PO',           desc: 'AI Chat · Technical',  emoji: '🏦', profession: 'Bank PO',                  mode: 'chat' },
  { label: 'Govt / SSC / UPSC', desc: 'Classic · Behavioral', emoji: '🏛️', profession: 'Government Job (SSC/UPSC)', mode: 'classic' },
];

// ── Feature 23 — Time-aware greeting helper ───────────────────────────────
// IST = UTC + 5:30
function getISTHour(): number {
  const now = new Date();
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60_000;
  return new Date(utcMs + 5.5 * 3_600_000).getHours();
}

interface GreetingCopy { headline: string; subline: string; accentColor: string; period: string }

function buildGreeting(name: string, streak: number, practicedToday: boolean): GreetingCopy {
  const hour = getISTHour();
  let headline: string;
  let accentColor: string;

  if      (hour >= 5  && hour < 12) { headline = `Good morning, ${name} ☀️`;   accentColor = '#facc15'; }
  else if (hour >= 12 && hour < 17) { headline = `Good afternoon, ${name} 👋`;  accentColor = '#60a5fa'; }
  else if (hour >= 17 && hour < 22) { headline = `Good evening, ${name} 🌆`;   accentColor = '#f97316'; }
  else                               { headline = `Still up, ${name}? 🌙`;       accentColor = '#818cf8'; }

  const period =
    hour >= 5  && hour < 12 ? 'Morning' :
    hour >= 12 && hour < 17 ? 'Afternoon' :
    hour >= 17 && hour < 22 ? 'Evening'   : 'Night';

  let subline: string;
  const isNight = hour < 5 || hour >= 22;

  if (isNight) {
    if (streak === 0 && !practicedToday) subline = 'Late night prep — panels respect the grind. 🕯️';
    else if (practicedToday)             subline = 'You already practiced today. Get some rest.';
    else                                 subline = `Day ${streak} — don't break it. 🔥`;
  } else if (streak > 0) {
    subline = `Day ${streak} — don't break it. 🔥`;
  } else if (practicedToday) {
    subline = 'You already practiced today. Run another?';
  } else {
    subline = 'One session a day keeps the panel away.';
  }

  return { headline, subline, accentColor, period };
}

// ── Feature 22 — useCountUp hook ─────────────────────────────────────────
// Counts from 0 → target over `duration`ms with ease-out cubic, fires once
// after a stagger delay. Returns current display value as a string.
function useCountUp(target: number, options?: { duration?: number; delay?: number; decimals?: number }): string {
  const { duration = 800, delay = 0, decimals = 0 } = options ?? {};
  const [display, setDisplay] = useState('0');
  const rafRef = useRef<number>(0);

  useEffect(() => {
    if (target === 0) { setDisplay('0'); return; }
    const tid = setTimeout(() => {
      const start = performance.now();
      function step(now: number) {
        const elapsed  = now - start;
        const progress = Math.min(elapsed / duration, 1);
        const eased    = 1 - Math.pow(1 - progress, 3); // ease-out cubic
        const current  = eased * target;
        setDisplay(decimals > 0 ? current.toFixed(decimals) : String(Math.round(current)));
        if (progress < 1) rafRef.current = requestAnimationFrame(step);
        else setDisplay(decimals > 0 ? target.toFixed(decimals) : String(target));
      }
      rafRef.current = requestAnimationFrame(step);
    }, delay);
    return () => { clearTimeout(tid); cancelAnimationFrame(rafRef.current); };
  }, [target, duration, delay, decimals]);

  return display;
}

// ── Feature 24 — Score chart custom components ───────────────────────────
// Custom recharts dot: filled circle with accent glow ring.
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

// Custom tooltip for Feature 24
interface TooltipPayloadItem { value: number; payload: { profession?: string; created_at?: string; score: number } }
interface CustomTooltipProps { active?: boolean; payload?: TooltipPayloadItem[]; label?: string; prevScores?: number[] }
function ScoreTooltip({ active, payload, prevScores = [] }: CustomTooltipProps) {
  if (!active || !payload?.length) return null;
  const item   = payload[0].payload;
  const score  = item.score;
  // recharts passes dataIndex via payload when AreaChart is used — fall back to score indexOf
  const rawIdx: number = (payload[0] as unknown as { index?: number }).index ?? prevScores.indexOf(score);
  const prev   = rawIdx > 0 ? prevScores[rawIdx - 1] : null;
  const delta  = prev != null ? +(score - prev).toFixed(1) : null;
  const date   = item.created_at
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

export default function DashboardPage() {
  const { user }            = useAuthStore();
  const { showUpgradeModal } = useUIStore();
  const router              = useRouter();
  const { data: meData, isLoading } = useMe();
  const { data: history }   = useScoreHistory(10);
  const { data: dailyQ }    = useDailyQuestion();
  const { data: prepEnrollment } = useMyPrepEnrollment();
  const { data: speechTrend }  = useSpeechTrend();

  const stats        = meData?.stats;
  const usage        = meData?.usage;
  const jobReadiness = meData?.job_readiness;
  const weakAreas    = meData?.weak_areas ?? [];
  const recommendations = meData?.recommendations ?? [];
  // Derive plan from the live /me response so an upgrade takes effect
  // immediately without requiring a page refresh. Fall back to the Zustand
  // store only while meData is still loading (avoids a free→paid flash).
  const livePlan = meData?.user?.plan ?? user?.plan;
  const isFree       = !livePlan || livePlan === 'free';
  const isStarter    = livePlan === 'starter' || livePlan === 'pro' || livePlan === 'elite';
  const { data: readinessData } = useReadinessReport(isStarter);
  const readinessReport   = readinessData?.report ?? null;
  const sessionsUntilNext = readinessData?.sessions_until_next_report ?? null;
  const FREE_LIMIT   = usage?.limit ?? user?.ai_calls_limit ?? null;
  const aiUsed       = usage?.ai_calls ?? 0;
  const aiRemaining  = usage?.remaining ?? user?.ai_calls_remaining ?? null;
  const usagePct     = FREE_LIMIT ? Math.min(100, Math.round((aiUsed / FREE_LIMIT) * 100)) : 0;
  const name         = user?.name?.split(' ')[0] || 'there';
  const hasData      = (stats?.sessions ?? 0) > 0;

  // Feature 23 — practicedToday: last_session date in IST === today in IST
  const practicedToday = useMemo(() => {
    const lastSession = stats?.last_session;
    if (!lastSession) return false;
    const toISTDate = (iso: string) => {
      const utcMs = new Date(iso).getTime() + 5.5 * 3_600_000;
      return new Date(utcMs).toDateString();
    };
    return toISTDate(lastSession) === toISTDate(new Date().toISOString());
  }, [stats?.last_session]);

  const greeting = buildGreeting(name, stats?.streak ?? 0, practicedToday);

  // Feature 22 — count-up values (0 while loading, real values after meData arrives)
  const streakCount   = useCountUp(stats?.streak   ?? 0, { delay: 0,   duration: 700 });
  const sessionsCount = useCountUp(stats?.sessions  ?? 0, { delay: 120, duration: 750 });
  // best_score is x/10; store it ×10 as integer, display with .toFixed(1)
  const bestScoreRaw  = stats?.best_score != null ? Math.round(stats.best_score * 10) : 0;
  const bestScoreCount= useCountUp(bestScoreRaw,          { delay: 240, duration: 800, decimals: 0 });
  const aiUsedCount   = useCountUp(aiUsed,                { delay: 360, duration: 700 });

  // Feature 24 — score history ordered oldest→newest for the chart
  const chartData = useMemo(() => {
    if (!history?.length) return [];
    return [...history].reverse(); // history comes newest-first from API
  }, [history]);
  const chartScores = useMemo(() => chartData.map((s) => s.score), [chartData]);

  // Job Landed card — show after 5+ sessions, hide once user has submitted
  // (job_landed_at non-null = already submitted, card gone forever).
  const [showJobLandedModal, setShowJobLandedModal] = useState(false);
  const hasJobLandedCard =
    (stats?.sessions ?? 0) >= 5 &&
    !meData?.user?.job_landed_at;

  // day7_active — fire once per mount if the user is in the 6-8 day window
  // after signup. Uses a ref so a React Strict Mode double-invoke or a
  // fast remount doesn't double-fire within the same page load.
  const day7Fired = useRef(false);
  useEffect(() => {
    if (day7Fired.current || !meData) return;
    const createdAt = meData.user?.created_at ?? user?.created_at;
    if (!createdAt) return;

    const daysSinceSignup = Math.floor(
      (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60 * 24)
    );

    if (daysSinceSignup >= 6 && daysSinceSignup <= 8) {
      day7Fired.current = true;
      analytics.day7Active({ days_since_signup: daysSinceSignup });
    }
  }, [meData, user]);

  function handleQuickStart(profession: string, mode: string) {
    router.push(`/interview/setup?profession=${encodeURIComponent(profession)}&mode=${mode}`);
  }

  // Continue button on the Prep Path card — pre-fills the setup page from
  // today's day's session_config via the same ?profession=&mode= params
  // already read by interview/setup/page.tsx, plus difficulty/interview_type.
  function handleContinuePrepPath() {
    const today = prepEnrollment?.today;
    if (!today) return;
    const { profession, mode, difficulty, interview_type } = today.session_config;
    const qs = new URLSearchParams({ profession, mode, difficulty, interview_type });
    router.push(`/interview/setup?${qs.toString()}`);
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner size={28} style={{ color: 'var(--accent)' }} />
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-5">

      {/* Feature 23 — Time-aware greeting */}
      <div
        className="rounded-2xl px-5 py-4 border relative overflow-hidden"
        style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
      >
        {/* Subtle ambient radial tinted by time-of-day color */}
        <div
          aria-hidden="true"
          style={{
            position: 'absolute', inset: 0, pointerEvents: 'none',
            background: `radial-gradient(ellipse at 15% 50%, ${greeting.accentColor}0a 0%, transparent 70%)`,
          }}
        />
        {/* Time badge */}
        <div className="inline-flex items-center gap-1.5 mb-3 px-2.5 py-1 rounded-full border text-[10px] font-bold uppercase tracking-wide"
          style={{ background: 'var(--surface-2)', borderColor: 'var(--border2)', color: 'var(--text-3)' }}>
          <span
            className="w-1.5 h-1.5 rounded-full"
            style={{ background: greeting.accentColor, animation: 'gr-blink 2s ease-in-out infinite' }}
          />
          {greeting.period} · IST
        </div>
        <h1 className="text-xl font-bold leading-tight mb-1" style={{ color: 'var(--text-1)', letterSpacing: '-0.02em' }}>
          {greeting.headline}
        </h1>
        <p className="text-xs" style={{ color: 'var(--text-3)' }}>{greeting.subline}</p>
      </div>

      {/* Daily Question Drop — Easy build item. Renders nothing while
          loading or if generation failed server-side (no fake fallback). */}
      {dailyQ?.question && (
        <div
          className="rounded-2xl p-4 border flex items-start gap-3"
          style={{ background: 'var(--blue-dim)', borderColor: 'var(--blue-border)' }}
        >
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: 'var(--surface)' }}
          >
            <Lightbulb className="w-4 h-4" style={{ color: 'var(--accent)' }} />
          </div>
          <div className="min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-wide mb-1" style={{ color: 'var(--accent)' }}>
              Today's Question
            </div>
            <p className="text-sm leading-relaxed" style={{ color: 'var(--text-1)' }}>{dailyQ.question}</p>
          </div>
        </div>
      )}

      {/* Guided Prep Path — Phase 8 (P6-A). Shows the user's active enrollment
          ("Day 3 of 7 — Bank PO Prep") with a Continue button that pre-fills
          the setup page from today's day's session_config. Renders nothing
          if the user isn't enrolled in a path or it's still loading. */}
      {prepEnrollment?.enrollment && prepEnrollment.path && prepEnrollment.today && (
        <div
          className="rounded-2xl p-4 border flex items-center gap-3 flex-wrap"
          style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
        >
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: 'var(--accent-dim)' }}
          >
            <CalendarCheck className="w-4 h-4" style={{ color: 'var(--accent)' }} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-bold uppercase tracking-wide mb-0.5" style={{ color: 'var(--accent)' }}>
              Day {prepEnrollment.current_day} of {prepEnrollment.path.duration_days} — {prepEnrollment.path.title}
            </div>
            <p className="text-sm" style={{ color: 'var(--text-1)' }}>{prepEnrollment.today.title}</p>
          </div>
          <button
            onClick={handleContinuePrepPath}
            className="px-4 py-2 rounded-xl text-xs font-bold text-white transition-opacity hover:opacity-90 shrink-0"
            style={{ background: 'var(--accent)' }}
          >
            Continue
          </button>
        </div>
      )}


      {!hasData && (
        <div className="rounded-2xl border text-center overflow-hidden" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
          <div className="px-8 pt-12 pb-10 flex flex-col items-center">

            {/* Animated mic with radiating arcs */}
            <div className="relative w-24 h-24 flex items-center justify-center mb-7">
              <div className="mic-arc" />
              <div className="mic-arc" />
              <div className="mic-arc" />
              {/* Mic icon base */}
              <div className="relative z-10 w-16 h-16 rounded-full flex items-center justify-center"
                style={{
                  background: 'linear-gradient(135deg, var(--blue), rgba(37,99,235,0.6))',
                  boxShadow: '0 0 28px rgba(96,165,250,0.2)',
                }}>
                <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden="true">
                  <rect x="9" y="2" width="10" height="15" rx="5" fill="white" opacity="0.9" />
                  <path d="M5 14c0 5 4 8 9 8s9-3 9-8" stroke="white" strokeWidth="2" strokeLinecap="round" fill="none" opacity="0.9" />
                  <line x1="14" y1="22" x2="14" y2="26" stroke="white" strokeWidth="2" strokeLinecap="round" opacity="0.9" />
                  <line x1="10" y1="26" x2="18" y2="26" stroke="white" strokeWidth="2" strokeLinecap="round" opacity="0.9" />
                </svg>
              </div>
            </div>

            <h2 className="text-xl font-extrabold mb-2 leading-tight" style={{ color: 'var(--text-1)' }}>
              Your first session awaits
            </h2>
            <p className="text-sm max-w-sm mx-auto mb-8 leading-relaxed" style={{ color: 'var(--text-2)' }}>
              Pick a track, answer 5 questions, get your Readiness Score — all in under 10 minutes.
            </p>

            {/* 3-step progress hint */}
            <div className="flex items-center max-w-xs w-full mx-auto mb-8">
              {[
                { label: 'Pick track',  n: 1 },
                { label: 'Answer 5 Qs', n: 2 },
                { label: 'See score',   n: 3 },
              ].map(({ label, n }, i) => (
                <React.Fragment key={label}>
                  <div className="flex flex-col items-center gap-1.5 flex-1">
                    <div
                      className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold"
                      style={{
                        background: n === 1 ? 'var(--blue)' : 'var(--surface-2)',
                        border: n === 1 ? '1.5px solid var(--accent)' : '1.5px solid var(--border2)',
                        color: n === 1 ? '#fff' : 'var(--text-3)',
                        boxShadow: n === 1 ? '0 0 12px rgba(96,165,250,0.3)' : 'none',
                      }}
                    >
                      {n}
                    </div>
                    <span className="text-[10px] font-semibold text-center leading-tight"
                      style={{ color: n === 1 ? 'var(--accent)' : 'var(--text-3)' }}>
                      {label}
                    </span>
                  </div>
                  {i < 2 && (
                    <div className="flex-1 h-px mb-5" style={{ background: 'var(--border2)' }} />
                  )}
                </React.Fragment>
              ))}
            </div>

            {/* CTA */}
            <button
              onClick={() => router.push('/interview/setup')}
              className="flex items-center gap-3 px-7 py-3.5 rounded-xl text-sm font-bold text-white transition-all duration-200 hover:-translate-y-0.5"
              style={{ background: 'var(--blue)', boxShadow: '0 4px 20px rgba(37,99,235,0.35)' }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.boxShadow = '0 8px 28px rgba(37,99,235,0.45)'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.boxShadow = '0 4px 20px rgba(37,99,235,0.35)'; }}
            >
              <span className="text-lg">🎤</span>
              <span>
                Start in 10 min
                <span className="block text-[10px] font-medium opacity-70">Free · No card · No download</span>
              </span>
            </button>
          </div>
        </div>
      )}

      {/* Stats row — Feature 22: values count up on mount */}
      {hasData && (() => {
        const bestScoreDisplay = stats?.best_score != null
          ? `${(parseInt(bestScoreCount) / 10).toFixed(1)}/10`
          : '—';
        const cards: { label: string; value: string; sub: string; color: string }[] = [
          { label: 'Streak',      value: streakCount,      sub: 'days 🔥',                                      color: 'var(--warn)'    },
          { label: 'Sessions',    value: sessionsCount,    sub: 'completed',                                    color: 'var(--accent)'  },
          { label: 'Best Score',  value: bestScoreDisplay, sub: 'personal best',                                color: 'var(--success)' },
          { label: 'AI Sessions', value: aiUsedCount,      sub: FREE_LIMIT ? `of ${FREE_LIMIT} used` : 'used', color: 'var(--accent)'  },
        ];
        return (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {cards.map((s) => (
              <div key={s.label} className="rounded-xl p-4 text-center border" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
                <div className="text-[10px] uppercase tracking-wide mb-1" style={{ color: 'var(--text-3)' }}>{s.label}</div>
                <div className="text-2xl font-bold tabular-nums" style={{ color: s.color, letterSpacing: '-0.03em' }}>{s.value}</div>
                <div className="text-[10px] mt-0.5" style={{ color: 'var(--text-3)' }}>{s.sub}</div>
              </div>
            ))}
          </div>
        );
      })()}

      {/* Usage bar — free users */}
      {isFree && hasData && (
        <div className="rounded-xl p-4 border" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold flex items-center gap-1.5" style={{ color: 'var(--text-2)' }}>
              <Zap className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} />
              AI Sessions Used
            </span>
            <span className="text-sm font-bold tabular-nums" style={{ color: 'var(--text-1)' }}>
              {aiUsed}{FREE_LIMIT ? ` / ${FREE_LIMIT}` : ''}
            </span>
          </div>
          <ProgressBar
            value={aiUsed}
            max={FREE_LIMIT ?? aiUsed + 1}
            color={usagePct >= 80 ? 'var(--error)' : usagePct >= 60 ? 'var(--warn)' : 'var(--accent)'}
            animated
          />
          <p className="text-xs mt-2" style={{ color: 'var(--text-2)' }}>
            {aiRemaining != null ? `${aiRemaining} sessions remaining. ` : ''}
            <button onClick={() => showUpgradeModal('strip')} className="hover:underline" style={{ color: 'var(--accent)' }}>
              Upgrade for unlimited →
            </button>
          </p>
        </div>
      )}

      {/* Two-column: Recent + Quick Start */}
      {hasData && (
        <div className="grid md:grid-cols-2 gap-4">
          {/* Recent Sessions */}
          <div className="rounded-2xl border overflow-hidden" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
            <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: 'var(--border)' }}>
              <span className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>Recent Sessions</span>
              <button onClick={() => router.push('/history')} className="text-xs font-medium hover:underline" style={{ color: 'var(--accent)' }}>
                View all →
              </button>
            </div>
            <div>
              {(history ?? []).slice(0, 4).map((s: Session) => (
                <button
                  key={s.id}
                  onClick={() => router.push(`/interview/summary?session=${s.id}`)}
                  className="w-full flex items-center justify-between px-4 py-3 border-b text-left transition-colors last:border-0"
                  style={{ borderColor: 'var(--border)' }}
                  onMouseEnter={(e: React.MouseEvent<HTMLElement>) => (e.currentTarget.style.background = 'var(--surface-2)')}
                  onMouseLeave={(e: React.MouseEvent<HTMLElement>) => (e.currentTarget.style.background = 'transparent')}
                >
                  <div>
                    <div className="text-xs font-medium" style={{ color: 'var(--text-1)' }}>{s.profession}</div>
                    <div className="text-[10px]" style={{ color: 'var(--text-3)' }}>{formatDate(s.created_at)}</div>
                  </div>
                  <ScoreRing score={Math.round(s.score)} max={10} size="sm" />
                </button>
              ))}
              {!history?.length && (
                <div className="px-4 py-8 text-center text-xs" style={{ color: 'var(--text-3)' }}>No sessions yet.</div>
              )}
            </div>
          </div>

          {/* Quick Start — Feature 25: hover arrow + icon scale + left bar */}
          <div className="rounded-2xl border overflow-hidden" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
            <div className="flex items-center gap-2 px-4 py-3 border-b" style={{ borderColor: 'var(--border)' }}>
              <Zap className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} />
              <span className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>Quick Start</span>
            </div>
            <div>
              {QUICK_STARTS.map((qs) => (
                <button
                  key={qs.label}
                  onClick={() => handleQuickStart(qs.profession, qs.mode)}
                  className="qs-item w-full flex items-center gap-3 px-4 py-3 border-b text-left transition-colors last:border-0"
                  style={{ borderColor: 'var(--border)' }}
                  onMouseEnter={(e: React.MouseEvent<HTMLElement>) => (e.currentTarget.style.background = 'var(--surface-2)')}
                  onMouseLeave={(e: React.MouseEvent<HTMLElement>) => (e.currentTarget.style.background = 'transparent')}
                >
                  <div className="qs-icon w-9 h-9 rounded-xl flex items-center justify-center text-lg flex-shrink-0"
                    style={{ background: 'var(--accent-dim)' }}>
                    {qs.emoji}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold" style={{ color: 'var(--text-1)' }}>{qs.label}</div>
                    <div className="text-[10px]" style={{ color: 'var(--text-3)' }}>{qs.desc}</div>
                  </div>
                  <span className="qs-arrow">→</span>
                </button>
              ))}
              {!prepEnrollment?.enrollment && (
                <button
                  onClick={() => router.push('/prep-paths')}
                  className="qs-item w-full flex items-center gap-3 px-4 py-3 border-b text-left transition-colors"
                  style={{ borderColor: 'var(--border)' }}
                  onMouseEnter={(e: React.MouseEvent<HTMLElement>) => (e.currentTarget.style.background = 'var(--surface-2)')}
                  onMouseLeave={(e: React.MouseEvent<HTMLElement>) => (e.currentTarget.style.background = 'transparent')}
                >
                  <div className="qs-icon w-9 h-9 rounded-xl flex items-center justify-center text-lg flex-shrink-0"
                    style={{ background: 'var(--accent-dim)' }}>
                    <CalendarCheck className="w-4 h-4" style={{ color: 'var(--accent)' }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold" style={{ color: 'var(--text-1)' }}>Try a Guided Prep Path</div>
                    <div className="text-[10px]" style={{ color: 'var(--text-3)' }}>Structured day-by-day tracks for Bank PO, UPSC & more</div>
                  </div>
                  <span className="qs-arrow">→</span>
                </button>
              )}
              <button
                onClick={() => router.push('/interview/setup')}
                className="qs-item w-full flex items-center gap-3 px-4 py-3 text-left transition-colors"
                onMouseEnter={(e: React.MouseEvent<HTMLElement>) => (e.currentTarget.style.background = 'var(--surface-2)')}
                onMouseLeave={(e: React.MouseEvent<HTMLElement>) => (e.currentTarget.style.background = 'transparent')}
              >
                <div className="qs-icon w-9 h-9 rounded-xl flex items-center justify-center text-lg flex-shrink-0"
                  style={{ background: 'var(--surface-3)' }}>
                  ✦
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold" style={{ color: 'var(--accent)' }}>Browse all tracks →</div>
                  <div className="text-[10px]" style={{ color: 'var(--text-3)' }}>11 career tracks available</div>
                </div>
                <span className="qs-arrow">→</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Feature 24 — Score chart: gradient fill + custom dot + polished tooltip */}
      {hasData && chartData.length >= 2 && (
        <div className="rounded-2xl border overflow-hidden" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
          <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: 'var(--border)' }}>
            <span className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>Score history</span>
            {(() => {
              const last = chartData[chartData.length - 1]?.score ?? 0;
              const prev = chartData[chartData.length - 2]?.score ?? 0;
              const delta = +(last - prev).toFixed(1);
              return delta !== 0 ? (
                <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full"
                  style={{
                    background: delta > 0 ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.12)',
                    color: delta > 0 ? 'var(--success)' : 'var(--error)',
                    border: `1px solid ${delta > 0 ? 'rgba(16,185,129,0.25)' : 'rgba(239,68,68,0.25)'}`,
                  }}>
                  {delta > 0 ? `↑ +${delta}` : `↓ ${delta}`} trending
                </span>
              ) : null;
            })()}
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
      )}

      {/* Job Readiness */}
      {hasData && jobReadiness && (
        <div className="rounded-2xl p-5 border" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
          <div className="flex items-center gap-2 mb-4">
            <Target className="w-4 h-4" style={{ color: 'var(--accent)' }} />
            <span className="text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>Interview Readiness</span>
          </div>
          <div className="flex items-center gap-5">
            <ScoreRing score={jobReadiness.score} size={76} />
            <div>
              <div className="text-sm font-semibold mb-1" style={{ color: 'var(--text-1)' }}>{jobReadiness.label}</div>
              <p className="text-xs leading-relaxed max-w-xs" style={{ color: 'var(--text-2)' }}>{jobReadiness.message}</p>
            </div>
          </div>
        </div>
      )}

      {/* Recommendations */}
      {recommendations.length > 0 && (
        <div className="rounded-2xl border overflow-hidden" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
          <div className="flex items-center gap-2 px-4 py-3 border-b" style={{ borderColor: 'var(--border)' }}>
            <Lightbulb className="w-4 h-4" style={{ color: 'var(--accent)' }} />
            <span className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>Recommended for you</span>
          </div>
          <div className="px-4 py-4 space-y-3">
            {recommendations.map((rec, i) => (
              <div key={i} className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <div className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>{rec.title}</div>
                  <p className="text-xs leading-relaxed max-w-md" style={{ color: 'var(--text-2)' }}>{rec.reason}</p>
                </div>
                {rec.action && (
                  <button
                    onClick={() => router.push('/interview/setup')}
                    className="text-xs font-semibold px-3 py-1.5 rounded-lg shrink-0"
                    style={{ background: 'var(--accent)', color: 'var(--surface)' }}
                  >
                    {rec.action}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Weak Areas */}
      {weakAreas.length > 0 && (
        <div className="rounded-2xl border overflow-hidden" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
          <div className="flex items-center gap-2 px-4 py-3 border-b" style={{ borderColor: 'var(--border)' }}>
            <TrendingUp className="w-4 h-4" style={{ color: 'var(--error)' }} />
            <span className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>Areas to Improve</span>
          </div>
          <div className="px-4 py-4 space-y-4">
            {weakAreas.map((wa: WeakArea) => (
              <div key={wa.topic}>
                <ProgressBar
                  value={wa.avg_score}
                  max={10}
                  label={wa.topic}
                  showValue
                  animated
                  color={
                    wa.avg_score >= 7 ? 'var(--success)' :
                    wa.avg_score >= 5 ? 'var(--warn)' :
                    'var(--error)'
                  }
              />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Interview Readiness Report — Starter+ only, only when a report exists */}
      {isStarter && readinessReport && (
        <div className="rounded-2xl border overflow-hidden" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: 'var(--border)' }}>
            <span className="text-sm font-semibold flex items-center gap-2" style={{ color: 'var(--text-1)' }}>
              <FileText className="w-4 h-4" style={{ color: 'var(--accent)' }} />
              Interview Readiness Report
            </span>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-md" style={{ background: 'var(--blue-dim)', color: 'var(--accent)' }}>
              After session {readinessReport.session_count}
            </span>
          </div>

          {/* Report body */}
          <div className="px-4 py-4">
            <p className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: 'var(--text-2)' }}>
              {readinessReport.report_text}
            </p>

            {/* Footer row: avg score + next checkpoint + cert link */}
            <div className="mt-4 pt-3 border-t flex flex-wrap items-center justify-between gap-3" style={{ borderColor: 'var(--border)' }}>
              <div className="flex items-center gap-4">
                {readinessReport.avg_score != null && (
                  <div className="text-center">
                    <div className="text-[10px] uppercase tracking-wide mb-0.5" style={{ color: 'var(--text-3)' }}>Avg Score</div>
                    <div
                      className="text-lg font-bold tabular-nums"
                      style={{ color: readinessReport.avg_score >= 7 ? 'var(--success)' : readinessReport.avg_score >= 5 ? 'var(--warn)' : 'var(--error)' }}
                    >
                      {readinessReport.avg_score.toFixed(1)}/10
                    </div>
                  </div>
                )}
                {sessionsUntilNext != null && (
                  <div className="text-center">
                    <div className="text-[10px] uppercase tracking-wide mb-0.5" style={{ color: 'var(--text-3)' }}>Next Report</div>
                    <div className="text-sm font-semibold" style={{ color: 'var(--text-2)' }}>
                      {sessionsUntilNext} session{sessionsUntilNext !== 1 ? 's' : ''} away
                    </div>
                  </div>
                )}
              </div>

              {/* View Certificate */}
              <button
                className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg"
                style={{ background: 'var(--blue-dim)', color: 'var(--accent)' }}
                onClick={async () => {
                  try {
                    const { analyticsApi } = await import('@/features/analytics/api');
                    const res = await analyticsApi.getReadinessCertificateToken();
                    if (res.ok && res.data.cert_url) {
                      window.open(res.data.cert_url, '_blank', 'noopener');
                    }
                  } catch {
                    // silently ignore — certificate is a nice-to-have
                  }
                }}
              >
                <ExternalLink className="w-3.5 h-3.5" />
                View Certificate
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Speech Trends card — Beta (P5)
           Gated by FLAG.SPEECH_ANALYTICS_CARD (Bug #5 fix) AND requires 3+
           sessions with recorded metrics so the chart has a meaningful trend
           line rather than a single dot. Set NEXT_PUBLIC_FF_SPEECH_ANALYTICS_CARD=true
           to enable. Labelled "Beta" because WPM is an estimate (typed, not spoken)
           and filler detection is heuristic, not ML-based. */}
      {FLAG.SPEECH_ANALYTICS_CARD && (speechTrend ?? []).length >= 3 && (
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
              <div className="text-[10px] uppercase tracking-wide mb-2" style={{ color: 'var(--text-3)' }}>
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
              <div className="text-[10px] uppercase tracking-wide mb-2" style={{ color: 'var(--text-3)' }}>
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
              <p className="text-[10px] mt-2 leading-relaxed" style={{ color: 'var(--text-3)' }}>
                Lower is better. Common fillers include "um", "uh", "like", "basically", "so".
                Detected from your typed answers — estimates only.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Upgrade strip */}
      {isFree && (stats?.sessions ?? 0) >= 3 && (
        <div className="rounded-xl p-4 flex items-center justify-between gap-4 flex-wrap border"
          style={{ background: 'var(--blue-dim)', borderColor: 'var(--blue-border)' }}>
          <div>
            <div className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>🚀 You're improving!</div>
            <div className="text-xs mt-0.5" style={{ color: 'var(--text-2)' }}>Unlock unlimited sessions to keep your momentum.</div>
          </div>
          <button
            onClick={() => showUpgradeModal('nudge')}
            className="text-xs font-bold text-white px-4 py-2 rounded-lg whitespace-nowrap"
            style={{ background: 'var(--blue)' }}
          >
            Upgrade → ₹699/mo
          </button>
        </div>
      )}

      {/* Job Landed card — shown after ≥5 sessions, hidden once submitted */}
      {hasData && hasJobLandedCard && (
        <div
          className="rounded-xl p-4 flex items-center justify-between gap-4 flex-wrap border"
          style={{ background: 'var(--success-dim)', borderColor: 'var(--success)' }}
        >
          <div className="flex items-center gap-3">
            <Trophy className="w-5 h-5 flex-shrink-0" style={{ color: 'var(--success)' }} />
            <div>
              <div className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>
                🎉 Did Vachix help you land a job?
              </div>
              <div className="text-xs mt-0.5" style={{ color: 'var(--text-2)' }}>
                Share your win — inspire thousands of other candidates.
              </div>
            </div>
          </div>
          <button
            onClick={() => setShowJobLandedModal(true)}
            className="text-xs font-bold px-4 py-2 rounded-lg whitespace-nowrap"
            style={{ background: 'var(--success)', color: '#fff' }}
          >
            I Got the Job! 🚀
          </button>
        </div>
      )}

      {/* Job Landed modal */}
      {showJobLandedModal && (
        <JobLandedModal
          onClose={() => setShowJobLandedModal(false)}
          userName={user?.name ?? 'User'}
        />
      )}

    </div>
  );
}
