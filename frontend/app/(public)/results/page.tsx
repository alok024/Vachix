'use client';

/**
 * app/(public)/results/page.tsx
 *
 * Public Results Board — shows opted-in users who landed jobs via Vachix.
 * No auth required. Paginated. Works as a social-proof / referral surface.
 *
 * Route: /results
 */

import { useEffect, useState, useCallback } from 'react';
import { Trophy, ExternalLink, ChevronLeft, ChevronRight } from 'lucide-react';
import { resultsBoardApi } from '@/features/user/api/results-board';
import type { ResultsBoardEntry } from '@/features/user/types/results-board';
import { formatDate } from '@/lib/utils';
import { ScoreRing } from '@/components/ui';
import Link from 'next/link';

const PAGE_SIZE = 20;

// ── Card ─────────────────────────────────────────────────────────────────────

function BoardCard({ entry }: { entry: ResultsBoardEntry }) {
  return (
    <div
      className="rounded-2xl border p-5 flex flex-col gap-3"
      style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
    >
      {/* Top row: name + score */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-bold truncate" style={{ color: 'var(--text-1)' }}>
            {entry.display_name}
          </div>
          <div className="text-xs mt-0.5 truncate" style={{ color: 'var(--text-2)' }}>
            {entry.role}
            {entry.company ? ` · ${entry.company}` : ''}
          </div>
        </div>

        {entry.avg_score != null && (
          <div className="flex-shrink-0 text-center">
            <ScoreRing
              score={Number(entry.avg_score.toFixed(1))}
              max={10}
              size="sm"
              label="avg score"
            />
          </div>
        )}
      </div>

      {/* Sessions stat */}
      <div className="flex items-center gap-1.5">
        <span className="text-[11px]" style={{ color: 'var(--text-3)' }}>
          {entry.sessions_count} session{entry.sessions_count !== 1 ? 's' : ''} completed
        </span>
        <span style={{ color: 'var(--border)' }}>·</span>
        <span className="text-[11px]" style={{ color: 'var(--text-3)' }}>
          {formatDate(entry.created_at)}
        </span>
      </div>

      {/* Share image link */}
      <a
        href={entry.og_image_url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-1.5 text-[11px] font-semibold w-fit"
        style={{ color: 'var(--accent)' }}
      >
        <ExternalLink className="w-3 h-3" />
        Share card
      </a>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function ResultsPage() {
  const [entries, setEntries] = useState<ResultsBoardEntry[]>([]);
  const [total,   setTotal]   = useState(0);
  const [page,    setPage]    = useState(1);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  const totalPages = Math.ceil(total / PAGE_SIZE);

  const loadPage = useCallback(async (p: number) => {
    setLoading(true);
    setError('');
    try {
      const res = await resultsBoardApi.getResultsBoard(p, PAGE_SIZE);
      if (res.ok) {
        setEntries(res.data.entries);
        setTotal(res.data.total);
        setPage(p);
      } else {
        setError('Failed to load results. Please try again.');
      }
    } catch {
      setError('Failed to load results. Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadPage(1); }, [loadPage]);

  return (
    <div
      className="min-h-screen"
      style={{ background: 'var(--bg)', color: 'var(--text-1)' }}
    >
      {/* Header */}
      <div
        className="border-b"
        style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
      >
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6">
          <div className="flex items-center gap-3 mb-2">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: 'var(--success-dim)' }}
            >
              <Trophy className="w-5 h-5" style={{ color: 'var(--success)' }} />
            </div>
            <div>
              <h1 className="text-xl font-bold" style={{ color: 'var(--text-1)', letterSpacing: '-0.02em' }}>
                Results Board
              </h1>
              <p className="text-xs" style={{ color: 'var(--text-3)' }}>
                Vachix users who landed their dream jobs
              </p>
            </div>
          </div>

          {total > 0 && (
            <p className="text-xs mt-3" style={{ color: 'var(--text-2)' }}>
              <strong style={{ color: 'var(--success)' }}>{total}</strong> candidate{total !== 1 ? 's' : ''} landed jobs using Vachix
            </p>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6">

        {loading && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="rounded-2xl border p-5 animate-pulse h-32"
                style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
              />
            ))}
          </div>
        )}

        {!loading && error && (
          <div className="text-center py-16">
            <p className="text-sm" style={{ color: 'var(--error)' }}>{error}</p>
            <button
              onClick={() => loadPage(page)}
              className="mt-4 text-xs font-semibold px-4 py-2 rounded-lg"
              style={{ background: 'var(--accent)', color: '#fff' }}
            >
              Retry
            </button>
          </div>
        )}

        {!loading && !error && entries.length === 0 && (
          <div className="text-center py-20">
            <div className="text-5xl mb-4">🏆</div>
            <h2 className="text-lg font-bold mb-2" style={{ color: 'var(--text-1)' }}>
              Be the first on the board
            </h2>
            <p className="text-sm max-w-sm mx-auto mb-6" style={{ color: 'var(--text-2)' }}>
              Complete 5+ interview sessions, land a job, and share your win.
            </p>
            <Link
              href="/"
              className="inline-block text-sm font-bold px-6 py-2.5 rounded-xl text-white"
              style={{ background: 'var(--blue)' }}
            >
              Start Practising →
            </Link>
          </div>
        )}

        {!loading && !error && entries.length > 0 && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {entries.map(entry => (
                <BoardCard key={entry.id} entry={entry} />
              ))}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-3 mt-8">
                <button
                  onClick={() => loadPage(page - 1)}
                  disabled={page <= 1}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-40 transition-colors"
                  style={{ border: '1px solid var(--border)', color: 'var(--text-2)' }}
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                  Prev
                </button>
                <span className="text-xs" style={{ color: 'var(--text-3)' }}>
                  Page {page} of {totalPages}
                </span>
                <button
                  onClick={() => loadPage(page + 1)}
                  disabled={page >= totalPages}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-40 transition-colors"
                  style={{ border: '1px solid var(--border)', color: 'var(--text-2)' }}
                >
                  Next
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {/* CTA footer */}
            <div
              className="mt-10 rounded-2xl border p-6 text-center"
              style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
            >
              <div className="text-2xl mb-2">🎙️</div>
              <h3 className="text-base font-bold mb-1" style={{ color: 'var(--text-1)' }}>
                Start your prep today
              </h3>
              <p className="text-xs mb-4 max-w-xs mx-auto" style={{ color: 'var(--text-2)' }}>
                Join {total}+ candidates who used Vachix to ace their interviews.
              </p>
              <Link
                href="/"
                className="inline-block text-sm font-bold px-6 py-2.5 rounded-xl text-white"
                style={{ background: 'var(--blue)' }}
              >
                Try Vachix Free →
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
