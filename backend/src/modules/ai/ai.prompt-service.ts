/**
 * AI Prompt Service (H4)
 *
 * Previously, buildPromptContext() lived inside ai.controller.ts, mixing
 * HTTP-layer concerns (reading req/res) with service-layer orchestration
 * (fetching user data, building personalised system prompts).
 *
 * This file extracts that logic so it can be:
 *   - Unit-tested without spinning up an Express server
 *   - Reused by any future handler (e.g. a WebSocket endpoint)
 *   - Reasoned about in isolation
 *
 * ai.controller.ts now imports buildPromptContext from here and only
 * handles HTTP: read request → call service → send response.
 */

import { db }                                          from '../../core/database/client';
import { AIMessage }                                   from './ai.service';
import { getUserMemoryContext }                        from './ai.memory';
import { getWeakAreaPromptContext }                    from '../analytics/weak_areas.service';
import { getAdaptiveBehaviorContext }                  from './ai-adaptive';
import { getOnboardingPromptContext, getPersonaBucket } from './onboarding-context';
import { env }                                        from '../../core/config/env';
import { aiLogger }                                   from '../../infra/logger';
import { trimMessagesToTokenBudget }                  from '../../core/utils/tokens';

// ── Aria base prompt ───────────────────────────────────────────────
// Single source of truth — imported by the controller, never duplicated.

export const BASE_SYSTEM_PROMPT =
  `You are Aria, an AI interview coach for Vachix. ` +
  `Help users practice job interviews, evaluate their answers, give structured feedback, ` +
  `and improve their English communication. Only assist with interview-related tasks. ` +
  `Be concise and direct. Always respond with valid JSON when asked.`;

// ── Types ──────────────────────────────────────────────────────────

export interface PromptContext {
  systemPrompt:    string;
  messages:        AIMessage[];
  adaptiveProfile: ReturnType<typeof getAdaptiveBehaviorContext>['profile'] | null;
  cacheable:       boolean;
  /**
   * M2: true when memory/weak-area/adaptive/onboarding context was injected
   * into the system prompt. Passed through to callAI's cacheCtx so the
   * cache layer can bucket the entry per-user with a short TTL instead of
   * skipping the cache entirely.
   */
  personalised:    boolean;
  personaKey:      string;
  trimmedCount:    number;
}

// ── Main export ────────────────────────────────────────────────────
//
// Builds a fully personalised message array for a given user + plan + topic.
// Fetches memory, weak areas, stats, and onboarding data concurrently, then
// assembles them into a system prompt and applies token-budget trimming.
//
// Called by handleAI and handleAIStream — identical personalisation pipeline
// for both the buffered and streaming code paths.

export async function buildPromptContext(
  userId:            string,
  plan:              string,
  topic:             string,
  rawMessages:       AIMessage[],
  maxResponseTokens: number,
): Promise<PromptContext> {
  const hasPersonalisation = plan !== 'free';

  const [memoryContext, weakAreaContext, userStats, dbUser] = await Promise.all([
    getUserMemoryContext(userId, topic),
    getWeakAreaPromptContext(userId),
    db.getStats(userId),
    db.getUserById(userId),
  ]);

  const onboardingData = {
    profession: dbUser?.onboarding_profession,
    goal:       dbUser?.onboarding_goal,
  };
  const onboardingContext = getOnboardingPromptContext(onboardingData);

  // Adaptive coaching layer — Pro/Elite only
  const adaptive = (hasPersonalisation && userStats)
    ? getAdaptiveBehaviorContext({
        sessions:      userStats.sessions      ?? 0,
        streak:        userStats.streak        ?? 0,
        best_score:    userStats.best_score    ?? 0,
        avg_job_ready: userStats.avg_job_ready_score ?? 0,
        clarity_avg:   userStats.clarity_avg   ?? 0,
        structure_avg: userStats.structure_avg ?? 0,
        relevance_avg: userStats.relevance_avg ?? 0,
        grammar_avg:   userStats.grammar_avg   ?? 0,
      })
    : null;

  const adaptiveContext = adaptive?.prompt ?? '';
  const adaptiveProfile = adaptive?.profile ?? null;

  const systemPrompt = BASE_SYSTEM_PROMPT + onboardingContext + memoryContext + weakAreaContext + adaptiveContext;

  const rawAssembled: AIMessage[] = [
    { role: 'system', content: systemPrompt },
    ...rawMessages,
  ];

  // Token budget — sliding window. Drops oldest conversation turns (never
  // the system message) until prompt + reserved response tokens fit budget.
  const { messages, trimmedCount } = trimMessagesToTokenBudget(rawAssembled, maxResponseTokens);

  if (trimmedCount > 0) {
    aiLogger.info('Trimmed conversation history to fit token budget', {
      userId,
      trimmedCount,
      totalMessages: rawAssembled.length - 1,
      budget:        env.AI_CONTEXT_TOKEN_BUDGET,
    });
  }

  // M2: previously `cacheable = !memoryContext && !weakAreaContext &&
  // !adaptiveContext && !onboardingContext` meant ANY personalisation signal
  // disabled caching entirely — so Pro/Elite users (the ones with memory,
  // weak-area, and adaptive context) NEVER got cache benefits, while
  // brand-new free users with no history got served from the shared cache.
  //
  // Now every response is cacheable. `personalised` flags whether this
  // response carries per-user context; the cache layer (ai-cache.ts) uses
  // that to bucket the key by userId and apply a short TTL, so retries are
  // deduplicated without leaking one user's coaching context to another.
  const personalised = !!(memoryContext || weakAreaContext || adaptiveContext || onboardingContext);
  const cacheable     = true;
  const personaKey    = getPersonaBucket(onboardingData);

  return { systemPrompt, messages, adaptiveProfile, cacheable, personalised, personaKey, trimmedCount };
}
