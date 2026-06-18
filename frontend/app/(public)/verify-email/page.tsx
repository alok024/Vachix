'use client';

/**
 * app/(public)/verify-email/page.tsx
 *
 * Migrated from backend/public/verify-email.html.
 * Route: /verify-email?token=<token>&signup=1
 */

import { useEffect, useRef, useState , Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { authApi } from '@/features/auth/api';

type Status = 'loading' | 'success' | 'error' | 'resend';

function VerifyEmailPageInner() {
  const params   = useSearchParams();
  const router   = useRouter();
  const token    = params.get('token') ?? '';
  const isSignup = params.get('signup') === '1';

  const [status,  setStatus]  = useState<Status>('loading');
  const [message, setMessage] = useState('');
  const [email,   setEmail]   = useState('');
  const [sending, setSending] = useState(false);
  // Bug 5 fix: expose a cancel function so user can dismiss the auto-redirect
  const [cancelled, setCancelled] = useState(false);
  // Bug 10 fix: the timer id needs to be reachable from the "Cancel redirect"
  // button's click handler, which runs long after this effect has settled —
  // a ref (not a `let` in the effect closure) is the only thing that stays
  // up to date for both the effect's cleanup and the button handler.
  const redirectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!token) {
      setStatus('error');
      setMessage('Missing verification token.');
      return;
    }

    authApi.verifyEmail(token).then((res) => {
      if (res.ok) {
        setStatus('success');
        // Bug 10 fix: store the timeout id on the ref (not a local closure
        // variable) so "Cancel redirect" can clearTimeout it directly.
        redirectTimerRef.current = setTimeout(() => {
          router.push('/login');
        }, 3000);
      } else {
        setStatus('error');
        setMessage('Verification failed. The link may have expired.');
      }
    });

    // Bug 10 fix: cleanup — cancel the redirect if the component unmounts
    // before the 3 s fires (e.g. user navigates away manually)
    return () => {
      if (redirectTimerRef.current !== null) clearTimeout(redirectTimerRef.current);
    };
  }, [token, router]);

  const handleResend = async () => {
    if (!email.trim()) return;
    setSending(true);
    const res = await authApi.resendVerification(email.trim());
    setSending(false);
    if (res.ok) {
      setMessage('Verification email sent! Check your inbox.');
    } else {
      setMessage('Failed to resend. Please try again.');
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#06080F] px-4">
      <div className="w-full max-w-sm rounded-2xl border border-white/[0.07] bg-[#0D0F1A] p-8 text-center space-y-4">
        <a href="/" className="text-2xl font-extrabold tracking-tight">
          Speak<span className="text-[#4F8EF7]">Smart</span>
        </a>

        {status === 'loading' && (
          <>
            <div className="mx-auto h-10 w-10 animate-spin rounded-full border-2 border-white/10 border-t-[#4F8EF7]" />
            <p className="text-white/60 text-sm">Verifying your email…</p>
          </>
        )}

        {status === 'success' && (
          <>
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/15 text-3xl">✓</div>
            <p className="font-semibold text-white">Email verified!</p>
            {cancelled ? (
              <a href="/login" className="inline-block w-full rounded-lg bg-[#4F8EF7] py-2 text-sm font-semibold text-white">
                Go to Login
              </a>
            ) : (
              <>
                <p className="text-sm text-white/50">
                  {isSignup ? 'Welcome to Vachix! ' : ''}Redirecting to login in 3 s…
                </p>
                <button
                  onClick={() => {
                    if (redirectTimerRef.current !== null) {
                      clearTimeout(redirectTimerRef.current);
                      redirectTimerRef.current = null;
                    }
                    setCancelled(true);
                  }}
                  className="text-xs text-white/30 hover:text-white/60 transition-colors"
                >
                  Cancel redirect
                </button>
              </>
            )}
          </>
        )}

        {status === 'error' && (
          <>
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-red-500/15 text-3xl">✗</div>
            <p className="font-semibold text-white">{message || 'Verification failed'}</p>
            <div className="space-y-2 pt-2">
              <p className="text-xs text-white/40">Enter your email to resend:</p>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full rounded-lg border border-white/10 bg-white/[0.05] px-3 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:border-[#4F8EF7]"
              />
              <button
                onClick={handleResend}
                disabled={sending || !email.trim()}
                className="w-full rounded-lg bg-[#4F8EF7] py-2 text-sm font-semibold disabled:opacity-50 transition-opacity"
              >
                {sending ? 'Sending…' : 'Resend Verification Email'}
              </button>
              {message && <p className="text-xs text-emerald-400">{message}</p>}
            </div>
          </>
        )}
      </div>
    </main>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<div />}>
      <VerifyEmailPageInner />
    </Suspense>
  );
}
