import { AppError } from '../../core/utils/errors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { env } from '../../core/config/env';
import { db } from '../../core/database/client';
import { authLogger } from '../../infra/logger';
import { getRedis } from '../../infra/queue/redis';
import type { JWTPayload } from '../../core/middleware';
import type { RegisterDTO, LoginDTO } from '../../core/utils/schemas';
import { attributeReferral } from '../growth/referral.service';
import { createVerificationToken } from './emailVerification.service';

// Refresh-token grace cache
// Next.js middleware fires per matched route (prefetches included), so
// multiple requests arrive with the same vachix_rt simultaneously — all
// before the browser receives the rotated cookie from the first response.
// This cache returns the same new token pair for the same JTI within a
// 30-second window instead of incorrectly treating it as token theft.
//
// The original implementation used a process-memory Map.
// Under multi-instance deployment (Railway horizontal scale) or after any
// restart, the in-memory cache is lost. This caused two problems:
// 1. False positives: the same refresh token hitting different instances
// within 30s would be flagged as token theft and log the user out.
// 2. False negatives: a stolen token replayed on a different instance
// wouldn't find the grace entry even though the DB blacklist was set.
//
// Uses Redis (EX 30s) when available, fall back to the in-process Map
// for local dev / degraded mode. The fallback is explicitly safe — in dev
// there's only one instance, so the in-process Map works correctly.
const REFRESH_GRACE_MS      = 30_000;
const REFRESH_GRACE_KEY_TTL = 30; // seconds — matches REFRESH_GRACE_MS

// In-process fallback (dev / no Redis). Never used in multi-instance prod.
const _localGrace = new Map<string, { tokens: AuthTokens; expiresAt: number }>();

async function getGraceTokens(jti: string): Promise<AuthTokens | null> {
  const redis = getRedis();
  if (redis) {
    try {
      const raw = await redis.get(`refresh:grace:${jti}`);
      if (!raw) return null;
      return JSON.parse(raw) as AuthTokens;
    } catch (err) {
      authLogger.warn('Redis grace cache GET failed — falling back to local', { jti, error: (err as Error).message });
      // Fall through to local cache
    }
  }
  const local = _localGrace.get(jti);
  if (local && local.expiresAt > Date.now()) return local.tokens;
  return null;
}

async function setGraceTokens(jti: string, tokens: AuthTokens): Promise<void> {
  const redis = getRedis();
  if (redis) {
    try {
      await redis.set(`refresh:grace:${jti}`, JSON.stringify(tokens), 'EX', REFRESH_GRACE_KEY_TTL);
      return;
    } catch (err) {
      authLogger.warn('Redis grace cache SET failed — falling back to local', { jti, error: (err as Error).message });
      // Fall through to local cache
    }
  }
  _localGrace.set(jti, { tokens, expiresAt: Date.now() + REFRESH_GRACE_MS });
  setTimeout(() => _localGrace.delete(jti), REFRESH_GRACE_MS);
}

// Access token lifetime
// Access tokens were previously valid for 7 days. Combined
// with a possibly-unavailable Redis blacklist (see grace cache above),
// that meant a compromised, suspended, or downgraded account could stay
// "valid" in the JWT claim for up to a week. The refresh-token rotation
// flow (refreshAccessToken) already mints a fresh access token transparently
// on every 401 (see frontend lib/api.ts), so a short-lived access token
// costs nothing in UX — it's silently renewed in the background.
// Exported so cookies.ts can set a matching cookie maxAge.
export const ACCESS_TOKEN_EXPIRES_IN  = '30m';
export const ACCESS_TOKEN_TTL_MS      = 30 * 60 * 1000;

// Types

export interface AuthTokens {
  token:        string;
  refreshToken: string;
}

export interface PublicUser {
  id:             string;
  email:          string;
  plan:           string;
  name:           string;
  ai_calls:       number;
  email_verified: boolean;
}

// Token generation

export function generateTokens(
  user: Pick<JWTPayload, 'id' | 'email' | 'plan' | 'name'> & { email_verified?: boolean }
): AuthTokens {
  const jti = crypto.randomUUID();

  const payload: Omit<JWTPayload, 'iat' | 'exp'> = {
    id:             user.id,
    email:          user.email,
    plan:           user.plan,
    name:           user.name || '',
    email_verified: user.email_verified ?? false,
    jti,
  };

  const token = jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: ACCESS_TOKEN_EXPIRES_IN,
  } as jwt.SignOptions);

  const refreshToken = jwt.sign(
    { id: user.id, jti: crypto.randomUUID(), type: 'refresh' },
    env.JWT_REFRESH_SECRET,
    { expiresIn: '30d' } as jwt.SignOptions
  );

  return { token, refreshToken };
}

// Register

