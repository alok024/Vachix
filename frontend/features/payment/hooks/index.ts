'use client';

/**
 * features/payment/hooks/index.ts
 *
 * React Query hooks for the Razorpay checkout flow.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { paymentApi } from '../api';
import { QK } from '@/lib/query-keys';

// Create order
export function useCreateOrder() {
  return useMutation({
    mutationFn: (plan: 'starter' | 'pro' | 'elite') => paymentApi.createOrder(plan),
  });
}

// Verify payment
export function useVerifyPayment() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: paymentApi.verifyPayment,
    onSuccess: (res) => {
      if (res.ok) {
        // Backend already rotated the vachix_at cookie to embed the new plan.
        // Refetch /me to pick up the upgraded plan + reset usage.
        qc.invalidateQueries({ queryKey: QK.me });
      }
    },
  });
}
