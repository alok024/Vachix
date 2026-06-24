'use client';

/**
 * features/user/hooks/index.ts
 *
 * React Query hooks for the current user's profile, onboarding status,
 * and referral data. Implementations moved here from the old central
 * hooks/queries.ts.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { userApi } from '../api';
import { useAuthStore } from '@/store/auth';
import { QK } from '@/lib/query-keys';
import { throwIfError } from '@/lib/api';

// /me — user + usage + stats + weak areas
// Gated on cached `user` (persisted from a previous session). This is a
// UX optimization, not a security boundary — real auth enforcement is
// the httpOnly cookie, checked server-side by middleware.ts on every
// page request and by authMiddleware on every API call.
export function useMe() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated());
  const setUser = useAuthStore((s) => s.setUser);

  return useQuery({
    queryKey: QK.me,
    queryFn: async () => {
      const res = await userApi.me();
      // throwIfError throws an ApiError carrying res.status — providers.tsx
      // retry logic inspects .status so 401/403 are not retried.
      throwIfError(res, 'Failed to fetch user');
      // Keep Zustand in sync — only the fields that components read from the
      // auth store directly (ProtectedRoute, nav, admin gates). Usage fields
      // accessed by the UI (session_count, session_limit, remaining, resets_at)
      // are read from the RQ cache (useMe().data.usage), not from the store,
      // so they don't need to be spread here.
      if (res.data.user) setUser({
          ...res.data.user,
          ai_calls: res.data.usage?.ai_calls,
          ai_calls_limit: res.data.usage?.limit ?? null,
          ai_calls_remaining: res.data.usage?.remaining ?? null,
        });
      return res.data;
    },
    enabled: isAuthenticated,
    staleTime: 30_000,      // 30s before refetch
    refetchOnWindowFocus: true,
  });
}

// Complete onboarding
export function useCompleteOnboarding() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: ({ profession, goal }: { profession: string; goal: string }) =>
      userApi.completeOnboarding(profession, goal),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK.me });
    },
  });
}

// Referral data
export function useReferral() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated());

  return useQuery({
    queryKey: QK.referral,
    queryFn: async () => {
      const res = await userApi.getReferral();
      if (!res.ok) throw new Error('Failed to fetch referral');
      return res.data;
    },
    enabled: isAuthenticated,
    staleTime: 120_000,
  });
}