// Return type now includes emailSent
export async function registerUser(
  dto: RegisterDTO
): Promise<{ tokens: AuthTokens; user: PublicUser; emailSent: boolean }> {
  // Normalise email at registration. Login and resend-verification
  // already normalise, but the register path passed dto.email raw — meaning
  // "User@Email.com" and "user@email.com" were stored as different accounts,
  // and the mixed-case stored value caused lookup mismatches everywhere else.
  dto = { ...dto, email: dto.email.toLowerCase().trim() };

  const existing = await db.getUserByEmail(dto.email);
  if (existing) {
    throw new AppError(409, 'email_already_registered', 'Email already registered');
  }

  const password_hash = await bcrypt.hash(dto.password, 12);

  const user = await db.createUser({
    email:         dto.email,
    password_hash,
    plan:          'free',
    name:          dto.name || '',
  });

  if (!user) throw new AppError(500, 'user_creation_failed', 'Failed to create user');

  // Initialise usage + stats rows in parallel
  await Promise.all([
    db.upsertUsage(user.id, 0),
    db.upsertStats(user.id, { streak: 0, sessions: 0, best_score: 0, total_score: 0 }),
  ]);

  authLogger.info('User registered', { userId: user.id, email: user.email });

  // If Resend is configured (RESEND_API_KEY + EMAIL_FROM), send a real
  // verification email and leave email_verified=false until the user clicks
  // the link. If not configured (local dev, or before a sending domain is set
  // up), auto-verify so the product still works end-to-end, with a warning.
  let emailSent = false;
  let verified  = user.email_verified ?? false;

  if (env.RESEND_API_KEY && env.EMAIL_FROM) {
    try {
      await createVerificationToken(user.id, user.email);
      emailSent = true;
    } catch (err) {
      // Delivery failed — don't strand the user unable to log in at all.
      // Fall back to auto-verify and let them resend later if they want to.
      authLogger.error('createVerificationToken failed — falling back to auto-verify', {
        userId:  user.id,
        error:   (err as Error)?.message,
        // err.message for AppError includes the Resend HTTP status + response
        // body (e.g. "Resend delivery failed (403): {"name":"missing_api_key"}")
        // which is invisible if err is passed directly (Error props aren't
        // JSON-serialisable, so Winston would log {}).
      });
      await db.updateUser(user.id, { email_verified: true });
      verified = true;
    }
  } else {
    authLogger.warn(
      'RESEND_API_KEY/EMAIL_FROM not configured — auto-verifying new user. ' +
      'Anyone can register with any email address while this is unset.',
      { userId: user.id }
    );
    await db.updateUser(user.id, { email_verified: true });
    verified = true;
  }

  // Attribute referral if a ref code was provided at signup (non-fatal)
  if (dto.ref) {
    await attributeReferral(user.id, dto.ref).catch(() => {});
  }

  const tokens = generateTokens({ ...user, email_verified: verified });
  return {
    tokens,
    emailSent,
    user: {
      id:             user.id,
      email:          user.email,
      plan:           user.plan,
      name:           user.name,
      ai_calls:       0,
      email_verified: verified,
    },
  };
}

// Login

export async function loginUser(
  dto: LoginDTO
): Promise<{ tokens: AuthTokens; user: PublicUser }> {
  const normalizedEmail = dto.email.toLowerCase().trim();
  const user = await db.getUserByEmail(normalizedEmail);
  if (!user) {
    throw new AppError(401, 'invalid_credentials', 'Invalid email or password');
  }

  const valid = await bcrypt.compare(dto.password, user.password_hash);
  if (!valid) {
    throw new AppError(401, 'invalid_credentials', 'Invalid email or password');
  }

  if (!user.email_verified) {
    throw new AppError(403, 'email_not_verified', 'Please verify your email before logging in.');
  }

  // db.getUsage was called unguarded — if it throws (transient
  // Supabase network blip, malformed response body, etc.) a user with
  // fully valid credentials and a verified email got a 500 instead of a
  // successful login, because the throw propagated straight out of this
  // function with nothing here to catch it. Usage count is informational
  // (`ai_calls` in the response, used for client-side display only) — it
  // must never be able to block the actual login outcome. Same non-fatal
  // treatment as incrementAIUsage/maybeRewardReferrer elsewhere in this
  // codebase: log and degrade to 0 rather than fail the request.
  let usage: Awaited<ReturnType<typeof db.getUsage>> = null;
  try {
    usage = await db.getUsage(user.id);
  } catch (err) {
    authLogger.warn('getUsage failed during login (non-fatal, defaulting ai_calls to 0)', {
      userId: user.id, error: (err as Error).message,
    });
  }

  authLogger.info('User logged in', { userId: user.id });

  const tokens = generateTokens({ ...user, email_verified: true });
  return {
    tokens,
    user: {
      id:             user.id,
      email:          user.email,
      plan:           user.plan,
      name:           user.name,
      ai_calls:       usage?.call_count ?? 0,
      email_verified: user.email_verified ?? false,
    },
  };
}

// Logout — blacklist current access token

export async function logoutUser(
  jti:       string,
  userId:    string,
  expiresAt: Date
): Promise<void> {
  await db.blacklistToken({
    token_jti:  jti,
    user_id:    userId,
    expires_at: expiresAt.toISOString(),
  });
  authLogger.info('Token blacklisted on logout', { userId, jti });
}

// Refresh access token

