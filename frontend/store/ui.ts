'use client';

/**
 * store/ui.ts
 *
 * Zustand UI store — theme, sidebar, upgrade modal, toasts.
 *
 * Moved here from components/ui/index.ts so that `@/store/ui` (already
 * the import path used by AppShell, ProtectedRoute, ToastStack,
 * UpgradeModal, providers.tsx, and every (app) page) resolves correctly
 * and UI state lives alongside the other Zustand stores in `store/`.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { UpgradeTrigger } from '@/types';

interface Toast {
  id: string;
  // C2: Renamed from `html` to `message` — rendered as a plain React text node,
  // not via dangerouslySetInnerHTML, so no XSS risk if dynamic values are ever passed.
  message: string;
  className?: string;
  duration?: number;
}

interface UIStore {
  // Theme
  isDark: boolean;
  toggleTheme: () => void;

  // Sidebar
  sidebarOpen: boolean;
  toggleSidebar: () => void;
  closeSidebar: () => void;

  // Upgrade modal
  upgradeModalOpen: boolean;
  upgradeTrigger: UpgradeTrigger;
  showUpgradeModal: (trigger?: UpgradeTrigger) => void;
  closeUpgradeModal: () => void;

  // Toasts
  toasts: Toast[];
  showToast: (message: string, opts?: { className?: string; duration?: number }) => () => void;
  removeToast: (id: string) => void;
}

export const useUIStore = create<UIStore>()(
  persist(
    (set, get) => ({
      isDark: true,
      toggleTheme: () => {
        const next = !get().isDark;
        set({ isDark: next });
        // Sync with the same key the landing page reads so theme carries over
        // the moment the user crosses from the marketing site into the app.
        if (typeof window !== 'undefined') {
          const theme = next ? 'dark' : 'light';
          document.documentElement.setAttribute('data-theme', theme);
          localStorage.setItem('ssi-theme', theme);
        }
      },

      sidebarOpen: false,
      toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
      closeSidebar: () => set({ sidebarOpen: false }),

      upgradeModalOpen: false,
      upgradeTrigger: null,
      showUpgradeModal: (trigger = null) =>
        set({ upgradeModalOpen: true, upgradeTrigger: trigger }),
      closeUpgradeModal: () =>
        set({ upgradeModalOpen: false, upgradeTrigger: null }),

      toasts: [],
      showToast: (message, opts: { className?: string; duration?: number } = {}) => {
        const id = crypto.randomUUID();
        set((s) => ({
          toasts: [...s.toasts, { id, message, ...opts }],
        }));
        const remove = () => get().removeToast(id);
        const duration = opts.duration ?? 6000;
        setTimeout(remove, duration);
        return remove;
      },
      removeToast: (id) =>
        set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
    }),
    {
      name: 'ss-ui',
      partialize: (state) => ({ isDark: state.isDark }),
    }
  )
);
