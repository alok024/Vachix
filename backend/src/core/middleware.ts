import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { z, ZodSchema } from 'zod';
import { env } from './config/env';
import { db } from './database/client';
import { PLAN_LIMITS, PlanType } from './config/env';
import { logger } from '../infra/logger';
import { unauthorized, forbidden, badRequest, fail } from './utils/response';
import { AppError } from './utils/errors';
import { trackEvent } from '../modules/analytics/events.service';
import { ACCESS_COOKIE } from '../modules/auth/cookies';
import { setContextUserId } from '../infra/request-context';

// Token extraction
// Prefers the httpOnly access-token cookie (set by login/register/refresh).
// Falls back to the Authorization header for non-browser clients (mobile
// apps, server-to-server calls, tests) that can't rely on cookies.
function extractToken(req: Request): string | null {
  const cookieToken = req.cookies?.[ACCESS_COOKIE];
  if (cookieToken) return cookieToken;

  const header = req.headers['authorization'];
  if (header) return header.replace('Bearer ', '').trim();

  return null;
}

const log = logger.child({ module: 'middleware' });

// JWT payload type

export interface JWTPayload {
  id:              string;
  email:           string;
  plan:            string;
  name:            string;
  email_verified?: boolean;   // added to type
  jti?:            string;
  iat?:            number;
  exp?:            number;
}

declare global {
  namespace Express {
    interface Request {
      user?:      JWTPayload;
      callCount?: number;
      // resolvedLimit carries the DB-authoritative plan limit (including
      // referral bonus calls) so controllers don't re-derive it from the JWT plan,
      // which can be stale immediately after an upgrade.
      resolvedLimit?: number;
      usageWarning?: {
        remaining: number;
        limit:     number;
        level:     'none' | 'strip' | 'modal';
      };
    }
  }
}

// Auth middleware

export async function authMiddleware(
  req: Request, res: Response, next: NextFunction
): Promise<void> {
  const token = extractToken(req);
  if (!token) { unauthorized(res, 'No token provided', 'no_token'); return; }

  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as JWTPayload;

    if (payload.jti) {
      try {
        const blacklisted = await db.isTokenBlacklisted(payload.jti);
        if (blacklisted) {
          unauthorized(res, 'Token has been revoked. Please log in again.', 'token_revoked');
          return;
        }
      } catch {
        log.warn('Token blacklist check failed (non-fatal)', { jti: payload.jti });
      }
    }

    // Reject tokens issued before a password reset.
    // When a user resets their password, tokens_invalidated_at is stamped on
    // their DB row. Any token with iat < tokens_invalidated_at was issued
    // before the reset and must be treated as revoked — even if it hasn't
    // expired yet and isn't individually blacklisted. This closes the window
    // where a compromised session token remains valid after a password change.
    //
    // We only do this DB lookup when the JWT carries an iat claim (always true
    // for tokens we issue). The check is a fast indexed column read on the
    // users table — same table already read by checkUsageLimit downstream,
    // so it doesn't add a new DB round-trip for protected routes that already
    // run checkUsageLimit. For auth-only routes (logout, refresh) it's one
    // extra read, which is acceptable for the security guarantee.
    if (payload.iat) {
      try {
        const dbUser = await db.getUserById(payload.id);
        if (dbUser?.tokens_invalidated_at) {
          const invalidatedAt = new Date(dbUser.tokens_invalidated_at).getTime() / 1000;
          if (payload.iat < invalidatedAt) {
            unauthorized(res, 'Session invalidated. Please log in again.', 'session_invalidated');
            return;
          }
        }
      } catch {
        // Non-fatal: if the DB check fails, let the request through rather
        // than blocking all authenticated users during a DB hiccup.
        log.warn('tokens_invalidated_at check failed (non-fatal)', { userId: payload.id });
      }
    }

    req.user = payload;
    // Propagate userId into the AsyncLocalStorage request context so
    // every downstream log call (services, ledgers) includes userId
    // automatically — no manual threading required.
    setContextUserId(payload.id);
    next();
  } catch {
    unauthorized(res, 'Invalid or expired token', 'invalid_token');
  }
}

// Usage limit check

