'use client';

/**
 * app/(public)/compare/page.tsx
 *
 * Public shareable "Friend Score Comparison" landing page.
 * No Vachix account required to participate as a challenger.
 *
 * Flow:
 *   1. Load comparison data from /api/compare/:token
 *   2. Show the question + sharer's score (answer hidden to not anchor bias)
 *   3. Challenger types their answer and optionally sets a display name
 *   4. On submit → AI scores it → result reveal (score, delta, feedback)
 *   5. Leaderboard of all prior challengers shown below
 *
 * Route: /compare?id=<shareToken>
 */

import { useEffect, useState, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { comparisonApi } from '@/features/comparison/api';
import type {
  PublicComparisonResponse,
  ChallengeSubmitResponse,
} from '@/features/comparison/types';

// ── helpers ───────────────────────────────────────────────────────────────

function ScorePill({ score, label }: { score: number; label: string }) {
  // Feature 44 — ring grammar, matching the rest of the app. Thresholds
  // simplified from this page's previous 3-cutoff scheme (8/6/4) to the
  // app-wide 0-10 convention (7/4) used everywhere else, so a score of
  // e.g. 6.5 now reads the same "good" colour here as it would on the
  // dashboard or summary page. Colours stay as this page's own hex
  // palette (not CSS vars) — this standalone public share page is
  // styled independently of the app's light/dark theme by design.
  const colour =
    score >= 7 ? '#22c55e'
    : score >= 4 ? '#f59e0b'
    : '#ef4444';

  const size = 64;
  const r = (size / 2) - 6;
  const circ = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(1, score / 10));
  const offset = circ - pct * circ;

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="6" />
          <circle
            cx={size / 2} cy={size / 2} r={r} fill="none"
            stroke={colour} strokeWidth="6" strokeLinecap="round"
            strokeDasharray={circ} strokeDashoffset={offset}
            style={{ transition: 'stroke-dashoffset 0.8s cubic-bezier(0.16,1,0.3,1)' }}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center text-lg font-bold" style={{ color: colour }}>
          {score.toFixed(1)}
        </div>
      </div>
      <span className="text-[11px] font-semibold uppercase tracking-widest text-white/40">{label}</span>
    </div>
  );
}

