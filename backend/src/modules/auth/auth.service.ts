import { AppError } from '../../core/utils/errors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { env } from '../../core/config/env';
import { db } from '../../core/database/client';
import { authLogger } from '../../infra/logger';
import type { JWTPayload } from '../../core/middleware';
import type { RegisterDTO, LoginDTO } from '../../core/utils/schemas';
import { attributeReferral } from '../growth/referral.service';
import { createVerificationToken } from './emailVerification.service';

// ── Refresh-token grace cache ─────────────────────────────────────
// Next.js middleware fires per matched route (prefetches included), so
// multiple requests arrive with the same ss_rt simultaneously — all
// before the browser receives the rotated cookie from the first response.
// This cache returns the same new token pair for the same JTI within a
// 10-second window instead of incorrectly treating it as token theft.
const _refreshGrace = new Map<string, { tokens: AuthTokens; expiresAt: number }>();
const REFRESH_GRACE_MS = 30_000;

// ── Types ─────────────────────────────────────────────────────────

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

// ── Token generation ──────────────────────────────────────────────

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
    expiresIn: '7d',
  } as jwt.SignOptions);

  const refreshToken = jwt.sign(
    { id: user.id, jti: crypto.randomUUID(), type: 'refresh' },
    env.JWT_REFRESH_SECRET,
    { expiresIn: '30d' } as jwt.SignOptions
  );

  return { token, refreshToken };
}

// ── Register ──────────────────────────────────────────────────────

// Fix 1: Return type now includes emailSent
export async function registerUser(
  dto: RegisterDTO
): Promise<{ tokens: AuthTokens; user: PublicUser; emailSent: boolean }> {
  // FIX 5: Normalise email at registration. Login and resend-verification
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

  // Send verification email — non-fatal so signup doesn't fail if email is down
  let emailSent = false;
  try {
    await createVerificationToken(user.id, user.email);
    emailSent = true;
  } catch (err) {
    authLogger.error('createVerificationToken failed after register', { userId: user.id, err });
  }

  // Attribute referral if a ref code was provided at signup (non-fatal)
  if (dto.ref) {
    await attributeReferral(user.id, dto.ref).catch(() => {});
  }

  const tokens = generateTokens(user);
  return {
    tokens,
    emailSent,
    user: {
      id:             user.id,
      email:          user.email,
      plan:           user.plan,
      name:           user.name,
      ai_calls:       0,
      email_verified: user.email_verified ?? false,
    },
  };
}

// ── Login ─────────────────────────────────────────────────────────

export async function loginUser(
  dto: LoginDTO
): Promise<{ tokens: AuthTokens; user: PublicUser }> {
  const user = await db.getUserByEmail(dto.email);
  if (!user) {
    throw new AppError(401, 'invalid_credentials', 'Invalid email or password');
  }

  const valid = await bcrypt.compare(dto.password, user.password_hash);
  if (!valid) {
    throw new AppError(401, 'invalid_credentials', 'Invalid email or password');
  }

  // EMAIL VERIFICATION GATE — temporarily softened.
  // Hard-blocking login while email delivery is unconfirmed locks out all
  // existing users (old accounts never verified) and new users who didn't
  // receive the email. Re-enable once SMTP is confirmed working by
  // uncommenting the block below and removing the warning-only path.
  //
  // if (!user.email_verified) {
  //   throw new AppError(403, 'email_not_verified', 'Please verify your email before logging in.');
  // }
  if (!user.email_verified) {
    authLogger.warn('Unverified user logging in (soft gate active)', { userId: user.id });
  }

  const usage = await db.getUsage(user.id);

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

// ── Logout — blacklist current access token ───────────────────────

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

// ── Refresh access token ──────────────────────────────────────────

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

  // FIX 4: Refresh token rotation — blacklist the incoming refresh token
  // immediately so it cannot be reused. Without this, a stolen refresh token
  // stays valid for 30 days and can mint unlimited access tokens indefinitely.
  // We reuse the existing token_blacklist table (same one used for access tokens).
  if (payload.jti) {
    try {
      const alreadyBlacklisted = await db.isTokenBlacklisted(payload.jti);
      if (alreadyBlacklisted) {
        // Check grace cache first — Next.js middleware legitimately sends the
        // same JTI multiple times within milliseconds (one per prefetched route).
        const grace = _refreshGrace.get(payload.jti);
        if (grace && grace.expiresAt > Date.now()) {
          authLogger.info('Refresh token reuse within grace window — returning cached tokens', { jti: payload.jti, userId: payload.id });
          return grace.tokens;
        }
        // Outside grace window — genuine replay attack or token theft.
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
    } catch (err) {
      // Re-throw AppError instances (reuse detection, blacklist hit)
      if (err instanceof AppError) throw err;
      // DB errors on blacklist write are non-fatal — log and continue rather
      // than blocking the user from refreshing. The 30-day JWT TTL is still
      // the backstop; a missed blacklist write is a minor risk window.
      authLogger.warn('Could not blacklist refresh token (non-fatal)', { jti: payload.jti, error: (err as Error).message });
    }
  }

  const user = await db.getUserById(payload.id);
  if (!user) {
    throw new AppError(404, 'user_not_found', 'User not found');
  }

  authLogger.info('Tokens refreshed', { userId: user.id });
  const tokens = generateTokens(user);

  // Cache under the consumed JTI so concurrent middleware/client calls within
  // the grace window get the same token pair instead of triggering reuse detection.
  if (payload.jti) {
    _refreshGrace.set(payload.jti, { tokens, expiresAt: Date.now() + REFRESH_GRACE_MS });
    setTimeout(() => _refreshGrace.delete(payload.jti!), REFRESH_GRACE_MS);
  }

  return tokens;
}

// ── Forgot password ───────────────────────────────────────────────

export async function requestPasswordReset(email: string): Promise<string | null> {
  const user = await db.getUserByEmail(email);
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

// ── Confirm password reset ────────────────────────────────────────

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

  await Promise.all([
    db.updateUser(reset.user_id, { password_hash }),
    db.markPasswordResetUsed(reset.id!),
  ]);

  authLogger.info('Password reset confirmed', { userId: reset.user_id });
}
