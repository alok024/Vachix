import { Router } from 'express';
import rateLimit from 'express-rate-limit';
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

const loginLimiter = rateLimit({
  windowMs: 60_000,
  max:      10,
  message:  { error: 'Too many login attempts. Please wait a minute.' },
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
  validate(ResetPasswordSchema),
  asyncHandler(AuthController.resetPassword)
);

export default router;
