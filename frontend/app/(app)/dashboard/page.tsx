'use client';

import React from 'react';
/**
 * app/(app)/dashboard/page.tsx — fully CSS-var themed, no hardcoded hex.
 */

import { useRouter } from 'next/navigation';
import { useMe } from '@/features/user/hooks';
import { useScoreHistory } from '@/features/analytics/hooks';
import { useAuthStore } from '@/store/auth';
import { useUIStore } from '@/store/ui';
import { ProgressBar, Spinner, ScoreRing } from '@/components/ui';
import { formatDate, scoreColor } from '@/lib/utils';
import { Target, Zap, TrendingUp } from 'lucide-react';

const QUICK_STARTS = [
  { label: 'Software Dev',      desc: 'AI Chat · Friendly',   emoji: '💻', profession: 'Software Developer',        mode: 'chat' },
  { label: 'Bank PO',           desc: 'AI Chat · Technical',  emoji: '🏦', profession: 'Bank PO',                  mode: 'chat' },
  { label: 'Govt / SSC / UPSC', desc: 'Classic · Behavioral', emoji: '🏛️', profession: 'Government Job (SSC/UPSC)', mode: 'classic' },
];

function ScorePill({ score }: { score: number }) {
  const [bg, fg] =
    score >= 7 ? ['var(--success-dim)', 'var(--success)'] :
    score >= 5 ? ['var(--warn-dim)',    'var(--warn)']    :
                 ['var(--error-dim)',   'var(--error)'];
  return (
    <span className="text-xs font-bold px-2 py-0.5 rounded-md" style={{ background: bg, color: fg }}>
      {score}/10
    </span>
  );
}

