import { AppError } from '../../core/utils/errors';
import { env } from '../../core/config/env';
import { authLogger } from '../../infra/logger';

/**
 * Low-level Resend send helper.
 * If RESEND_API_KEY / EMAIL_FROM are not configured, falls back to
 * logging the email (dev mode) instead of throwing — callers decide
 * whether a failed/skipped send should be fatal.
 */
async function sendEmail(opts: {
  to: string;
  subject: string;
  html: string;
  text: string;
  logContext: Record<string, unknown>;
}): Promise<void> {
  const { to, subject, html, text, logContext } = opts;

  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) {
    authLogger.info('Email send skipped — RESEND_API_KEY/EMAIL_FROM not configured (dev mode)', {
      to, subject, ...logContext,
    });
    return;
  }

  const res = await fetch('https://api.resend.com/emails', {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${env.RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      to,
      subject,
      html,
      text,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new AppError(502, 'email_delivery_failed', `Resend delivery failed (${res.status}): ${body}`);
  }
}

// ── Verification email ─────────────────────────────────────────────

export async function sendVerificationEmail(to: string, rawToken: string): Promise<void> {
  const verifyUrl = `${env.FRONTEND_URL}/verify-email?token=${rawToken}`;

  const html = `
    <p>Hi,</p>
    <p>Thanks for signing up for Vachix. Please verify your email address to activate your account.</p>
    <p>
      <a href="${verifyUrl}" style="
        display:inline-block;
        padding:12px 24px;
        background:#6366f1;
        color:#fff;
        border-radius:6px;
        text-decoration:none;
        font-weight:600;
      ">Verify Email</a>
    </p>
    <p>Or copy this link into your browser:<br/>${verifyUrl}</p>
    <p>This link expires in 24 hours. If you did not create this account, you can safely ignore this email.</p>
  `;

  const text = [
    'Verify your email address',
    '',
    'Thanks for signing up for Vachix. Click the link below to verify your account (expires in 24 hours):',
    verifyUrl,
    '',
    'If you did not create this account, ignore this email.',
  ].join('\n');

  await sendEmail({
    to,
    subject: 'Verify your Vachix email',
    html,
    text,
    logContext: { link: verifyUrl },
  });
}

// ── B2B Lead emails ────────────────────────────────────────────────
// Two sends per new lead:
//   1. Internal alert  → LEAD_NOTIFY_EMAIL (team sees it in < 1 min)
//   2. Confirmation    → lead's own email  (sets expectation, builds trust)
//
// Both are fire-and-forget from the controller — a failed email never
// rolls back the DB insert.

export interface LeadEmailPayload {
  name:    string;
  email:   string;
  org:     string;
  size:    string;
  orgType?: string;
  message?: string;
}

export async function sendLeadEmails(lead: LeadEmailPayload): Promise<void> {
  const { name, email, org, size, orgType, message } = lead;

  const notifyTargets = env.LEAD_NOTIFY_EMAIL
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  // ── 1. Internal notification ──────────────────────────────────────
  if (notifyTargets.length > 0) {
    const internalHtml = `
      <h2 style="margin-top:0;font-size:18px;">🔔 New B2B Demo Request</h2>
      <table style="border-collapse:collapse;width:100%;font-size:14px;">
        <tr><td style="padding:6px 12px 6px 0;color:#666;width:110px;">Name</td><td style="padding:6px 0;font-weight:600;">${escHtml(name)}</td></tr>
        <tr><td style="padding:6px 12px 6px 0;color:#666;">Email</td><td style="padding:6px 0;"><a href="mailto:${escHtml(email)}">${escHtml(email)}</a></td></tr>
        <tr><td style="padding:6px 12px 6px 0;color:#666;">Organisation</td><td style="padding:6px 0;">${escHtml(org)}</td></tr>
        <tr><td style="padding:6px 12px 6px 0;color:#666;">Team size</td><td style="padding:6px 0;">${escHtml(size)}</td></tr>
        ${orgType ? `<tr><td style="padding:6px 12px 6px 0;color:#666;">Org type</td><td style="padding:6px 0;">${escHtml(orgType)}</td></tr>` : ''}
        ${message ? `<tr><td style="padding:6px 12px 6px 0;color:#666;vertical-align:top;">Message</td><td style="padding:6px 0;">${escHtml(message)}</td></tr>` : ''}
      </table>
      <p style="margin-top:16px;font-size:13px;color:#999;">Received via Vachix B2B form · Reply directly to <a href="mailto:${escHtml(email)}">${escHtml(email)}</a></p>
    `;
    const internalText = [
      '🔔 New B2B Demo Request',
      '',
      `Name:    ${name}`,
      `Email:   ${email}`,
      `Org:     ${org}`,
      `Size:    ${size}`,
      orgType ? `Type:    ${orgType}` : '',
      message ? `Message: ${message}` : '',
    ].filter(line => line !== '').join('\n');

    await Promise.allSettled(
      notifyTargets.map(to =>
        sendEmail({
          to,
          subject: `[Vachix B2B] New demo request — ${org}`,
          html: internalHtml,
          text: internalText,
          logContext: { leadEmail: email, org },
        }).catch(err =>
          authLogger.warn('Lead internal notification failed (non-fatal)', { to, error: (err as Error).message })
        )
      )
    );
  }

  // ── 2. Confirmation to the lead ────────────────────────────────────
  const confirmHtml = `
    <p>Hi ${escHtml(name)},</p>
    <p>Thanks for your interest in Vachix for <strong>${escHtml(org)}</strong>! We've received your demo request and will be in touch within one business day.</p>
    <p>In the meantime, feel free to explore the product at <a href="https://vachix.in">vachix.in</a> — your team can sign up and start practising right away on the free plan.</p>
    <p style="margin-top:24px;color:#999;font-size:13px;">The Vachix Team<br/>
    <a href="mailto:hello@vachix.in">hello@vachix.in</a></p>
  `;
  const confirmText = [
    `Hi ${name},`,
    '',
    `Thanks for your interest in Vachix for ${org}! We've received your demo request and will be in touch within one business day.`,
    '',
    'In the meantime, feel free to explore the product at https://vachix.in',
    '',
    'The Vachix Team',
    'hello@vachix.in',
  ].join('\n');

  await sendEmail({
    to:      email,
    subject: 'Your Vachix demo request — we\'ll be in touch soon',
    html:    confirmHtml,
    text:    confirmText,
    logContext: { org, size },
  }).catch(err =>
    authLogger.warn('Lead confirmation email failed (non-fatal)', { email, error: (err as Error).message })
  );
}

// ── B2B Lead 24h follow-up ─────────────────────────────────────────
// Sent ~24h after the initial confirmation, only if the lead is still
// in "new" status (i.e. the team hasn't manually followed up yet).
// Dispatched via BullMQ — see dispatchLeadFollowUp / worker.ts.

export async function sendLeadFollowUpEmail(lead: LeadEmailPayload): Promise<void> {
  const { name, email, org } = lead;

  const html = `
    <p>Hi ${escHtml(name)},</p>
    <p>Just following up on your demo request for <strong>${escHtml(org)}</strong> — we wanted to make sure it didn't slip through the cracks!</p>
    <p>Happy to set up a quick call this week to walk through how Vachix can help your team practice interviews at scale. Just reply to this email with a time that works, or let us know if you have any questions in the meantime.</p>
    <p style="margin-top:24px;color:#999;font-size:13px;">The Vachix Team<br/>
    <a href="mailto:hello@vachix.in">hello@vachix.in</a></p>
  `;
  const text = [
    `Hi ${name},`,
    '',
    `Just following up on your demo request for ${org} — we wanted to make sure it didn't slip through the cracks!`,
    '',
    'Happy to set up a quick call this week. Just reply to this email with a time that works, or let us know if you have any questions.',
    '',
    'The Vachix Team',
    'hello@vachix.in',
  ].join('\n');

  await sendEmail({
    to:      email,
    subject: `Following up on your Vachix demo request — ${org}`,
    html,
    text,
    logContext: { org, followUp: true },
  });
}

// ── Tiny HTML-escape helper (internal use only) ──────────────────────
function escHtml(s: string | undefined): string {
  return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Password reset email ───────────────────────────────────────────

export async function sendPasswordResetEmail(to: string, resetLink: string): Promise<void> {
  const html = `
    <p>Hi,</p>
    <p>You requested a password reset for your Vachix account.</p>
    <p>
      <a href="${resetLink}" style="
        display:inline-block;
        padding:12px 24px;
        background:#6366f1;
        color:#fff;
        border-radius:6px;
        text-decoration:none;
        font-weight:600;
      ">Reset Password</a>
    </p>
    <p>This link expires in 1 hour. If you didn't request this, ignore this email.</p>
  `;

  const text = [
    'Reset your Vachix password',
    '',
    'You requested a password reset. Click the link below (expires in 1 hour):',
    resetLink,
    '',
    "If you didn't request this, ignore this email.",
  ].join('\n');

  await sendEmail({
    to,
    subject: 'Reset your Vachix password',
    html,
    text,
    logContext: { link: resetLink },
  });
}
