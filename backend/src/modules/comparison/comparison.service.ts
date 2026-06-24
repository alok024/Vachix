/**
 * Score Comparison Service — Friend Score Comparison
 *
 * Async shareable link comparing two users' scores on the same interview
 * question. No live pairing — the sharer answers first and gets a link;
 * anyone who opens it (no Vachix account required) sees the sharer's score
 * and can submit their own answer to get AI-scored and compared.
 *
 * Token model:
 *   Same HMAC-SHA256 pattern as reports.service.ts and certificates.service.ts
 *   — payload is the comparison UUID, token = base64url(id).base64url(mac).
 *   Reuses REPORT_SECRET so no new secret to manage; the "comparison:" prefix
 *   in the signed payload namespaces it from report and certificate tokens so
 *   they can never be replayed as each other.
 *
 * AI scoring:
 *   Challengers submit a free-text answer; the service calls the AI to
 *   score it against the original question (same 0–10 scale as the main
 *   interview flow). This is a lightweight single-turn call, not a full
 *   session — no feedback persistence, no quota debit.
 */

import crypto from 'crypto';
import { env }    from '../../core/config/env';
import { db }     from '../../core/database/client';
import { callAI } from '../ai/ai.service';
import { logger } from '../../infra/logger';
import type { ScoreComparisonRow, ComparisonResponseRow } from '../../core/database/client';

const log = logger.child({ module: 'comparison' });

// ── Token encode/decode (matches reports.service.ts pattern exactly) ─

const MAC_BYTES = 16; // 128-bit truncated HMAC

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlToBuffer(input: string): Buffer {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  const pad    = (4 - (padded.length % 4)) % 4;
  return Buffer.from(padded + '='.repeat(pad), 'base64');
}

function signComparisonId(id: string): Buffer {
  // "comparison:" prefix namespaces the payload from report/certificate tokens
  return crypto
    .createHmac('sha256', env.REPORT_SECRET)
    .update(`comparison:${id}`, 'utf8')
    .digest()
    .subarray(0, MAC_BYTES);
}

export function encodeComparisonToken(comparisonId: string): string {
  const idPart  = b64url(Buffer.from(comparisonId, 'utf8'));
  const macPart = b64url(signComparisonId(comparisonId));
  return `${idPart}.${macPart}`;
}

export function decodeComparisonToken(token: string): string | null {
  try {
    const dotIndex = token.lastIndexOf('.');
    if (dotIndex < 0) return null;

    const idPart  = token.slice(0, dotIndex);
    const macPart = token.slice(dotIndex + 1);
    if (!idPart || !macPart) return null;

    const id = b64urlToBuffer(idPart).toString('utf8');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      return null;
    }

    const expectedMac = signComparisonId(id);
    const givenMac    = b64urlToBuffer(macPart);
    if (givenMac.length !== expectedMac.length) return null;
    if (!crypto.timingSafeEqual(givenMac, expectedMac)) return null;

    return id;
  } catch {
    return null;
  }
}

// ── Public shape returned to the frontend ────────────────────

export interface PublicComparison {
  comparison_id:   string;
  share_token:     string;
  question_text:   string;
  sharer_score:    number;
  sharer_answer:   string;
  expires_at:      string;
  responses:       Array<{
    id:                 string;
    challenger_name:    string | null;
    challenger_score:   number;
    ai_feedback:        string | null;
    created_at:         string;
  }>;
}

// ── Create a challenge from a completed session's question ───

export async function createComparison(
  userId:         string,
  sessionId:      string,
  questionIndex:  number,
): Promise<{ share_token: string; share_url: string }> {
  // Fetch the feedback row for this specific question
  const feedbacks = await db.getSessionFeedback(sessionId);
  const fb = feedbacks[questionIndex];

  if (!fb) {
    throw new Error(`No feedback at question_index=${questionIndex} for session ${sessionId}`);
  }

  // We need a placeholder ID to generate the token before the DB insert,
  // since the token is stored in the row itself. Use a deterministic
  // approach: insert a temporary row and immediately update with the token.
  // Simpler alternative: generate the UUID in application code.
  const id         = crypto.randomUUID();
  const shareToken = encodeComparisonToken(id);

  await db.createScoreComparison({
    id:             id,
    session_id:     (() => {
      // sessions.id is int8; PostgREST requires a JS number.
      // Validate before casting: a non-numeric sessionId produces NaN which
      // PostgREST silently ignores, inserting a row with a null FK.
      const n = Number(sessionId);
      if (!Number.isFinite(n)) throw new Error(`Invalid sessionId (non-numeric): ${sessionId}`);
      return n;
    })(),
    user_id:        userId,
    question_index: questionIndex,
    question_text:  fb.question,
    sharer_answer:  fb.answer ?? '',
    sharer_score:   fb.score,
    share_token:    shareToken,
  });

  const shareUrl = `${env.FRONTEND_URL}/compare?id=${shareToken}`;
  log.info('Score comparison created', { userId, sessionId, questionIndex, shareToken });

  return { share_token: shareToken, share_url: shareUrl };
}

