/**
 * features/payment/api/index.ts
 *
 * HTTP calls for the Razorpay checkout flow.
 */
import { apiCall } from '@/lib/api';
import type {
  CreateOrderResponse,
  VerifyPaymentPayload,
  VerifyPaymentResponse,
} from '../types';

// Set NEXT_PUBLIC_RAZORPAY_TEST_MODE=true on Cloudflare Pages to route
// all checkout flows through the test key. Never set this in production.
const TEST_MODE = process.env.NEXT_PUBLIC_RAZORPAY_TEST_MODE === 'true';

export const paymentApi = {
  createOrder: (plan: 'starter' | 'pro' | 'elite') =>
    apiCall<CreateOrderResponse>(
      `/payment/create-order${TEST_MODE ? '?mode=test' : ''}`,
      'POST',
      { plan }
    ),

  verifyPayment: (payload: VerifyPaymentPayload) =>
    apiCall<VerifyPaymentResponse>('/payment/verify', 'POST', payload),
};
