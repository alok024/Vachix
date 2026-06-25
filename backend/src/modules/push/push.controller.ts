/**
 * Push Subscription Controller
 *
 * Endpoints for registering and removing Web Push subscriptions,
 * and for serving the weekly progress card SVG.
 *
 * Routes (mounted in push.routes.ts):
 *   POST   /api/push/subscribe          — store a subscription (auth required)
 *   DELETE /api/push/unsubscribe        — remove by endpoint (auth required)
 *   GET    /api/push/vapid-public-key   — serve the VAPID public key (public)
 *   GET    /api/weekly-card/:userId     — serve weekly card SVG (public)
 */

import { Request, Response } from 'express';
import { asyncHandler } from '../../core/middleware';
import { db } from '../../core/database/client';
import { env } from '../../core/config/env';
import { ok, badRequest, notFound } from '../../core/utils/response';
import { logger } from '../../infra/logger';

const log = logger.child({ module: 'push' });

// GET /api/push/vapid-public-key  (public)
export const getVapidPublicKey = asyncHandler(async (_req: Request, res: Response) => {
  if (!env.VAPID_PUBLIC_KEY) {
    badRequest(res, 'Push notifications not configured', 'vapid_not_configured');
    return;
  }
  ok(res, { publicKey: env.VAPID_PUBLIC_KEY });
});

// POST /api/push/subscribe  (auth required)
//
// Body: { endpoint: string, keys: { p256dh: string, auth: string } }
// Mirrors the PushSubscription shape from the browser PushManager API.
export const subscribePush = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { endpoint, keys } = req.body as {
    endpoint: string;
    keys: { p256dh: string; auth: string };
  };

  await db.upsertPushSubscription({
    user_id:  userId,
    endpoint,
    p256dh:   keys.p256dh,
    auth:     keys.auth,
  });

  log.info('Push subscription saved', { userId, endpoint: endpoint.slice(0, 60) });
  ok(res, { subscribed: true });
});

// DELETE /api/push/unsubscribe  (auth required)
//
// Body: { endpoint: string }
export const unsubscribePush = asyncHandler(async (req: Request, res: Response) => {
  const userId   = req.user!.id;
  const endpoint = (req.body as { endpoint: string }).endpoint;

  await db.deletePushSubscriptionForUser(endpoint, userId);
  log.info('Push subscription removed', { userId });
  ok(res, { unsubscribed: true });
});

// GET /api/weekly-card/:userId  (public — no auth)
//
// Returns the most recently generated weekly card SVG for the user.
// The SVG is stored inline on the user row (weekly_card_url column holds
// the raw SVG string, not a URL, despite the column name — matches how
// certificates.service.ts stores SVG inline rather than in object storage).
export const getWeeklyCardSvg = asyncHandler(async (req: Request, res: Response) => {
  const { userId } = req.params;

  const user = await db.getUserById(userId);
  if (!user) {
    notFound(res, 'User not found');
    return;
  }

  if (!user.weekly_card_url) {
    notFound(res, 'Weekly card not generated yet');
    return;
  }

  res.setHeader('Content-Type', 'image/svg+xml');
  // Short public cache — matches certificates.controller.ts reasoning.
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.send(user.weekly_card_url);
});
