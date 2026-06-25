import { Request, Response } from 'express';
import * as PaymentService from './payment.service';
import { paymentLogger } from '../../infra/logger';
import { ok, badRequest, fail } from '../../core/utils/response';
import { trackEvent } from '../analytics/events.service';
import { getOrCreateReferralCode } from '../growth/referral.service';
import { setAccessCookie } from '../auth/cookies';

// POST /api/payment/create-order

export async function createOrder(req: Request, res: Response): Promise<void> {
  const { plan } = req.body as { plan: 'starter' | 'pro' | 'elite' }; // validated by CreateOrderSchema middleware
  const user = req.user!;
  const testMode = req.query.mode === 'test';

  const order = await PaymentService.createOrder(user.id, user.email, plan, testMode);
  trackEvent({ event: 'upgrade_click', userId: user.id, plan, properties: { target_plan: plan, test_mode: testMode } });
  ok(res, order);
}

// POST /api/payment/verify
// Secondary activation path — runs client-side after payment modal closes.
// Webhook is the primary path. This handles the gap before webhook fires.

export async function verifyPayment(req: Request, res: Response): Promise<void> {
  const {
    razorpay_order_id,
    razorpay_payment_id,
    razorpay_signature,
    plan,
  } = req.body as { // validated by VerifyPaymentSchema middleware
    razorpay_order_id:   string;
    razorpay_payment_id: string;
    razorpay_signature:  string;
    plan:                'starter' | 'pro' | 'elite';
  };

  const valid = PaymentService.verifySignature(
    razorpay_order_id,
    razorpay_payment_id,
    razorpay_signature
  );

  if (!valid) {
    paymentLogger.warn('Payment verify: signature mismatch', {
      userId:  req.user!.id,
      orderId: razorpay_order_id,
    });
    badRequest(res, 'Payment verification failed', 'payment_verification_failed');
    return;
  }

  // Verify the order belongs to this user before activating.
  // Without this check, any authenticated user could supply another user's
  // order_id, pass the HMAC check, and upgrade their own account for free.
  // We fetch the order from Razorpay and compare notes.user_id to req.user.id.
  try {
    const rzpOrder = await PaymentService.fetchRazorpayOrder(razorpay_order_id);
    if (!rzpOrder || rzpOrder.notes?.user_id !== req.user!.id) {
      paymentLogger.warn('Payment verify: order ownership mismatch', {
        requestUserId:   req.user!.id,
        orderNoteUserId: rzpOrder?.notes?.user_id,
        orderId:         razorpay_order_id,
      });
      badRequest(res, 'Payment verification failed', 'payment_verification_failed');
      return;
    }
  } catch (err) {
    paymentLogger.error('Payment verify: could not fetch order from Razorpay', {
      userId:  req.user!.id,
      orderId: razorpay_order_id,
      error:   (err as Error).message,
    });
    fail(res, 502, 'payment_verification_failed', 'Could not verify order. Please try again.');
    return;
  }

  // activateSubscription is idempotent — safe even if webhook already ran.
  // Returns a fresh access token with the upgraded plan embedded — set it
  // as the httpOnly cookie so the client's next request is already
  // authorized at the new plan, without exposing the token to JS.
  const newToken = await PaymentService.activateSubscription(
    req.user!.id,
    plan,
    razorpay_order_id,
    razorpay_payment_id
  );
  setAccessCookie(res, newToken);

  trackEvent({ event: 'upgrade_success', userId: req.user!.id, plan, properties: { source: 'verify' } });

  // Post-upgrade referral nudge
  // Upgrade success screen is the highest-intent moment in the product.
  // User just committed real money → they believe in the product → ideal time
  // to ask them to share. Fetch referral info and send it with the success
  // response so the frontend can show a "Share with a friend" card inline.
  // Non-fatal: upgrade token always returns even if referral fetch fails.
  let referral: Awaited<ReturnType<typeof getOrCreateReferralCode>> | null = null;
  try {
    referral = await getOrCreateReferralCode(req.user!.id);
    trackEvent({
      event:  'referral_invite_shown',
      userId: req.user!.id,
      plan,
      properties: { trigger: 'post_upgrade', referral_code: referral.code },
    });
  } catch (err) {
    // Non-fatal: upgrade success is returned regardless
    paymentLogger.warn('Post-upgrade referral fetch failed (non-fatal)', { userId: req.user!.id, error: (err as Error).message });
  }

  ok(res, { plan, referral });
}

// POST /api/payment/webhook
// PRIMARY activation path. Registered in app.ts with raw body parser
// BEFORE express.json(). req.body is a raw Buffer here.

export async function webhook(req: Request, res: Response): Promise<void> {
  const signature = req.headers['x-razorpay-signature'] as string;

  if (!signature) {
    badRequest(res, 'Missing webhook signature', 'missing_signature');
    return;
  }

  try {
    await PaymentService.handleWebhook(req.body as Buffer, signature);
    res.json({ received: true });
  } catch (err) {
    // AppError carries .statusCode and .code; plain errors fall back to 500.
    const error = err as Error & { statusCode?: number; code?: string };
    paymentLogger.error('Webhook handling failed', { name: error.name, message: error.message });
    fail(res, error.statusCode ?? 500, error.code ?? 'webhook_failed', error.statusCode && error.statusCode < 500 ? error.message : 'Webhook processing failed');
  }
}
