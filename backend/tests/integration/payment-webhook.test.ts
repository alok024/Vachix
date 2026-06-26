/**
 * Payment webhook integration test.
 *
 * Uses supertest against the real Express app with the real routing/middleware
 * stack — so the raw-body parser, HMAC signature check, and idempotency guard
 * all run exactly as they do in production.
 *
 * Mocked layers:
 *   - db (../../src/core/database/client)       — no real Supabase calls
 *   - global.fetch                               — intercepts the raw REST
 *     POST in activateSubscription() so it never hits Supabase
 *   - infra/logger                               — silence winston in CI
 *   - infra/observability (Sentry)               — no external calls at boot
 *   - infra/load-monitor                         — no setInterval noise
 *   - infra/queue/dispatcher                     — no BullMQ / Redis at boot
 *   - modules/push/push.routes (VAPID)           — no web-push init noise
 *
 * Critical invariant: replaying the same webhook event MUST NOT double-credit
 * a subscription. The idempotency guard lives in payment.service.ts →
 * handleWebhook() → db.getSubscriptionByPaymentId(). This test proves it holds
 * under real routing conditions.
 */

import request from 'supertest';
import crypto  from 'crypto';

// ── Infrastructure mocks (must come before any app import) ──────────────────

const _silent = () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() });

jest.mock('../../src/infra/logger', () => ({
  logger:             { child: _silent, ..._silent() },
  authLogger:         _silent(),
  paymentLogger:      _silent(),
  aiLogger:           { child: _silent, ..._silent() },
  subscriptionLogger: _silent(),
}));

jest.mock('../../src/infra/observability', () => ({
  initSentry:              jest.fn().mockResolvedValue(undefined),
  captureException:        jest.fn(),
  capturePaymentException: jest.fn(),
  getMetrics:              jest.fn().mockReturnValue({}),
}));;

jest.mock('../../src/infra/load-monitor', () => ({
  startLoadMonitor:   jest.fn(),
  getSystemLoadStats: jest.fn().mockReturnValue({}),
}));

jest.mock('../../src/infra/ai-limiter', () => ({
  getAILimiterStats: jest.fn().mockReturnValue({}),
}));

jest.mock('../../src/infra/circuit-breaker', () => ({
  groqBreaker:   { getState: jest.fn().mockReturnValue({ state: 'CLOSED', failures: 0 }) },
  openaiBreaker: { getState: jest.fn().mockReturnValue({ state: 'CLOSED', failures: 0 }) },
  CircuitBreaker: jest.fn(),
}));

jest.mock('../../src/infra/queue/dispatcher', () => ({
  scheduleSubscriptionExpiry:   jest.fn().mockResolvedValue(undefined),
  scheduleSessionExpiry:        jest.fn().mockResolvedValue(undefined),
  scheduleBlacklistCleanup:     jest.fn(),
  scheduleComparisonCleanup:    jest.fn(),
  scheduleWeeklyProgressCards:  jest.fn().mockResolvedValue(undefined),
}));

// Silence VAPID init (uses web-push which errors without real keys)
jest.mock('../../src/modules/analytics/weekly-card.service', () => ({
  initVapid: jest.fn(),
}));

// Silence event flush registration
jest.mock('../../src/modules/analytics/events.service', () => ({
  registerShutdownFlush: jest.fn(),
  trackEvent:            jest.fn(),
}));

// Growth/referral (not needed for webhook path)
jest.mock('../../src/modules/growth/referral.service', () => ({
  getOrCreateReferralCode: jest.fn(),
}));

// ── DB mock ──────────────────────────────────────────────────────────────────

jest.mock('../../src/core/database/client', () => ({
  db: {
    getSubscriptionByPaymentId:       jest.fn(),
    getUserById:                      jest.fn(),
    updateUser:                       jest.fn(),
    resetUsage:                       jest.fn(),
    supersedeOtherActiveSubscriptions: jest.fn(),
    getActiveSubscription:            jest.fn(),
    updateSubscription:               jest.fn(),
  },
}));

// ── App + fixtures ───────────────────────────────────────────────────────────

