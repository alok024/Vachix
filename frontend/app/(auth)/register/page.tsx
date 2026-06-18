'use client';

import React from 'react';

/**
 * app/(auth)/register/page.tsx
 *
 * Register page — after successful registration the user is sent to
 * /verify-email-sent (NOT /dashboard) because the account requires
 * email verification before login is permitted.
 *
 * Previous bug: router.push('/dashboard') after register caused an
 * immediate middleware redirect back to /login because the new account
 * has email_verified=false and the backend rejects login with 403.
 */

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRegister } from '@/hooks/queries';
import { extractErrorMessage } from '@/lib/api';
import { Eye, EyeOff } from 'lucide-react';

const KEYFRAMES = `
@keyframes reg-fade-up { from{opacity:0;transform:translateY(14px)} to{opacity:1;transform:none} }
@keyframes reg-float-a { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-18px)} }
@keyframes reg-float-b { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-12px)} }
@media(prefers-reduced-motion:reduce){
  .reg-card,.reg-orb-1,.reg-orb-2{animation:none!important}
}
`;

function LogoMark({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      <defs>
        <linearGradient id="ssLG" x1="2" y1="2" x2="30" y2="30" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="var(--violet)" />
          <stop offset="1" stopColor="var(--gold)" />
        </linearGradient>
      </defs>
      <path d="M16 2C8.27 2 2 7.85 2 15.1c0 3.62 1.55 6.9 4.1 9.26-.18 1.84-.74 3.4-1.62 4.74-.2.3.05.7.4.64 2.4-.4 4.46-1.4 6.1-2.62 1.55.55 3.25.86 5.02.86 7.73 0 14-5.85 14-13.1S23.73 2 16 2Z" fill="url(#ssLG)" />
      <path d="M10.5 17.5c1.2 1.7 3.2 2.8 5.5 2.8s4.3-1.1 5.5-2.8" stroke="var(--bg)" strokeWidth="1.8" strokeLinecap="round" fill="none" />
      <circle cx="11.5" cy="13" r="1.6" fill="var(--bg)" />
      <circle cx="20.5" cy="13" r="1.6" fill="var(--bg)" />
    </svg>
  );
}

