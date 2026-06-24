'use client';

/**
 * features/interview/hooks/index.ts
 *
 * React Query hooks for creating sessions and reading a single
 * session's detail (the interview feature owns `/sessions` POST and
 * `/sessions/:id` — see features/README.md).
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { interviewApi } from '../api';
import { QK } from '@/lib/query-keys';

// Save a completed session
export function useSaveSession() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: interviewApi.createSession,
    onSuccess: () => {
      // Invalidate so dashboard/history refetch fresh data
      qc.invalidateQueries({ queryKey: QK.me });
      qc.invalidateQueries({ queryKey: QK.sessions });
    },
  });
}

// Single session detail (interview summary page)
//
// Interviewer's Notes are written by a background job shortly *after*
// the session row is created, so the very first fetch (typically made
// seconds after the session ends, on this same summary page) often
// lands before that job has finished. staleTime: Infinity is still
// correct for the rest of the session — scores, feedback, etc. never
// change after creation — but it would otherwise mean a missing note
// is missing forever for this cached query. refetchInterval below polls
// briefly, lightly, and only while notes are genuinely pending.
const INTERVIEWER_NOTES_POLL_MS = 4_000;
const INTERVIEWER_NOTES_POLL_DEADLINE_MS = 30_000; // give up after ~30s

export function useSession(id: string | null) {
  return useQuery({
    queryKey: QK.session(id ?? ''),
    queryFn: async () => {
      if (!id) throw new Error('No session id');
      const res = await interviewApi.getSession(id);
      if (!res.ok) throw new Error('Failed to fetch session');
      return res.data;
    },
    enabled: !!id,
    // Sessions are immutable after creation — scores, feedback, etc. never
    // change. staleTime: Infinity prevents needless re-fetches on navigation.
    // Exception: if interviewer_notes is null and we are past the 30s polling
    // window (background job likely failed permanently), treat the cached data
    // as immediately stale so the next page mount triggers one re-fetch.
    // This avoids serving permanently-null notes from cache indefinitely while
    // still keeping the Infinity behaviour for fully-populated sessions.
    staleTime: (query) => {
      const session = query.state.data?.session;
      if (!session) return Infinity;
      if (session.interviewer_notes) return Infinity;
      const createdAt = session.created_at ? new Date(session.created_at).getTime() : 0;
      const pastDeadline = Date.now() - createdAt > INTERVIEWER_NOTES_POLL_DEADLINE_MS;
      // Past deadline + still null → stale immediately so a fresh mount retries.
      return pastDeadline ? 0 : Infinity;
    },
    refetchInterval: (query) => {
      const session = query.state.data?.session;
      if (!session) return false;
      // Already has notes (or the background job failed and never will
      // — we can't distinguish "pending" from "permanently null" by
      // value alone, so cap polling by elapsed time instead).
      if (session.interviewer_notes) return false;
      const createdAt = session.created_at ? new Date(session.created_at).getTime() : 0;
      if (Date.now() - createdAt > INTERVIEWER_NOTES_POLL_DEADLINE_MS) return false;
      return INTERVIEWER_NOTES_POLL_MS;
    },
  });
}

export { useInterviewStore } from '@/store/interview';
