'use client';

/**
 * app/(public)/report/page.tsx
 *
 * Public shareable interview report page.
 * Migrated from backend/public/report.html → proper Next.js page.
 *
 * Route: /report?id=<shareToken>&ref=<referralCode>
 */

import { useEffect, useState , Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { reportsApi } from '@/features/reports/api';
import type { PublicReportResponse } from '@/features/reports/types';

type ReportData = PublicReportResponse;

function ReportPageInner() {
  const params     = useSearchParams();
  const shareToken = params.get('id') ?? '';
  const inboundRef = params.get('ref') ?? '';

  const [data,    setData]    = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  useEffect(() => {
    if (!shareToken) {
      setError('Invalid report link. No share token found.');
      setLoading(false);
      return;
    }

    reportsApi.getReport(shareToken).then((res) => {
      if (!res.ok) {
        setError('Report not found or link has expired.');
      } else {
        setData(res.data);
      }
      setLoading(false);
    });
  }, [shareToken]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0A0B10]">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/10 border-t-[#4F8EF7]" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0A0B10]">
        <div className="text-center">
          <p className="text-xl font-semibold text-white/80">{error ?? 'Something went wrong.'}</p>
          <a href="/" className="mt-4 inline-block text-[#4F8EF7] hover:underline">
            Go to Vachix →
          </a>
        </div>
      </div>
    );
  }

  const { session, feedbacks, referral_code } = data;
  const signupUrl = referral_code
    ? `/register?ref=${referral_code}`
    : '/register';

  return (
    <main className="min-h-screen bg-[#0A0B10] font-sans text-white">
      {/* Header */}
      <header className="border-b border-white/[0.07] px-6 py-4">
        <div className="mx-auto flex max-w-3xl items-center justify-between">
          <span className="text-lg font-bold tracking-tight">
            Speak<span className="text-[#4F8EF7]">Smart</span>
          </span>
          <a
            href={signupUrl}
            className="rounded-lg bg-[#4F8EF7] px-4 py-2 text-sm font-semibold text-white hover:bg-[#6ba3f9] transition-colors"
          >
            Try Free →
          </a>
        </div>
      </header>

      <div className="mx-auto max-w-3xl px-4 py-8 space-y-6">
        {/* Score card */}
        <div className="rounded-2xl border border-white/[0.07] bg-[#13151C] p-6">
          <p className="text-sm text-white/50 uppercase tracking-widest mb-1">Interview Score</p>
          <p className="text-6xl font-extrabold text-[#4F8EF7]">{session.score}<span className="text-2xl text-white/30">/10</span></p>
          <div className="mt-4 flex flex-wrap gap-3 text-sm text-white/60">
            <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1">{session.profession}</span>
            <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1">{session.difficulty}</span>
            <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1">{session.interview_type}</span>
            <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1">{session.exchanges} exchanges</span>
          </div>
        </div>

        {/* Feedbacks */}
        {feedbacks.map((fb, i) => (
          <div key={fb.id} className="rounded-2xl border border-white/[0.07] bg-[#13151C] p-5 space-y-3">
            <p className="text-xs text-white/40 uppercase tracking-wider">Q{i + 1}</p>
            <p className="font-medium text-white/90">{fb.question}</p>
            {fb.answer && (
              <p className="text-sm text-white/55 italic">&ldquo;{fb.answer}&rdquo;</p>
            )}
            {fb.interview_feedback && (
              <p className="text-sm text-white/70">{fb.interview_feedback}</p>
            )}
            <div className="flex items-center gap-2">
              <span className="text-xs text-white/40">Score</span>
              <span className={`text-sm font-bold ${fb.score >= 7 ? 'text-emerald-400' : fb.score >= 5 ? 'text-yellow-400' : 'text-red-400'}`}>
                {fb.score}/10
              </span>
            </div>
          </div>
        ))}

        {/* CTA */}
        <div className="rounded-2xl border border-[#4F8EF7]/20 bg-[#4F8EF7]/[0.06] p-6 text-center">
          <p className="font-semibold text-white mb-1">Practice makes perfect</p>
          <p className="text-sm text-white/50 mb-4">Join Vachix and ace your next interview</p>
          <a
            href={signupUrl}
            className="inline-block rounded-xl bg-[#4F8EF7] px-6 py-3 font-semibold text-white hover:bg-[#6ba3f9] transition-colors"
          >
            Start Free — No Credit Card
          </a>
        </div>
      </div>
    </main>
  );
}

export default function ReportPage() {
  return (
    <Suspense fallback={<div />}>
      <ReportPageInner />
    </Suspense>
  );
}