export default function RegisterPage() {
  const [name,     setName]     = useState('');
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [showPw,   setShowPw]   = useState(false);
  const [mounted,  setMounted]  = useState(false);

  const router   = useRouter();
  const register = useRegister();

  useEffect(() => { setTimeout(() => setMounted(true), 30); }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // FIX: No try/catch here — let React Query set isError so the error
    // banner above the form renders correctly.
    // FIX: Redirect to /verify-email-sent, NOT /dashboard. The account
    // requires email verification; going to /dashboard would immediately
    // bounce back to /login because the backend rejects unverified logins.
    await register.mutateAsync({ name, email, password });
    router.push(`/verify-email-sent?email=${encodeURIComponent(email)}`);
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg)', color: 'var(--text-1)', fontFamily: 'var(--sans)' }}>
      <style>{KEYFRAMES}</style>

      {/* Ambient */}
      <div style={{ position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none', overflow: 'hidden' }}>
        <div className="reg-orb-1" style={{ position: 'absolute', width: 480, height: 480, borderRadius: '50%', background: 'var(--violet)', opacity: .07, filter: 'blur(120px)', top: '-10%', right: '-8%', animation: 'reg-float-a 20s ease-in-out infinite' }} />
        <div className="reg-orb-2" style={{ position: 'absolute', width: 340, height: 340, borderRadius: '50%', background: 'var(--gold)', opacity: .06, filter: 'blur(110px)', bottom: '-8%', left: '-6%', animation: 'reg-float-b 24s ease-in-out infinite 4s' }} />
        <div style={{ position: 'absolute', inset: 0, backgroundImage: 'linear-gradient(var(--border) 1px,transparent 1px),linear-gradient(90deg,var(--border) 1px,transparent 1px)', backgroundSize: '72px 72px', WebkitMaskImage: 'radial-gradient(ellipse 80% 60% at 50% 0%,black,transparent 80%)', maskImage: 'radial-gradient(ellipse 80% 60% at 50% 0%,black,transparent 80%)', opacity: .5 }} />
      </div>

      {/* Nav */}
      <nav style={{ position: 'sticky', top: 0, zIndex: 20, height: 60, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 28px', borderBottom: '1px solid var(--border)', background: 'var(--nav-bg)', backdropFilter: 'blur(16px)' }}>
        <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: 8, textDecoration: 'none' }}>
          <LogoMark />
          <span style={{ fontFamily: 'var(--serif)', fontStyle: 'italic', fontSize: 15, fontWeight: 700, color: 'var(--text-1)' }}>
            Speak<span style={{ color: 'var(--accent)', fontStyle: 'normal' }}>Smart</span>
          </span>
        </Link>
        <Link href="/login" style={{ fontSize: 13, color: 'var(--text-2)', textDecoration: 'none' }}>
          Already have an account? <span style={{ color: 'var(--accent)', fontWeight: 600 }}>Sign in →</span>
        </Link>
      </nav>

      {/* Card */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '48px 24px', position: 'relative', zIndex: 1 }}>
        <div
          className="reg-card"
          style={{
            width: '100%', maxWidth: 420,
            background: 'var(--surface)', border: '1px solid var(--border2)',
            borderRadius: 20, padding: '40px 36px', boxShadow: 'var(--card-shadow)',
            opacity: mounted ? 1 : 0,
            animation: mounted ? 'reg-fade-up .45s ease both' : 'none',
          }}
        >
          {/* Header */}
          <div style={{ textAlign: 'center', marginBottom: 32 }}>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 14 }}>
              <LogoMark size={36} />
            </div>
            <h1 style={{ fontSize: 24, fontWeight: 700, color: 'var(--text-1)', marginBottom: 6 }}>
              Start for free
            </h1>
            <p style={{ fontSize: 13, color: 'var(--text-3)' }}>
              7 free sessions — no card required.
            </p>
          </div>

          {register.isError && (
            <div style={{ background: 'var(--error-dim)', border: '1px solid var(--error-border)', borderRadius: 10, padding: '10px 14px', marginBottom: 20, fontSize: 13, color: 'var(--error)' }}>
              {extractErrorMessage(register.error as any)}
            </div>
          )}

          <form onSubmit={handleSubmit} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <Field label="Your name">
              <input
                type="text" value={name} onChange={e => setName(e.target.value)}
                placeholder="Priya Sharma" required autoFocus autoComplete="name"
                style={inputStyle}
              />
            </Field>

            <Field label="Email address">
              <input
                type="email" value={email} onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com" required autoComplete="email"
                style={inputStyle}
              />
            </Field>

            <Field label="Password">
              <div style={{ position: 'relative' }}>
                <input
                  type={showPw ? 'text' : 'password'}
                  value={password} onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••" required autoComplete="new-password"
                  style={{ ...inputStyle, paddingRight: 40 }}
                />
                <button
                  type="button" onClick={() => setShowPw(v => !v)}
                  style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)', padding: 4 }}
                >
                  {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </Field>

            <button
              type="submit"
              disabled={register.isPending}
              style={{
                marginTop: 4, height: 44, borderRadius: 10, border: 'none',
                cursor: register.isPending ? 'not-allowed' : 'pointer',
                background: 'linear-gradient(135deg,var(--violet),var(--gold))',
                color: '#fff', fontSize: 14, fontWeight: 700, opacity: register.isPending ? .7 : 1,
                transition: 'opacity .2s',
              }}
            >
              {register.isPending ? 'Creating account…' : 'Get 7 free sessions →'}
            </button>
          </form>

          <p style={{ textAlign: 'center', fontSize: 11, color: 'var(--text-3)', marginTop: 20, lineHeight: 1.5 }}>
            By signing up you agree to our{' '}
            <Link href="/terms"   style={{ color: 'var(--accent)' }}>Terms</Link>
            {' '}and{' '}
            <Link href="/privacy" style={{ color: 'var(--accent)' }}>Privacy policy</Link>.
          </p>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)' }}>{label}</label>
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%', height: 40, borderRadius: 10, border: '1px solid var(--border2)',
  background: 'var(--surface-2)', color: 'var(--text-1)', fontSize: 14,
  padding: '0 12px', outline: 'none', transition: 'border-color .2s',
};
