'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { useState, useEffect } from 'react';
import { useUIStore } from '@/store/ui';
import { UpgradeModal } from '@/components/shared/UpgradeModal';
import { ToastStack } from '@/components/shared/ToastStack';
import posthog from 'posthog-js';

// ── QueryClient — shared config ───────────────────────────────────
function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60 * 1000,
        retry: (failureCount, error) => {
          // Don't retry on 401/403
          if (error instanceof Error && error.message.includes('401')) return false;
          if (error instanceof Error && error.message.includes('403')) return false;
          return failureCount < 2;
        },
      },
    },
  });
}

let browserQueryClient: QueryClient | undefined;
function getQueryClient() {
  if (typeof window === 'undefined') return makeQueryClient();
  if (!browserQueryClient) browserQueryClient = makeQueryClient();
  return browserQueryClient;
}

// ── PostHog init ──────────────────────────────────────────────────
function PostHogInit() {
  useEffect(() => {
    const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
    if (!key) return;
    posthog.init(key, {
      api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://app.posthog.com',
      capture_pageview: true,
      capture_pageleave: true,
      person_profiles: 'identified_only',
    });
  }, []);
  return null;
}

// ── Theme applier ─────────────────────────────────────────────────
// BUG FIX: globals.css uses [data-theme="dark"] / [data-theme="light"] selectors,
// NOT .dark / .light class selectors. The old code only toggled classes, so CSS
// custom properties (--bg, --text1, etc.) never applied. Now we set the
// data-theme attribute so all theme variables work correctly.
function ThemeApplier() {
  const isDark = useUIStore((s) => s.isDark);
  const toggleTheme = useUIStore((s) => s.toggleTheme);

  useEffect(() => {
    // On first mount, sync with the landing page's ssi-theme localStorage key.
    // If the user set a theme on the marketing site, honour it in the app.
    const stored = localStorage.getItem('ssi-theme');
    const shouldBeDark = stored ? stored === 'dark' : true;
    if (shouldBeDark !== isDark) toggleTheme();
    // Always write back so the two keys stay aligned going forward.
    const theme = shouldBeDark ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.classList.toggle('dark', shouldBeDark);
    document.documentElement.classList.toggle('light', !shouldBeDark);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const theme = isDark ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.classList.toggle('dark', isDark);
    document.documentElement.classList.toggle('light', !isDark);
  }, [isDark]);
  return null;
}

// ── Root providers ────────────────────────────────────────────────
export function Providers({ children }: { children: React.ReactNode }) {
  const qc = getQueryClient();

  return (
    <QueryClientProvider client={qc}>
      <PostHogInit />
      <ThemeApplier />
      {children}
      <UpgradeModal />
      <ToastStack />
      {process.env.NODE_ENV === 'development' && (
        <ReactQueryDevtools initialIsOpen={false} />
      )}
    </QueryClientProvider>
  );
}
