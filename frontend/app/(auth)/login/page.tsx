'use client';

import React from 'react';

/**
 * app/(auth)/login/page.tsx
 *
 * Login page — visual continuation of the landing page.
 * Uses the same CSS vars (--violet, --gold, --bg, etc.) and ambient
 * orb/grid recipe so the transition from marketing → app feels seamless.
 * Fully theme-aware: works in both dark and light modes.
 */

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useLogin } from '@/hooks/queries';
import { extractErrorMessage } from '@/lib/api';
import { Eye, EyeOff } from 'lucide-react';

// Elara corrections that cycle on the left panel to show what the product does
const CORRECTIONS = [
  { wrong: '"I am working since 5 years"', right: '"I have been working for 5 years"', tag: 'Tense' },
  { wrong: '"She don\'t know the answer"',  right: '"She doesn\'t know the answer"',   tag: 'Subject–Verb' },
  { wrong: '"He is more smarter"',          right: '"He is smarter"',                  tag: 'Double comparative' },
  { wrong: '"I did not went there"',        right: '"I did not go there"',             tag: 'Auxiliary' },
  { wrong: '"We discussed about it"',       right: '"We discussed it"',                tag: 'Redundant preposition' },
];

const STATS = [
  { n: '11', label: 'Interview tracks' },
  { n: '7',  label: 'Free sessions' },
  { n: '3',  label: 'Score dimensions' },
];

const KEYFRAMES = `
@keyframes auth-fade-left  { from { opacity:0; transform:translateX(-20px) } to { opacity:1; transform:none } }
@keyframes auth-fade-right { from { opacity:0; transform:translateX( 20px) } to { opacity:1; transform:none } }
@keyframes auth-fade-up    { from { opacity:0; transform:translateY( 12px) } to { opacity:1; transform:none } }
@keyframes auth-float-a    { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-18px)} }
@keyframes auth-float-b    { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-12px)} }
@keyframes auth-corr-in    { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:none} }
@media(prefers-reduced-motion:reduce){
  .auth-left,.auth-right,.auth-stat,.auth-orb-1,.auth-orb-2{animation:none!important}
}
`;

function LogoMark({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      <defs>
        <linearGradient id="authLogoG" x1="2" y1="2" x2="30" y2="30" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="var(--violet)" />
          <stop offset="1" stopColor="var(--gold)" />
        </linearGradient>
      </defs>
      <path d="M16 2C8.27 2 2 7.85 2 15.1c0 3.62 1.55 6.9 4.1 9.26-.18 1.84-.74 3.4-1.62 4.74-.2.3.05.7.4.64 2.4-.4 4.46-1.4 6.1-2.62 1.55.55 3.25.86 5.02.86 7.73 0 14-5.85 14-13.1S23.73 2 16 2Z" fill="url(#authLogoG)" />
      <path d="M10.5 17.5c1.2 1.7 3.2 2.8 5.5 2.8s4.3-1.1 5.5-2.8" stroke="var(--bg)" strokeWidth="1.8" strokeLinecap="round" fill="none" />
      <circle cx="11.5" cy="13" r="1.6" fill="var(--bg)" />
      <circle cx="20.5" cy="13" r="1.6" fill="var(--bg)" />
    </svg>
  );
}