import app from '../../src/app';
import { db } from '../../src/core/database/client';
import { buildRazorpayWebhookPayload } from '../fixtures/payment';

// ── Constants ────────────────────────────────────────────────────────────────

const WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET ?? 'test-webhook-secret';

// Fake user returned by db.getUserById after activation — must satisfy
// the Pick<JWTPayload, 'id'|'email'|'plan'|'name'> shape for generateTokens.
const FAKE_USER = {
  id:             'user-uuid-test-1234',
  email:          'test@test.com',
  plan:           'pro',
  name:           'Test User',
  email_verified: true,
  password_hash:  'x',
};

/**
 * Sign a raw JSON body string with the test webhook secret.
 * The webhook controller reads `req.body` as a raw Buffer (registered with
 * express.raw() in app.ts) and hashes that same Buffer — so we must sign
 * the exact string that supertest will send as the request body.
 */
function signBody(bodyStr: string): string {
  return crypto
    .createHmac('sha256', WEBHOOK_SECRET)
    .update(bodyStr)
    .digest('hex');
}

/**
 * Mock global.fetch so activateSubscription()'s raw Supabase REST upsert
 * succeeds without any network call. Returns a minimal 201-like ok response.
 */
function mockFetchOk(): jest.SpyInstance {
  return jest.spyOn(global, 'fetch').mockResolvedValue(
    new Response(JSON.stringify([]), { status: 201 })
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/payment/webhook', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ── Happy path ─────────────────────────────────────────────────────────────

  it('returns 200 and processes a valid payment.captured event', async () => {
    const payload = buildRazorpayWebhookPayload({});
    const body    = JSON.stringify(payload);
    const sig     = signBody(body);

    (db.getSubscriptionByPaymentId as jest.Mock).mockResolvedValue(null);
    (db.updateUser  as jest.Mock).mockResolvedValue(undefined);
    (db.resetUsage  as jest.Mock).mockResolvedValue(undefined);
    (db.supersedeOtherActiveSubscriptions as jest.Mock).mockResolvedValue(undefined);
    (db.getUserById as jest.Mock).mockResolvedValue(FAKE_USER);
    mockFetchOk();

    const res = await request(app)
      .post('/api/payment/webhook')
      .set('Content-Type', 'application/json')
      .set('x-razorpay-signature', sig)
      .send(body);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ received: true });
  });

  it('calls updateUser and resetUsage exactly once on first capture', async () => {
    const payload = buildRazorpayWebhookPayload({ userId: 'user-uuid-first' });
    const body    = JSON.stringify(payload);
    const sig     = signBody(body);

    (db.getSubscriptionByPaymentId as jest.Mock).mockResolvedValue(null);
    (db.updateUser  as jest.Mock).mockResolvedValue(undefined);
    (db.resetUsage  as jest.Mock).mockResolvedValue(undefined);
    (db.supersedeOtherActiveSubscriptions as jest.Mock).mockResolvedValue(undefined);
    (db.getUserById as jest.Mock).mockResolvedValue({ ...FAKE_USER, id: 'user-uuid-first' });
    mockFetchOk();

    await request(app)
      .post('/api/payment/webhook')
      .set('Content-Type', 'application/json')
      .set('x-razorpay-signature', sig)
      .send(body);

    expect(db.updateUser).toHaveBeenCalledTimes(1);
    expect(db.resetUsage).toHaveBeenCalledTimes(1);
  });

  // ── Idempotency (most critical) ────────────────────────────────────────────

  it('skips processing on duplicate webhook — never double-credits (idempotency)', async () => {
    const payload = buildRazorpayWebhookPayload({ paymentId: 'pay_already_processed' });
    const body    = JSON.stringify(payload);
    const sig     = signBody(body);

    // Simulate: subscription row already exists for this payment_id
    (db.getSubscriptionByPaymentId as jest.Mock).mockResolvedValue({
      id:      'sub-existing-123',
      user_id: 'user-uuid-test-1234',
      plan:    'pro',
    });

    const res = await request(app)
      .post('/api/payment/webhook')
      .set('Content-Type', 'application/json')
      .set('x-razorpay-signature', sig)
      .send(body);

    // Webhook must still acknowledge receipt (Razorpay retries on non-2xx)
    expect(res.status).toBe(200);

    // Critical: no re-activation must occur
    expect(db.updateUser).not.toHaveBeenCalled();
    expect(db.resetUsage).not.toHaveBeenCalled();
    expect(db.supersedeOtherActiveSubscriptions).not.toHaveBeenCalled();
    expect(db.getUserById).not.toHaveBeenCalled();
  });

  it('is safe when the same event is replayed 3 times — only processes once', async () => {
    const payload = buildRazorpayWebhookPayload({ paymentId: 'pay_replay_test' });
    const body    = JSON.stringify(payload);
    const sig     = signBody(body);

    // First call: no existing sub → process
    (db.getSubscriptionByPaymentId as jest.Mock)
      .mockResolvedValueOnce(null)                        // 1st replay: process
      .mockResolvedValue({ id: 'sub-123', plan: 'pro' }); // 2nd & 3rd: duplicate

    (db.updateUser  as jest.Mock).mockResolvedValue(undefined);
    (db.resetUsage  as jest.Mock).mockResolvedValue(undefined);
    (db.supersedeOtherActiveSubscriptions as jest.Mock).mockResolvedValue(undefined);
    (db.getUserById as jest.Mock).mockResolvedValue(FAKE_USER);
    mockFetchOk();

    const send = () =>
      request(app)
        .post('/api/payment/webhook')
        .set('Content-Type', 'application/json')
        .set('x-razorpay-signature', sig)
        .send(body);

    await send();
    await send();
    await send();

    // updateUser must fire exactly once across all three replays
    expect(db.updateUser).toHaveBeenCalledTimes(1);
    expect(db.resetUsage).toHaveBeenCalledTimes(1);
  });

  // ── Signature validation ───────────────────────────────────────────────────

  it('returns 400 on invalid webhook signature', async () => {
    const payload = buildRazorpayWebhookPayload({});

    const res = await request(app)
      .post('/api/payment/webhook')
      .set('Content-Type', 'application/json')
      .set('x-razorpay-signature', 'invalid-signature-tampered')
      .send(JSON.stringify(payload));

    expect(res.status).toBe(400);
    expect(db.getSubscriptionByPaymentId).not.toHaveBeenCalled();
  });

  it('returns 400 when x-razorpay-signature header is missing', async () => {
    const payload = buildRazorpayWebhookPayload({});

    const res = await request(app)
      .post('/api/payment/webhook')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(payload));

    expect(res.status).toBe(400);
  });

  it('rejects a body that has been tampered with after signing', async () => {
    const payload  = buildRazorpayWebhookPayload({});
    const original = JSON.stringify(payload);
    const sig      = signBody(original);

    // Tamper: change plan after signing
    const tampered = JSON.stringify({ ...payload, injected: true });

    const res = await request(app)
      .post('/api/payment/webhook')
      .set('Content-Type', 'application/json')
      .set('x-razorpay-signature', sig)
      .send(tampered); // sig doesn't match tampered body

    expect(res.status).toBe(400);
  });

  // ── Plan field validation ──────────────────────────────────────────────────

  it('returns 200 but skips activation when plan is missing from notes', async () => {
    const payload = buildRazorpayWebhookPayload({});
    // Remove the plan field from notes to simulate a malformed webhook
    (payload.payload.payment.entity.notes as Record<string, unknown>).plan = undefined;
    const body = JSON.stringify(payload);
    const sig  = signBody(body);

    (db.getSubscriptionByPaymentId as jest.Mock).mockResolvedValue(null);
    (db.getUserById as jest.Mock).mockResolvedValue(FAKE_USER);

    const res = await request(app)
      .post('/api/payment/webhook')
      .set('Content-Type', 'application/json')
      .set('x-razorpay-signature', sig)
      .send(body);

    // Webhook acks — but no subscription is written (logged as error, not thrown)
    expect(res.status).toBe(200);
    expect(db.updateUser).not.toHaveBeenCalled();
  });
});
