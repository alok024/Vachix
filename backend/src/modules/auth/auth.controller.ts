import { Request, Response } from 'express';
import * as AuthService from './auth.service';
import { verifyEmailToken, resendVerification as sendVerificationEmail, RateLimitError } from './emailVerification.service';
import { sendPasswordResetEmail } from './email.service';
import { authLogger } from '../../infra/logger';
import { env } from '../../core/config/env';
import { ok, created, badRequest, tooManyRequests, unauthorized } from '../../core/utils/response';
import { trackEvent } from '../analytics/events.service';
import { setAuthCookies, clearAuthCookies, REFRESH_COOKIE } from './cookies';

// Register

export async function register(req: Request, res: Response): Promise<void> {
  const { tokens, user, emailSent } = await AuthService.registerUser(req.body);
  setAuthCookies(res, tokens);
  trackEvent({ event: 'signup', userId: user.id, plan: user.plan, properties: { method: 'email' } });
  created(res, { user, email_sent: emailSent });
}

// Login

export async function login(req: Request, res: Response): Promise<void> {
  const { tokens, user } = await AuthService.loginUser(req.body);
  setAuthCookies(res, tokens);
  trackEvent({ event: 'login', userId: user.id, plan: user.plan });
  ok(res, { user });
}

// Logout

export async function logout(req: Request, res: Response): Promise<void> {
  const user = req.user!;
  if (user.jti && user.exp) {
    await AuthService.logoutUser(user.jti, user.id, new Date(user.exp * 1000));
  }
  clearAuthCookies(res);
  ok(res, { message: 'Logged out successfully' });
}

// Refresh token

export async function refreshToken(req: Request, res: Response): Promise<void> {
  const rt = req.cookies?.[REFRESH_COOKIE] as string | undefined;
  if (!rt) {
    unauthorized(res, 'No refresh token provided', 'no_refresh_token');
    return;
  }

  try {
    const tokens = await AuthService.refreshAccessToken(rt);
    setAuthCookies(res, tokens);
    ok(res, { refreshed: true });
  } catch (err) {
    // Refresh failed (expired/invalid/reused) — clear cookies so the
    // client doesn't keep retrying with a dead refresh token.
    clearAuthCookies(res);
    throw err;
  }
}

// Verify email

export async function verifyEmail(req: Request, res: Response): Promise<void> {
  const { token } = req.body as { token: string };
  const result = await verifyEmailToken(token);

  if (!result.success) {
    badRequest(res, result.message);
    return;
  }

  ok(res, { message: result.message });
}

// Resend verification

export async function resendVerification(req: Request, res: Response): Promise<void> {
  const { email } = req.body as { email: string };

  try {
    // Import renamed to sendVerificationEmail to avoid shadowing this
    // exported handler. Previously the alias `resendVerification_` called
    // `resendVerification(email)` which resolved to THIS function — an
    // infinite loop that would stack-overflow at runtime.
    await sendVerificationEmail(email);
  } catch (err) {
    if (err instanceof RateLimitError) {
      tooManyRequests(res, 'Too many verification emails sent. Please wait before trying again.');
      return;
    }
    throw err;
  }

  // Always respond success — never reveal whether the account exists or is already verified
  ok(res, { message: 'If that email is registered and not yet verified, a verification link has been sent.' });
}

// Forgot password

export async function forgotPassword(req: Request, res: Response): Promise<void> {
  const { email } = req.body as { email: string };
  const resetToken = await AuthService.requestPasswordReset(email);

  if (resetToken) {
    const resetLink = `${env.FRONTEND_URL}/reset-password?token=${resetToken}`;
    // Email construction + delivery lives in email.service — controller just
    // decides whether to call it.  Non-fatal: the token is already stored in
    // the DB; if the send fails, the user can request again.
    await sendPasswordResetEmail(email, resetLink).catch(err =>
      authLogger.error('Failed to send password reset email', {
        email,
        error: (err as Error)?.message,
        // err.message includes the Resend HTTP status + body, e.g.:
        // "Resend delivery failed (403): {"name":"missing_api_key"}"
        // Passing `err` directly logs {} because Error props aren't enumerable.
      })
    );
  }

  // Always respond success — never reveal whether email exists
  ok(res, { message: 'If that email is registered, a reset link has been sent.' });
}

// Reset password

export async function resetPassword(req: Request, res: Response): Promise<void> {
  const { token, new_password } = req.body as { token: string; new_password: string };
  await AuthService.confirmPasswordReset(token, new_password);
  ok(res, { message: 'Password updated. Please log in.' });
}