function LoginPageInner() {
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [showPw,   setShowPw]   = useState(false);
  const [mounted,  setMounted]  = useState(false);
  const [corrIdx,  setCorrIdx]  = useState(0);
  const [statIdx,  setStatIdx]  = useState(0);
  const [corrVisible, setCorrVisible] = useState(true);

  const router  = useRouter();
  const params  = useSearchParams();
  const login   = useLogin();

  useEffect(() => { setTimeout(() => setMounted(true), 30); }, []);

  // Cycle through Elara corrections every 4 s
  useEffect(() => {
    const id = setInterval(() => {
      setCorrVisible(false);
      setTimeout(() => {
        setCorrIdx(i => (i + 1) % CORRECTIONS.length);
        setCorrVisible(true);
      }, 300);
    }, 4000);
    return () => clearInterval(id);
  }, []);

  // Cycle stats label
  useEffect(() => {
    const id = setInterval(() => setStatIdx(i => (i + 1) % STATS.length), 2500);
    return () => clearInterval(id);
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    try {
      await login.mutateAsync({ email, password });
      router.push(params.get('redirect') || '/dashboard');
    } catch (_) {}
  }

  const corr = CORRECTIONS[corrIdx];
  const stat = STATS[statIdx];

  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ background: 'var(--bg)', color: 'var(--text-1)', fontFamily: 'var(--sans)' }}
    >
      <style>{KEYFRAMES}</style>

      {/* Ambient orbs */}
      <div style={{ position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none', overflow: 'hidden' }}>
        <div className="auth-orb-1" style={{
          position: 'absolute', width: 500, height: 500, borderRadius: '50%',
          background: 'var(--violet)', opacity: .08, filter: 'blur(120px)',
          top: '-12%', left: '-8%', animation: 'auth-float-a 18s ease-in-out infinite',
        }} />
        <div className="auth-orb-2" style={{
          position: 'absolute', width: 360, height: 360, borderRadius: '50%',
          background: 'var(--gold)', opacity: .07, filter: 'blur(110px)',
          bottom: '-10%', right: '-6%', animation: 'auth-float-b 22s ease-in-out infinite 3s',
        }} />
        {/* Grid */}
        <div style={{
          position: 'absolute', inset: 0,
          backgroundImage: 'linear-gradient(var(--border) 1px,transparent 1px),linear-gradient(90deg,var(--border) 1px,transparent 1px)',
          backgroundSize: '72px 72px',
          WebkitMaskImage: 'radial-gradient(ellipse 80% 60% at 50% 0%,black,transparent 80%)',
          maskImage: 'radial-gradient(ellipse 80% 60% at 50% 0%,black,transparent 80%)',
          opacity: .5,
        }} />
      </div>

      {/* Nav bar — same height as landing */}
      <nav style={{
        position: 'sticky', top: 0, zIndex: 20, height: 60,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 28px', borderBottom: '1px solid var(--border)',
        background: 'var(--nav-bg)', backdropFilter: 'blur(16px)',
      }}>
        <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: 8, textDecoration: 'none' }}>
          <LogoMark />
          <span style={{ fontFamily: 'var(--serif)', fontStyle: 'italic', fontSize: 15, fontWeight: 700, color: 'var(--text-1)' }}>
            Speak<span style={{ color: 'var(--accent)', fontStyle: 'normal' }}>Smart</span>
          </span>
        </Link>
        <Link href="/register" style={{ fontSize: 13, color: 'var(--text-2)', textDecoration: 'none' }}>
          New here? <span style={{ color: 'var(--accent)', fontWeight: 600 }}>Create account →</span>
        </Link>
      </nav>

      {/* Main two-column layout */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 24px', position: 'relative', zIndex: 1 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 40, width: '100%', maxWidth: 960, alignItems: 'start' }}
          className="auth-grid">

          {/* ── Left panel ── */}
          <div
            className="auth-left"
            style={{ opacity: mounted ? 1 : 0, animation: mounted ? 'auth-fade-left .5s ease both' : 'none' }}
          >
            {/* Live correction card */}
            <div style={{
              borderRadius: 16, border: '1px solid var(--border2)',
              background: 'var(--surface)', padding: '20px 20px 16px',
              marginBottom: 24, overflow: 'hidden',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 14 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--emerald)', display: 'inline-block', animation: 'pulse 2s infinite' }} />
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '.08em' }}>Live correction · Elara AI</span>
              </div>
              <div style={{ opacity: corrVisible ? 1 : 0, transition: 'opacity .25s', animation: corrVisible ? 'auth-corr-in .3s ease both' : 'none' }}>
                <div style={{
                  background: 'var(--error-dim)', border: '1px solid var(--error-border)',
                  borderRadius: 8, padding: '8px 12px', marginBottom: 8,
                  fontSize: 13, color: 'var(--error)', textDecoration: 'line-through',
                }}>
                  {corr.wrong}
                </div>
                <div style={{
                  background: 'var(--success-dim)', border: '1px solid var(--success-border)',
                  borderRadius: 8, padding: '8px 12px', marginBottom: 10,
                  fontSize: 13, color: 'var(--success)', fontWeight: 600,
                }}>
                  {corr.right}
                </div>
                <span style={{
                  fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em',
                  padding: '2px 8px', borderRadius: 4,
                  background: 'var(--violet-dim)', color: 'var(--violet)', border: '1px solid var(--violet-border)',
                }}>
                  {corr.tag}
                </span>
              </div>
            </div>

            {/* Cycling stat */}
            <div style={{ marginBottom: 24, display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span style={{
                fontFamily: 'var(--serif)', fontSize: 44, fontWeight: 700,
                background: 'linear-gradient(135deg,var(--violet),var(--gold))',
                WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
                transition: 'opacity .3s',
              }}>{stat.n}</span>
              <span style={{ fontSize: 14, color: 'var(--text-2)', transition: 'opacity .3s' }}>{stat.label}</span>
            </div>

            <p style={{ fontFamily: 'var(--serif)', fontStyle: 'italic', fontSize: 20, color: 'var(--text-1)', lineHeight: 1.45, marginBottom: 28 }}>
              "Real feedback. Real improvement.<br />Real interviews."
            </p>

            {/* Score bars */}
            {[
              { label: 'Fluency', pct: 82, color: 'var(--emerald)' },
              { label: 'Grammar', pct: 71, color: 'var(--gold)' },
              { label: 'Vocabulary', pct: 67, color: 'var(--violet)' },
            ].map((b, i) => (
              <div key={b.label} style={{ marginBottom: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                  <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{b.label}</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)' }}>{b.pct}</span>
                </div>
                <div style={{ height: 5, background: 'var(--surface-3)', borderRadius: 9 }}>
                  <div style={{
                    height: '100%', borderRadius: 9, background: b.color,
                    width: mounted ? `${b.pct}%` : '0%',
                    transition: `width .8s ${.3 + i * .12}s var(--ease-spring)`,
                  }} />
                </div>
              </div>
            ))}
          </div>

          {/* ── Form card ── */}
          <div
            className="auth-right"
            style={{
              opacity: mounted ? 1 : 0,
              animation: mounted ? 'auth-fade-right .5s .08s ease both' : 'none',
              background: 'var(--surface)', border: '1px solid var(--border2)',
              borderRadius: 20, padding: '36px 32px',
              boxShadow: 'var(--card-shadow)',
            }}
          >
            <h1 style={{ fontSize: 24, fontWeight: 700, color: 'var(--text-1)', marginBottom: 4 }}>Welcome back</h1>
            <p style={{ fontSize: 13, color: 'var(--text-3)', marginBottom: 28 }}>
              Sign in to continue your interview prep.
            </p>

            {login.isError && (
              <div style={{
                background: 'var(--error-dim)', border: '1px solid var(--error-border)',
                borderRadius: 10, padding: '10px 14px', marginBottom: 20, fontSize: 13,
                color: 'var(--error)',
              }}>
                {extractErrorMessage(login.error as any)}
              </div>
            )}

            <form onSubmit={handleSubmit} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <Field label="Email address">
                <input
                  type="email" value={email} onChange={e => setEmail(e.target.value)}
                  placeholder="you@example.com" required autoFocus autoComplete="email"
                  style={inputStyle}
                />
              </Field>

              <Field label="Password">
                <div style={{ position: 'relative' }}>
                  <input
                    type={showPw ? 'text' : 'password'}
                    value={password} onChange={e => setPassword(e.target.value)}
                    placeholder="••••••••" required autoComplete="current-password"
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

              <div style={{ textAlign: 'right', marginTop: -6 }}>
                <Link href="/forgot-password" style={{ fontSize: 12, color: 'var(--accent)', textDecoration: 'none' }}>
                  Forgot password?
                </Link>
              </div>

              <button
                type="submit"
                disabled={login.isPending}
                style={{
                  height: 44, borderRadius: 10, border: 'none', cursor: login.isPending ? 'not-allowed' : 'pointer',
                  background: 'var(--accent-bg)', color: 'var(--accent-text)',
                  fontSize: 14, fontWeight: 700, transition: 'opacity .2s',
                  opacity: login.isPending ? .7 : 1,
                }}
              >
                {login.isPending ? 'Signing in…' : 'Sign in'}
              </button>
            </form>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '24px 0', color: 'var(--text-3)', fontSize: 12 }}>
              <div style={{ flex: 1, height: 1, background: 'var(--border2)' }} />
              or
              <div style={{ flex: 1, height: 1, background: 'var(--border2)' }} />
            </div>

            {/* OAuth stubs */}
            {[
              { label: 'Continue with Google', icon: '🇬' },
              { label: 'Continue with GitHub', icon: '⬡' },
            ].map(o => (
              <button key={o.label} type="button" style={{
                width: '100%', height: 40, borderRadius: 10, marginBottom: 10,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                background: 'transparent', border: '1px solid var(--border2)',
                color: 'var(--text-2)', fontSize: 13, cursor: 'pointer',
                transition: 'border-color .2s',
              }}
              onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--border3)')}
              onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border2)')}
              >
                <span>{o.icon}</span>{o.label}
              </button>
            ))}

            <p style={{ textAlign: 'center', fontSize: 12, color: 'var(--text-3)', marginTop: 20 }}>
              No account?{' '}
              <Link href="/register" style={{ color: 'var(--accent)', fontWeight: 600, textDecoration: 'none' }}>
                Get 7 free sessions →
              </Link>
            </p>
          </div>
        </div>
      </div>

      {/* Responsive: stack on mobile */}
      <style>{`
        @media(max-width:680px){
          .auth-grid{grid-template-columns:1fr!important}
          .auth-left{display:none}
        }
      `}</style>
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

export default function LoginPage() {
  return (
    <Suspense>
      <LoginPageInner />
    </Suspense>
  );
}