export async function checkUsageLimit(
  req: Request, res: Response, next: NextFunction
): Promise<void> {
  const user = req.user!;

  try {
    const [dbUser, usage] = await Promise.all([db.getUserById(user.id), db.getUsage(user.id)]);

    // Always use the DB plan — JWT plan can be stale after an upgrade
    const actualPlan  = (dbUser?.plan as PlanType) ?? (user.plan as PlanType);
    const baseLimit   = PLAN_LIMITS[actualPlan]?.ai_calls ?? 30;
    const callCount   = usage?.call_count ?? 0;

    // Referral bonus calls are added on top of the base free limit
    const bonusCalls  = (dbUser as unknown as Record<string, number>)?.referral_bonus ?? 0;
    const actualLimit = baseLimit === -1 ? -1 : baseLimit + bonusCalls;

    req.callCount = callCount;

    // Remove the req.body.free bypass from the limit gate.
    // Clients could previously send { free: true } to skip the hard wall entirely.
    // The /api/ai/free route now handles non-counted calls — path is set by the
    // server's routing, not the client body. The middleware always enforces the
    // hard limit; the controller on /free simply skips the usage increment.
    if (actualLimit !== -1 && callCount >= actualLimit) {
      fail(res, 403, 'limit_reached', `You have used all ${actualLimit} AI sessions for your ${actualPlan} plan.`, {
        calls_used: callCount,
        limit:      actualLimit,
      });
      return;
    }

    // Expose the DB-authoritative limit on the request so controllers
    // don't fall back to PLAN_LIMITS[user.plan] (the JWT plan), which is stale
    // immediately after an upgrade until the user re-authenticates.
    req.resolvedLimit = actualLimit;

    // Progressive monetization signals — let the frontend ramp pressure
    // instead of cliff-edging the user straight into a hard wall.
    // remaining: calls left after this one completes
    // warningLevel: 'none' | 'strip' (5/7+) | 'modal' (6/7+)
    if (actualLimit !== -1) {
      const remaining = Math.max(actualLimit - callCount - 1, 0);
      let warningLevel: 'none' | 'strip' | 'modal' = 'none';
      if (callCount >= actualLimit - 1) warningLevel = 'modal';      // about to use last call (6/7)
      else if (callCount >= actualLimit - 2) warningLevel = 'strip'; // 5/7

      res.setHeader('X-Usage-Remaining', String(remaining));
      res.setHeader('X-Usage-Limit', String(actualLimit));
      res.setHeader('X-Usage-Warning', warningLevel);
      req.usageWarning = { remaining, limit: actualLimit, level: warningLevel };
    }

    next();
  } catch (err) {
    log.error('checkUsageLimit error', { userId: user.id, error: err });
    next(err);
  }
}

// Zod validation middleware

export function validate(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      badRequest(res, 'Validation failed', 'validation_failed', result.error.flatten().fieldErrors);
      return;
    }
    req.body = result.data;
    next();
  };
}

// defense-in-depth — reject malformed :id-style route params before
// they're interpolated into a PostgREST filter. The ownership filter
// (user_id=eq....) still gates access, so this isn't a full IDOR fix on
// its own, but it stops obviously-malformed/injection-shaped values from
// ever reaching the query string.
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export function validateUUIDParam(paramName: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const value = req.params[paramName];
    if (!value || !UUID_RE.test(value)) {
      badRequest(res, `Invalid ${paramName}`, 'invalid_param');
      return;
    }
    next();
  };
}

// Optional auth middleware
// Attaches req.user if a valid token is present, but never rejects the
// request — used for endpoints that work for both logged-in and
// anonymous users (e.g. event tracking).

export async function optionalAuth(
  req: Request, _res: Response, next: NextFunction
): Promise<void> {
  const token = extractToken(req);
  if (!token) { next(); return; }

  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as JWTPayload;

    if (payload.jti) {
      try {
        const blacklisted = await db.isTokenBlacklisted(payload.jti);
        if (blacklisted) { next(); return; }
      } catch {
        log.warn('Token blacklist check failed (non-fatal)', { jti: payload.jti });
      }
    }

    // H-4: Mirror authMiddleware's tokens_invalidated_at check.
    // A token issued before a password reset must be treated as revoked
    // even on optional-auth routes — once any optionalAuth route starts
    // exposing user-scoped data, a pre-reset token would otherwise grant
    // access. Non-fatal: DB failure falls through to anonymous, not error.
    if (payload.iat) {
      try {
        const dbUser = await db.getUserById(payload.id);
        if (dbUser?.tokens_invalidated_at) {
          const invalidatedAt = new Date(dbUser.tokens_invalidated_at).getTime() / 1000;
          if (payload.iat < invalidatedAt) { next(); return; }
        }
      } catch {
        log.warn('tokens_invalidated_at check failed (non-fatal)', { userId: payload.id });
      }
    }

    req.user = payload;
  } catch {
    // Invalid/expired token on an optional-auth route — proceed anonymously
  }
  next();
}