function DeltaBadge({ delta }: { delta: number }) {
  const won     = delta > 0;
  const tied    = delta === 0;
  const colour  = won ? '#22c55e' : tied ? '#4F8EF7' : '#ef4444';
  const label   = won
    ? `+${delta.toFixed(1)} — You beat them! 🏆`
    : tied
    ? 'Dead even — well played 🤝'
    : `${delta.toFixed(1)} — They edged you this time`;

  return (
    <div
      className="rounded-xl px-4 py-3 text-center text-sm font-semibold"
      style={{ background: `${colour}18`, border: `1px solid ${colour}44`, color: colour }}
    >
      {label}
    </div>
  );
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

// ── main inner component ──────────────────────────────────────────────────

function ComparePageInner() {
  const params = useSearchParams();
  const token  = params.get('id') ?? '';

  const [comparison, setComparison] = useState<PublicComparisonResponse | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState<string | null>(null);

  // submission state
  const [name,        setName]        = useState('');
  const [answer,      setAnswer]      = useState('');
  const [submitting,  setSubmitting]  = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [result,      setResult]      = useState<ChallengeSubmitResponse | null>(null);

  // share / copy state
  const [copied,     setCopied]     = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

  useEffect(() => {
    if (!token) {
      setError('Invalid comparison link — no token found.');
      setLoading(false);
      return;
    }
    comparisonApi.getComparison(token).then(res => {
      if (!res.ok) {
        setError('This comparison link has expired or doesn\'t exist.');
      } else {
        setComparison(res.data);
      }
      setLoading(false);
    });
  }, [token]);

  const handleSubmit = useCallback(async () => {
    if (!answer.trim() || submitting || result) return;
    setSubmitError(null);
    setSubmitting(true);

    const res = await comparisonApi.submitResponse(token, answer.trim(), name.trim() || undefined);
    setSubmitting(false);

    if (!res.ok) {
      setSubmitError('Something went wrong scoring your answer. Try again.');
      return;
    }

    setResult(res.data);

    // Optimistically add own response to the leaderboard
    if (comparison) {
      setComparison(prev => prev ? {
        ...prev,
        responses: [
          ...prev.responses,
          {
            id:               crypto.randomUUID(),
            challenger_name:  name.trim() || 'You',
            challenger_score: res.data.challenger_score,
            ai_feedback:      res.data.ai_feedback,
            created_at:       new Date().toISOString(),
          },
        ],
      } : prev);
    }
  }, [answer, name, submitting, result, token, comparison]);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(window.location.href).then(() => {
      setCopied(true);
      setCopyFailed(false);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {
      // Clipboard API blocked (permissions denied, non-HTTPS, etc.) —
      // surface a brief error label on the button instead of silently failing.
      setCopyFailed(true);
      setTimeout(() => setCopyFailed(false), 3000);
    });
  }, []);

  // ── loading / error states ──────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0A0B10]">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/10 border-t-[#4F8EF7]" />
      </div>
    );
  }

  if (error || !comparison) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0A0B10]">
        <div className="mx-auto max-w-sm text-center px-4">
          <div className="mb-4 text-4xl">🔗</div>
          <p className="text-lg font-semibold text-white/80 mb-2">Link not found</p>
          <p className="text-sm text-white/40 mb-6">{error ?? 'This comparison link may have expired.'}</p>
          <a
            href="/register"
            className="inline-block rounded-xl bg-[#4F8EF7] px-6 py-3 font-semibold text-white hover:bg-[#6ba3f9] transition-colors"
          >
            Try Vachix Free →
          </a>
        </div>
      </div>
    );
  }

  const expiresDate  = formatDate(comparison.expires_at);
  const hasResponded = Boolean(result);

  // ── main render ──────────────────────────────────────────────────────────

  return (
    <main className="min-h-screen bg-[#0A0B10] font-sans text-white">
      {/* Header */}
      <header className="border-b border-white/[0.07] px-6 py-4">
        <div className="mx-auto flex max-w-2xl items-center justify-between">
          <span className="text-lg font-bold tracking-tight">Vachix</span>
          <div className="flex items-center gap-3">
            <a
              href="/login"
              className="text-sm font-semibold text-white/60 hover:text-white/90 transition-colors"
            >
              Log in
            </a>
            <a
              href="/register"
              className="rounded-lg bg-[#4F8EF7] px-4 py-2 text-sm font-semibold text-white hover:bg-[#6ba3f9] transition-colors"
            >
              Try Free →
            </a>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-2xl px-4 py-8 space-y-6">

        {/* Hero card — sharer's challenge */}
        <div className="rounded-2xl border border-white/[0.07] bg-[#13151C] p-6 space-y-4">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-white/40">
            <span>⚔️</span>
            <span>Interview Challenge</span>
          </div>

          <p className="text-base font-medium leading-relaxed text-white/90">
            {comparison.question_text}
          </p>

          <div className="flex items-center gap-3 pt-1">
            <ScorePill score={comparison.sharer_score} label="Their score" />
            <div className="flex-1 text-xs text-white/40 leading-relaxed">
              Can you beat <strong className="text-white/60">{comparison.sharer_score.toFixed(1)}/10</strong>?
              Answer the same question and see how you stack up.
            </div>
          </div>
        </div>

        {/* Answer / result section */}
        {!hasResponded ? (
          <div className="rounded-2xl border border-white/[0.07] bg-[#13151C] p-6 space-y-4">
            <h2 className="text-sm font-bold text-white/80">Your Answer</h2>

            <input
              type="text"
              placeholder="Your name (optional)"
              value={name}
              onChange={e => setName(e.target.value)}
              maxLength={100}
              className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm text-white placeholder-white/25 outline-none focus:border-[#4F8EF7]/60 focus:ring-1 focus:ring-[#4F8EF7]/30 transition"
            />

            <textarea
              placeholder="Type your answer here…"
              value={answer}
              onChange={e => setAnswer(e.target.value)}
              rows={5}
              maxLength={2000}
              className="w-full resize-none rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white placeholder-white/25 outline-none focus:border-[#4F8EF7]/60 focus:ring-1 focus:ring-[#4F8EF7]/30 transition"
            />

            <div className="flex items-center justify-between">
              <span className="text-xs text-white/25">{answer.length}/2000</span>
              <button
                onClick={handleSubmit}
                disabled={!answer.trim() || submitting}
                className="rounded-xl bg-[#4F8EF7] px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-[#6ba3f9] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {submitting ? 'Scoring…' : 'Submit & Compare →'}
              </button>
            </div>

            {submitError && (
              <p className="text-xs text-red-400">{submitError}</p>
            )}
          </div>
        ) : (
          /* Result reveal */
          <div className="rounded-2xl border border-white/[0.07] bg-[#13151C] p-6 space-y-5">
            <h2 className="text-sm font-bold text-white/80">Your Result</h2>

            <div className="flex items-center justify-center gap-8">
              <ScorePill score={result!.challenger_score} label="You" />
              <div className="text-2xl text-white/20">vs</div>
              <ScorePill score={result!.sharer_score} label="Them" />
            </div>

            <DeltaBadge delta={result!.delta} />

            {result!.ai_feedback && (
              <div
                className="rounded-xl px-4 py-3 text-sm text-white/70 leading-relaxed"
                style={{ background: 'rgba(79,142,247,0.06)', border: '1px solid rgba(79,142,247,0.15)' }}
              >
                <span className="text-xs font-bold uppercase tracking-widest text-[#4F8EF7] block mb-1">AI Feedback</span>
                {result!.ai_feedback}
              </div>
            )}

            <div className="flex flex-wrap gap-3 pt-1">
              <a
                href="/login"
                className="flex-1 rounded-xl bg-[#4F8EF7] px-4 py-2.5 text-center text-sm font-semibold text-white hover:bg-[#6ba3f9] transition-colors"
              >
                Practice more on Vachix →
              </a>
              <a
                href="/register"
                className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-center text-sm font-semibold text-white hover:bg-white/[0.08] transition-colors"
              >
                New? Try free →
              </a>
              <button
                onClick={handleCopy}
                className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm font-semibold text-white hover:bg-white/[0.08] transition-colors"
              >
                {copied ? 'Copied ✓' : copyFailed ? 'Copy failed — try manually' : 'Share this challenge'}
              </button>
            </div>
          </div>
        )}

        {/* Leaderboard — prior challengers */}
        {comparison.responses.length > 0 && (
          <div className="rounded-2xl border border-white/[0.07] bg-[#13151C] p-6 space-y-4">
            <h2 className="text-xs font-bold uppercase tracking-widest text-white/40">
              Challengers ({comparison.responses.length})
            </h2>
            <div className="space-y-2">
              {[...comparison.responses]
                .sort((a, b) => b.challenger_score - a.challenger_score)
                .map((r, i) => (
                  <div
                    key={r.id}
                    className="flex items-center gap-4 rounded-xl px-4 py-3"
                    style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}
                  >
                    <span className="w-5 text-center text-xs font-bold text-white/25">
                      {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}`}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-white/80 truncate">
                        {r.challenger_name ?? 'Anonymous'}
                      </p>
                      <p className="text-xs text-white/30">{formatDate(r.created_at)}</p>
                    </div>
                    <span
                      className="text-sm font-bold tabular-nums"
                      style={{
                        color: r.challenger_score >= 8 ? '#22c55e'
                              : r.challenger_score >= 6 ? '#4F8EF7'
                              : r.challenger_score >= 4 ? '#f59e0b'
                              : '#ef4444',
                      }}
                    >
                      {r.challenger_score.toFixed(1)}
                    </span>
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* Footer note */}
        <p className="text-center text-xs text-white/20 pb-4">
          Link expires {expiresDate}
        </p>
      </div>
    </main>
  );
}

export default function ComparePage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center bg-[#0A0B10]"><div className="h-8 w-8 animate-spin rounded-full border-2 border-white/10 border-t-[#4F8EF7]" /></div>}>
      <ComparePageInner />
    </Suspense>
  );
}