export async function refreshAccessToken(refreshToken: string): Promise<AuthTokens> {
  let payload: { id: string; jti?: string; type: string; exp?: number };
  try {
    payload = jwt.verify(refreshToken, env.JWT_REFRESH_SECRET) as {
      id: string; jti?: string; type: string; exp?: number;
    };
  } catch {
    throw new AppError(401, 'invalid_refresh_token', 'Invalid or expired refresh token');
  }

  if (payload.type !== 'refresh') {
    throw new AppError(401, 'invalid_token_type', 'Invalid token type');
  }

  // Refresh token rotation — blacklist the incoming refresh token
  // immediately so it cannot be reused. Without this, a stolen refresh token
  // stays valid for 30 days and can mint unlimited access tokens indefinitely.
  // We reuse the existing token_blacklist table (same one used for access tokens).
  // Track whether the blacklist write confirmed so the grace cache is only
  // populated when the JTI is genuinely blacklisted. Populating it on a
  // DB error would let subsequent requests within the grace window bypass
  // reuse detection for a token that was never actually persisted.
  let blacklistConfirmed = false;
  if (payload.jti) {
    try {
      const alreadyBlacklisted = await db.isTokenBlacklisted(payload.jti);
      if (alreadyBlacklisted) {
        // Use Redis-backed grace cache (works across instances).
        const cachedTokens = await getGraceTokens(payload.jti);
        if (cachedTokens) {
          authLogger.info('Refresh token reuse within grace window — returning cached tokens', { jti: payload.jti, userId: payload.id });
          return cachedTokens;
        }
        authLogger.warn('Refresh token reuse detected — possible token theft', { jti: payload.jti, userId: payload.id });
        throw new AppError(401, 'refresh_token_reused', 'Refresh token has already been used. Please log in again.');
      }

      const expiresAt = payload.exp
        ? new Date(payload.exp * 1000)
        : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

      await db.blacklistToken({
        token_jti:  payload.jti,
        user_id:    payload.id,
        expires_at: expiresAt.toISOString(),
      });
      blacklistConfirmed = true;
    } catch (err) {
      if (err instanceof AppError) throw err;
      authLogger.warn('Could not blacklist refresh token (non-fatal)', { jti: payload.jti, error: (err as Error).message });
    }
  }

  const user = await db.getUserById(payload.id);
  if (!user) {
    throw new AppError(404, 'user_not_found', 'User not found');
  }

  authLogger.info('Tokens refreshed', { userId: user.id });
  const tokens = generateTokens(user);

  // Only populate the grace cache when the blacklist write succeeded.
  // If the write failed, the JTI was never persisted — caching it here
  // would let concurrent requests bypass reuse detection for free.
  // setGraceTokens writes to Redis (EX 30s) so the entry
  // is visible across all instances, not just the one that handled this refresh.
  if (payload.jti && blacklistConfirmed) {
    await setGraceTokens(payload.jti, tokens);
  }

  return tokens;
}

// Forgot password

export async function requestPasswordReset(email: string): Promise<string | null> {
  const user = await db.getUserByEmail(email.toLowerCase().trim());
  if (!user) return null; // silent — never reveal whether email exists

  // Invalidate any existing unused reset tokens before issuing a new one
  // so only one link is ever valid at a time.
  await db.invalidatePasswordResets(user.id);

  const resetToken = crypto.randomBytes(32).toString('hex');
  // Store only the SHA-256 hash — raw token is never persisted.
  // (Same pattern as email verification tokens.)
  const tokenHash  = crypto.createHash('sha256').update(resetToken).digest('hex');
  const expiresAt  = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour

  await db.createPasswordReset({ user_id: user.id, token: tokenHash, expires_at: expiresAt });

  authLogger.info('Password reset token created', { userId: user.id });
  return resetToken; // raw token — goes into the email link only
}

// Confirm password reset

export async function confirmPasswordReset(
  token:       string,
  newPassword: string
): Promise<void> {
  // Hash the raw token before lookup — DB only stores the hash
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const reset = await db.getPasswordReset(tokenHash);

  if (!reset || reset.used) {
    throw new AppError(400, 'invalid_reset_token', 'Invalid or expired reset token');
  }

  if (new Date(reset.expires_at) < new Date()) {
    throw new AppError(400, 'reset_token_expired', 'Reset token has expired');
  }

  const password_hash = await bcrypt.hash(newPassword, 12);

  // Stamp tokens_invalidated_at so authMiddleware rejects
  // any access token issued before this moment. Without this, a stolen session
  // token remains valid until its own expiry (ACCESS_TOKEN_EXPIRES_IN, 30
  // minutes — formerly 7 days) even after the user resets their password.
  // The timestamp is checked in authMiddleware against payload.iat —
  // tokens older than this value are rejected with 'session_invalidated'.
  const nowIso = new Date().toISOString();

  await Promise.all([
    db.updateUser(reset.user_id, { password_hash, tokens_invalidated_at: nowIso }),
    db.markPasswordResetUsed(reset.id!),
  ]);

  authLogger.info('Password reset confirmed', { userId: reset.user_id });
}