// Async wrapper

export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res, next).catch(next);
  };
}

// Email-verified guard
// Always checks DB — never trusts potentially-stale JWT claim.
// Place after authMiddleware on any route that requires a verified email.

export async function requireVerified(
  req: Request, res: Response, next: NextFunction
): Promise<void> {
  const user = req.user!;
  try {
    const dbUser = await db.getUserById(user.id);
    if (!dbUser?.email_verified) {
      forbidden(res, 'Please verify your email before using this feature.', 'email_not_verified');
      return;
    }
    next();
  } catch (err) {
    log.error('requireVerified DB check failed', { userId: user.id, err });
    next(err);
  }
}

// Onboarding guard
// Place after authMiddleware (and optionally after requireVerified).
// Blocks AI + session routes until the user has completed onboarding.
// Returns a structured 403 that the frontend can detect and redirect.
// Exempt routes: POST /api/onboarding itself (user.routes.ts skips this).

export async function requireOnboarded(
  req: Request, res: Response, next: NextFunction
): Promise<void> {
  const user = req.user!;
  try {
    const dbUser = await db.getUserById(user.id);

    // Paid users (pro/elite) and pre-launch accounts are exempt from the
    // onboarding gate — they either predated the feature or paid without
    // completing it. Blocking them from AI calls would break their experience.
    const isPaid = dbUser?.plan === 'pro' || dbUser?.plan === 'elite' || dbUser?.plan === 'starter';
    const onboardingLaunch = new Date('2026-06-16T00:00:00Z');
    const createdAt = dbUser?.created_at ? new Date(dbUser.created_at) : null;
    const isPreLaunchUser = createdAt !== null && createdAt < onboardingLaunch;

    if (!dbUser?.onboarding_completed_at && !isPaid && !isPreLaunchUser) {
      forbidden(res, 'Please complete onboarding before using this feature.', 'onboarding_required');
      return;
    }
    next();
  } catch (err) {
    log.error('requireOnboarded DB check failed', { userId: user.id, err });
    next(err);
  }
}

// Admin guard
// Place after authMiddleware. Checks the DB is_admin flag — never trusts
// the JWT, since admin status can be revoked without re-issuing tokens.

export async function requireAdmin(
  req: Request, res: Response, next: NextFunction
): Promise<void> {
  const user = req.user!;
  try {
    const dbUser = await db.getUserById(user.id);
    if (!dbUser?.is_admin) {
      forbidden(res, 'Forbidden: admin access required', 'admin_required');
      return;
    }
    next();
  } catch (err) {
    log.error('requireAdmin DB check failed', { userId: user.id, err });
    next(err);
  }
}

// Pro-plan guard
// Place after authMiddleware. Blocks endpoints that are Pro/Elite only
// (e.g. ElevenLabs TTS). Always checks DB so downgrades are instant.

export async function requirePro(
  req: Request, res: Response, next: NextFunction
): Promise<void> {
  const user = req.user!;
  try {
    const dbUser = await db.getUserById(user.id);
    const plan   = (dbUser?.plan ?? 'free') as PlanType;
    if (plan !== 'pro' && plan !== 'elite') {
      // Track the upsell moment so we can measure voice → upgrade conversion.
      // Fire-and-forget — never blocks the rejection.
      trackEvent({
        event:  'upsell_shown',
        userId: user.id,
        plan,
        properties: { trigger: 'hd_voice', path: req.path },
      });
      forbidden(
        res,
        'HD voice is a Pro feature. Upgrade to hear Aria and Elara speak their feedback.',
        'pro_required',
      );
      return;
    }
    next();
  } catch (err) {
    log.error('requirePro DB check failed', { userId: user.id, err });
    next(err);
  }
}

// Generic Starter+ guard
// Place after authMiddleware. Same plan check as requireVoiceTier (Starter,
// Pro, Elite all pass), but for non-voice Starter+ features — e.g. the
// Interview Readiness Report (every-5-sessions rollup summary). Kept
// separate from requireVoiceTier rather than reused directly so the
// upsell event/message stays accurate per feature instead of always
// saying "HD voice" for things that aren't voice.
// Always checks DB so downgrades are instant, same as requireVoiceTier/requirePro.

