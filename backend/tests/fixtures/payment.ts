import crypto from 'crypto';

export function buildRazorpayWebhookPayload(overrides: {
  paymentId?: string;
  orderId?:   string;
  userId?:    string;
  plan?:      string;
}) {
  const {
    paymentId = 'pay_test_' + crypto.randomBytes(8).toString('hex'),
    orderId   = 'order_test_' + crypto.randomBytes(8).toString('hex'),
    userId    = 'user-uuid-test-1234',
    plan      = 'pro',
  } = overrides;

  return {
    event: 'payment.captured',
    payload: {
      payment: {
        entity: {
          id:       paymentId,
          order_id: orderId,
          amount:   69900,
          currency: 'INR',
          status:   'captured',
          notes:    { user_id: userId, plan, email: 'test@test.com' },
        },
      },
    },
  };
}

export function signWebhookPayload(payload: object, secret: string): string {
  return crypto
    .createHmac('sha256', secret)
    .update(JSON.stringify(payload))
    .digest('hex');
}
