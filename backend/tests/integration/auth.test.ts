/**
 * Auth route integration tests — POST /api/login
 *
 * Uses supertest against the real Express app with the full routing and
 * middleware stack (rate limiter, Zod validation, error handler).
 *
 * Mocked layers:
 *   - db (../../src/core/database/client)    — no real Supabase calls
 *   - infra/logger                            — silence winston in CI
 *   - infra/observability (Sentry)            — no external calls at boot
 *   - infra/load-monitor                      — no setInterval noise
 *   - infra/queue/dispatcher                  — no BullMQ / Redis at boot
 *   - modules/analytics/*                     — no event flush / VAPID init
 *   - modules/growth/referral.service         — not needed for login path
 *
 * Note on the rate-limit test: express-rate-limit uses an in-memory store
 * keyed by IP. supertest always sends from 127.0.0.1 and the global limiter
 * in app.ts is 200/min — well above the loginLimiter threshold of 10/min.
 * Firing 11 sequential requests from the same IP guarantees at least one 429.
 * We run them sequentially (not Promise.all) so the store increments
 * deterministically before we read the statuses.
 */

import request from 'supertest';
import bcrypt  from 'bcryptjs';

// ── Infrastructure mocks (must precede any app import) ───────────────────────

const silentChild = () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
});

jest.mock('../../src/infra/logger', () => ({
  logger:             { child: silentChild, ...silentChild() },
  authLogger:         silentChild(),
  paymentLogger:      silentChild(),
  aiLogger:           silentChild(),
  subscriptionLogger: silentChild(),
}));

jest.mock('../../src/infra/observability', () => ({
  initSentry:       jest.fn().mockResolvedValue(undefined),
  captureException: jest.fn(),
  getMetrics:       jest.fn().mockReturnValue({}),
}));

jest.mock('../../src/infra/load-monitor', () => ({
  startLoadMonitor:   jest.fn(),
  getSystemLoadStats: jest.fn().mockReturnValue({}),
}));

jest.mock('../../src/infra/ai-limiter', () => ({
  getAILimiterStats: jest.fn().mockReturnValue({}),
}));

jest.mock('../../src/infra/circuit-breaker', () => ({
  groqBreaker:    { getState: jest.fn().mockReturnValue({ state: 'CLOSED', failures: 0 }) },
  openaiBreaker:  { getState: jest.fn().mockReturnValue({ state: 'CLOSED', failures: 0 }) },
  CircuitBreaker: jest.fn(),
}));

jest.mock('../../src/infra/queue/dispatcher', () => ({
  scheduleSubscriptionExpiry:  jest.fn().mockResolvedValue(undefined),
  scheduleSessionExpiry:       jest.fn().mockResolvedValue(undefined),
  scheduleBlacklistCleanup:    jest.fn(),
  scheduleComparisonCleanup:   jest.fn(),
  scheduleWeeklyProgressCards: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../src/modules/analytics/weekly-card.service', () => ({
  initVapid: jest.fn(),
}));

jest.mock('../../src/modules/analytics/events.service', () => ({
  registerShutdownFlush: jest.fn(),
  trackEvent:            jest.fn(),
}));

jest.mock('../../src/modules/growth/referral.service', () => ({
  getOrCreateReferralCode: jest.fn(),
}));

// ── DB mock ───────────────────────────────────────────────────────────────────

jest.mock('../../src/core/database/client', () => ({
  db: {
    getUserByEmail:     jest.fn(),
    getUserById:        jest.fn(),
    createUser:         jest.fn(),
    getUsage:           jest.fn(),
    isTokenBlacklisted: jest.fn().mockResolvedValue(false),
    createUsage:        jest.fn(),
  },
}));

// ── App + db ──────────────────────────────────────────────────────────────────