export async function requireStarterTier(
  req: Request, res: Response, next: NextFunction
): Promise<void> {
  const user = req.user!;
  try {
    const dbUser = await db.getUserById(user.id);
    const plan   = (dbUser?.plan ?? 'free') as PlanType;
    if (plan !== 'starter' && plan !== 'pro' && plan !== 'elite') {
      trackEvent({
        event:  'upsell_shown',
        userId: user.id,
        plan,
        properties: { trigger: 'readiness_report', path: req.path },
      });
      forbidden(
        res,
        'The Interview Readiness Report requires Starter or higher. Upgrade to unlock your rolling readiness summary.',
        'starter_tier_required',
      );
      return;
    }
    next();
  } catch (err) {
    log.error('requireStarterTier DB check failed', { userId: user.id, err });
    next(err);
  }
}

// Voice-tier guard
// Place after authMiddleware. Gates the metered HD-voice endpoint
// (/api/voice/tts) to any paying plan — Starter, Pro, and Elite — while
// the true Free tier stays on the once-per-day warm-up route instead.
// Distinct from requirePro (which stays Pro/Elite-only for genuinely
// Pro+-exclusive features like full session history) because the voice
// usage ledger (migration 011_voice_usage_ledger.sql) already defines a
// real, metered Starter allowance via VOICE_CAP_STARTER — Starter users
// have paid for capped HD voice, not the once-a-day free taste.
// Always checks DB so downgrades are instant, same as requirePro.

export async function requireVoiceTier(
  req: Request, res: Response, next: NextFunction
): Promise<void> {
  const user = req.user!;
  try {
    const dbUser = await db.getUserById(user.id);
    const plan   = (dbUser?.plan ?? 'free') as PlanType;
    if (plan !== 'starter' && plan !== 'pro' && plan !== 'elite') {
      // Track the upsell moment so we can measure voice → upgrade conversion.
      // Fire-and-forget — never blocks the rejection.
      trackEvent({
        event:  'upsell_shown',
        userId: user.id,
        plan,
        properties: { trigger: 'hd_voice', path: req.path },
      });
      forbidden(
        res,
        'HD voice requires Starter or higher. Upgrade to hear Aria and Elara speak their feedback.',
        'voice_tier_required',
      );
      return;
    }
    next();
  } catch (err) {
    log.error('requireVoiceTier DB check failed', { userId: user.id, err });
    next(err);
  }
}

// Global error handler

export function errorHandler(
  err: Error & { statusCode?: number; code?: string },
  _req: Request, res: Response, _next: NextFunction
): void {
  // Attach requestId to every error response envelope so clients and logs
  // can correlate frontend error reports with server-side stack traces.
  const requestId = (_req as Request & { requestId?: string }).requestId;
  // AppError (and subclasses) carry their own status + code.
  // Plain errors with a .statusCode duck-type the same interface.
  const status  = (err as AppError).statusCode ?? 500;
  const code    = (err as AppError).code ?? (status < 500 ? 'request_error' : 'internal_error');
  const message = status < 500 ? err.message : 'Internal server error';

  if (status >= 500) {
    log.error('Unhandled error', {
      requestId: ((_req as unknown) as { requestId?: string }).requestId,
      name:      err.name,
      message:   err.message,
      code,
      stack:     err.stack,
    });
  }

  if (requestId) res.setHeader('X-Request-Id', requestId);

  // Forward structured details from AppError (e.g. session_limit_reached
  // includes resets_at + session_limit so the client can show the reset date
  // without a follow-up request).
  const details = (err as AppError).details;
  if (details !== undefined) {
    fail(res, status, code, message, details);
  } else {
    fail(res, status, code, message);
  }
}

// sessions.id is int8 (bigint) in Postgres — not a UUID. Routes that
// accept a session id in a path param must validate it as a positive
// integer, not a UUID. validateUUIDParam on those routes was incorrect
// and caused every real API call (GET /sessions/:id, certificate-token,
// share-token, compare) to return 400 for valid numeric session IDs.
export function validateIntParam(paramName: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const value = req.params[paramName];
    const n = Number(value);
    if (!value || !Number.isInteger(n) || n <= 0) {
      badRequest(res, `Invalid ${paramName}`, 'invalid_param');
      return;
    }
    next();
  };
}
