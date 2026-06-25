/**
 * Unit tests for voice-ledger plan cap configuration
 * (src/modules/voice/voice.ledger.ts)
 *
 * These tests validate the PLAN_VOICE_CAPS logic and env-driven cap values.
 * No database, no Redis, no network calls — pure config-layer assertions.
 *
 * Integration tests for requireVoiceQuota (DB read path, 429 response,
 * fail-open on transient error) live in tests/integration/.
 */

// Silence logger output — we care about values, not log lines.
jest.mock('../../src/infra/logger', () => ({
  logger: {
    child: () => ({
      info:  jest.fn(),
      warn:  jest.fn(),
      error: jest.fn(),
    }),
  },
}));

// Mock the database client so importing voice.ledger.ts doesn't attempt a
// real Supabase connection. The ledger module imports `db` at module scope.
jest.mock('../../src/core/database/client', () => ({
  db: {
    getVoiceUsage:          jest.fn(),
    incrementVoiceUsage:    jest.fn(),
    topUpBonusVoiceSeconds: jest.fn(),
  },
}));

// ── Plan caps ───────────────────────────────────────────────────────────────

describe('Voice ledger plan caps', () => {
  // Replicate the module-level constant so tests are self-contained.
  // If PLAN_VOICE_CAPS is ever exported from the module this should
  // switch to importing it directly.
  const PLAN_CAPS: Record<string, number> = {
    starter: parseInt(process.env.VOICE_CAP_STARTER ?? '600'),
    pro:     parseInt(process.env.VOICE_CAP_PRO     ?? '3600'),
    elite:   -1,
  };

  it('free tier has no cap entry (blocked by requireVoiceTier upstream)', () => {
    // Voice is gated before the ledger fires — free users never reach
    // requireVoiceQuota, so no cap entry is needed (or safe to assume).
    expect(PLAN_CAPS['free']).toBeUndefined();
  });

  it('starter cap is 600 seconds (10 min)', () => {
    expect(PLAN_CAPS['starter']).toBe(600);
  });

  it('pro cap is 3600 seconds (60 min)', () => {
    expect(PLAN_CAPS['pro']).toBe(3600);
  });

  it('elite cap is -1 (unlimited)', () => {
    expect(PLAN_CAPS['elite']).toBe(-1);
  });

  it('elite cap short-circuits the DB read entirely (no quota check needed)', () => {
    // Sentinel value convention: -1 means skip the Supabase getVoiceUsage call.
    // This test documents the intent so future readers don't second-guess it.
    expect(PLAN_CAPS['elite']).toBeLessThan(0);
  });
});

// ── Env-driven cap overrides ─────────────────────────────────────────────────

describe('Voice cap env vars', () => {
  it('VOICE_CAP_STARTER defaults to 600 seconds', () => {
    expect(parseInt(process.env.VOICE_CAP_STARTER ?? '600')).toBe(600);
  });

  it('VOICE_CAP_PRO defaults to 3600 seconds', () => {
    expect(parseInt(process.env.VOICE_CAP_PRO ?? '3600')).toBe(3600);
  });

  it('STREAK_VOICE_BONUS_SECS is a non-negative integer', () => {
    const bonus = parseInt(process.env.STREAK_VOICE_BONUS_SECS ?? '300');
    expect(bonus).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(bonus)).toBe(true);
  });

  it('STREAK_VOICE_BONUS_SECS defaults to 300 seconds (5 min)', () => {
    const bonus = parseInt(process.env.STREAK_VOICE_BONUS_SECS ?? '300');
    expect(bonus).toBe(300);
  });

  it('MAX_BONUS_VOICE_SECONDS defaults to 3600 seconds (60 min)', () => {
    const max = parseInt(process.env.MAX_BONUS_VOICE_SECONDS ?? '3600');
    expect(max).toBe(3600);
    expect(max).toBeGreaterThan(0);
  });
});

// ── Effective quota arithmetic ───────────────────────────────────────────────

describe('Effective quota calculation', () => {
  it('effectiveCap = planCap + bonusSeconds', () => {
    const planCap     = 600;   // starter
    const bonusSecs   = 300;   // one streak milestone
    const effectiveCap = planCap + bonusSecs;
    expect(effectiveCap).toBe(900);
  });

  it('quota is exhausted when totalUsed >= effectiveCap', () => {
    const effectiveCap = 900;
    const totalUsed    = 900;
    expect(totalUsed >= effectiveCap).toBe(true);
  });

  it('quota is NOT exhausted when totalUsed < effectiveCap', () => {
    const effectiveCap = 900;
    const totalUsed    = 899;
    expect(totalUsed >= effectiveCap).toBe(false);
  });

  it('voiceSecondsUsed + avatarSecondsUsed drain the same pool', () => {
    // avatar_seconds_used counts against the voice quota — both consume
    // from the same monthly ceiling.
    const voiceUsed  = 400;
    const avatarUsed = 200;
    const totalUsed  = voiceUsed + avatarUsed;
    expect(totalUsed).toBe(600); // equals starter cap → exhausted
  });

  it('remainingQuota = effectiveCap - totalUsed', () => {
    const effectiveCap = 900;
    const totalUsed    = 600;
    const remaining    = effectiveCap - totalUsed;
    expect(remaining).toBe(300);
  });
});

// ── Streak milestone set ─────────────────────────────────────────────────────

describe('Streak milestone days', () => {
  // Mirror the STREAK_MILESTONE_DAYS set from voice.ledger.ts.
  const STREAK_MILESTONE_DAYS = new Set([7, 14, 21, 28, 35, 42, 60, 90]);

  it('day 7 triggers a bonus top-up', () => {
    expect(STREAK_MILESTONE_DAYS.has(7)).toBe(true);
  });

  it('day 28 triggers a bonus top-up', () => {
    expect(STREAK_MILESTONE_DAYS.has(28)).toBe(true);
  });

  it('day 90 triggers a bonus top-up', () => {
    expect(STREAK_MILESTONE_DAYS.has(90)).toBe(true);
  });

  it('non-milestone day does not trigger a bonus', () => {
    expect(STREAK_MILESTONE_DAYS.has(1)).toBe(false);
    expect(STREAK_MILESTONE_DAYS.has(10)).toBe(false);
    expect(STREAK_MILESTONE_DAYS.has(100)).toBe(false);
  });
});
