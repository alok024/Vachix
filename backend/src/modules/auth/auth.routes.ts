import { Router } from 'express';
import rateLimit, { MemoryStore } from 'express-rate-limit';
import * as AuthController from './auth.controller';
import { validate, authMiddleware, asyncHandler } from '../../core/middleware';
import {
  RegisterSchema,
  LoginSchema,
  ForgotPasswordSchema,
  ResetPasswordSchema,
  VerifyEmailSchema,
  ResendVerificationSchema,
} from '../../core/utils/schemas';

const router = Router();

// loginLimiterStore is exported so tests can call resetKey() in beforeEach,
// clearing per-IP hit counts between test cases to prevent cross-test bleed.
// The limiter itself is stateless between test files (each Jest worker gets a
// fresh module registry), but within a single test file multiple tests share
// the same in-process store — without a reset, hit counts accumulate and the
// 11th request trips the limiter even in unrelated tests.
export const loginLimiterStore = new MemoryStore();

const loginLimiter = rateLimit({
  windowMs: 60_000,
  max:      10,
  message:  { error: 'Too many login attempts. Please wait a minute.' },
  store:    loginLimiterStore,
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60_000, // 1 hour
  // Raised from 3 → 10: the old limit was too aggressive for shared IPs
  // (offices, universities, mobile NAT) where multiple legitimate users
  // sit behind the same IP. 10/hr still blocks bulk account-farming while
  // not locking out real users on shared networks.
  max:      10,
  message:  { error: 'Too many accounts created from this address. Please wait an hour.' },
});

const resetLimiter = rateLimit({
  windowMs: 15 * 60_000, // 15 minutes
  max:      5,
  message:  { error: 'Too many password reset attempts. Please wait.' },
});

const resendLimiter = rateLimit({
  windowMs: 60 * 60_000, // 1 hour (mirrors RESEND_LIMIT in emailVerification.service)
  max:      3,
  message:  { error: 'Too many resend attempts. Please wait.' },
});

// Defense-in-depth: refresh tokens already require a valid signed httpOnly
// cookie, so this isn't brute-forceable, but an unlimited endpoint still
// lets a buggy client (or malicious one) hammer the DB on every request.
const refreshLimiter = rateLimit({
  windowMs: 60_000,
  max:      30,
  message:  { error: 'Too many refresh attempts. Please wait.' },
});

// Defense-in-depth: reset tokens are 32 random bytes (256-bit), so this
// isn't realistically brute-forceable either, but every other token-bearing
// auth route has a limiter and this one shouldn't be the odd one out.
const resetConfirmLimiter = rateLimit({
  windowMs: 15 * 60_000,
  max:      10,
  message:  { error: 'Too many attempts. Please wait.' },
});

// POST /api/register
router.post('/register',
  registerLimiter,
  validate(RegisterSchema),
  asyncHandler(AuthController.register)
);

// POST /api/login
router.post('/login',
  loginLimiter,
  validate(LoginSchema),
  asyncHandler(AuthController.login)
);

// POST /api/logout
router.post('/logout',
  authMiddleware,
  asyncHandler(AuthController.logout)
);

// POST /api/refresh-token
router.post('/refresh-token',
  refreshLimiter,
  asyncHandler(AuthController.refreshToken)
);

// POST /api/verify-email
router.post('/verify-email',
  validate(VerifyEmailSchema),
  asyncHandler(AuthController.verifyEmail)
);

// POST /api/resend-verification
router.post('/resend-verification',
  resendLimiter,
  validate(ResendVerificationSchema),
  asyncHandler(AuthController.resendVerification)
);

// POST /api/password-reset/request
router.post('/password-reset/request',
  resetLimiter,
  validate(ForgotPasswordSchema),
  asyncHandler(AuthController.forgotPassword)
);

// POST /api/password-reset/confirm
router.post('/password-reset/confirm',
  resetConfirmLimiter,
  validate(ResetPasswordSchema),
  asyncHandler(AuthController.resetPassword)
);

export default router;
