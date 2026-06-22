'use client';

import { useSearchParams, useRouter } from 'next/navigation';
import { useState, Suspense } from 'react';
import { useSession } from '@/features/interview/hooks';
import { interviewApi } from '@/features/interview/api';
import { certificatesApi } from '@/features/certificates/api';
import { comparisonApi }   from '@/features/comparison/api';
import { useInterviewStore } from '@/store/interview';
import { useUIStore } from '@/store/ui';
import { useAuthStore } from '@/store/auth';
import { Button, Card, CardHeader, CardBody, ScoreBadge, Spinner, ScoreRing } from '@/components/ui';
import { formatDate } from '@/lib/utils';
import { CheckCircle, Share2, Download, MessageSquareQuote, Award, Users } from 'lucide-react';

function InterviewSummaryPageInner() {
  const params    = useSearchParams();
  const router    = useRouter();
  const sessionId = params.get('session');
  const { user }  = useAuthStore();
  const { showUpgradeModal, showToast } = useUIStore();
  const { session: liveSession, config } = useInterviewStore();
  const isFree = !user || (user.plan !== 'pro' && user.plan !== 'elite');

  const { data, isLoading } = useSession(sessionId);
  const sessionData = data?.session;
  const feedbacks   = data?.feedbacks ?? liveSession.allFeedbacks;

  const [shareUrl, setShareUrl]     = useState<string | null>(null);
  const [copyLoading, setCopyLoading] = useState(false);
  const [certLoading, setCertLoading] = useState(false);
  // Track which question index is currently generating a compare link
  const [compareLoading, setCompareLoading] = useState<number | null>(null);

  const avgScore    = sessionData?.score ?? (feedbacks.length ? Math.round(feedbacks.reduce((a, f) => a + f.score, 0) / feedbacks.length * 10) / 10 : 0);
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

  if (isLoading && sessionId) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner size={28} style={{ color: 'var(--accent)' }} />
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 max-w-2xl mx-auto space-y-5">

      {/* Header */}
      <div className="text-center py-4">
        <div
          className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4"
          style={{ background: 'var(--success-dim)', border: '2px solid var(--success-border)' }}
        >
          <CheckCircle className="w-8 h-8" style={{ color: 'var(--success)' }} />
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
          {isFree && (
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

      {/* Per-question feedback */}
      {feedbacks.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--text-3)' }}>Your Answers</h3>
          {feedbacks.map((fb, i) => (
            <Card key={(fb as any).id ?? i} className="p-5 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs mb-1" style={{ color: 'var(--text-3)' }}>Q{i + 1}</div>
                  <p className="text-sm font-medium" style={{ color: 'var(--text-1)' }}>{fb.question}</p>
                </div>
                <ScoreBadge score={Math.round(fb.score)} />
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
          ))}
        </div>
      )}

      {/* CTA */}
      <div className="flex gap-3 pb-4">
        <Button variant="secondary" className="flex-1" onClick={() => router.push('/dashboard')}>
          Dashboard
        </Button>
        <Button className="flex-1" onClick={() => router.push('/interview/setup')}>
          Practice Again →
        </Button>
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
