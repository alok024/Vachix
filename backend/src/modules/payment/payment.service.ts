import { AppError } from '../../core/utils/errors';
import Razorpay from 'razorpay';
import crypto from 'crypto';
import { env, PLAN_PRICES } from '../../core/config/env';
import { db } from '../../core/database/client';
import { generateTokens } from '../auth/auth.service';
import { paymentLogger } from '../../infra/logger';
import { capturePaymentException } from '../../infra/observability';

// Razorpay instance

function getRazorpay(testMode = false): Razorpay {
  if (testMode && env.RAZORPAY_TEST_KEY_ID && env.RAZORPAY_TEST_KEY_SECRET) {
    return new Razorpay({
      key_id:     env.RAZORPAY_TEST_KEY_ID,
      key_secret: env.RAZORPAY_TEST_KEY_SECRET,
    });
  }
  return new Razorpay({
    key_id:     env.RAZORPAY_KEY_ID,
    key_secret: env.RAZORPAY_KEY_SECRET,
  });
}

// Create Razorpay order

export async function createOrder(
  userId: string,
  email:  string,
  plan:   'starter' | 'pro' | 'elite',
  testMode = false
) {
  const amount = PLAN_PRICES[plan];
  const useTest = testMode && !!env.RAZORPAY_TEST_KEY_ID;

  // The Razorpay SDK throws a plain object on failure
  // ({ statusCode, error: { code, description } }), not a real Error —
  // it has no `.message`, so the global error handler's
  // `err.message` read comes back undefined and the client sees a
  // blank "Something went wrong." with no actionable detail. Catch
  // here and re-throw as a proper AppError carrying Razorpay's real
  // status/code/description through to the client and the logs.
  let order;
  try {
    order = await getRazorpay(useTest).orders.create({
      amount,
      currency: 'INR',
      notes:    { user_id: userId, email, plan, test_mode: useTest ? '1' : '0' },
    });
  } catch (err) {
    const rzpErr = err as { statusCode?: number; error?: { code?: string; description?: string } };
    paymentLogger.error('Razorpay order creation failed', {
      userId, plan, testMode: useTest,
      statusCode: rzpErr.statusCode,
      rzpError:   rzpErr.error,
    });
    capturePaymentException(err, {
      userId,
      extra: { plan, testMode: useTest, rzpCode: rzpErr.error?.code },
    });
    throw new AppError(
      rzpErr.statusCode && rzpErr.statusCode < 500 ? rzpErr.statusCode : 502,
      rzpErr.error?.code ?? 'razorpay_order_failed',
      rzpErr.error?.description ?? 'Could not create payment order. Please try again.'
    );
  }

  paymentLogger.info('Razorpay order created', {
    userId, plan, orderId: order.id, amount, testMode: useTest,
  });

  return {
    order_id: order.id,
    amount:   order.amount,
    currency: order.currency,
    key:      useTest ? env.RAZORPAY_TEST_KEY_ID : env.RAZORPAY_KEY_ID,
    plan,
  };
}

// Constant-time hex digest comparison
// Used for all HMAC signature checks below. Plain === leaks timing
// information proportional to how many leading characters match,
// which is a known side-channel against MAC verification — especially
// relevant here since a forged webhook signature directly gates
// granting a paid subscription for free.
function hexDigestsEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// Verify payment signature (client callback)

export function verifySignature(
  orderId:   string,
  paymentId: string,
  signature: string
): boolean {
  const check = (secret: string) =>
    hexDigestsEqual(
      crypto.createHmac('sha256', secret).update(`${orderId}|${paymentId}`).digest('hex'),
      signature
    );

  if (check(env.RAZORPAY_KEY_SECRET)) return true;
  if (env.RAZORPAY_TEST_KEY_SECRET && check(env.RAZORPAY_TEST_KEY_SECRET)) return true;
  return false;
}

// Fetch order from Razorpay (for ownership verification)
// Used by the payment verify endpoint to confirm that the supplied
// razorpay_order_id was actually created for the requesting user.
// Tries live keys first, then test keys if configured.

