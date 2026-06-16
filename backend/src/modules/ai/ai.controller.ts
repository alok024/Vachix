/**
 * AI Controller — Phase 9
 *
 * Phase 8 → 9 additions:
 *   1. System-level load check (RPM gate) before burst check
 *   2. Adaptive behavior context injected into system prompt (Pro/Elite)
 *   3. Structured cache context (type + topic) passed to callAI
 *   4. Sentry user context set on each request
 *   5. Metrics counter for burst rejections
 *
 * H4 fix: buildPromptContext + BASE_SYSTEM_PROMPT + PromptContext moved to
 * ai.prompt-service.ts so this file only handles HTTP concerns.
 */

import { Request, Response }      from 'express';
import { asyncHandler }            from '../../core/middleware';
import { callAI, streamAI, AIMessage } from './ai.service';
import { getCachedAIResponse, setCachedAIResponse } from '../../infra/ai-cache';
import { buildPromptContext }      from './ai.prompt-service';
import { incrementAIUsage }        from '../user/user.service';
import { env, PLAN_LIMITS, PlanType } from '../../core/config/env';
import { aiLogger }                from '../../infra/logger';
import { checkBurstLimit }         from '../../infra/burst-limiter';
import { getAILimiterStats }       from '../../infra/ai-limiter';
import { checkSystemLoad }         from '../../infra/load-monitor';
import { setSentryUser, captureException, increment } from '../../infra/observability';
import { ok, fail }                from '../../core/utils/response';
import { AIUnavailableError }      from '../../core/utils/errors';
import { sanitiseTopic }           from '../../core/utils';

// AI errors from ai.service.ts are typed as AIUnavailableError (imported above).

// ── POST /api/ai ──────────────────────────────────────────────────

