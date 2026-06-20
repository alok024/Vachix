/**
 * lib/api.ts
 *
 * Core `apiCall()` fetch wrapper (auth refresh, error shape),
 * `extractErrorMessage`, and `BACKEND_URL`.
 *
 * Nothing else belongs here — endpoint-specific calls live in each
 * feature's `api/index.ts` (see `features/README.md`).
 */
import type { ApiResult } from '@/types';
import { useAuthStore } from '@/store/auth';

// M13: previously fell straight through to the production Railway URL
// whenever NEXT_PUBLIC_BACKEND_URL was unset, so a developer who forgot
// to add it to .env.local would have their local frontend silently hit
// production — corrupting prod analytics events, test sessions, etc.,
// with no error to indicate why. Fail loudly in development instead;
// production/preview builds still get the documented fallback so a
// missing env var there doesn't take the whole app down.
function resolveBackendUrl(): string {
  const configured = process.env.NEXT_PUBLIC_BACKEND_URL;
  if (configured) return configured;

  if (process.env.NODE_ENV === 'development') {
    throw new Error(
      'NEXT_PUBLIC_BACKEND_URL is not set. Add it to .env.local — ' +
      'without it, local development would silently hit the production backend.'
    );
  }

  return 'https://vachix-production.up.railway.app';
}

export const BACKEND_URL = resolveBackendUrl();

// Free-tier AI call limit is defined server-side in env.ts (PLAN_LIMITS.free.ai_calls)
// and returned per-user via usage.limit in the /me response.
// Do not add a hardcoded limit here — use the server value from the auth store.

// Auth
// Tokens live in httpOnly cookies (vachix_at / vachix_rt) set by the backend.
// JS never reads or writes them — XSS can't exfiltrate a session.
// All requests go through Next.js's /api/* rewrite (next.config.ts),
// which proxies to BACKEND_URL. From the browser's point of view this
// is same-origin, so the cookies set by the backend land on *this*
// domain and are sent automatically with `credentials: 'include'`.

// Core fetch wrapper (with auto-refresh on 401)

let _refreshPromise: Promise<boolean> | null = null;
let _lastRefreshAt = 0;

// 60-second cooldown: middleware no longer does refresh, so the client
// is the sole refresh path. Once a refresh succeeds, any 401s within
// the next 60s are stale in-flight requests that just need a retry —
// not new refresh triggers. 60s >> typical request round-trip time.
const REFRESH_COOLDOWN_MS = 60_000;

export async function apiCall<T = unknown>(
  endpoint: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' = 'GET',
  body?: unknown,
  _retry = true,   // internal: prevents infinite refresh loop
): Promise<ApiResult<T>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  const opts: RequestInit = { method, headers, credentials: 'include' };
  if (body) opts.body = JSON.stringify(body);

  try {
    const res = await fetch(`/api${endpoint}`, opts);
    let data: unknown;
    try { data = await res.json(); } catch { data = {}; }

    // Silent token refresh on 401
    if (res.status === 401 && _retry) {
      const now = Date.now();
      const cooldownActive = now - _lastRefreshAt < REFRESH_COOLDOWN_MS;

      // Snapshot the user this request started with — if login/logout
      // races ahead of this refresh, we don't want to clear a session
      // that isn't this one anymore.
      const userAtRequestStart = useAuthStore.getState().user;

      if (!cooldownActive) {
        // Deduplicate concurrent refresh requests — only one fetch to
        // /api/refresh-token goes out regardless of how many parallel
        // requests hit 401 simultaneously.
        if (!_refreshPromise) {
          _refreshPromise = refreshSession().finally(() => {
            _lastRefreshAt = Date.now();
            _refreshPromise = null;
          });
        }

        const refreshed = await _refreshPromise;
        if (refreshed) {
          // Retry original request once — browser now has fresh cookies.
          return apiCall<T>(endpoint, method, body, false);
        }
      } else {
        // Cooldown active — a refresh just completed. The 401 is a
        // stale in-flight request; just retry with the fresh cookies
        // that are already in the browser without calling refresh again.
        return apiCall<T>(endpoint, method, body, false);
      }

      // Refresh is dead — real cookie's gone, nothing left to retry.
      // Clear the cached user so isAuthenticated() stops lying, otherwise
      // every gated query (UpgradeModal's useMe, etc.) keeps re-firing
      // this same 401 and we loop on /login forever.
      //
      // Only do it if the session hasn't changed since we started —
      // a login that landed mid-flight already has its own valid user,
      // don't stomp it.
      const sessionUnchanged = useAuthStore.getState().user === userAtRequestStart;

      if (typeof window !== 'undefined' && sessionUnchanged) {
        useAuthStore.getState().clearSession();

        // Already on /login — nowhere to redirect to, and trying anyway
        // is exactly what causes the loop.
        if (window.location.pathname !== '/login') {
          const next = encodeURIComponent(window.location.pathname + window.location.search);
          window.location.href = `/login?next=${next}`;
        }
      }
      return {
        ok: false,
        status: 401,
        error: { code: 'session_expired', message: 'Session expired. Please log in again.' },
      };
    }

    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: (data as { error?: { code: string; message: string } | string })?.error
          ?? { code: 'unknown', message: 'Request failed' },
      };
    }

    // Backend success responses are wrapped as { success: true, data: <payload> }.
    // Unwrap here so callers' `res.data` is the actual payload (e.g. `res.data.user`),
    // matching the error path below which already reads the flat `error` field.
    return { ok: true, data: (data as { data?: unknown })?.data as T };
  } catch {
    return {
      ok: false,
      status: 0,
      error: { code: 'network_error', message: 'Could not connect to server.' },
    };
  }
}

// Refresh — exchanges the httpOnly refresh cookie for a new access
// cookie. The backend reads vachix_rt and sets fresh vachix_at/vachix_rt cookies on
// the response. Goes through the Next.js /api rewrite (same-origin),
// which means the Set-Cookie headers DO land on the browser correctly —
// unlike middleware's server-side fetch which goes through the rewrite
// proxy and has Set-Cookie stripped.
async function refreshSession(): Promise<boolean> {
  try {
    const res = await fetch('/api/refresh-token', {
      method: 'POST',
      credentials: 'include',
    });
    return res.ok;
  } catch {
    return false;
  }
}

// Error message extraction
//
// L4: error envelopes from the backend may include `request_id` — the
// same correlation ID logged server-side and sent as the X-Request-Id
// header (see core/utils/response.ts). When present, append it as a
// "(Error ref: ...)" suffix so a user reporting "AI error — please try
// again" gives support something to grep logs/Sentry for.
type ApiErrorShape = { code: string; message: string; request_id?: string } | string | undefined;

/** Extracts the backend-provided request/correlation ID, if any. */
export function getErrorRequestId(error: ApiErrorShape): string | undefined {
  if (!error || typeof error === 'string') return undefined;
  return error.request_id;
}

export function extractErrorMessage(error: ApiErrorShape): string {
  if (!error) return 'Something went wrong.';
  if (typeof error === 'string') return error;
  const base = error.message || 'Something went wrong.';
  return error.request_id ? `${base} (Error ref: ${error.request_id})` : base;
}

/**
 * Appends a "(Error ref: ...)" suffix to a custom message when the backend
 * error envelope carried a request_id. Use this for hand-written messages
 * (e.g. "Failed to generate questions...") that don't come from
 * error.message directly.
 */
export function withErrorRef(message: string, error: ApiErrorShape): string {
  const ref = getErrorRequestId(error);
  return ref ? `${message} (Error ref: ${ref})` : message;
}