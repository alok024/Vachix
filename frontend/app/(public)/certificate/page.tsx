'use client';

/**
 * app/(public)/certificate/page.tsx
 *
 * Public shareable certificate page. Extends the existing public
 * /report page (same layout conventions, same brand tokens) with a
 * branded certificate image generated server-side as SVG — see
 * backend/src/modules/certificates/certificates.service.ts.
 *
 * Route: /certificate?id=<certificateToken>
 */

import { useEffect, useState, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { certificatesApi } from '@/features/certificates/api';
import type { CertificateContentResponse } from '@/features/certificates/types';

function CertificatePageInner() {
  const params = useSearchParams();
  const token  = params.get('id') ?? '';

  const [data,    setData]    = useState<CertificateContentResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const [copied,  setCopied]  = useState(false);

  useEffect(() => {
    if (!token) {
      setError('Invalid certificate link. No token found.');
      setLoading(false);
      return;
    }

    certificatesApi.getCertificate(token).then((res) => {
      if (!res.ok) {
        setError('Certificate not found or link has expired.');
      } else {
        setData(res.data);
      }
      setLoading(false);
    });
  }, [token]);

  // Same-origin proxy path (next.config.ts rewrites /api/:path* to the
  // backend) — works directly as an <img src> with no CORS concerns,
  // and is the same URL that'd be used as a social link-preview image.
  const imageUrl = token ? `/api/certificate/${token}.svg` : '';

  const handleCopyLink = useCallback(() => {
    if (typeof window === 'undefined') return;
    navigator.clipboard.writeText(window.location.href).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {/* clipboard permission denied — non-fatal, no UI to update */});
  }, []);

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

  const isReadiness = data.kind === 'readiness';

  return (
    <main className="min-h-screen bg-[#0A0B10] font-sans text-white">
      {/* Header */}
      <header className="border-b border-white/[0.07] px-6 py-4">
        <div className="mx-auto flex max-w-3xl items-center justify-between">
          <span className="text-lg font-bold tracking-tight">Vachix</span>
          <a
            href="/register"
            className="rounded-lg bg-[#4F8EF7] px-4 py-2 text-sm font-semibold text-white hover:bg-[#6ba3f9] transition-colors"
          >
            Try Free →
          </a>
        </div>
      </header>

      <div className="mx-auto max-w-3xl px-4 py-8 space-y-6">
        {/* Certificate image — the actual shareable artifact */}
        <div className="overflow-hidden rounded-2xl border border-white/[0.07] bg-[#13151C]">
          {/* eslint-disable-next-line @next/next/no-img-element -- SVG from
              our own backend, not user-uploaded; next/image's optimizer
              doesn't add value here and adds a build-time remote-pattern
              config requirement for no real benefit. */}
          <img
            src={imageUrl}
            alt={`${data.userName} — ${data.headline}, score ${data.scoreLabel}/10`}
            className="w-full"
          />
        </div>

        {/* Actions */}
        <div className="flex flex-wrap gap-3">
          <a
            href={imageUrl}
            download={`vachix-${isReadiness ? 'readiness' : 'interview'}-certificate.svg`}
            className="rounded-lg border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-semibold text-white hover:bg-white/[0.08] transition-colors"
          >
            Download
          </a>
          <button
            onClick={handleCopyLink}
            className="rounded-lg border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-semibold text-white hover:bg-white/[0.08] transition-colors"
          >
            {copied ? 'Link copied ✓' : 'Copy link'}
          </button>
        </div>

        {/* CTA */}
        <div className="rounded-2xl border border-[#4F8EF7]/20 bg-[#4F8EF7]/[0.06] p-6 text-center">
          <p className="font-semibold text-white mb-1">
            {isReadiness ? 'Track your own interview readiness' : 'Practice makes perfect'}
          </p>
          <p className="text-sm text-white/50 mb-4">Join Vachix and ace your next interview</p>
          <a
            href="/register"
            className="inline-block rounded-xl bg-[#4F8EF7] px-6 py-3 font-semibold text-white hover:bg-[#6ba3f9] transition-colors"
          >
            Start Free — No Credit Card
          </a>
        </div>
      </div>
    </main>
  );
}

export default function CertificatePage() {
  return (
    <Suspense fallback={<div />}>
      <CertificatePageInner />
    </Suspense>
  );
}
