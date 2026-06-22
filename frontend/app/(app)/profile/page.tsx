'use client';

import { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useMe, useLogout } from '@/hooks/queries';
import { useCompleteOnboarding } from '@/features/user/hooks';
import { useAuthStore } from '@/store/auth';
import { useUIStore } from '@/store/ui';
import { Button, Card, CardHeader, CardBody, Badge, ProgressBar, Spinner } from '@/components/ui';
import { formatDate } from '@/lib/utils';
import { LogOut, Crown, Diamond, Zap } from 'lucide-react';
import { QK } from '@/lib/query-keys';

const PROFESSIONS = [
  'Software Engineering', 'Data Science / AI', 'Product Management', 'Business Analyst',
  'Marketing', 'Finance / Banking', 'HR / Recruiting', 'Sales', 'Operations', 'Other',
];

const GOALS = [
  'Get my first job', 'Switch companies', 'Get promoted', 'Improve confidence', 'Practice regularly',
];

function OnboardingForm({ onDone }: { onDone: () => void }) {
  const [profession, setProfession] = useState('');
  const [goal, setGoal] = useState('');
  const [error, setError] = useState('');
  const completeOnboarding = useCompleteOnboarding();

  async function handleSubmit() {
    if (!profession || !goal) { setError('Please select both a field and a goal.'); return; }
    setError('');
    const res = await completeOnboarding.mutateAsync({ profession, goal });
    if (res.ok) onDone();
    else setError('Something went wrong. Please try again.');
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: 'var(--bg)' }}>
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <div className="text-3xl mb-2">👋</div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-1)' }}>Welcome to Vachix</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-3)' }}>Tell us about yourself so we can personalise your practice.</p>
        </div>

        <Card className="p-5">
          <div className="text-sm font-semibold mb-3" style={{ color: 'var(--text-1)' }}>What's your field?</div>
          <div className="grid grid-cols-2 gap-2">
            {PROFESSIONS.map((p) => (
              <button
                key={p}
                onClick={() => setProfession(p)}
                className="text-sm px-3 py-2 rounded-lg border transition-all text-left"
                style={profession === p
                  ? { borderColor: 'var(--accent-border)', background: 'var(--accent-dim)', color: 'var(--text-1)' }
                  : { borderColor: 'var(--border)', background: 'transparent', color: 'var(--text-2)' }}
              >
                {p}
              </button>
            ))}
          </div>
        </Card>

        <Card className="p-5">
          <div className="text-sm font-semibold mb-3" style={{ color: 'var(--text-1)' }}>What's your main goal?</div>
          <div className="space-y-2">
            {GOALS.map((g) => (
              <button
                key={g}
                onClick={() => setGoal(g)}
                className="w-full text-sm px-4 py-2.5 rounded-lg border transition-all text-left"
                style={goal === g
                  ? { borderColor: 'var(--accent-border)', background: 'var(--accent-dim)', color: 'var(--text-1)' }
                  : { borderColor: 'var(--border)', background: 'transparent', color: 'var(--text-2)' }}
              >
                {g}
              </button>
            ))}
          </div>
        </Card>

        {error && <p className="text-xs text-center" style={{ color: 'var(--error)' }}>{error}</p>}

        <Button className="w-full" onClick={handleSubmit} loading={completeOnboarding.isPending} disabled={!profession || !goal}>
          Get Started →
        </Button>
      </div>
    </div>
  );
}

