/**
 * Referral Service — Phase 9
 *
 * "Growth engine still missing: referral loop."
 *
 * Flow:
 *   1. User gets a unique referral code (generated on first request).
 *   2. New user signs up with ?ref=CODE → code is attributed.
 *   3. When referred user completes their FIRST session → referrer gets reward.
 *   4. Reward: +10 bonus AI calls credited to the referrer's account.
 *      (Configurable via REFERRAL_BONUS_CALLS env var.)
 *
 * ── DB schema additions (migration 003) ──────────────────────────
 *   users table:
 *     referral_code    TEXT UNIQUE  — this user's shareable code
 *     referred_by      TEXT         — code used at signup
 *     referral_bonus   INT DEFAULT 0 — extra calls granted
 *
 *   referral_events table:
 *     id               UUID PRIMARY KEY DEFAULT gen_random_uuid()
 *     referrer_id      UUID REFERENCES users(id)
 *     referred_id      UUID REFERENCES users(id)
 *     rewarded_at      TIMESTAMPTZ     — null until first session complete
 *     created_at       TIMESTAMPTZ DEFAULT now()
 *
 * ── Usage ─────────────────────────────────────────────────────────
 *   // On signup (auth.service.ts):
 *   await attributeReferral(newUserId, refCode);
 *
 *   // After first session saved (sessions.service.ts):
 *   await maybeRewardReferrer(userId);
 *
 *   // In user profile endpoint:
 *   const { code, url } = await getOrCreateReferralCode(userId);
 */

import { AppError } from '../../core/utils/errors';
import { env }    from '../../core/config/env';
import { db }     from '../../core/database/client';
import { logger } from '../../infra/logger';
import crypto     from 'crypto';

const log = logger.child({ module: 'referral' });

const BONUS_CALLS    = env.REFERRAL_BONUS_CALLS;
const BASE_URL       = env.FRONTEND_URL;

// ── Code generation ───────────────────────────────────────────────

/** 8-char alphanumeric code — human-readable, URL-safe */
function generateCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no O/0/I/1 confusion
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars[crypto.randomInt(chars.length)]; // cryptographically secure
  }
  return code;
}

// ── Public API ────────────────────────────────────────────────────

export interface ReferralInfo {
  code:         string;
  url:          string;
  uses:         number;   // how many people signed up with this code
  rewarded:     number;   // how many completed a session (reward triggered)
  bonus_calls:  number;   // total bonus calls earned
  // ── Share context ─────────────────────────────────────────────────
  // Pre-built copy for share buttons, success screens, and invite flows.
  // Computed once here so no frontend template string logic is needed.
  share_context: {
    whatsapp_url: string;   // deep-links into WhatsApp with message pre-filled
    copy_text:    string;   // plain text for "Copy link" button
    invite_headline: string; // headline for the invite card / modal
    reward_line:  string;   // e.g. "You both get 10 extra AI sessions"
  };
}

/**
 * Get (or create) the referral code for a user.
 * Safe to call on every profile page load — idempotent.
 */
export async function getOrCreateReferralCode(userId: string): Promise<ReferralInfo> {
  const user = await db.getUserById(userId);
  if (!user) throw new AppError(404, 'not_found', 'User not found');

  let code: string = ((user as unknown) as Record<string, string>).referral_code ?? '';

  if (!code) {
    // Generate a unique code (retry on collision)
    let attempts = 0;
    while (attempts < 5) {
      const candidate = generateCode();
      try {
        await db.setReferralCode(userId, candidate);
        code = candidate;
        break;
      } catch {
        attempts++;
      }
    }
    if (!code) throw new AppError(500, 'referral_code_generation_failed', 'Could not generate a unique referral code');
  }

  const stats = await db.getReferralStats(userId);

  const shareUrl    = `${BASE_URL}?ref=${code}`;
  const copyText    = `Practice English interviews with Aria on Vachix — it's genuinely helpful. Use my link and we both get ${BONUS_CALLS} extra AI sessions free: ${shareUrl}`;
  const waMessage   = encodeURIComponent(`Hey! I've been using Vachix to prep for interviews and it's really good. Try it free — we both get ${BONUS_CALLS} bonus AI sessions: ${shareUrl}`);

  return {
    code,
    url:         shareUrl,
    uses:        stats.uses,
    rewarded:    stats.rewarded,
    bonus_calls: stats.bonus_calls,
    share_context: {
      whatsapp_url:    `https://wa.me/?text=${waMessage}`,
      copy_text:       copyText,
      invite_headline: 'Invite a friend, get more sessions',
      reward_line:     `You both get ${BONUS_CALLS} extra AI sessions free`,
    },
  };
}

/**
 * Called at signup when a referral code is present in the query string.
 * Records the attribution. Reward is granted later (after first session).
 */
export async function attributeReferral(
  newUserId: string,
  refCode:   string
): Promise<void> {
  if (!refCode) return;

  try {
    const referrer = await db.getUserByReferralCode(refCode);
    if (!referrer || referrer.id === newUserId) return; // invalid or self-ref

    await db.createReferralEvent(referrer.id, newUserId);
    await db.setReferredBy(newUserId, refCode);

    log.info('Referral attributed', { referrerId: referrer.id, newUserId });
  } catch (err) {
    // Referral errors must never break signup
    log.warn('Referral attribution failed (non-fatal)', { error: (err as Error).message });
  }
}

/**
 * Called after a user's first session is saved.
 * If this user was referred, rewards their referrer with bonus calls.
 * Idempotent — reward_at check prevents double-granting.
 */
export async function maybeRewardReferrer(userId: string): Promise<void> {
  try {
    const event = await db.getPendingReferralEvent(userId);
    if (!event) return; // not referred, or already rewarded

    // Grant bonus calls to referrer
    await db.addBonusCalls(event.referrer_id, BONUS_CALLS);
    await db.markReferralRewarded(event.id);

    log.info('Referral reward granted', {
      referrerId: event.referrer_id,
      referredId: userId,
      bonusCalls: BONUS_CALLS,
    });
  } catch (err) {
    log.warn('Referral reward failed (non-fatal)', { error: (err as Error).message });
  }
}