export const handleAI = asyncHandler(async (req: Request, res: Response) => {
  // L3: AI responses are user-specific and must never be cached at the
  // network layer (CDN/proxy) — set this first so it applies to every
  // response path below, including error/limit responses.
  res.setHeader('Cache-Control', 'no-store');

  const user      = req.user!;
  const callCount  = req.callCount ?? 0;
  const plan       = user.plan as PlanType;
  // FIX H7: Use req.resolvedLimit (set by checkUsageLimit from the DB) instead of
  // PLAN_LIMITS[user.plan]. The JWT plan is stale immediately after an upgrade —
  // users who just paid would still see their old free-tier "remaining" count.
  const limit      = req.resolvedLimit ?? PLAN_LIMITS[plan]?.ai_calls ?? 30;

  const topic = sanitiseTopic(
    (req.body.topic as string | undefined) ??
    (req.body.profession as string | undefined)
  );

  // Tag this user in Sentry for any subsequent errors
  setSentryUser(user.id, plan);

  // ── 1. System load gate (RPM cap — all users) ─────────────────
  const load = checkSystemLoad();
  if (load.overloaded) {
    res.setHeader('Retry-After', '30');
    fail(res, 503, 'system_overloaded', 'The system is currently under heavy load. Please try again shortly.', {
      retry_after_s: 30,
      rpm:           load.rpm,
      max_rpm:       load.maxRpm,
    });
    return;
  }

  // ── 2. Per-user burst check ────────────────────────────────────
  const burst = await checkBurstLimit(user.id, plan);
  if (!burst.allowed) {
    increment('ai.burst.rejected');
    const retryAfter = Math.ceil(burst.resetInMs / 1000);
    res.setHeader('Retry-After', retryAfter);
    fail(res, 429, 'burst_limit_exceeded', 'You are sending requests too fast. Please slow down.', {
      retry_after_s: retryAfter,
    });
    return;
  }

  // ── 3. Build system prompt ─────────────────────────────────────
  // FIX I8: pass the resolved response-token budget through so the
  // sliding-window trimmer can reserve room for it (default mirrors
  // callAI/streamAI's own default of 1024).
  const maxResponseTokens = req.body.max_tokens ?? 1024;
  const { messages, adaptiveProfile, cacheable, personalised, personaKey } = await buildPromptContext(
    user.id,
    plan,
    topic,
    (req.body.messages as AIMessage[]) || [],
    maxResponseTokens,
  );
  const hasPersonalisation = plan !== 'free';

  // ── 4. Call AI ─────────────────────────────────────────────────
  let text: string;
  let provider: string;
  let cached: boolean | undefined;

  try {
    ({ text, provider, cached } = await callAI(
      messages,
      req.body.max_tokens,
      {
        cacheable,
        // M2: personalised + userId let the cache layer bucket per-user
        // with a short TTL instead of skipping the cache entirely.
        cacheCtx: { topic, personaKey, personalised, userId: user.id },
      }
    ));
  } catch (err) {
    const e = err instanceof AIUnavailableError ? err : (err as Error & { statusCode?: number; retryAfterSeconds?: number });

    captureException(e, { userId: user.id, plan, extra: { topic } });

    if (e.retryAfterSeconds) res.setHeader('Retry-After', e.retryAfterSeconds);

    fail(res, e instanceof AIUnavailableError ? 503 : ((e as { statusCode?: number }).statusCode ?? 503), 'ai_unavailable', e.message, {
      retry_after_s: e.retryAfterSeconds ?? 30,
      _debug: env.NODE_ENV === 'development' ? getAILimiterStats() : undefined,
    });
    return;
  }

  // FIX (session-counted, not message-counted): usage is now incremented once
  // per *completed interview session* (sessions.service.ts, on save), not once
  // per AI message exchange. A single session fires many AI calls (greeting,
  // each question, each answer's feedback, follow-ups, etc.) — counting every
  // one of those against the 7-free-sessions quota was blocking free users
  // partway through their very first session instead of after their 7th.
  // isFreeCall/incrementAIUsage are intentionally no longer called here.

  aiLogger.debug('AI call completed', {
    userId:     user.id,
    provider,
    cached:     cached ?? false,
    callCount,
    plan,
    adaptive:   !!adaptiveProfile,   // true when Pro/Elite has enough data for coaching profile
    personalised: hasPersonalisation, // false on free plan — no memory/adaptive layer
  });

  ok(res, {
    text,
    provider,
    cached:     cached ?? false,
    calls_used: callCount,
    limit:      limit === -1 ? null : limit,
    remaining:  limit === -1 ? null : Math.max(0, limit - callCount),
    plan_features: {
      personalised: hasPersonalisation,  // false = free plan; prompt has no adaptive/memory layer
    },
    // Structured coaching signals for the "Aria adapted for you" UI.
    // null when hasPersonalisation is false (free plan) or on first session
    // before enough data exists for a profile.
    coaching_context: adaptiveProfile?.coaching_context ?? null,
  });
});

// ── POST /api/ai/stream — real-time SSE token streaming ──────────
//
// Same auth/limit/personalisation pipeline as /api/ai, but the model's
// response is streamed to the client token-by-token over
// Server-Sent-Events as it is generated — true incremental output,
// not request → wait → full response.
//
// Events sent:
//   event: token   data: {"text":"..."}      (one per chunk, as it arrives)
//   event: done    data: {"provider":"...","calls_used":N,"remaining":N|null}
//   event: error   data: {"error":"...","message":"...","retry_after_s":N}

