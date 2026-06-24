'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { useSessions } from '@/hooks/queries';
import { useAuthStore } from '@/store/auth';
import { useUIStore } from '@/store/ui';
import { Card, Badge, Button, EmptyState, Spinner, ScoreRing } from '@/components/ui';
import { formatDate } from '@/lib/utils';
import type { Session } from '@/types';
import { ChevronRight, Lock, History } from 'lucide-react';

export default function HistoryPage() {
  const router = useRouter();
  const { user } = useAuthStore();
  const { showUpgradeModal } = useUIStore();
  // History is available to all paying plans (Starter, Pro, Elite).
  // Only free users are locked out — isFree must not classify Starter as free.
  const isFree = !user || user.plan === 'free';
  const { data: sessions, isLoading } = useSessions();

  if (isFree) {
    return (
      <div className="p-4 sm:p-6 max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold mb-6" style={{ color: 'var(--text-1)' }}>Past Sessions</h1>
        <Card className="p-8 text-center">
          <Lock className="w-10 h-10 mx-auto mb-4" style={{ color: 'var(--text-3)' }} />
          <h2 className="text-lg font-bold mb-2" style={{ color: 'var(--text-1)' }}>Session history is a paid feature</h2>
          <p className="text-sm mb-5 max-w-xs mx-auto" style={{ color: 'var(--text-3)' }}>
            Upgrade to view all past sessions, track your progress over time, and revisit feedback anytime.
          </p>
          <Button variant="upgrade" onClick={() => showUpgradeModal('feature_lock')}>
            Upgrade from ₹299/month
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-6" style={{ color: 'var(--text-1)' }}>Past Sessions</h1>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Spinner size={28} style={{ color: 'var(--accent)' }} />
        </div>
      ) : !sessions?.length ? (
        <Card className="p-8">
          <EmptyState
            icon={<History className="w-6 h-6" />}
            title="No sessions yet"
            description="Complete your first interview to see your history here."
            action={<Button onClick={() => router.push('/interview/setup')}>Start Interview</Button>}
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {sessions.map((s: Session) => (
            <button
              key={s.id}
              onClick={() => router.push(`/interview/summary?session=${s.id}`)}
              className="w-full flex items-center justify-between p-4 rounded-2xl border text-left transition-all duration-200"
              style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
              onMouseEnter={(e: React.MouseEvent<HTMLElement>) => {
                e.currentTarget.style.borderColor = 'var(--border2)';
                e.currentTarget.style.background = 'var(--surface-2)';
              }}
              onMouseLeave={(e: React.MouseEvent<HTMLElement>) => {
                e.currentTarget.style.borderColor = 'var(--border)';
                e.currentTarget.style.background = 'var(--surface)';
              }}
            >
              <div className="flex items-center gap-3 min-w-0">
                <ScoreRing score={Math.round(s.score)} max={10} size="sm" />
                <div className="min-w-0">
                  <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-1)' }}>{s.profession}</p>
                  <p className="text-xs" style={{ color: 'var(--text-3)' }}>{formatDate(s.created_at)}</p>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--text-3)' }} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
