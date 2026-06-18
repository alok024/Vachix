import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';

/**
 * middleware.ts
 *
 * Server-side auth GATE only — verify ss_at, redirect if missing.
 * Token refresh is NOT done here. It is handled entirely client-side
 * by ProtectedRoute (via apiCall's 401 handler in lib/api.ts).
 *
 * Why not refresh here?
 *   - Next.js rewrites strip Set-Cookie from proxied responses, so
 *     cookies set during a middleware refresh never reach the browser.
 *   - Calling the backend directly from Edge middleware is unreliable
 *     across Cloudflare Pages + Railway and causes concurrent refresh
 *     races (one per prefetch/RSC request).
 *   - The client-side refresh path in lib/api.ts already handles this
 *     correctly with deduplication (_refreshPromise) and a cooldown.
 *
 * Flow when ss_at is expired:
 *   1. Middleware sees invalid/missing ss_at → redirects to /login?next=...
 *      BUT only for full-page navigations. Prefetch/RSC requests get 401.
 *   2. /login page calls POST /api/login or the client's apiCall retries
 *      with a 401 → triggers refreshSession() in lib/api.ts → sets fresh
 *      cookies → retries the original request.
 *
 * Requires JWT_SECRET (server-side env var, NOT NEXT_PUBLIC_) to match
 * the backend's JWT_SECRET — see .env.example.
 */

const ACCESS_COOKIE  = 'ss_at';
const REFRESH_COOKIE = 'ss_rt';

const PROTECTED_PREFIXES = [
  '/dashboard',
  '/profile',
  '/history',
  '/interview',
  '/english',
  '/referral',
  '/admin',
];

const AUTH_PAGES = ['/login', '/register'];

function matchesPrefix(pathname: string, prefixes: string[]): boolean {
  return prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function getSecret(): Uint8Array | null {
  const secret = process.env.JWT_SECRET;
  if (!secret) return null;
  return new TextEncoder().encode(secret);
}

async function isValidAccessToken(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const secret = getSecret();
  if (!secret) return false;

  try {
    await jwtVerify(token, secret);
    return true;
  } catch {
    return false;
  }
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const accessToken  = req.cookies.get(ACCESS_COOKIE)?.value;

  const isProtected = matchesPrefix(pathname, PROTECTED_PREFIXES);
  const isAuthPage  = matchesPrefix(pathname, AUTH_PAGES);

  if (!isProtected && !isAuthPage) return NextResponse.next();

  const valid = await isValidAccessToken(accessToken);

 // ── /login, /register ─────────────────────────────────────────
  if (isAuthPage) {
    // Only auto-redirect away from /login when already authenticated.
    // /register stays reachable even with a valid session, since this app
    // gets used on shared devices.
    if (valid && pathname === '/login') {
      return NextResponse.redirect(new URL('/dashboard', req.url));
    }
    return NextResponse.next();
  }

  // ── Protected routes — valid token ────────────────────────────
  if (valid) return NextResponse.next();

  // ── Protected routes — no valid token ────────────────────────
  // If the user has a refresh token cookie, they have a live session —
  // let them through. The client-side apiCall will get a 401 on the
  // first /me call, trigger refreshSession(), get fresh cookies, and
  // retry. This avoids the middleware refresh race entirely.
  const hasRefreshToken = !!req.cookies.get(REFRESH_COOKIE)?.value;
  if (hasRefreshToken) {
    // Pass through — client will handle the refresh transparently.
    return NextResponse.next();
  }

  // No tokens at all — redirect to login.
  const isPrefetch = req.headers.get('next-router-prefetch') === '1';
  const isRSC      = req.headers.get('rsc') === '1';
  if (isPrefetch || isRSC) {
    // Don't redirect background requests — return 401 silently.
    return new NextResponse(null, { status: 401 });
  }

  const loginUrl = new URL('/login', req.url);
  loginUrl.searchParams.set('next', pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    '/dashboard/:path*',
    '/profile/:path*',
    '/history/:path*',
    '/interview/:path*',
    '/english/:path*',
    '/referral/:path*',
    '/admin/:path*',
    '/login',
    '/register',
  ],
};