export const handleAIStream = asyncHandler(async (req: Request, res: Response) => {
  const user      = req.user!;
  const callCount  = req.callCount ?? 0;
  const plan       = user.plan as PlanType;
  // FIX H7: Same as handleAI — use DB-authoritative limit, not stale JWT plan.
  const limit      = req.resolvedLimit ?? PLAN_LIMITS[plan]?.ai_calls ?? 30;

  const topic = sanitiseTopic(
    (req.body.topic as string | undefined) ??
    (req.body.profession as string | undefined)
  );

  setSentryUser(user.id, plan);

  // ── SSE headers — sent immediately so the client connection opens ─
  res.setHeader('Content-Type', 'text/event-stream');
  // L3: AI responses are user-specific — no-store ensures no
  // CDN/proxy ever caches this stream regardless of method/config.
  res.setHeader('Cache-Control', 'no-store, no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // disable proxy buffering (nginx)
  res.flushHeaders?.();

  const sendEvent = (event: string, data: unknown) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
    // @ts-expect-error - flush exists on Node http response when compression isn't used
    res.flush?.();
  };

  // ── 1. System load gate ────────────────────────────────────────
  const load = checkSystemLoad();
  if (load.overloaded) {
    sendEvent('error', {
      error: 'system_overloaded',
      message: 'The system is currently under heavy load. Please try again shortly.',
      retry_after_s: 30,
    });
    res.end(); return;
  }

  // ── 2. Per-user burst check ────────────────────────────────────
  const burst = await checkBurstLimit(user.id, plan);
  if (!burst.allowed) {
    increment('ai.burst.rejected');
    sendEvent('error', {
      error: 'burst_limit_exceeded',
      message: 'You are sending requests too fast. Please slow down.',
      retry_after_s: Math.ceil(burst.resetInMs / 1000),
    });
    res.end(); return;
  }

  // ── 3. Build system prompt (same personalisation pipeline as /api/ai) ──
  // FIX I8: see handleAI — reserve room for the response in the token budget.
  const maxResponseTokens = req.body.max_tokens ?? 1024;
  const { messages, adaptiveProfile, cacheable, personalised, personaKey } = await buildPromptContext(
    user.id,
    plan,
    topic,
    (req.body.messages as AIMessage[]) || [],
    maxResponseTokens,
  );
  const hasPersonalisation = plan !== 'free';
  // M2: personalised + userId let the cache layer bucket per-user with a
  // short TTL instead of skipping the cache entirely.
  const cacheCtx = { topic, personaKey, personalised, userId: user.id };

  // Detect early client disconnects so we stop pushing tokens for nothing.
  let clientGone = false;
  req.on('close', () => { clientGone = true; });

  try {
    // ── 4a. Cache hit — replay instantly as a fast simulated stream ──
    if (cacheable) {
      const cached = await getCachedAIResponse(messages, cacheCtx);
      if (cached) {
        for (const word of cached.text.split(/(\s+)/)) {
          if (clientGone) break;
          sendEvent('token', { text: word });
          await new Promise(r => setTimeout(r, 8)); // perceptible live-typing effect
        }
        sendEvent('done', {
          provider: cached.provider,
          cached: true,
          calls_used: callCount + 1,
          limit: limit === -1 ? null : limit,
          remaining: limit === -1 ? null : Math.max(0, limit - (callCount + 1)),
          plan_features: {
            personalised: hasPersonalisation,  // false = free plan; prompt has no adaptive/memory layer
          },
          coaching_context: adaptiveProfile?.coaching_context ?? null,
        });
        res.end(); return;
      }
    }

    // ── 4b. Live stream from provider, token-by-token ────────────────
    const { provider, fullText } = await streamAI(
      messages,
      (chunk) => { if (!clientGone) sendEvent('token', { text: chunk }); },
      req.body.max_tokens,
    );

    if (clientGone) { res.end(); return; }

    if (cacheable && fullText.trim()) {
      await setCachedAIResponse(messages, { text: fullText, provider }, cacheCtx).catch(() => {});
    }

    aiLogger.debug('AI stream completed', {
      userId: user.id, provider, callCount: callCount + 1, plan,
    });

    sendEvent('done', {
      provider,
      cached: false,
      calls_used: callCount + 1,
      limit: limit === -1 ? null : limit,
      remaining: limit === -1 ? null : Math.max(0, limit - (callCount + 1)),
      plan_features: {
        personalised: hasPersonalisation,  // false = free plan; prompt has no adaptive/memory layer
      },
      coaching_context: adaptiveProfile?.coaching_context ?? null,
    });
    res.end();

  } catch (err) {
    const e = err instanceof AIUnavailableError ? err : (err as Error & { statusCode?: number; retryAfterSeconds?: number });
    captureException(e, { userId: user.id, plan, extra: { topic, stream: true } });
    sendEvent('error', {
      error: 'ai_unavailable',
      message: e.message,
      retry_after_s: e.retryAfterSeconds ?? 30,
    });
    res.end();
  }
});
