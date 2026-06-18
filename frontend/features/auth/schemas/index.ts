/**
 * features/auth/schemas/index.ts
 *
 * Client-side form validation schemas for auth flows.
 * These mirror the backend schemas in backend/src/core/utils/schemas.ts.
 * In future, both can import from @vachix/shared.
 */
import { z } from 'zod';

export const LoginFormSchema = z.object({
  email:    z.string().email('Enter a valid email'),
  password: z.string().min(1, 'Password is required'),
});

export const RegisterFormSchema = z.object({
  name:     z.string().min(2, 'Name must be at least 2 characters').max(100),
  email:    z.string().email('Enter a valid email'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  ref:      z.string().max(20).optional(),
});

export const ForgotPasswordFormSchema = z.object({
  email: z.string().email('Enter a valid email'),
});

export type LoginFormData        = z.infer<typeof LoginFormSchema>;
export type RegisterFormData     = z.infer<typeof RegisterFormSchema>;
export type ForgotPasswordData   = z.infer<typeof ForgotPasswordFormSchema>;
