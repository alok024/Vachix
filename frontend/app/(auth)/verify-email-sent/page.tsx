'use client';

/**
 * app/(auth)/verify-email-sent/page.tsx
 *
 * Landing page right after successful registration.
 * Tells the user to check their inbox before trying to log in.
 *
 * Route: /verify-email-sent?email=user@example.com
 *
 * Why this page exists:
 *   The backend requires email_verified=true before login succeeds (403
 *   email_not_verified). Previously the register page redirected straight
 *   to /dashboard, which bounced back to /login because the account was
 *   unverified — users had no idea why they couldn't get in.
 */

import { useState, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { authApi } from '@/features/auth/api';

function VerifyEmailSentInner() {
  const params = useSearchParams();
  const email  = params.get('email') ?? '';

  const [sending,  setSending]  = useState(false);
  const [resent,   setResent]   = useState(false);
  const [resendErr, setResendErr] = useState('');

  async function handleResend() {
    if (!email || sending) return;
    setSending(true);
    setResendErr('');
    const res = await authApi.resendVerification(email);
    setSending(false);
    if (res.ok) {
      setResent(true);
    } else {
      // Backend returns the same success message even on rate-limit to avoid
      // enumeration — but a network/server error will land here.
      setResendErr('Could not resend. Please wait a minute and try again.');
    }
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--bg)', color: 'var(--text-1)', fontFamily: 'var(--sans)',
      padding: '24px',
    }}>
      <div style={{
        width: '100%', maxWidth: 420,
        background: 'var(--surface)', border: '1px solid var(--border2)',
        borderRadius: 20, padding: '40px 36px', boxShadow: 'var(--card-shadow)',
        textAlign: 'center',
      }}>
        {/* Icon */}
        <div style={{
          width: 64, height: 64, borderRadius: '50%',
          background: 'var(--violet-dim)', border: '1px solid var(--violet-border)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 28, margin: '0 auto 20px',
        }}>
          ✉️
        </div>

        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-1)', marginBottom: 10 }}>
          Check your inbox
        </h1>

        <p style={{ fontSize: 14, color: 'var(--text-2)', lineHeight: 1.6, marginBottom: 8 }}>
          We sent a verification link to
        </p>
        {email && (
          <p style={{
            fontSize: 14, fontWeight: 600, color: 'var(--accent)',
            wordBreak: 'break-all', marginBottom: 20,
          }}>
            {email}
          </p>
        )}

        <p style={{ fontSize: 13, color: 'var(--text-3)', lineHeight: 1.6, marginBottom: 28 }}>
          Click the link in that email to verify your account, then come back to sign in.
          The link expires in 24 hours.
        </p>

        {/* Resend section */}
        <div style={{
          background: 'var(--surface-2)', borderRadius: 12,
          padding: '16px', marginBottom: 24,
        }}>
          <p style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 10 }}>
            Didn&apos;t get the email? Check your spam folder, or&hellip;
          </p>

          {resent ? (
            <p style={{ fontSize: 13, color: 'var(--success)', fontWeight: 600 }}>
              ✓ Verification email resent!
            </p>
          ) : (
            <button
              onClick={handleResend}
              disabled={sending || !email}
              style={{
                width: '100%', height: 38, borderRadius: 8, border: '1px solid var(--border2)',
                background: 'transparent', color: 'var(--text-1)', fontSize: 13,
                cursor: sending || !email ? 'not-allowed' : 'pointer',
                opacity: sending || !email ? 0.5 : 1,
                transition: 'opacity .2s',
              }}
            >
              {sending ? 'Sending…' : 'Resend verification email'}
            </button>
          )}

          {resendErr && (
            <p style={{ fontSize: 12, color: 'var(--error)', marginTop: 8 }}>
              {resendErr}
            </p>
          )}
        </div>

        <Link
          href="/login"
          style={{
            display: 'block', height: 44, lineHeight: '44px',
            borderRadius: 10, textDecoration: 'none', textAlign: 'center',
            background: 'linear-gradient(135deg,var(--violet),var(--gold))',
            color: '#fff', fontSize: 14, fontWeight: 700,
          }}
        >
          Go to sign in →
        </Link>
      </div>
    </div>
  );
}

export default function VerifyEmailSentPage() {
  return (
    <Suspense fallback={<div />}>
      <VerifyEmailSentInner />
    </Suspense>
  );
}
