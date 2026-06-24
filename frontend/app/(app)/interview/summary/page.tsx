'use client';

import { useSearchParams, useRouter } from 'next/navigation';
import { useState, useEffect, Suspense } from 'react';
import { useSession } from '@/features/interview/hooks';
import { interviewApi } from '@/features/interview/api';
import { certificatesApi } from '@/features/certificates/api';
import { comparisonApi }   from '@/features/comparison/api';
import { useInterviewStore } from '@/store/interview';
import { useUIStore } from '@/store/ui';
import { useAuthStore } from '@/store/auth';
import { Button, Card, CardHeader, CardBody, Spinner, ScoreRing } from '@/components/ui';
import { formatDate } from '@/lib/utils';
import { CheckCircle, Share2, Download, MessageSquareQuote, Award, Users } from 'lucide-react';

function InterviewSummaryPageInner() {
  const params    = useSearchParams();
  const router    = useRouter();
  const sessionIdRaw = params.get('session');
  // sessions.id is int8 (bigint) in the DB — the URL param is a numeric string
  // like "4", not a UUID. Guard against obviously invalid values (non-numeric,
  // zero, negative) so a garbled URL shows a clean not-found state rather than
  // a zero-filled page with broken share/certificate actions.
  const sessionId = (sessionIdRaw && /^[1-9][0-9]*$/.test(sessionIdRaw))
    ? sessionIdRaw
    : null;
  const { user }  = useAuthStore();
  const { showUpgradeModal, showToast } = useUIStore();
  const { session: liveSession, config } = useInterviewStore();
  // Bug #4 fix: renamed isFree → isOnFreePlan for clarity.
  // The job_ready_score RING renders for ALL plans (jobReadyScore != null check
  // below). This flag only controls the upsell button next to the ring —
  // Starter/Pro/Elite users see the score but not the upgrade prompt.
  // Starter plan (₹299/mo) includes job_ready_score per PLAN_LIMITS in env.ts.
  const isOnFreePlan = !user || user.plan === 'free';

  const { data, isLoading } = useSession(sessionId);
  const sessionData = data?.session;
  const feedbacks   = data?.feedbacks ?? liveSession.allFeedbacks;

  const [shareUrl, setShareUrl]     = useState<string | null>(null);
  const [copyLoading, setCopyLoading] = useState(false);
  const [certLoading, setCertLoading] = useState(false);
  // Track which question index is currently generating a compare link
  const [compareLoading, setCompareLoading] = useState<number | null>(null);

  const avgScore    = sessionData?.score ?? (feedbacks.length ? Math.round(feedbacks.reduce((a, f) => a + f.score, 0) / feedbacks.length * 10) / 10 : 0);

  // F35 fix: Animate the score ring by starting at full circumference (empty)
  // and transitioning to the target offset after mount so the CSS transition fires.
  const ringCircumference = 2 * Math.PI * 42;
  const ringTargetOffset  = ringCircumference * (1 - Math.min(avgScore / 10, 1));
  const [ringOffset, setRingOffset] = useState(ringCircumference); // start: ring empty
  useEffect(() => {
    // A tiny delay ensures the browser has painted the start state first.
    const id = setTimeout(() => setRingOffset(ringTargetOffset), 50);
    return () => clearTimeout(id);
  }, [ringTargetOffset]);

  const totalErrors = feedbacks.reduce((a, f) => a + (f.corrections?.length ?? 0), 0);
  const totalQ      = feedbacks.length || (sessionData?.exchanges ?? 0);
  const jobReadyScore = sessionData?.job_ready_score;

  function buildShareText() {
    return `I scored ${avgScore}/10 on my ${sessionData?.profession || config.profession} interview with Vachix! 🎙️ Try it free: https://vachix.in`;
  }

  async function copyLink() {
    if (copyLoading) return;
    if (shareUrl) { await navigator.clipboard.writeText(shareUrl); showToast('🔗 Link copied!'); return; }
    if (!sessionId) { await navigator.clipboard.writeText('https://vachix.in'); showToast('🔗 Link copied!'); return; }
    setCopyLoading(true);
    const res = await interviewApi.getShareToken(sessionId);
    setCopyLoading(false);
    if (res.ok) {
      setShareUrl(res.data.share_url);
      await navigator.clipboard.writeText(res.data.share_url);
      showToast('🔗 Session link copied!');
    } else {
      await navigator.clipboard.writeText('https://vachix.in');
      showToast('🔗 Link copied (share token unavailable)');
    }
  }

  function downloadReport() {
    const lines = [
      'Vachix — Interview Report',
      `Date: ${formatDate(sessionData?.created_at ?? new Date().toISOString())}`,
      `Profession: ${sessionData?.profession ?? config.profession}`,
      `Score: ${avgScore}/10`,
      '',
      ...feedbacks.map((fb, i) => [
        `Question ${i + 1}: ${fb.question}`,
        `Your Answer: ${fb.answer ?? '—'}`,
        `Score: ${fb.score}/10`,
        `Tips: ${fb.tips ?? '—'}`,
        fb.corrections?.length ? `Corrections:\n${fb.corrections.map((c) => `  ✗ ${c.wrong ?? c.mistake} → ✓ ${c.correct ?? c.correction}`).join('\n')}` : '',
        '',
      ].filter(Boolean).join('\n')),
    ].join('\n');
    const blob = new Blob([lines], { type: 'text/plain' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = `vachix-report-${Date.now()}.txt`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 100);
  }

  async function handleGetCertificate() {
    if (!sessionId || certLoading) return;
    setCertLoading(true);
    const res = await certificatesApi.getSessionCertificateToken(sessionId);
    setCertLoading(false);
    if (res.ok) {
      window.open(res.data.certificate_url, '_blank');
    } else {
      showToast('Could not generate certificate. Try again.');
    }
  }

  async function handleChallengeFriend(questionIndex: number) {
    if (!sessionId || compareLoading !== null) return;
    setCompareLoading(questionIndex);
    const res = await comparisonApi.createComparison(sessionId, questionIndex);
    setCompareLoading(null);
    if (res.ok) {
      await navigator.clipboard.writeText(res.data.share_url).catch(() => {});
      showToast('🔗 Challenge link copied! Send it to a friend.');
    } else {
      showToast('Could not create challenge link. Try again.');
    }
  }

  // Invalid/missing session ID with no live session in the store
  // means there's nothing to show — don't render a zero-filled summary
  // with broken share/certificate actions.
  if (!sessionId && feedbacks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <p className="text-sm" style={{ color: 'var(--text-3)' }}>Session not found.</p>
        <Button variant="secondary" size="sm" onClick={() => router.push('/dashboard')}>
          Back to Dashboard
        </Button>
      </div>
    );
  }

  if (isLoading && sessionId) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner size={28} style={{ color: 'var(--accent)' }} />
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 max-w-2xl mx-auto space-y-5">

      {/* F35: Header with score ring reveal + confetti burst on high score */}
      <div className="text-center py-4 relative overflow-visible">
        <div
          id="cf35Container"
          className="relative w-24 h-24 mx-auto mb-4 flex items-center justify-center"
        >
          {/* SVG score ring */}
          <svg width="96" height="96" className="absolute inset-0" style={{ transform: 'rotate(-90deg)' }}>
            <circle cx="48" cy="48" r="42" fill="none" stroke="var(--surface-2)" strokeWidth="5" />
            <circle
              cx="48" cy="48" r="42" fill="none"
              stroke={avgScore >= 8 ? 'var(--success, #22c55e)' : avgScore >= 5 ? '#f59e0b' : '#ef4444'}
              strokeWidth="5"
              strokeLinecap="round"
              strokeDasharray={String(ringCircumference)}
              strokeDashoffset={String(ringOffset)}
              style={{ transition: 'stroke-dashoffset 1.2s cubic-bezier(.22,.68,0,1.2) .2s' }}
            />
            {/* Glow layer */}
            <circle
              cx="48" cy="48" r="42" fill="none"
              stroke={avgScore >= 8 ? '#4ade80' : avgScore >= 5 ? '#fbbf24' : '#f87171'}
              strokeWidth="2" strokeLinecap="round"
              strokeDasharray={String(ringCircumference)}
              strokeDashoffset={String(ringOffset)}
              style={{ transition: 'stroke-dashoffset 1.2s cubic-bezier(.22,.68,0,1.2) .2s', opacity: .4, filter: 'blur(2px)' }}
            />
          </svg>
          <div className="relative z-10 flex flex-col items-center">
            <span
              className="text-2xl font-bold tabular-nums"
              style={{ color: avgScore >= 8 ? 'var(--success, #22c55e)' : avgScore >= 5 ? '#f59e0b' : '#ef4444' }}
            >
              {avgScore}
            </span>
            <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>/10</span>
          </div>
          {/* F35: Confetti particles (rendered by CSS animation, shown for high scores) */}
          {avgScore >= 8 && (
            <div aria-hidden className="absolute inset-0 pointer-events-none overflow-visible">
              {['#60a5fa','#4ade80','#fbbf24','#f472b6','#a78bfa','#f87171','#34d399','#fb923c','#22d3ee','#e879f9','#fff'].map((color, i) => {
                const angle = (i / 11) * Math.PI * 2;
                const radius = 60 + (i % 3) * 20;
                const dx = Math.round(Math.cos(angle) * radius);
                const dy = Math.round(Math.sin(angle) * radius - 20);
                return (
                  <span key={i} style={{
                    position: 'absolute', top: '50%', left: '50%',
                    width: i % 3 === 0 ? '8px' : '6px',
                    height: i % 3 === 0 ? '8px' : '6px',
                    borderRadius: i % 3 === 0 ? '50%' : '2px',
                    background: color,
                    transform: 'translate(-50%, -50%)',
                    animation: `cf35Fire .8s cubic-bezier(.22,.68,0,1.2) ${i * 40 + 800}ms both`,
                    '--cf35-dx': dx + 'px',
                    '--cf35-dy': dy + 'px',
                  } as React.CSSProperties} />
                );
              })}
              <style>{`
                @keyframes cf35Fire {
                  from { opacity:1; transform:translate(-50%,-50%) translate(0,0) rotate(0); }
                  to   { opacity:0; transform:translate(-50%,-50%) translate(var(--cf35-dx),var(--cf35-dy)) rotate(360deg); }
                }
              `}</style>
            </div>
          )}
        </div>
        <h2 className="text-2xl font-bold" style={{ color: 'var(--text-1)' }}>Interview Complete!</h2>
        <p className="text-sm mt-1" style={{ color: 'var(--text-3)' }}>
          {sessionData?.profession ?? config.profession} · {formatDate(sessionData?.created_at ?? new Date().toISOString())}
        </p>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Avg Score',   value: `${avgScore}/10`, color: 'var(--success)' },
          { label: 'Errors Found', value: String(totalErrors), color: 'var(--error)' },
          { label: 'Questions',   value: String(totalQ),   color: 'var(--accent)' },
        ].map((s) => (
          <Card key={s.label} className="p-4 text-center">
            <div className="text-2xl font-bold tabular-nums" style={{ color: s.color }}>{s.value}</div>
            <div className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>{s.label}</div>
          </Card>
        ))}
      </div>

      {/* Interviewer's Notes — Easy build item. A short narrative summary
          in Aria's voice, generated by a background job shortly after the
          session saves. Renders nothing while pending or if generation
          failed (no fake/placeholder text) — see useSession's polling
          comment for how this gets picked up once it lands. */}
      {sessionData?.interviewer_notes && (
        <Card className="p-4 flex items-start gap-3" style={{ background: 'var(--blue-dim)', borderColor: 'var(--blue-border)' }}>
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: 'var(--surface)' }}
          >
            <MessageSquareQuote className="w-4 h-4" style={{ color: 'var(--accent)' }} />
          </div>
          <div className="min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-wide mb-1" style={{ color: 'var(--accent)' }}>
              Aria's Notes
            </div>
            <p className="text-sm leading-relaxed" style={{ color: 'var(--text-1)' }}>{sessionData.interviewer_notes}</p>
          </div>
        </Card>
      )}

      {/* Job-ready ring */}
      {jobReadyScore != null && (
        <Card className="p-5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <ScoreRing score={jobReadyScore} size={72} label="Job-ready" />
            <div>
              <div className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>Readiness Score</div>
              <div className="text-xs" style={{ color: 'var(--text-3)' }}>Based on your performance today</div>
            </div>
          </div>
          {isOnFreePlan && (
            <Button variant="upgrade" size="sm" onClick={() => showUpgradeModal('session_end')}>
              Upgrade ₹699 →
            </Button>
          )}
        </Card>
      )}

      {/* Share / export */}
      <Card>
        <CardHeader>
          <span className="text-sm font-semibold flex items-center gap-2" style={{ color: 'var(--text-1)' }}>
            <Share2 className="w-4 h-4" style={{ color: 'var(--accent)' }} /> Share Your Result
          </span>
        </CardHeader>
        <CardBody>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={() => window.open(`https://wa.me/?text=${encodeURIComponent(buildShareText())}`, '_blank')}>
              📱 WhatsApp
            </Button>
            <Button variant="secondary" size="sm" onClick={() => window.open(`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent('https://vachix.in')}`, '_blank')}>
              💼 LinkedIn
            </Button>
            <Button variant="secondary" size="sm" onClick={() => window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(buildShareText())}`, '_blank')}>
              𝕏 Twitter
            </Button>
            <Button variant="secondary" size="sm" onClick={copyLink} loading={copyLoading}>
              🔗 Copy Link
            </Button>
            <Button variant="secondary" size="sm" onClick={downloadReport}>
              <Download className="w-3.5 h-3.5" /> Export TXT
            </Button>
            {sessionId && (
              <Button variant="secondary" size="sm" onClick={handleGetCertificate} loading={certLoading}>
                <Award className="w-3.5 h-3.5" /> Certificate
              </Button>
            )}
          </div>
        </CardBody>
      </Card>

      {/* F36: Per-question feedback with staggered scroll reveal */}
      {feedbacks.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--text-3)' }}>Your Answers</h3>
          {feedbacks.map((fb, i) => (
            <div
              key={fb.id ?? i}
              style={{
                animation: `fs36SlideUp .5s cubic-bezier(.22,.68,0,1.2) ${i * 100}ms both`,
              }}
            >
            <Card className="p-5 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs mb-1" style={{ color: 'var(--text-3)' }}>Q{i + 1}</div>
                  <p className="text-sm font-medium" style={{ color: 'var(--text-1)' }}>{fb.question}</p>
                </div>
                <ScoreRing score={Math.round(fb.score)} max={10} size="md" />
              </div>

              {fb.tips && (
                <p className="text-xs leading-relaxed pt-3" style={{ color: 'var(--text-2)', borderTop: '1px solid var(--border)' }}>
                  {fb.tips}
                </p>
              )}

              {fb.corrections && fb.corrections.length > 0 && (
                <div className="space-y-1.5">
                  <div className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-3)' }}>Corrections</div>
                  {fb.corrections.map((c: any, j: number) => (
                    <div key={j} className="text-xs rounded-lg px-3 py-2" style={{ background: 'var(--error-dim)', border: '1px solid var(--error-border)' }}>
                      <span style={{ color: 'var(--error)', textDecoration: 'line-through' }}>{c.wrong ?? c.mistake}</span>
                      <span className="mx-2" style={{ color: 'var(--text-3)' }}>→</span>
                      <span style={{ color: 'var(--success)' }}>{c.correct ?? c.correction}</span>
                      {c.rule && <div className="mt-0.5" style={{ color: 'var(--text-3)' }}>{c.rule}</div>}
                    </div>
                  ))}
                </div>
              )}

              {/* F38: Elara insight callout — shown when recurring pattern detected */}
              {fb.corrections && fb.corrections.length >= 2 && i === feedbacks.length - 1 && (() => {
                // Show insight after the last question if we see 2+ corrections in it
                const totalCorrCount = feedbacks.reduce((a, f) => a + (f.corrections?.length ?? 0), 0);
                if (totalCorrCount < 3) return null;
                return (
                  <div
                    className="rounded-xl p-4 flex items-start gap-3 border"
                    style={{
                      background: 'var(--blue-dim)',
                      borderColor: 'var(--blue-border)',
                      animation: 'ei38SlideIn .5s cubic-bezier(.22,.68,0,1.2) .6s both',
                      opacity: 0,
                    }}
                  >
                    <div
                      className="w-8 h-8 rounded-lg flex-shrink-0 flex items-center justify-center text-base"
                      style={{ background: 'var(--surface)' }}
                    >
                      💡
                    </div>
                    <div className="min-w-0">
                      <div className="text-[10px] font-bold uppercase tracking-wide mb-1" style={{ color: 'var(--accent)' }}>
                        Aria Noticed
                      </div>
                      <p className="text-xs leading-relaxed" style={{ color: 'var(--text-1)' }}>
                        You had <strong>{totalCorrCount} language corrections</strong> across this session.
                        The most common pattern: small article or tense errors.
                        Slowing down by 10% during answers usually fixes these automatically — silence reads as composure.
                      </p>
                    </div>
                    <style>{`
                      @keyframes ei38SlideIn {
                        from { opacity:0; transform:translateY(12px); }
                        to   { opacity:1; transform:translateY(0); }
                      }
                    `}</style>
                  </div>
                );
              })()}

              {/* Challenge a friend on this specific question */}
              {sessionId && (
                <div className="pt-2" style={{ borderTop: '1px solid var(--border)' }}>
                  <button
                    onClick={() => handleChallengeFriend(i)}
                    disabled={compareLoading !== null}
                    className="flex items-center gap-1.5 text-xs font-semibold transition-colors disabled:opacity-40"
                    style={{ color: 'var(--accent)' }}
                  >
                    <Users className="h-3 w-3" />
                    {compareLoading === i ? 'Copying link…' : 'Challenge a friend on this question'}
                  </button>
                </div>
              )}
            </Card>
            </div>
          ))}
          <style>{`
            @keyframes fs36SlideUp {
              from { opacity:0; transform:translateY(24px); }
              to   { opacity:1; transform:translateY(0); }
            }
          `}</style>
        </div>
      )}

      {/* F37: Action button hierarchy — Practice Again is primary CTA */}
      <div className="flex flex-col gap-3 pb-4">
        <Button
          size="lg"
          className="w-full"
          onClick={() => router.push('/interview/setup')}
          style={{
            background: 'var(--accent)',
            boxShadow: '0 4px 20px rgba(99,102,241,.35)',
            fontSize: '1rem',
            fontWeight: 700,
            letterSpacing: '.01em',
          }}
        >
          🎙 Practice Again →
        </Button>
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={() => router.push('/dashboard')}>
            Dashboard
          </Button>
          <Button variant="secondary" className="flex-1" onClick={() => window.open(`https://wa.me/?text=${encodeURIComponent(buildShareText())}`, '_blank')}>
            📱 Share Score
          </Button>
        </div>
      </div>

    </div>
  );
}

export default function InterviewSummaryPage() {
  return (
    <Suspense fallback={<div />}>
      <InterviewSummaryPageInner />
    </Suspense>
  );
}
