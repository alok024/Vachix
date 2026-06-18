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

// ── Token extraction ──────────────────────────────────────────────
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

// ── JWT payload type ──────────────────────────────────────────────

export interface JWTPayload {
  id:              string;
  email:           string;
  plan:            string;
  name:            string;
  email_verified?: boolean;   // Fix 2: added to type
  jti?:            string;
  iat?:            number;
  exp?:            number;
}

declare global {
  namespace Express {
    interface Request {
      user?:      JWTPayload;
      callCount?: number;
      // FIX H7: resolvedLimit carries the DB-authoritative plan limit (including
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

// ── Auth middleware ───────────────────────────────────────────────

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

    req.user = payload;
    next();
  } catch {
    unauthorized(res, 'Invalid or expired token', 'invalid_token');
  }
}

// ── Usage limit check ─────────────────────────────────────────────

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

    // FIX H6: Remove the req.body.free bypass from the limit gate.
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

    // FIX H7: Expose the DB-authoritative limit on the request so controllers
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
    log.error('checkUsageLimit error', { error: err });
    next(err);
  }
}

// ── Zod validation middleware ─────────────────────────────────────

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

// ── Optional auth middleware ───────────────────────────────────────
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

    req.user = payload;
  } catch {
    // Invalid/expired token on an optional-auth route — proceed anonymously
  }
  next();
}

// ── Async wrapper ─────────────────────────────────────────────────

export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res, next).catch(next);
  };
}

// ── Email-verified guard ──────────────────────────────────────────
// Fix 2: Always checks DB — never trusts potentially-stale JWT claim.
// Place after authMiddleware on any route that requires a verified email.

export async function requireVerified(
  req: Request, res: Response, next: NextFunction
): Promise<void> {
  const user = req.user!;
  try {
    const dbUser = await db.getUserById(user.id);
    // SOFT GATE: email verification hard-block disabled while SMTP is unconfirmed.
    // Blocking AI access for unverified users locks out everyone since email
    // delivery is not yet working. Log a warning and let them through.
    // TODO: restore the hard block once SMTP is verified:
    //   if (!dbUser?.email_verified) {
    //     forbidden(res, 'Please verify your email before using this feature.', 'email_not_verified');
    //     return;
    //   }
    if (!dbUser?.email_verified) {
      log.warn('Unverified user accessing AI (soft gate active)', { userId: user.id });
    }
    next();
  } catch (err) {
    log.error('requireVerified DB check failed', { userId: user.id, err });
    next(err);
  }
}

// ── Onboarding guard ──────────────────────────────────────────────
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
    const isPaid = dbUser?.plan === 'pro' || dbUser?.plan === 'elite';
    const onboardingLaunch = new Date('2026-06-16T00:00:00Z');
    const createdAt = dbUser?.created_at ? new Date(dbUser.created_at) : null;
    const isPreLaunchUser = createdAt !== null && createdAt < onboardingLaunch;

    // SOFT GATE: onboarding hard-block disabled while existing users are being backfilled.
    // TODO: restore once all users have onboarding_completed_at set and the
    // onboarding flow is confirmed working end-to-end:
    //   if (!dbUser?.onboarding_completed_at && !isPaid && !isPreLaunchUser) {
    //     forbidden(res, 'Please complete onboarding before using this feature.', 'onboarding_required');
    //     return;
    //   }
    if (!dbUser?.onboarding_completed_at && !isPaid && !isPreLaunchUser) {
      log.warn('User without onboarding accessing AI (soft gate active)', { userId: user.id });
    }
    next();
  } catch (err) {
    log.error('requireOnboarded DB check failed', { userId: user.id, err });
    next(err);
  }
}

// ── Admin guard ────────────────────────────────────────────────────
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

// ── Pro-plan guard ────────────────────────────────────────────────
// Place after authMiddleware. Blocks endpoints that are Pro/Elite only
// (e.g. ElevenLabs TTS). Always checks DB so downgrades are instant.

export async function requirePro(
  req: Request, res: Response, next: NextFunction
): Promise<void> {
  const user = req.user!;
  try {
    const dbUser = await db.getUserById(user.id);
    const plan   = (dbUser?.plan ?? 'free') as PlanType;
    if (plan === 'free') {
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
        'HD voice is a Pro feature. Upgrade to unlock Aria\'s voice.',
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

// ── Global error handler ──────────────────────────────────────────

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
  fail(res, status, code, message);
}
