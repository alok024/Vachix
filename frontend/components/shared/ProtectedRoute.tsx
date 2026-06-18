'use client';

/**
 * components/shared/ProtectedRoute.tsx
 *
 * Wraps any page under (app)/ — the perimeter auth check (is there a
 * valid session at all?) is now done server-side by middleware.ts
 * before this component ever renders, using the httpOnly ss_at cookie.
 *
 * This component handles the remaining client-side concerns:
 *  - Avoids a flash of empty UI while /me loads
 *  - Redirects to /profile if onboarding isn't complete
 *  - Redirects to /dashboard if an admin-only page is hit by a non-admin
 *
 * Usage:
 *   In (app)/layout.tsx:
 *     <ProtectedRoute>{children}</ProtectedRoute>
 */

import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter, usePathname } from 'next/navigation';
import { useAuthStore } from '@/store/auth';
import { userApi } from '@/features/user/api';
import { QK } from '@/lib/query-keys';

interface Props {
  children: React.ReactNode;
  /** Pass true for admin-only sections */
  requireAdmin?: boolean;
}

export function ProtectedRoute({ children, requireAdmin = false }: Props) {
  const router   = useRouter();
  const pathname = usePathname();
  const setUser  = useAuthStore((s) => s.setUser);
  const cachedUser = useAuthStore((s) => s.user);

  // Always fetch /me here — middleware already guarantees a valid
  // ss_at/ss_rt cookie reached this route, so no `enabled` gate is
  // needed. Shares its cache key with useMe() elsewhere.
  const { data: meData, isLoading, isError } = useQuery({
    queryKey: QK.me,
    queryFn: async () => {
      const res = await userApi.me();
      if (!res.ok) throw new Error('Failed to fetch user');
      if (res.data.user) setUser({
          ...res.data.user,
          ai_calls: res.data.usage?.ai_calls,
          ai_calls_limit: res.data.usage?.limit ?? null,
          ai_calls_remaining: res.data.usage?.remaining ?? null,
        });
      return res.data;
    },
    staleTime: 30_000,
    retry: false,
  });

  const user = meData?.user ?? cachedUser;

  useEffect(() => {
    if (!user) return;

    if (requireAdmin && !user.is_admin) {
      router.replace('/dashboard');
      return;
    }

    // Onboarding gate — bounce to profile if not completed.
    // Exempt:
    //  1. /profile itself — handles the onboarding form, avoids redirect loop
    //  2. Paid users (pro/elite) — they predate onboarding or paid without it
    //  3. Accounts created before onboarding launched (Jun 16 2026)
    const isProfilePage = pathname === '/profile' || pathname.startsWith('/profile/');
    const isPaidUser    = user.plan === 'pro' || user.plan === 'elite';
    const onboardingLaunch = new Date('2026-06-16T00:00:00Z');
    const accountCreated   = user.created_at ? new Date(user.created_at) : null;
    const isPreLaunchUser  = accountCreated !== null && accountCreated < onboardingLaunch;

    // ONBOARDING GATE — bounces new users to profile setup before they
    // can access any protected page. Exempt: the profile page itself
    // (avoids a redirect loop), paid users, and accounts created before
    // onboarding launched (Jun 16 2026) that were never prompted.
    if (!user.onboarding_completed_at && !isProfilePage && !isPaidUser && !isPreLaunchUser) {
      router.replace('/profile?onboarding=1');
    }
  }, [user, router, pathname, requireAdmin]);

  // While /me is in flight (and we have nothing cached yet) or it
  // failed (apiCall will have already redirected to /login on a real
  // 401), show a loading state instead of flashing protected content.
  if ((isLoading && !cachedUser) || isError || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center ">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/10 border-t-[#4F8EF7]" />
      </div>
    );
  }

  return <>{children}</>;
}
