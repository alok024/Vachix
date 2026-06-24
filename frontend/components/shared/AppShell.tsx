'use client';

import React, { useRef, useEffect, useCallback } from 'react';
import { useUIStore } from '@/store/ui';
import { useAuthStore } from '@/store/auth';
import { useLogout } from '@/features/auth/hooks';
import { useMe } from '@/features/user/hooks';
import { useRouter, usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard, Play, History, User, Gift,
  MessageSquare, LogOut, Sun, Moon, Menu, X, CalendarCheck,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  section?: string;
  badge?: string;
  proBadge?: boolean;
  freeOnly?: boolean;
  mobileNav?: boolean; // show in bottom nav
};

const NAV: NavItem[] = [
  { href: '/dashboard',       label: 'Dashboard',        icon: LayoutDashboard, section: 'Practice', mobileNav: true },
  { href: '/interview/setup', label: 'New Interview',    icon: Play,                                  mobileNav: true },
  { href: '/english',         label: 'English',          icon: MessageSquare,   badge: 'NEW',         mobileNav: true },
  { href: '/history',         label: 'Sessions',         icon: History,         proBadge: true,       mobileNav: true },
  { href: '/prep-paths',      label: 'Prep Paths',       icon: CalendarCheck,   badge: 'NEW' },
  { href: '/profile',         label: 'Profile',          icon: User,            section: 'Account',   mobileNav: true },
  { href: '/referral',        label: 'Refer & Earn',     icon: Gift,            freeOnly: true },
];

// Bottom nav items — 5 max for comfortable touch targets
const BOTTOM_NAV = NAV.filter((n) => n.mobileNav);

const PAGE_TITLES: Record<string, string> = {
  '/dashboard':         'Dashboard',
  '/interview/setup':   'New Interview',
  '/interview/session': 'Session',
  '/interview/summary': 'Session Report',
  '/english':           'English Practice',
  '/history':           'Past Sessions',
  '/profile':           'Profile & Plan',
  '/referral':          'Refer & Earn',
};