export async function fetchRazorpayOrder(
  orderId: string
): Promise<{ id: string; notes?: Record<string, string> } | null> {
  // Try live keys
  try {
    const order = await getRazorpay(false).orders.fetch(orderId);
    return order as { id: string; notes?: Record<string, string> };
  } catch {
    // If live key fails and test keys are configured, try those
    if (env.RAZORPAY_TEST_KEY_ID && env.RAZORPAY_TEST_KEY_SECRET) {
      try {
        const order = await getRazorpay(true).orders.fetch(orderId);
        return order as { id: string; notes?: Record<string, string> };
      } catch {
        return null;
      }
    }
    return null;
  }
}

// Activate subscription
// Idempotent — safe to call from both client callback AND webhook.
// Uses ON CONFLICT on razorpay_order_id to prevent the race where both
// the client verify and the webhook arrive simultaneously, both read
// existing=null, and both try to INSERT — producing two active rows.

export async function activateSubscription(
  userId:    string,
  plan:      'starter' | 'pro' | 'elite',
  orderId:   string,
  paymentId: string
): Promise<string> {
  const now       = new Date();
  const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  // Single upsert keyed on razorpay_order_id — whichever of the
  // client-verify and webhook paths arrives first wins; the second
  // is a no-op.  Both paths then read the canonical row.
  const subRes = await fetch(`${env.SUPABASE_URL}/rest/v1/subscriptions?on_conflict=razorpay_order_id`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey:         env.SUPABASE_SERVICE_KEY,
      Authorization:  `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      Prefer:         'resolution=merge-duplicates',
    },
    body: JSON.stringify({
      user_id:             userId,
      plan,
      status:              'active',
      razorpay_order_id:   orderId,
      razorpay_payment_id: paymentId,
      started_at:          now.toISOString(),
      expires_at:          expiresAt.toISOString(),
    }),
  });

  // Always check the response — a silent 4xx/5xx here means the
  // subscriptions row was never written, leaving the user's plan upgraded
  // in the users table but with no subscription record. Throw so the caller
  // (client-verify or webhook) returns an error and can be retried.
  if (!subRes.ok) {
    const body = await subRes.text().catch(() => '');
    paymentLogger.error('Supabase subscription upsert failed', {
      userId, orderId, status: subRes.status, body: body.slice(0, 500),
    });
    throw new AppError(502, 'subscription_write_failed', `Subscription write failed (HTTP ${subRes.status}). Please contact support.`);
  }

  // Update plan + reset usage counter, and supersede any other active
  // subscription row for this user so a renewal-before-expiry can't leave
  // a stale active row around for the expiry cron to act on (#14).
  await Promise.all([
    db.updateUser(userId, { plan }),
    db.resetUsage(userId),
    db.supersedeOtherActiveSubscriptions(userId, orderId),
  ]);

  paymentLogger.info('Subscription activated', { userId, plan, orderId, paymentId });

  // Issue fresh JWT with updated plan embedded
  const user = await db.getUserById(userId);
  if (!user) throw new AppError(500, 'user_not_found_post_activation', 'User not found after subscription activation');

  const { token } = generateTokens(user);
  return token;
}

// Webhook (PRIMARY activation path)
// Registered in app.ts BEFORE express.json() with raw body parser.

export async function handleWebhook(rawBody: Buffer, signature: string): Promise<void> {
  // 1. Verify authenticity (try live secret, then test secret if configured)
  const sign = (secret: string) =>
    crypto.createHmac('sha256', secret).update(rawBody).digest('hex');

  const matchesLive = hexDigestsEqual(sign(env.RAZORPAY_WEBHOOK_SECRET), signature);
  const matchesTest = !!env.RAZORPAY_TEST_WEBHOOK_SECRET &&
    hexDigestsEqual(sign(env.RAZORPAY_TEST_WEBHOOK_SECRET), signature);

  if (!matchesLive && !matchesTest) {
    paymentLogger.warn('Webhook signature mismatch — possible spoofing attempt');
    throw new AppError(400, 'invalid_webhook_signature', 'Invalid webhook signature');
  }

  const event = JSON.parse(rawBody.toString()) as RazorpayWebhookEvent;

  paymentLogger.info('Webhook received', {
    event:     event.event,
    paymentId: event.payload?.payment?.entity?.id,
  });

  // 2. Idempotency — skip if we already processed this payment
  const paymentId = event.payload?.payment?.entity?.id;
  if (paymentId) {
    const duplicate = await db.getSubscriptionByPaymentId(paymentId);
    if (duplicate) {
      paymentLogger.info('Duplicate webhook — already processed', { paymentId });
      return;
    }
  }

  // 3. Route by event type
  switch (event.event) {
    case 'payment.captured':
      await onPaymentCaptured(event);
      break;
    case 'payment.failed':
      onPaymentFailed(event);
      break;
    case 'subscription.cancelled':
      await onSubscriptionCancelled(event);
      break;
    default:
      paymentLogger.debug('Unhandled webhook event', { event: event.event });
  }
}

// Webhook event handlers

async function onPaymentCaptured(event: RazorpayWebhookEvent): Promise<void> {
  const payment = event.payload?.payment?.entity;
  if (!payment) return;

  const userId = payment.notes?.user_id;
  const plan   = payment.notes?.plan as 'starter' | 'pro' | 'elite' | undefined;

  if (!userId || !plan || !['starter', 'pro', 'elite'].includes(plan)) {
    paymentLogger.error('Webhook: missing or invalid user_id/plan in payment notes', { payment });
    return;
  }

  await activateSubscription(userId, plan, payment.order_id, payment.id);

  paymentLogger.info('Payment captured via webhook', {
    userId,
    plan,
    paymentId: payment.id,
    orderId:   payment.order_id,
    amount:    payment.amount,
  });
}

function onPaymentFailed(event: RazorpayWebhookEvent): void {
  const payment = event.payload?.payment?.entity;
  paymentLogger.warn('Payment failed', {
    paymentId: payment?.id,
    reason:    payment?.error_description,
    userId:    payment?.notes?.user_id,
  });
}

async function onSubscriptionCancelled(event: RazorpayWebhookEvent): Promise<void> {
  const sub = event.payload?.subscription?.entity;
  if (!sub) return;

  // sub.id is a Razorpay subscription ID (e.g. "sub_XXXXX"), NOT a user_id.
  // Use the user_id stored in the subscription notes instead.
  const userId = sub.notes?.user_id;
  if (!userId) {
    paymentLogger.error('Webhook: subscription.cancelled missing user_id in notes', { subId: sub.id });
    return;
  }

  const existing = await db.getActiveSubscription(userId);
  if (!existing) return;

  await db.updateSubscription(existing.id!, { status: 'cancelled' });
  await db.updateUser(existing.user_id, { plan: 'free' });

  paymentLogger.info('Subscription cancelled via webhook', { userId: existing.user_id });
}

// Subscription expiry cron
// Called on app startup then every hour via setInterval in app.ts.
// Marks expired subscriptions and downgrades the user's plan to free.

export async function expireOverdueSubscriptions(): Promise<void> {
  const expired = await db.getExpiredActiveSubscriptions();
  if (expired.length === 0) return;

  paymentLogger.info(`Expiring ${expired.length} overdue subscription(s)`);

  await Promise.all(
    expired.map(async (sub) => {
      await db.updateSubscription(sub.id!, { status: 'expired' });
      await db.updateUser(sub.user_id, { plan: 'free' });
      paymentLogger.info('Subscription expired — user downgraded to free', {
        userId: sub.user_id,
        plan:   sub.plan,
      });
    })
  );
}

// Razorpay webhook types

interface RazorpayPaymentEntity {
  id:                 string;
  order_id:           string;
  amount:             number;
  currency:           string;
  status:             string;
  error_description?: string;
  notes?: {
    user_id?: string;
    email?:   string;
    plan?:    string;
  };
}

interface RazorpaySubscriptionEntity {
  id: string;
  notes?: {
    user_id?: string;
  };
}

interface RazorpayWebhookEvent {
  event: string;
  payload: {
    payment?:      { entity: RazorpayPaymentEntity };
    subscription?: { entity: RazorpaySubscriptionEntity };
  };
}
