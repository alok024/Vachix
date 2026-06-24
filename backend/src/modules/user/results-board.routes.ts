/**
 * modules/user/results-board.routes.ts
 *
 * POST /api/user/job-landed     — auth + verified required
 * GET  /api/user/results-board  — public (no auth)
 *
 * Mounted in app.ts as:
 *   app.use('/api/user', resultsBoardRoutes);
 */

import { Router } from 'express';
import { authMiddleware, requireVerified } from '../../core/middleware';
import { submitJobLanded, getBoard, getBoardEntry } from './results-board.controller';

const router = Router();

// Write path: must be authenticated and email-verified
router.post('/job-landed', authMiddleware, requireVerified, submitJobLanded);

// Read path: intentionally public — social proof page, no login required
router.get('/results-board', getBoard);

// Per-user lookup: used by the OG image Edge route to avoid a full board scan
router.get('/results-board-entry/:userId', getBoardEntry);

export default router;