function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="ssLogoGrad" x1="2" y1="2" x2="30" y2="30" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="var(--accent)" />
          <stop offset="1" stopColor="var(--warn)" />
        </linearGradient>
      </defs>
      <path
        d="M16 2C8.27 2 2 7.85 2 15.1c0 3.62 1.55 6.9 4.1 9.26-.18 1.84-.74 3.4-1.62 4.74-.2.3.05.7.4.64 2.4-.4 4.46-1.4 6.1-2.62 1.55.55 3.25.86 5.02.86 7.73 0 14-5.85 14-13.1S23.73 2 16 2Z"
        fill="url(#ssLogoGrad)"
      />
      <path d="M10.5 17.5c1.2 1.7 3.2 2.8 5.5 2.8s4.3-1.1 5.5-2.8"
        stroke="var(--bg)" strokeWidth="1.8" strokeLinecap="round" fill="none" />
      <circle cx="11.5" cy="13" r="1.6" fill="var(--bg)" />
      <circle cx="20.5" cy="13" r="1.6" fill="var(--bg)" />
    </svg>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { sidebarOpen, closeSidebar, toggleSidebar, isDark, toggleTheme } = useUIStore();
  const { user } = useAuthStore();
  const pathname  = usePathname();
  const router    = useRouter();
  const logout    = useLogout();

  // Feature 41 — streak data (useMe is already called by dashboard/profile;
  // staleTime=30s means this is a cache hit in the vast majority of renders)
  const { data: meData } = useMe();
  const streak = meData?.stats?.streak ?? 0;
  const streakVisible = streak > 0;
  const streakPulse   = streak >= 7;

  // Feature 42 — bottom nav sliding indicator
  const bottomNavRef = useRef<HTMLElement>(null);

  const isFree  = !user?.plan || (user.plan !== 'pro' && user.plan !== 'elite');
  const planLabel =
    user?.plan === 'elite'   ? '◈ Elite' :
    user?.plan === 'pro'     ? '✦ Pro'   :
    user?.plan === 'starter' ? '⚡ Starter' : 'Free';
  const name   = user?.name || user?.email?.split('@')[0] || '?';
  const avatar = name[0].toUpperCase();

  // Hide bottom nav on session page — it needs full immersive height
  const isSessionPage = pathname === '/interview/session';

  // Feature 42 — sync sliding indicator whenever pathname or nav changes
  const syncBottomNavIndicator = useCallback(() => {
    const nav = bottomNavRef.current;
    if (!nav) return;
    const visibleItems = BOTTOM_NAV.filter((n) => !(n.freeOnly && !isFree));
    const count = visibleItems.length;
    const activeIdx = visibleItems.findIndex(
      (n) => pathname === n.href || pathname.startsWith(n.href + '/')
    );
    nav.style.setProperty('--bn-ind-w', `${100 / count}%`);
    if (activeIdx >= 0) {
      nav.style.setProperty('--bn-ind-x', `${activeIdx * 100}%`);
    }
  }, [pathname, isFree]);

  useEffect(() => {
    syncBottomNavIndicator();
  }, [syncBottomNavIndicator]);

  // Feature 40 — spring drawer: apply spring transition on open, fast on close
  useEffect(() => {
    const aside = document.getElementById('vachix-sidebar');
    if (!aside) return;
    if (sidebarOpen) {
      aside.classList.remove('closing');
    } else {
      aside.classList.add('closing');
      const tid = setTimeout(() => aside.classList.remove('closing'), 220);
      return () => clearTimeout(tid);
    }
  }, [sidebarOpen]);

  // Feature 39 — flash helper: closes sidebar after flash animation
  function handleNavClick() {
    closeSidebar();
  }

  async function handleLogout() {
    await logout.mutateAsync();
    router.push('/login');
  }

  let lastSection = '';

  return (
    <div className="flex min-h-screen" style={{ background: 'var(--bg-app)' }}>

      {/* Desktop Sidebar */}
      <aside
        id="vachix-sidebar"
        className={cn(
          'fixed inset-y-0 left-0 z-50 w-56 flex flex-col',
          'border-r sidebar-drawer',
          sidebarOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full',
          'lg:translate-x-0 lg:shadow-none'
        )}
        style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
      >
        {/* Logo */}
        <Link
          href="/dashboard"
          onClick={closeSidebar}
          className="flex items-center gap-2.5 px-5 h-14 border-b flex-shrink-0"
          style={{ borderColor: 'var(--border)' }}
        >
          <LogoMark />
          <span
            className="text-[15px] font-bold tracking-tight"
            style={{ fontFamily: 'var(--serif)', fontStyle: 'italic', color: 'var(--text-1)' }}
          >
            Va<span style={{ color: 'var(--accent)', fontStyle: 'normal' }}>chix</span>
          </span>
        </Link>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-3 px-2.5">
          {NAV.map((item) => {
            if (item.freeOnly && !isFree) return null;

            const active       = pathname === item.href || pathname.startsWith(item.href + '/');
            const showSection  = !!item.section && item.section !== lastSection;
            if (item.section) lastSection = item.section;

            return (
              <React.Fragment key={item.href}>
                {showSection && (
                  <p
                    className="text-[10px] font-bold uppercase tracking-widest px-3 mb-1 mt-3"
                    style={{ color: 'var(--text-3)', letterSpacing: '0.1em' }}
                  >
                    {item.section}
                  </p>
                )}
                <Link
                  href={item.href}
                  onClick={(e) => {
                    // Feature 39: flash the newly-active item
                    const el = e.currentTarget as HTMLElement;
                    el.classList.add('sidebar-flashing');
                    el.addEventListener('animationend', () => el.classList.remove('sidebar-flashing'), { once: true });
                    handleNavClick();
                  }}
                  className={cn(
                    'sidebar-nav-link flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium mb-0.5 transition-all duration-200',
                    active && 'sidebar-active'
                  )}
                  style={{
                    background: active ? 'var(--accent-dim)' : 'transparent',
                    color:      active ? 'var(--accent)' : 'var(--text-2)',
                  }}
                  onMouseEnter={(e) => { if (!active) (e.currentTarget as HTMLElement).style.background = 'var(--surface-2)'; }}
                  onMouseLeave={(e) => { if (!active) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                >
                  <item.icon className="w-[15px] h-[15px] flex-shrink-0" strokeWidth={active ? 2.5 : 2} />
                  <span className="flex-1">{item.label}</span>

                  {item.badge && (
                    <span
                      className="text-[9px] font-bold px-1.5 py-0.5 rounded"
                      style={{ background: 'var(--success-dim)', color: 'var(--success)', border: '1px solid var(--success-border)' }}
                    >
                      {item.badge}
                    </span>
                  )}

                  {item.proBadge && isFree && (
                    <span
                      className="text-[9px] font-bold px-1.5 py-0.5 rounded"
                      style={{ background: 'var(--surface-3)', color: 'var(--text-3)' }}
                    >
                      PRO
                    </span>
                  )}
                </Link>
              </React.Fragment>
            );
          })}
        </nav>

        {/* User chip */}
        <div className="p-3 border-t flex-shrink-0" style={{ borderColor: 'var(--border)' }}>
          <button
            onClick={() => { router.push('/profile'); closeSidebar(); }}
            className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl transition-colors duration-200 text-left"
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-2)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            <div
              className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold flex-shrink-0"
              style={{ background: 'var(--blue)', color: '#fff' }}
            >
              {avatar}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold truncate" style={{ color: 'var(--text-1)' }}>{name}</p>
              <p className="text-[10px]" style={{ color: 'var(--text-3)' }}>{planLabel} plan</p>
            </div>
            {/* Feature 41 — streak badge */}
            <span
              className={cn(
                'streak-badge font-mono',
                streakVisible && 'streak-visible',
                streakPulse   && 'streak-pulse'
              )}
              aria-label={streakVisible ? `${streak}-day streak` : undefined}
            >
              🔥 {streak}
            </span>
          </button>
        </div>
      </aside>

      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 lg:hidden"
          onClick={closeSidebar}
        />
      )}

      {/* Main */}
      {/* FIXED: pb-16 on mobile so content isn't hidden behind bottom nav */}
      <div className={cn(
        'flex-1 flex flex-col min-h-screen lg:pl-56',
        !isSessionPage && 'pb-16 lg:pb-0'
      )}>
        {/* Ambient background */}
        <div className="app-ambient lg:left-56">
          <div className="app-orb app-orb-1" />
          <div className="app-orb app-orb-2" />
          <div className="app-grid" />
        </div>

        {/* Topbar */}
        <header
          className="sticky top-0 z-30 h-14 flex items-center justify-between px-4 border-b backdrop-blur-xl"
          style={{ background: 'var(--nav-bg)', borderColor: 'var(--border)' }}
        >
          <div className="flex items-center gap-3">
            {/* Mobile hamburger — only shown when sidebar closed */}
            <button
              onClick={toggleSidebar}
              className="lg:hidden w-9 h-9 flex items-center justify-center rounded-lg transition-colors"
              style={{ color: 'var(--text-2)' }}
              aria-label="Open menu"
            >
              {sidebarOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
            </button>
            {/* FIXED: page title now always visible (was hidden on mobile with hidden sm:block) */}
            <span className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>
              {PAGE_TITLES[pathname] ?? 'Vachix'}
            </span>
          </div>

          <div className="flex items-center gap-1">
            <IconBtn onClick={toggleTheme} title="Toggle theme" aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}>
              {isDark
                ? <Sun className="w-4 h-4 transition-transform duration-300" />
                : <Moon className="w-4 h-4 transition-transform duration-300" />}
            </IconBtn>
            <IconBtn onClick={handleLogout} title="Sign out" aria-label="Sign out">
              <LogOut className="w-3.5 h-3.5" />
            </IconBtn>
          </div>
        </header>

        <main className="flex-1 relative z-[1]">
          {children}
        </main>
      </div>

      {/* Mobile Bottom Navigation */}
      {/* ADDED: replaces the invisible hamburger-only nav for mobile users */}
      {!isSessionPage && (
        <nav
          ref={bottomNavRef}
          className="bottom-nav-slider fixed bottom-0 left-0 right-0 z-40 lg:hidden border-t backdrop-blur-xl"
          style={{
            background: 'var(--nav-bg)',
            borderColor: 'var(--border)',
            // Safe area for iPhone home indicator
            paddingBottom: 'env(safe-area-inset-bottom)',
          }}
          aria-label="Main navigation"
        >
          <div className="flex items-stretch h-14">
            {BOTTOM_NAV.filter((n) => !(n.freeOnly && !isFree)).map((item, idx) => {
              const active = pathname === item.href || pathname.startsWith(item.href + '/');
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={(e) => {
                    // Feature 42: spring-scale the icon on tap
                    const icon = (e.currentTarget as HTMLElement).querySelector('.bn-icon') as HTMLElement | null;
                    if (icon) {
                      icon.classList.remove('bn-tapping');
                      // force reflow to restart animation
                      void icon.offsetWidth;
                      icon.classList.add('bn-tapping');
                      icon.addEventListener('animationend', () => icon.classList.remove('bn-tapping'), { once: true });
                    }
                    // Update indicator immediately (before route change)
                    const nav = bottomNavRef.current;
                    if (nav) {
                      const visibleItems = BOTTOM_NAV.filter((n) => !(n.freeOnly && !isFree));
                      const count = visibleItems.length;
                      nav.style.setProperty('--bn-ind-w', `${100 / count}%`);
                      nav.style.setProperty('--bn-ind-x', `${idx * 100}%`);
                    }
                  }}
                  className="flex-1 flex flex-col items-center justify-center gap-0.5 relative transition-colors duration-150"
                  style={{ color: active ? 'var(--accent)' : 'var(--text-3)' }}
                  aria-label={item.label}
                  aria-current={active ? 'page' : undefined}
                >
                  <item.icon
                    className="bn-icon w-5 h-5"
                    strokeWidth={active ? 2.5 : 1.8}
                  />
                  <span className="text-[10px] font-medium leading-none">{item.label}</span>
                  {item.badge && (
                    <span
                      className="absolute top-1.5 right-[calc(50%-18px)] text-[8px] font-bold px-1 rounded"
                      style={{ background: 'var(--success)', color: '#000' }}
                    >
                      {item.badge}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        </nav>
      )}
    </div>
  );
}

function IconBtn({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className="w-9 h-9 flex items-center justify-center rounded-lg border transition-colors duration-200"
      style={{ borderColor: 'var(--border)', color: 'var(--text-2)', background: 'transparent' }}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-2)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
      {...props}
    >
      {children}
    </button>
  );
}