export default function DashboardPage() {
  const { user }            = useAuthStore();
  const { showUpgradeModal } = useUIStore();
  const router              = useRouter();
  const { data: meData, isLoading } = useMe();
  const { data: history }   = useScoreHistory(10);

  const stats        = meData?.stats;
  const usage        = meData?.usage;
  const jobReadiness = meData?.job_readiness;
  const weakAreas    = meData?.weak_areas ?? [];
  const isFree       = !user || (user.plan !== 'pro' && user.plan !== 'elite');
  const FREE_LIMIT   = usage?.limit ?? user?.ai_calls_limit ?? null;
  const aiUsed       = usage?.ai_calls ?? 0;
  const aiRemaining  = usage?.remaining ?? user?.ai_calls_remaining ?? null;
  const usagePct     = FREE_LIMIT ? Math.min(100, Math.round((aiUsed / FREE_LIMIT) * 100)) : 0;
  const name         = user?.name?.split(' ')[0] || 'there';
  const hasData      = (stats?.sessions ?? 0) > 0;

  function handleQuickStart(profession: string, mode: string) {
    router.push(`/interview/setup?profession=${encodeURIComponent(profession)}&mode=${mode}`);
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

      {/* Greeting */}
      <div>
        <h1 className="text-xl font-bold" style={{ color: 'var(--text-1)', letterSpacing: '-0.02em' }}>
          Welcome back, {name} 👋
        </h1>
        <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>Here's where you stand today.</p>
      </div>

      {/* Empty state */}
      {!hasData && (
        <div className="rounded-2xl p-8 text-center border" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
          <div className="text-5xl mb-4">🎙️</div>
          <h2 className="text-xl font-extrabold mb-2" style={{ color: 'var(--text-1)' }}>
            In 10 minutes, you'll know your{' '}
            <span style={{ background: 'linear-gradient(135deg,var(--violet),var(--gold))', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
              exact weak areas
            </span>
          </h2>
          <p className="text-sm max-w-sm mx-auto mb-6 leading-relaxed" style={{ color: 'var(--text-2)' }}>
            Most candidates fail interviews without knowing why. Vachix shows you{' '}
            <strong style={{ color: 'var(--text-1)' }}>exactly what to fix</strong> — before your next real interview.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 rounded-2xl overflow-hidden mb-6 max-w-md mx-auto border"
            style={{ background: 'var(--surface-2)', borderColor: 'var(--border)' }}>
            {[
              { emoji: '🎯', title: 'Know your score',   sub: 'Ranked vs 10,000+ users' },
              { emoji: '🤖', title: 'AI pinpoints gaps', sub: 'Live feedback, every answer' },
              { emoji: '📈', title: 'Track improvement', sub: 'Session-by-session chart' },
            ].map((b, i) => (
              <div key={b.title} className="py-4 px-2 text-center" style={{ borderRight: i < 2 ? '1px solid var(--border)' : 'none' }}>
                <div className="text-xl mb-1">{b.emoji}</div>
                <div className="text-xs font-bold mb-0.5" style={{ color: 'var(--text-1)' }}>{b.title}</div>
                <div className="text-[10px]" style={{ color: 'var(--text-3)' }}>{b.sub}</div>
              </div>
            ))}
          </div>
          <button
            onClick={() => router.push('/interview/setup')}
            className="px-6 py-3 rounded-xl text-sm font-bold text-white transition-opacity hover:opacity-90"
            style={{ background: 'linear-gradient(135deg,var(--violet),var(--gold))' }}
          >
            Start My First Interview Now
          </button>
          <p className="text-xs mt-3" style={{ color: 'var(--text-3)' }}>Free · No credit card · Results in under 10 mins</p>
        </div>
      )}

      {/* Stats row */}
      {hasData && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Streak',      value: stats?.streak ?? 0,                                         sub: 'days 🔥',           color: 'var(--warn)' },
            { label: 'Sessions',    value: stats?.sessions ?? 0,                                       sub: 'completed',          color: 'var(--accent)' },
            { label: 'Best Score',  value: stats?.best_score != null ? `${stats.best_score}/10` : '—', sub: 'personal best',      color: 'var(--emerald)' },
            { label: 'AI Sessions', value: aiUsed,                                                     sub: FREE_LIMIT ? `of ${FREE_LIMIT} used` : 'used', color: 'var(--violet)' },
          ].map((s: any) => (
            <div key={s.label} className="rounded-xl p-4 text-center border" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
              <div className="text-[10px] uppercase tracking-wide mb-1" style={{ color: 'var(--text-3)' }}>{s.label}</div>
              <div className="text-2xl font-bold tabular-nums" style={{ color: s.color, letterSpacing: '-0.03em' }}>{s.value}</div>
              <div className="text-[10px] mt-0.5" style={{ color: 'var(--text-3)' }}>{s.sub}</div>
            </div>
          ))}
        </div>
      )}

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
              {(history ?? []).slice(0, 4).map((s: any) => (
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
                  <ScorePill score={s.score} />
                </button>
              ))}
              {!history?.length && (
                <div className="px-4 py-8 text-center text-xs" style={{ color: 'var(--text-3)' }}>No sessions yet.</div>
              )}
            </div>
          </div>

          {/* Quick Start */}
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
                  className="w-full flex items-center gap-3 px-4 py-3 border-b text-left transition-colors last:border-0"
                  style={{ borderColor: 'var(--border)' }}
                  onMouseEnter={(e: React.MouseEvent<HTMLElement>) => (e.currentTarget.style.background = 'var(--surface-2)')}
                  onMouseLeave={(e: React.MouseEvent<HTMLElement>) => (e.currentTarget.style.background = 'transparent')}
                >
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center text-lg flex-shrink-0"
                    style={{ background: 'var(--accent-dim)' }}>
                    {qs.emoji}
                  </div>
                  <div>
                    <div className="text-xs font-semibold" style={{ color: 'var(--text-1)' }}>{qs.label}</div>
                    <div className="text-[10px]" style={{ color: 'var(--text-3)' }}>{qs.desc}</div>
                  </div>
                </button>
              ))}
              <button
                onClick={() => router.push('/interview/setup')}
                className="w-full flex items-center gap-3 px-4 py-3 text-left transition-colors"
                onMouseEnter={(e: React.MouseEvent<HTMLElement>) => (e.currentTarget.style.background = 'var(--surface-2)')}
                onMouseLeave={(e: React.MouseEvent<HTMLElement>) => (e.currentTarget.style.background = 'transparent')}
              >
                <div className="w-9 h-9 rounded-xl flex items-center justify-center text-lg flex-shrink-0"
                  style={{ background: 'var(--surface-3)' }}>
                  ✦
                </div>
                <div>
                  <div className="text-xs font-semibold" style={{ color: 'var(--accent)' }}>Browse all tracks →</div>
                  <div className="text-[10px]" style={{ color: 'var(--text-3)' }}>11 career tracks available</div>
                </div>
              </button>
            </div>
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

      {/* Weak Areas */}
      {weakAreas.length > 0 && (
        <div className="rounded-2xl border overflow-hidden" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
          <div className="flex items-center gap-2 px-4 py-3 border-b" style={{ borderColor: 'var(--border)' }}>
            <TrendingUp className="w-4 h-4" style={{ color: 'var(--error)' }} />
            <span className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>Areas to Improve</span>
          </div>
          <div className="px-4 py-4 space-y-4">
            {weakAreas.map((wa: any) => (
              <div key={wa.topic}>
                <ProgressBar
                  value={wa.avg_score}
                  max={10}
                  label={wa.topic}
                  showValue
                  animated
                  color={
                    wa.avg_score >= 7 ? 'var(--emerald)' :
                    wa.avg_score >= 5 ? 'var(--gold)' :
                    'var(--rose)'
                  }
              />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Upgrade strip */}
      {isFree && (stats?.sessions ?? 0) >= 3 && (
        <div className="rounded-xl p-4 flex items-center justify-between gap-4 flex-wrap border"
          style={{ background: 'var(--violet-dim)', borderColor: 'var(--violet-border)' }}>
          <div>
            <div className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>🚀 You're improving!</div>
            <div className="text-xs mt-0.5" style={{ color: 'var(--text-2)' }}>Unlock unlimited sessions to keep your momentum.</div>
          </div>
          <button
            onClick={() => showUpgradeModal('nudge')}
            className="text-xs font-bold text-white px-4 py-2 rounded-lg whitespace-nowrap"
            style={{ background: 'linear-gradient(135deg,var(--violet),var(--gold))' }}
          >
            Upgrade → ₹299/mo
          </button>
        </div>
      )}

    </div>
  );
}
