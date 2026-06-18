'use client';

import { useAuthStore } from '@/store/auth';
import { useReferral } from '@/features/user/hooks';
import { Card, CardHeader, CardBody, Button, Spinner } from '@/components/ui';
import { useUIStore } from '@/store/ui';
import { Gift, Users, Star, Zap } from 'lucide-react';

export default function ReferralPage() {
  const { user }   = useAuthStore();
  const { showToast } = useUIStore();
  const { data: referral, isLoading, isError } = useReferral();

  const referralUrl = referral?.code
    ? `${typeof window !== 'undefined' ? window.location.origin : 'https://vachix.in'}/register?ref=${referral.code}`
    : null;

  function copyLink() {
    if (!referralUrl) return;
    navigator.clipboard.writeText(referralUrl).then(() => showToast('🔗 Referral link copied!'));
  }

  function shareWhatsApp() {
    if (!referralUrl) return;
    window.open(`https://wa.me/?text=${encodeURIComponent(`Practice English & interviews with AI — free for Indian students & job seekers! Use my link: ${referralUrl}`)}`, '_blank');
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner size={28} style={{ color: 'var(--accent)' }} />
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 max-w-xl mx-auto space-y-5">

      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2" style={{ color: 'var(--text-1)' }}>
          <Gift className="w-6 h-6" style={{ color: 'var(--accent)' }} /> Refer & Earn
        </h1>
        <p className="text-sm mt-1" style={{ color: 'var(--text-3)' }}>
          Invite friends and get +1 free AI session for each person who joins.
        </p>
      </div>

      {/* How it works */}
      <Card>
        <CardHeader>
          <span className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>How it works</span>
        </CardHeader>
        <CardBody className="space-y-4">
          {[
            { icon: '🔗', title: 'Share your link',       desc: 'Send your unique referral link to friends, batchmates, or classmates.' },
            { icon: '✅', title: 'They join',              desc: 'They register using your link. No credit card required.' },
            { icon: '🎁', title: 'You earn a free session',desc: 'For each friend who joins, you get +1 bonus AI interview session.' },
          ].map((step) => (
            <div key={step.title} className="flex gap-3">
              <span className="text-xl mt-0.5 flex-shrink-0">{step.icon}</span>
              <div>
                <div className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>{step.title}</div>
                <div className="text-xs leading-relaxed mt-0.5" style={{ color: 'var(--text-3)' }}>{step.desc}</div>
              </div>
            </div>
          ))}
        </CardBody>
      </Card>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { icon: Users, label: 'Friends joined',  value: isError ? '—' : (referral?.uses ?? 0),        color: 'var(--accent)' },
          { icon: Star,  label: 'Rewarded',         value: isError ? '—' : (referral?.rewarded ?? 0),    color: 'var(--warn)' },
          { icon: Zap,   label: 'Bonus sessions',   value: isError ? '—' : (referral?.bonus_calls ?? 0), color: 'var(--emerald)' },
        ].map((s) => (
          <div key={s.label}>
          <Card className="p-4 text-center">
            <s.icon className="w-4 h-4 mx-auto mb-2" style={{ color: s.color }} />
            <div className="text-2xl font-bold tabular-nums" style={{ color: s.color }}>{String(s.value)}</div>
            <div className="text-[10px] mt-0.5" style={{ color: 'var(--text-3)' }}>{s.label}</div>
          </Card>
          </div>
        ))}
      </div>

      {/* Referral link card */}
      <Card className="p-5 space-y-3">
        <div className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-3)' }}>
          Your Referral Link
        </div>
        {referral?.code ? (
          <>
            <div className="flex gap-2">
              <div
                className="flex-1 px-3 py-2.5 rounded-xl text-xs truncate font-mono border"
                style={{ background: 'var(--surface-2)', borderColor: 'var(--border)', color: 'var(--text-2)' }}
              >
                {referralUrl}
              </div>
              <Button size="sm" onClick={copyLink}>Copy</Button>
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" className="flex-1" onClick={shareWhatsApp}>📱 WhatsApp</Button>
              <Button variant="secondary" size="sm" className="flex-1" onClick={copyLink}>🔗 Copy Link</Button>
            </div>
          </>
        ) : isError ? (
          <p className="text-sm" style={{ color: 'var(--error)' }}>Could not load referral data. Please refresh.</p>
        ) : (
          <p className="text-sm" style={{ color: 'var(--text-3)' }}>Referral code not available yet.</p>
        )}
      </Card>

      {/* Code chip */}
      {referral?.code && (
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs mb-1" style={{ color: 'var(--text-3)' }}>Your code</div>
              <div className="text-lg font-bold font-mono tracking-widest" style={{ color: 'var(--text-1)' }}>
                {referral.code}
              </div>
            </div>
            <Button
              variant="secondary" size="sm"
              onClick={() => { navigator.clipboard.writeText(referral.code); showToast('Code copied!'); }}
            >
              Copy Code
            </Button>
          </div>
        </Card>
      )}

      {/* Bonus banner */}
      {(referral?.bonus_calls ?? 0) > 0 && (
        <div
          className="rounded-2xl p-4 text-center"
          style={{ background: 'var(--success-dim)', border: '1px solid var(--success-border)' }}
        >
          <div className="font-bold" style={{ color: 'var(--success)' }}>
            🎉 You have {referral!.bonus_calls} bonus session{referral!.bonus_calls !== 1 ? 's' : ''} from referrals!
          </div>
          <div className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>
            These are added to your free session limit automatically.
          </div>
        </div>
      )}

    </div>
  );
}