// ── Public read ───────────────────────────────────────────────

export async function getPublicComparison(token: string): Promise<PublicComparison | null> {
  const id = decodeComparisonToken(token);
  if (!id) return null;

  const row = await db.getScoreComparisonByToken(token);
  if (!row) return null; // not found or expired

  const responses = await db.getComparisonResponses(row.id!);

  return {
    comparison_id: row.id!,
    share_token:   token,
    question_text: row.question_text,
    sharer_score:  row.sharer_score,
    sharer_answer: row.sharer_answer,
    expires_at:    row.expires_at!,
    responses:     responses.map(r => ({
      id:               r.id!,
      challenger_name:  r.challenger_name ?? null,
      challenger_score: r.challenger_score,
      ai_feedback:      r.ai_feedback ?? null,
      created_at:       r.created_at!,
    })),
  };
}

// ── Submit a challenger response (AI-scored) ──────────────────

export interface ChallengeSubmitResult {
  challenger_score: number;
  ai_feedback:      string;
  sharer_score:     number;
  delta:            number; // challenger_score - sharer_score (negative = sharer won)
}

export async function submitChallengeResponse(
  token:            string,
  challengerAnswer: string,
  challengerName?:  string,
): Promise<ChallengeSubmitResult | null> {
  const row = await db.getScoreComparisonByToken(token);
  if (!row) return null; // not found or expired

  // Cap total responses per comparison to prevent a viral link from
  // burning unbounded Groq quota. 50 is generous for any real use case
  // (friend group, college cohort) while capping worst-case AI spend.
  const existingResponses = await db.getComparisonResponses(row.id!);
  const RESPONSE_CAP = 50;
  if (existingResponses.length >= RESPONSE_CAP) {
    log.info('Comparison response cap reached', { comparisonId: row.id, cap: RESPONSE_CAP });
    return null; // controller maps null → 404; caller sees "link has expired"
  }

  // AI scores the challenger's answer against the original question —
  // lightweight single-turn call, same 0–10 scale as the main interview flow.
  const { score, feedback } = await scoreAnswerWithAI(
    row.question_text,
    challengerAnswer,
    row.sharer_answer,
  );

  const responseRow = await db.createComparisonResponse({
    comparison_id:     row.id!,
    challenger_name:   challengerName?.trim().slice(0, 100) || null,
    challenger_answer: challengerAnswer.slice(0, 2000),
    challenger_score:  score,
    ai_feedback:       feedback,
  });

  log.info('Comparison response submitted', {
    comparisonId: row.id, challengerScore: score, sharerScore: row.sharer_score,
  });

  return {
    challenger_score: responseRow.challenger_score,
    ai_feedback:      responseRow.ai_feedback ?? '',
    sharer_score:     row.sharer_score,
    delta:            Math.round((responseRow.challenger_score - row.sharer_score) * 10) / 10,
  };
}

// ── AI scoring helper ─────────────────────────────────────────

async function scoreAnswerWithAI(
  question:      string,
  answer:        string,
  sharerAnswer:  string,
): Promise<{ score: number; feedback: string }> {
  const prompt = [
    'You are an interview evaluator. Score the candidate\'s answer to the interview question below on a scale of 0–10.',
    'Respond ONLY with a JSON object in this exact format, no other text:',
    '{"score": <number 0-10, one decimal place>, "feedback": "<2 sentences max, direct and actionable>"}',
    '',
    `Question: ${question}`,
    `Candidate's answer: ${answer}`,
    '',
    // Show sharer answer for context, not as a reference to copy
    `(For context, another candidate answered: ${sharerAnswer.slice(0, 300)})`,
  ].join('\n');

  try {
    const res = await callAI(
      [{ role: 'user', content: prompt }],
      150,
      { cacheable: false }
    );

    const raw = res.text.trim().replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(raw) as { score?: unknown; feedback?: unknown };

    const score    = Math.min(10, Math.max(0, Math.round(Number(parsed.score) * 10) / 10));
    const feedback = typeof parsed.feedback === 'string' ? parsed.feedback.slice(0, 500) : '';

    if (isNaN(score)) throw new Error('AI returned non-numeric score');

    return { score, feedback };
  } catch (err) {
    log.warn('scoreAnswerWithAI: AI scoring failed — using fallback score', {
      error: (err as Error).message,
    });
    // Graceful degradation: don't block the submission just because AI is slow/down
    return { score: 5.0, feedback: 'Score could not be computed — please try again.' };
  }
}
