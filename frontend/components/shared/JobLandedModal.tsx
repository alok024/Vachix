'use client';

/**
 * components/shared/JobLandedModal.tsx
 *
 * "I Got the Job!" modal — shown from the dashboard card after ≥5 sessions.
 *
 * Flow:
 *   1. Form: role (required), company (optional), display name, opt-in checkbox
 *   2. Submit → POST /api/user/job-landed
 *   3. Success: show share panel with OG image link + Results Board CTA
 */

import { useState } from 'react';
import { X, Trophy, Share2, ExternalLink, CheckCircle2 } from 'lucide-react';
import { resultsBoardApi } from '@/features/user/api/results-board';
import { extractErrorMessage } from '@/lib/api';
import { analytics } from '@/lib/analytics';

interface Props {
  onClose:   () => void;
  userName:  string;
}

type Step = 'form' | 'success';

export function JobLandedModal({ onClose, userName }: Props) {
  const [step,        setStep]        = useState<Step>('form');
  const [role,        setRole]        = useState('');
  const [company,     setCompany]     = useState('');
  const [displayName, setDisplayName] = useState(userName.split(' ')[0] ?? '');
  const [showOnBoard, setShowOnBoard] = useState(true);
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState('');
  const [ogUrl,       setOgUrl]       = useState('');
  const [boardUrl,    setBoardUrl]    = useState<string | null>(null);
  const [copied,      setCopied]      = useState(false);

  async function handleSubmit() {
    if (!role.trim()) { setError('Please enter your new role.'); return; }
    if (!displayName.trim()) { setError('Please enter your name.'); return; }

    setError('');
    setLoading(true);

    try {
      const res = await resultsBoardApi.submitJobLanded({
        role:        role.trim(),
        company:     company.trim() || undefined,
        displayName: displayName.trim(),
        showOnBoard,
      });

      if (!res.ok) {
        setError(extractErrorMessage(res.error));
        return;
      }

      setOgUrl(res.data.og_image_url);
      setBoardUrl(res.data.results_board_url);
      setStep('success');

      analytics.jobLandedSubmitted({
        show_on_board: showOnBoard,
        has_company:   Boolean(company.trim()),
      });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : typeof e === "string" ? e : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  async function copyOgUrl() {
    try {
      await navigator.clipboard.writeText(ogUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard blocked — silently ignore
    }
  }

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="relative w-full max-w-md rounded-2xl border p-6 shadow-2xl"
        style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
      >
        {/* Close */}
        <button
          onClick={onClose}
          className="absolute right-4 top-4 rounded-lg p-1 transition-colors"
          style={{ color: 'var(--text-3)' }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-2)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>

        {step === 'form' ? (
          <>
            {/* Header */}
            <div className="mb-5 flex items-center gap-3">
              <div
                className="flex h-10 w-10 items-center justify-center rounded-xl flex-shrink-0"
                style={{ background: 'var(--success-dim)' }}
              >
                <Trophy className="h-5 w-5" style={{ color: 'var(--success)' }} />
              </div>
              <div>
                <h2 className="text-base font-bold" style={{ color: 'var(--text-1)' }}>
                  Congratulations! 🎉
                </h2>
                <p className="text-xs" style={{ color: 'var(--text-2)' }}>
                  Tell us about your new role
                </p>
              </div>
            </div>

            {/* Form fields */}
            <div className="space-y-3">
              {/* Role */}
              <div>
                <label className="mb-1 block text-xs font-semibold" style={{ color: 'var(--text-2)' }}>
                  Your new role <span style={{ color: 'var(--error)' }}>*</span>
                </label>
                <input
                  type="text"
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  placeholder="e.g. Software Engineer, Bank PO, Data Analyst"
                  maxLength={120}
                  className="w-full rounded-lg border px-3 py-2 text-sm outline-none transition-colors"
                  style={{
                    background:   'var(--surface-2)',
                    borderColor:  'var(--border)',
                    color:        'var(--text-1)',
                  }}
                  onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--accent)')}
                  onBlur={(e)  => (e.currentTarget.style.borderColor = 'var(--border)')}
                />
              </div>

              {/* Company */}
              <div>
                <label className="mb-1 block text-xs font-semibold" style={{ color: 'var(--text-2)' }}>
                  Company <span style={{ color: 'var(--text-3)' }}>(optional)</span>
                </label>
                <input
                  type="text"
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                  placeholder="e.g. Google, Infosys, SBI"
                  maxLength={120}
                  className="w-full rounded-lg border px-3 py-2 text-sm outline-none transition-colors"
                  style={{
                    background:   'var(--surface-2)',
                    borderColor:  'var(--border)',
                    color:        'var(--text-1)',
                  }}
                  onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--accent)')}
                  onBlur={(e)  => (e.currentTarget.style.borderColor = 'var(--border)')}
                />
              </div>

              {/* Display name */}
              <div>
                <label className="mb-1 block text-xs font-semibold" style={{ color: 'var(--text-2)' }}>
                  Your name (as shown publicly) <span style={{ color: 'var(--error)' }}>*</span>
                </label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="First name or full name"
                  maxLength={60}
                  className="w-full rounded-lg border px-3 py-2 text-sm outline-none transition-colors"
                  style={{
                    background:   'var(--surface-2)',
                    borderColor:  'var(--border)',
                    color:        'var(--text-1)',
                  }}
                  onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--accent)')}
                  onBlur={(e)  => (e.currentTarget.style.borderColor = 'var(--border)')}
                />
              </div>

              {/* Results Board opt-in */}
              <label
                className="flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors"
                style={{ borderColor: showOnBoard ? 'var(--success)' : 'var(--border)', background: showOnBoard ? 'var(--success-dim)' : 'var(--surface-2)' }}
              >
                <input
                  type="checkbox"
                  checked={showOnBoard}
                  onChange={(e) => setShowOnBoard(e.target.checked)}
                  className="mt-0.5 h-4 w-4 flex-shrink-0 accent-green-500"
                />
                <div>
                  <div className="text-xs font-semibold" style={{ color: 'var(--text-1)' }}>
                    Show on Results Board 🏆
                  </div>
                  <div className="text-[11px] mt-0.5 leading-relaxed" style={{ color: 'var(--text-2)' }}>
                    Inspire other candidates by sharing your win publicly at vachix.in/results
                  </div>
                </div>
              </label>
            </div>

            {error && (
              <p className="mt-3 text-xs" style={{ color: 'var(--error)' }}>{error}</p>
            )}

            {/* CTA */}
            <button
              onClick={handleSubmit}
              disabled={loading}
              className="mt-4 w-full rounded-xl py-2.5 text-sm font-bold text-white transition-opacity disabled:opacity-60"
              style={{ background: 'var(--success)' }}
            >
              {loading ? 'Submitting…' : 'Submit my win 🚀'}
            </button>
          </>
        ) : (
          <>
            {/* Success state */}
            <div className="mb-5 flex items-center gap-3">
              <div
                className="flex h-10 w-10 items-center justify-center rounded-xl flex-shrink-0"
                style={{ background: 'var(--success-dim)' }}
              >
                <CheckCircle2 className="h-5 w-5" style={{ color: 'var(--success)' }} />
              </div>
              <div>
                <h2 className="text-base font-bold" style={{ color: 'var(--text-1)' }}>
                  Win recorded! 🎉
                </h2>
                <p className="text-xs" style={{ color: 'var(--text-2)' }}>
                  You're officially a Vachix success story.
                </p>
              </div>
            </div>

            {/* Share card */}
            <div
              className="rounded-xl border p-4 space-y-3"
              style={{ background: 'var(--surface-2)', borderColor: 'var(--border)' }}
            >
              <div className="flex items-center gap-2">
                <Share2 className="h-4 w-4" style={{ color: 'var(--accent)' }} />
                <span className="text-xs font-semibold" style={{ color: 'var(--text-2)' }}>
                  Share your win
                </span>
              </div>

              {/* OG image URL to copy */}
              <div className="flex gap-2">
                <input
                  readOnly
                  value={ogUrl}
                  className="min-w-0 flex-1 rounded-lg border px-2 py-1.5 text-[11px] font-mono"
                  style={{
                    background:  'var(--surface)',
                    borderColor: 'var(--border)',
                    color:       'var(--text-2)',
                  }}
                />
                <button
                  onClick={copyOgUrl}
                  className="flex-shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors"
                  style={{
                    background: copied ? 'var(--success)' : 'var(--accent)',
                    color: '#fff',
                  }}
                >
                  {copied ? 'Copied!' : 'Copy'}
                </button>
              </div>

              <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>
                Share this image on LinkedIn, WhatsApp, or X to let everyone know.
              </p>
            </div>

            {/* Results Board link */}
            {boardUrl && (
              <a
                href={boardUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 flex items-center justify-center gap-2 rounded-xl border py-2.5 text-xs font-semibold transition-colors"
                style={{ borderColor: 'var(--success)', color: 'var(--success)' }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--success-dim)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <ExternalLink className="h-3.5 w-3.5" />
                View Results Board
              </a>
            )}

            <button
              onClick={onClose}
              className="mt-3 w-full rounded-xl py-2 text-xs font-semibold transition-colors"
              style={{ color: 'var(--text-3)' }}
            >
              Done
            </button>
          </>
        )}
      </div>
    </div>
  );
}
