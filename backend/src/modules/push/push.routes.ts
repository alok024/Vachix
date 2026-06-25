/**
 * Push Notification Routes
 *
 * Mounted in app.ts:
 *   /api/push/*       — subscription management (subscribe / unsubscribe / vapid key)
 *   /api/weekly-card  — weekly progress card SVG (public)
 */

import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware, validate } from '../../core/middleware';
import {
  getVapidPublicKey,
  subscribePush,
  unsubscribePush,
  getWeeklyCardSvg,
} from './push.controller';

export const pushRouter = Router();

const SubscribeSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth:   z.string().min(1),
  }),
});

const UnsubscribeSchema = z.object({
  endpoint: z.string().url(),
});

// Public — frontend reads this before calling PushManager.subscribe()
pushRouter.get('/push/vapid-public-key', getVapidPublicKey);

// Auth-required — manage subscriptions
pushRouter.post('/push/subscribe',    authMiddleware, validate(SubscribeSchema),    subscribePush);
pushRouter.delete('/push/unsubscribe', authMiddleware, validate(UnsubscribeSchema), unsubscribePush);

// Public weekly card SVG
pushRouter.get('/weekly-card/:userId', getWeeklyCardSvg);
