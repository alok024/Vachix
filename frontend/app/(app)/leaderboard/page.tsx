'use client';

import React from 'react';
import { useLeaderboard } from '@/features/analytics/hooks';
import { useMe } from '@/features/user/hooks';
import { Card, CardBody, CardHeader, Spinner, EmptyState } from '@/components/ui';
import { Trophy, Lock } from 'lucide-react';

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) return <span className="text-lg">🥇</span>;
  if (rank === 2) return <span className="text-lg">🥈</span>;
  if (rank === 3) return <span className="text-lg">🥉</span>;
  return <span className="text-sm font-bold tabular-nums" style={{ color: 'var(--text-3)' }}>#{rank}</span>;
}

function getNextSunday(): string {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const daysUntilSunday = (7 - now.getDay()) % 7 || 7;
  const next = new Date(now);
  next.setDate(now.getDate() + daysUntilSunday);
  return next.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });
}

function LockedLeaderboard() {
  return (
    <div className="relative">
      {/* Blurred placeholder rows */}
      <Card>
        <CardBody className="p-0 overflow-hidden">
          <div style={{ filter: 'blur(4px)', userSelect: 'none', pointerEvents: 'none' }}>
          {[1, 2, 3, 4, 5].map((n) => (
            <div
              key={n}
              className="flex items-center gap-3 px-4 py-3"
              style={{ borderBottom: n < 5 ? '1px solid var(--border)' : undefined }}
            >
              <div className="w-8 text-center flex-shrink-0">
                <RankBadge rank={n} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold truncate" style={{ color: 'var(--text-1)' }}>
                  {'Rahul K.'}
                </div>
                <div className="text-xs" style={{ color: 'var(--text-3)' }}>🔥 {14 - n}-day streak</div>
              </div>
              <div className="text-right flex-shrink-0">
                <div className="text-sm font-bold tabular-nums" style={{ color: 'var(--accent)' }}>
                  ⚡ {(1200 - n * 150).toLocaleString('en-IN')}
                </div>
                <div className="text-xs" style={{ color: 'var(--text-3)' }}>XP this week</div>
              </div>
            </div>
          ))}
          </div>
        </CardBody>
      </Card>
      {/* Overlay */}
      <div
        className="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-xl"
        style={{ background: 'rgba(var(--surface-1-rgb, 255 255 255) / 0.75)', backdropFilter: 'blur(2px)' }}
      >
        <Lock className="w-6 h-6" style={{ color: 'var(--accent)' }} />
        <p className="text-sm font-semibold text-center px-6" style={{ color: 'var(--text-1)' }}>
          Weekly leaderboard is for Pro &amp; Elite members
        </p>
        <a
          href="/profile"
          className="text-xs font-bold px-4 py-2 rounded-full"
          style={{ background: 'var(--accent)', color: '#fff' }}
        >
          Upgrade to compete →
        </a>
      </div>
    </div>
  );
}

export default function LeaderboardPage() {
  const { data, isLoading } = useLeaderboard();
  const { data: meData } = useMe();
  const myName    = meData?.user?.name ?? '';
  const nextReset = getNextSunday();

  const isCompetitive = data?.me?.is_competitive ?? false;

  return (
    <div className="max-w-lg mx-auto px-4 py-6 space-y-4">
      <div className="flex items-center gap-2">
        <Trophy className="w-5 h-5" style={{ color: 'var(--warn)' }} />
        <h1 className="text-lg font-bold" style={{ color: 'var(--text-1)' }}>Weekly Leaderboard</h1>
      </div>
      <p className="text-xs" style={{ color: 'var(--text-3)' }}>
        Top 50 by XP this week (Pro &amp; Elite). Resets every Sunday midnight IST.
        7-day streak&nbsp;=&nbsp;1.5× XP · 30-day streak&nbsp;=&nbsp;2× XP.
        Next reset: <strong>{nextReset}</strong>.
      </p>

      {isLoading && <div className="flex justify-center py-12"><Spinner className="w-8 h-8" /></div>}

      {/* Non-competitive users see blurred board + upsell */}
      {!isLoading && !isCompetitive && <LockedLeaderboard />}

      {/* Competitive users see the live board */}
      {!isLoading && isCompetitive && !data?.entries?.length && (
        <EmptyState title="No entries yet" description="Complete a session this week to appear on the leaderboard." />
      )}

      {!isLoading && isCompetitive && data && data.entries.length > 0 && (
        <Card>
          <CardBody className="p-0">
            {data.entries.map((entry, i) => {
              const isMe = entry.display_name === myName && myName !== '';
              return (
                <div
                  key={i}
                  className="flex items-center gap-3 px-4 py-3"
                  style={{
                    borderBottom: i < data.entries.length - 1 ? '1px solid var(--border)' : undefined,
                    background: isMe ? 'var(--surface-2)' : undefined,
                  }}
                >
                  <div className="w-8 text-center flex-shrink-0">
                    <RankBadge rank={entry.rank} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold truncate" style={{ color: 'var(--text-1)' }}>
                      {entry.display_name}{isMe ? ' (you)' : ''}
                    </div>
                    <div className="text-xs" style={{ color: 'var(--text-3)' }}>
                      {entry.streak > 0 ? `🔥 ${entry.streak}-day streak` : 'No active streak'}
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="text-sm font-bold tabular-nums" style={{ color: 'var(--accent)' }}>
                      ⚡ {entry.xp_weekly.toLocaleString('en-IN')}
                    </div>
                    <div className="text-xs" style={{ color: 'var(--text-3)' }}>XP this week</div>
                  </div>
                </div>
              );
            })}
          </CardBody>
        </Card>
      )}

      {/* Own rank card for Pro/Elite users outside top 50 */}
      {!isLoading && isCompetitive && data && !data.me.in_top_50 && data.me.xp_weekly > 0 && (
        <Card>
          <CardHeader><span className="text-xs font-semibold" style={{ color: 'var(--text-3)' }}>Your position</span></CardHeader>
          <CardBody>
            <div className="flex items-center gap-3">
              <div className="text-sm font-bold" style={{ color: 'var(--text-3)' }}>
                {data.me.rank ? `#${data.me.rank}` : 'Unranked'}
              </div>
              <div className="flex-1 text-sm" style={{ color: 'var(--text-1)' }}>
                ⚡ {data.me.xp_weekly.toLocaleString('en-IN')} XP this week
              </div>
            </div>
            <p className="text-xs mt-2" style={{ color: 'var(--text-3)' }}>
              Keep going — top 50 resets every Monday morning!
            </p>
          </CardBody>
        </Card>
      )}
    </div>
  );
}