import app from '../../src/app';
import { db } from '../../src/core/database/client';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Minimal valid UserRow for a verified, active user. */
async function buildFakeUser(overrides: Partial<{
  id: string;
  email: string;
  password: string;
  plan: string;
  email_verified: boolean;
}> = {}) {
  const {
    id             = 'user-uuid-login-test',
    email          = 'test@vachix.in',
    password       = 'ValidPass123',
    plan           = 'free',
    email_verified = true,
  } = overrides;

  const password_hash = await bcrypt.hash(password, 1); // cost 1 = fast in tests

  return {
    id,
    email,
    password_hash,
    plan,
    name:           'Test User',
    email_verified,
    referral_code:  null,
    referred_by:    null,
    referral_bonus: 0,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/login', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (db.getUsage as jest.Mock).mockResolvedValue({ call_count: 0 });
  });

  // ── Input validation (Zod layer) ────────────────────────────────────────────

  it('returns 400 when body is empty', async () => {
    const res = await request(app).post('/api/login').send({});
    expect(res.status).toBe(400);
  });

  it('returns 400 when email is missing', async () => {
    const res = await request(app)
      .post('/api/login')
      .send({ password: 'somepassword' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when password is missing', async () => {
    const res = await request(app)
      .post('/api/login')
      .send({ email: 'user@test.com' });
    expect(res.status).toBe(400);
  });

  it('returns 400 with an invalid email format', async () => {
    const res = await request(app)
      .post('/api/login')
      .send({ email: 'not-an-email', password: 'somepassword' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when password is an empty string', async () => {
    const res = await request(app)
      .post('/api/login')
      .send({ email: 'user@test.com', password: '' });
    expect(res.status).toBe(400);
  });

  // ── Auth logic (service layer) ──────────────────────────────────────────────

  it('returns 401 when user does not exist', async () => {
    (db.getUserByEmail as jest.Mock).mockResolvedValue(null);

    const res = await request(app)
      .post('/api/login')
      .send({ email: 'ghost@test.com', password: 'wrongpass' });

    expect(res.status).toBe(401);
  });

  it('returns 401 when password is wrong', async () => {
    const user = await buildFakeUser({ password: 'CorrectHorse99' });
    (db.getUserByEmail as jest.Mock).mockResolvedValue(user);

    const res = await request(app)
      .post('/api/login')
      .send({ email: user.email, password: 'WrongPassword!' });

    expect(res.status).toBe(401);
  });

  it('returns 403 when email is not verified', async () => {
    const user = await buildFakeUser({ email_verified: false });
    (db.getUserByEmail as jest.Mock).mockResolvedValue(user);

    const res = await request(app)
      .post('/api/login')
      .send({ email: user.email, password: 'ValidPass123' });

    expect(res.status).toBe(403);
  });

  it('returns 200 with valid credentials for a verified user', async () => {
    const user = await buildFakeUser();
    (db.getUserByEmail as jest.Mock).mockResolvedValue(user);

    const res = await request(app)
      .post('/api/login')
      .send({ email: user.email, password: 'ValidPass123' });

    expect(res.status).toBe(200);
  });

  it('does not leak which field was wrong (same 401 for bad email vs bad password)', async () => {
    const user = await buildFakeUser();
    (db.getUserByEmail as jest.Mock).mockResolvedValue(user);

    const wrongPass = await request(app)
      .post('/api/login')
      .send({ email: user.email, password: 'wrong' });

    (db.getUserByEmail as jest.Mock).mockResolvedValue(null);

    const noUser = await request(app)
      .post('/api/login')
      .send({ email: 'nobody@test.com', password: 'wrong' });

    // Both paths must return 401 — never expose which half was wrong
    expect(wrongPass.status).toBe(401);
    expect(noUser.status).toBe(401);
  });

  it('normalises email to lowercase before lookup', async () => {
    const user = await buildFakeUser({ email: 'user@test.com' });
    (db.getUserByEmail as jest.Mock).mockResolvedValue(user);

    await request(app)
      .post('/api/login')
      .send({ email: 'USER@TEST.COM', password: 'ValidPass123' });

    // db must be queried with the lowercased address
    expect(db.getUserByEmail).toHaveBeenCalledWith('user@test.com');
  });

  // ── Rate limiting ───────────────────────────────────────────────────────────

  it('rate-limits after 10 attempts per minute from the same IP', async () => {
    (db.getUserByEmail as jest.Mock).mockResolvedValue(null);

    const statuses: number[] = [];

    // Run 11 attempts sequentially so the in-memory rate-limit counter
    // increments deterministically before we read each status.
    for (let i = 0; i < 11; i++) {
      const res = await request(app)
        .post('/api/login')
        .set('X-Forwarded-For', '10.0.0.99') // consistent IP across all attempts
        .send({ email: 'test@test.com', password: 'x' });
      statuses.push(res.status);
    }

    // loginLimiter: max 10 per minute — the 11th must be 429
    expect(statuses[10]).toBe(429);
  });
});
