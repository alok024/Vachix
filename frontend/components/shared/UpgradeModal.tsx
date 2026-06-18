'use client';

import { useUIStore } from '@/store/ui';
import { useAuthStore } from '@/store/auth';
import { useCreateOrder, useVerifyPayment } from '@/features/payment/hooks';
import { useMe } from '@/features/user/hooks';
import { extractErrorMessage } from '@/lib/api';
import { Button, Badge, Spinner } from '@/components/ui';
import { X, Infinity, History, BarChart, Zap, Crown, Diamond } from 'lucide-react';
import { useState } from 'react';

declare global {
  interface Window {
    Razorpay: new (options: RazorpayOptions) => { open: () => void };
  }
}

interface RazorpayOptions {
  key: string; amount: number; currency: string; order_id: string;
  name: string; description: string;
  prefill: { email: string; name: string };
  theme: { color: string };
  handler: (response: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) => void;
  modal: { ondismiss: () => void };
}

const FEATURES = [
  { icon: Infinity, label: 'Unlimited AI interview sessions' },
  { icon: History,  label: 'Full session history & progress' },
  { icon: BarChart, label: 'Advanced analytics & weak-area coaching' },
  { icon: Zap,      label: 'Priority AI response speed' },
];

const REASON_MSGS: Record<string, string> = {
  limit_hit:       '🚫 You\'ve reached your free session limit',
  voice_fallback:  '🔊 HD voice requires Pro',
  feature_lock:    '🔒 This feature is available on Pro',
  session_end:     '✨ You\'re on a roll — keep practicing!',
  strip:           '⚡ Running low on sessions',
  nudge:           '🚀 You\'re improving fast!',
};

export function UpgradeModal() {
  const { upgradeModalOpen, upgradeTrigger, closeUpgradeModal, showToast } = useUIStore();
  const { user }         = useAuthStore();
  const [error, setError]   = useState('');
  const [loading, setLoading] = useState<'pro' | 'elite' | null>(null);

  const createOrder   = useCreateOrder();
  const verifyPayment = useVerifyPayment();
  const { data: meData } = useMe();

  if (!upgradeModalOpen) return null;

  const calls      = meData?.usage?.ai_calls ?? user?.ai_calls ?? 0;
  const FREE_LIMIT = meData?.usage?.limit ?? user?.ai_calls_limit ?? null;

  async function handleUpgrade(plan: 'pro' | 'elite') {
    setError('');
    setLoading(plan);
    try {
      const res = await createOrder.mutateAsync(plan);
      if (!res.ok) { setError(extractErrorMessage(res.error)); setLoading(null); return; }

      const { order_id, amount, currency, key } = res.data;

      if (!window.Razorpay) {
        await new Promise<void>((resolve, reject) => {
          const s = document.createElement('script');
          s.src = 'https://checkout.razorpay.com/v1/checkout.js';
          s.onload = () => resolve();
          s.onerror = () => reject(new Error('Failed to load Razorpay'));
          document.head.appendChild(s);
        });
      }

      const rzp = new window.Razorpay({
        key, amount, currency, order_id,
        name: 'Vachix',
        description: `${plan === 'pro' ? 'Pro' : 'Elite'} Plan — ₹${plan === 'pro' ? '299' : '599'}/month`,
        prefill: { email: user?.email ?? '', name: user?.name ?? '' },
        // Accent from the brand, not hardcoded blue
        theme: { color: '#9b7fff' },
        handler: async (response) => {
          const vRes = await verifyPayment.mutateAsync({ ...response, plan });
          if (vRes.ok) {
            showToast('🎉 Welcome to Pro! Your account has been upgraded.', { duration: 8000 });
            closeUpgradeModal();
          } else {
            setError('Payment succeeded but verification failed. Contact support.');
          }
          setLoading(null);
        },
        modal: { ondismiss: () => setLoading(null) },
      });
      rzp.open();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
      setLoading(null);
    }
  }

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(10px)' }}>
      <div
        className="rounded-2xl p-5 sm:p-8 w-full max-w-md relative max-h-[90vh] overflow-y-auto"
        style={{ background: 'var(--surface)', border: '1px solid var(--border2)', boxShadow: 'var(--card-shadow)' }}
      >
        {/* Close */}
        <button
          onClick={closeUpgradeModal}
          className="absolute top-4 right-4 w-8 h-8 rounded-full flex items-center justify-center transition-colors"
          style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-3)' }}
          onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-1)')}
          onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-3)')}
        >
          <X className="w-3.5 h-3.5" />
        </button>

        {/* Header */}
        <div className="text-center mb-6">
          <span className="text-4xl mb-3 block">🚀</span>
          <h2 className="text-xl font-bold mb-3" style={{ color: 'var(--text-1)' }}>Upgrade to Pro</h2>

          {/* Usage display */}
          <div
            className="inline-flex items-center gap-2 rounded-xl px-4 py-2 mb-3"
            style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
          >
            <span className="text-xl font-bold tabular-nums" style={{ color: 'var(--accent)' }}>{calls}</span>
            <span className="text-sm" style={{ color: 'var(--text-3)' }}>of {FREE_LIMIT ?? '∞'} free sessions used</span>
          </div>

          {upgradeTrigger && REASON_MSGS[upgradeTrigger] && (
            <p
              className="text-sm rounded-xl px-3 py-2"
              style={{ color: 'var(--violet)', background: 'var(--violet-dim)', border: '1px solid var(--violet-border)' }}
            >
              {REASON_MSGS[upgradeTrigger]}
            </p>
          )}
        </div>

        {/* Features list */}
        <p className="text-sm text-center mb-5" style={{ color: 'var(--text-3)' }}>
          Upgrade for <strong style={{ color: 'var(--text-1)' }}>unlimited AI interviews</strong> and unlock your full potential.
        </p>
        <div className="space-y-2 mb-6">
          {FEATURES.map((f) => (
            <div
              key={f.label}
              className="flex items-center gap-3 text-sm rounded-xl px-3 py-2.5"
              style={{ background: 'var(--surface-2)', color: 'var(--text-2)' }}
            >
              <f.icon className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--emerald)' }} />
              {f.label}
            </div>
          ))}
        </div>

        {error && (
          <p
            className="text-sm rounded-xl px-3 py-2 mb-4 text-center"
            style={{ color: 'var(--error)', background: 'var(--error-dim)', border: '1px solid var(--error-border)' }}
          >
            {error}
          </p>
        )}

        {/* CTAs */}
        <div className="space-y-3">
          <Button variant="upgrade" size="lg" className="w-full" loading={loading === 'pro'} disabled={!!loading} onClick={() => handleUpgrade('pro')}>
            <Crown className="w-4 h-4" />
            Pro — ₹299/month · Unlimited + AI Chat
          </Button>
          <Button variant="upgrade" size="lg" className="w-full" loading={loading === 'elite'} disabled={!!loading} onClick={() => handleUpgrade('elite')}>
            <Diamond className="w-4 h-4" />
            Elite — ₹599/month · Everything + Priority AI
          </Button>
        </div>

        <button
          onClick={closeUpgradeModal}
          className="w-full mt-4 text-xs transition-colors"
          style={{ color: 'var(--text-3)' }}
          onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-2)')}
          onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-3)')}
        >
          Maybe later
        </button>
      </div>
    </div>
  );
}
