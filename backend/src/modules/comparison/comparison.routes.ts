import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { validate } from '../../core/middleware';
import {
  createComparisonToken,
  getComparison,
  respondToComparison,
} from './comparison.controller';

const router = Router();

// Tighter rate limit on the public respond endpoint — it triggers an AI
// call per submission. Mirrors the voice-warmup limiter's posture.
const respondLimiter = rateLimit({
  windowMs: 60_000,
  max:      10,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { success: false, error: { code: 'rate_limited', message: 'Too many requests. Please slow down.' } },
});

const respondLimiterPublic = rateLimit({
  windowMs: 60_000,
  max:      30,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { success: false, error: { code: 'rate_limited', message: 'Too many requests. Please slow down.' } },
});

const RespondSchema = z.object({
  answer: z.string().min(1).max(2000),
  name:   z.string().max(100).optional(),
});

// Public read — GET /api/compare/:token
router.get('/:token',
  respondLimiterPublic,
  getComparison,
);

// Public submit — POST /api/compare/:token/respond
router.post('/:token/respond',
  respondLimiter,
  validate(RespondSchema),
  respondToComparison,
);

export default router;