function ProfilePageInner() {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const qc           = useQueryClient();
  const { user }     = useAuthStore();
  const { showUpgradeModal } = useUIStore();
  const { data: meData, isLoading } = useMe();
  const logout       = useLogout();

  const isOnboarding = searchParams.get('onboarding') === '1' && !meData?.onboarding?.completed;
  const stats        = meData?.stats;
  const usage        = meData?.usage;
  const isFree       = !user || (user.plan === 'free');
  const isStarter    = user?.plan === 'starter';
  const isProOrElite = user?.plan === 'pro' || user?.plan === 'elite';
  // Starter shares Free's finite, trackable session cap (30/month) —
  // unlike Pro/Elite, which are unlimited — so both should see the usage
  // bar and an upsell CTA. Only Pro/Elite are truly "unlimited, nothing
  // more to show usage for".
  const hasUsageCap  = isFree || isStarter;
  const FREE_LIMIT   = usage?.limit ?? user?.ai_calls_limit ?? null;
  const aiUsed       = usage?.ai_calls ?? 0;
  const aiRemaining  = usage?.remaining ?? user?.ai_calls_remaining ?? null;

  const planLabel        = user?.plan === 'elite' ? '◈ Elite' : user?.plan === 'pro' ? '✦ Pro' : user?.plan === 'starter' ? '⚡ Starter' : 'Free';
  const planBadgeVariant = (user?.plan === 'elite' ? 'elite' : user?.plan === 'pro' ? 'pro' : user?.plan === 'starter' ? 'starter' : 'free') as any;

  async function handleLogout() {
    await logout.mutateAsync();
    qc.clear();
    router.push('/login');
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner size={28} style={{ color: 'var(--accent)' }} />
      </div>
    );
  }

  if (isOnboarding) return <OnboardingForm onDone={() => { qc.invalidateQueries({ queryKey: QK.me }); router.replace('/dashboard'); }} />;

  return (
    <div className="p-4 sm:p-6 max-w-2xl mx-auto space-y-5">
      <h1 className="text-2xl font-bold" style={{ color: 'var(--text-1)' }}>Profile & Plan</h1>

      {/* User card */}
      <Card className="p-5">
        <div className="flex items-center gap-4">
          <div
            className="w-14 h-14 rounded-2xl flex items-center justify-center text-xl font-bold"
            style={{ background: 'var(--blue)', color: '#fff' }}
          >
            {(user?.name?.[0] ?? user?.email?.[0] ?? '?').toUpperCase()}
          </div>
          <div>
            <div className="text-lg font-bold" style={{ color: 'var(--text-1)' }}>{user?.name ?? '—'}</div>
            <div className="text-sm" style={{ color: 'var(--text-3)' }}>{user?.email}</div>
            <Badge variant={planBadgeVariant} className="mt-1">{planLabel} Plan</Badge>
          </div>
        </div>
      </Card>

      {/* Stats */}
      {stats && (
        <Card>
          <CardHeader><span className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>Your Stats</span></CardHeader>
          <CardBody>
            <div className="grid grid-cols-3 gap-4 text-center">
              {[
                { value: stats.streak, sub: 'Day streak 🔥', color: 'var(--warn)' },
                { value: stats.sessions, sub: 'Sessions', color: 'var(--accent)' },
                { value: `${stats.best_score ?? '—'}/10`, sub: 'Best score', color: 'var(--success)' },
              ].map((s, i) => (
                <div key={i}>
                  <div className="text-2xl font-bold tabular-nums" style={{ color: s.color }}>{s.value}</div>
                  <div className="text-xs" style={{ color: 'var(--text-3)' }}>{s.sub}</div>
                </div>
              ))}
            </div>
          </CardBody>
        </Card>
      )}

      {/* Usage — anyone with a finite session cap (Free, Starter) */}
      {hasUsageCap && (
        <Card className="p-5">
          <div className="flex justify-between items-center mb-2">
            <span className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>AI Sessions</span>
            <span className="text-sm font-bold" style={{ color: 'var(--text-1)' }}>{aiUsed}{FREE_LIMIT ? ` / ${FREE_LIMIT}` : ''}</span>
          </div>
          <ProgressBar
            value={aiUsed}
            max={FREE_LIMIT ?? aiUsed + 1}
            color={FREE_LIMIT && aiUsed >= FREE_LIMIT ? 'var(--error)' : FREE_LIMIT && aiUsed >= FREE_LIMIT * 0.7 ? 'var(--warn)' : 'var(--accent)'}
            animated
            className="mb-2"
          />
          <p className="text-xs" style={{ color: 'var(--text-3)' }}>
            {aiRemaining != null
              ? aiRemaining > 0 ? `${aiRemaining} session${aiRemaining !== 1 ? 's' : ''} remaining.` : 'All sessions used for this period.'
              : 'Check usage in your dashboard.'}
          </p>
        </Card>
      )}

      {/* Upgrade CTA — free users see Starter + Pro + Elite; Starter users see Pro + Elite */}
      {hasUsageCap && (
        <Card className="p-5" style={{ borderColor: 'var(--blue-border)' }}>
          <div className="text-sm font-bold mb-1" style={{ color: 'var(--text-1)' }}>🚀 Unlock unlimited practice</div>
          <p className="text-xs mb-4" style={{ color: 'var(--text-3)' }}>
            {isStarter
              ? 'Upgrade to Pro for unlimited AI sessions, full session history, and HD voice.'
              : 'Choose a plan to get more sessions, HD voice, and advanced analytics.'}
          </p>
          <div className="space-y-2">
            {/* Starter option — only shown to Free users */}
            {isFree && (
              <Button variant="upgrade" className="w-full" onClick={() => showUpgradeModal('strip')}>
                <Zap className="w-4 h-4" />
                Starter — ₹299/month
              </Button>
            )}
            <Button variant="upgrade" className="w-full" onClick={() => showUpgradeModal('strip')}>
              <Crown className="w-4 h-4" />
              Pro — ₹699/month
            </Button>
            <Button variant="upgrade" className="w-full" onClick={() => showUpgradeModal('strip')}>
              <Diamond className="w-4 h-4" />
              Elite — ₹1,299/month
            </Button>
          </div>
        </Card>
      )}

      {/* Starter plan — active features, accurate to what Starter actually includes */}
      {isStarter && (
        <Card className="p-5">
          <div className="text-sm font-semibold mb-3" style={{ color: 'var(--text-1)' }}>⚡ Starter Plan Active</div>
          <ul className="space-y-2 text-sm" style={{ color: 'var(--text-2)' }}>
            {['30 AI interview sessions/month', 'All 11 exam tracks', 'Elara English correction', 'Grammar & Fluency scoring', 'AI memory on your mistakes', 'HD voice — 10 min/month'].map((f) => (
              <li key={f} className="flex items-center gap-2">
                <span style={{ color: 'var(--success)' }}>✓</span> {f}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Pro/Elite features */}
      {isProOrElite && (
        <Card className="p-5">
          <div className="text-sm font-semibold mb-3" style={{ color: 'var(--text-1)' }}>
            {user?.plan === 'elite' ? '◈ Elite Plan Active' : '✦ Pro Plan Active'}
          </div>
          <ul className="space-y-2 text-sm" style={{ color: 'var(--text-2)' }}>
            {['Unlimited AI interview sessions', 'Full session history & progress tracking', 'Advanced analytics & weak-area coaching']
              .concat(user?.plan === 'elite' ? ['Priority AI response speed'] : [])
              .map((f) => (
                <li key={f} className="flex items-center gap-2">
                  <span style={{ color: 'var(--success)' }}>✓</span> {f}
                </li>
              ))}
          </ul>
        </Card>
      )}

      {/* Goals */}
      {meData?.onboarding?.completed && (
        <Card className="p-5">
          <div className="text-sm font-semibold mb-3" style={{ color: 'var(--text-1)' }}>Your Goals</div>
          {meData.onboarding.profession && (
            <div className="flex justify-between text-sm mb-1">
              <span style={{ color: 'var(--text-3)' }}>Field</span>
              <span style={{ color: 'var(--text-1)' }}>{meData.onboarding.profession}</span>
            </div>
          )}
          {meData.onboarding.goal && (
            <div className="flex justify-between text-sm">
              <span style={{ color: 'var(--text-3)' }}>Goal</span>
              <span style={{ color: 'var(--text-1)' }}>{meData.onboarding.goal}</span>
            </div>
          )}
        </Card>
      )}

      {user?.created_at && (
        <p className="text-xs text-center" style={{ color: 'var(--text-3)' }}>
          Member since {formatDate(user.created_at)}
        </p>
      )}

      <Button variant="danger" className="w-full" onClick={handleLogout} loading={logout.isPending}>
        <LogOut className="w-4 h-4" /> Sign Out
      </Button>
    </div>
  );
}

export default function ProfilePage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center h-64">
        <Spinner size={28} style={{ color: 'var(--accent)' }} />
      </div>
    }>
      <ProfilePageInner />
    </Suspense>
  );
}
