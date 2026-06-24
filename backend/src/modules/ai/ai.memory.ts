/**
 * AI Memory Service
 *
 * Tracks recurring mistakes per user across sessions and injects them into
 * Aria's system prompt so coaching is personalised to each user's history.
 *
 * Flow:
 *   1. After every session save → persistMistakesFromFeedback()
 *      Extracts grammar errors, low-score signals, and confidence flags
 *      from the session's feedback array and upserts them into the
 *      user_mistakes table (incrementing occurrence counts on conflict).
 *
 *   2. Before every AI call → getUserMemoryContext()
 *      Fetches the top 5 most-frequent mistakes for the current topic,
 *      formats them as a directive block, and returns it for injection
 *      into the system prompt. Empty string when no history exists yet.
 *
 * Prompt injection safety: mistake descriptions are wrapped with
 * wrapUntrusted() before they reach the system prompt, so a user
 * cannot smuggle instructions through their stored mistake text.
 *
 * Both functions are non-fatal — failures are logged and swallowed so
 * a DB hiccup in the memory layer never impacts the main session flow.
 */

import { db } from '../../core/database/client';
import { logger } from '../../infra/logger';
import { wrapUntrusted, UNTRUSTED_DATA_INSTRUCTION } from '../../core/utils';

const log = logger.child({ module: 'ai-memory' });

// Type guards
/** Narrows an unknown corrections element to the `{ error: string }` shape. */
function isCorrectionObject(c: unknown): c is { error: string } {
  return typeof c === 'object' && c !== null && 'error' in c && typeof (c as Record<string, unknown>).error === 'string';
}

/** Narrows to the shared ErrorCorrection shape `{ wrong: string, correct: string }`. */
function isErrorCorrectionObject(c: unknown): c is { wrong: string; correct: string } {
  const o = c as Record<string, unknown>;
  return typeof c === 'object' && c !== null
    && typeof o.wrong === 'string'
    && typeof o.correct === 'string';
}

// Public types
export interface MistakeRecord {
  topic:        string;
  mistake_type: 'grammar' | 'structure' | 'confidence' | 'content' | 'vocabulary' | 'clarity';
  description:  string;
}

export interface FeedbackItem {
  q?:              string;
  question?:       string;
  score?:          number;
  english_errors?: string[];
  corrections?:    unknown[];
  tips?:           string;
  structure?:      Record<string, unknown>;
}

// Persist mistakes from a completed session
/**
 * Extracts mistake signals from a session's feedback and upserts them into
 * the user_mistakes table. Occurrence counts accumulate across sessions so
 * the memory context reflects the user's most persistent patterns.
 *
 * Mistake extraction heuristics:
 *   - grammar      — entries in english_errors / corrections arrays
 *   - content      — score < 5 (answer quality too low)
 *   - structure    — score < 6 (answer not structured; suggest STAR)
 *   - confidence   — feedback tip mentions hesitation / uncertainty keywords
 *
 * Uses Promise.allSettled so a single row failure doesn't abort the rest.
 */
export async function persistMistakesFromFeedback(
  userId:    string,
  topic:     string,
  feedbacks: FeedbackItem[]
): Promise<void> {
  try {
    const mistakes: MistakeRecord[] = [];

    for (const f of feedbacks) {
      const score = f.score ?? 10;

      // Grammar: parse both the string-array form (english_errors) and
      // the legacy object form ({ error: string }) stored in corrections.
      const corrections = Array.isArray(f.english_errors)
        ? f.english_errors
        : Array.isArray(f.corrections)
          ? (f.corrections as unknown[]).map(c => {
              if (typeof c === 'string')          return c;
              if (isCorrectionObject(c))           return c.error;
              // Shared ErrorCorrection shape: { wrong, correct, explanation? }
              if (isErrorCorrectionObject(c))      return `${c.wrong} → ${c.correct}`;
              // Unknown shape — log so we can extend the guards rather than
              // silently dropping valid mistake data from memory.
              log.warn('ai.memory: unrecognised corrections element shape, skipping', { element: c });
              return '';
            })
          : [];

      for (const err of corrections) {
        if (err && err.length > 5) {
          mistakes.push({
            topic,
            mistake_type: 'grammar',
            description:  normalizeDescription(err),
          });
        }
      }

      // Content weakness: any score under 5 indicates the answer itself
      // (not just its form) was insufficient.
      if (score < 5) {
        mistakes.push({
          topic,
          mistake_type: 'content',
          description:  `Low-quality answers in ${topic} interviews (scored ${score}/10)`,
        });
      }

      // Structure weakness: scores under 6 suggest unorganised delivery.
      if (score < 6) {
        mistakes.push({
          topic,
          mistake_type: 'structure',
          description:  `Unstructured answers in ${topic} — needs STAR method`,
        });
      }

      // Confidence weakness: AI tip mentions hesitation or uncertainty.
      if (f.tips && /confiden|hesitat|uncertain|nervous/i.test(f.tips)) {
        mistakes.push({
          topic,
          mistake_type: 'confidence',
          description:  `Shows hesitation/uncertainty in ${topic} responses`,
        });
      }
    }

    if (mistakes.length === 0) return;

    // Upsert each mistake; occurrence counts increment on conflict so
    // we naturally surface the user's most persistent patterns at the top.
    await Promise.allSettled(
      mistakes.map(m =>
        db.rpc_upsert_mistake({
          p_user_id:      userId,
          p_topic:        m.topic,
          p_mistake_type: m.mistake_type,
          p_description:  m.description,
        })
      )
    );

    log.info('Persisted mistakes from session', { userId, count: mistakes.length });
  } catch (err) {
    log.warn('Failed to persist mistakes (non-fatal)', { userId, error: err });
  }
}

// Build memory context for AI system prompt
/**
 * Returns a formatted prompt fragment listing the user's top 5 recurring
 * mistakes for the given topic, sorted by occurrence count (most frequent
 * first). Returns an empty string if no history exists or the DB is down.
 *
 * Topic names are wrapped in <<<...>>> delimiters to prevent prompt injection
 * from user-controlled data stored in the mistakes table.
 */
export async function getUserMemoryContext(
  userId: string,
  topic:  string
): Promise<string> {
  try {
    const mistakes = await db.getUserMistakes(userId, topic);
    if (!mistakes || mistakes.length === 0) return '';

    const top = mistakes
      .sort((a, b) => b.occurrences - a.occurrences)
      .slice(0, 5);

    const lines = top.map(m =>
      `- [${m.mistake_type.toUpperCase()}] ${wrapUntrusted(m.description)} (seen ${m.occurrences}x)`
    );

    return (
      `\n\n📋 MEMORY — This user's recurring mistakes:\n${lines.join('\n')}\n` +
      `Address these patterns subtly in your feedback. If they repeat a known mistake, point it out explicitly. ` +
      UNTRUSTED_DATA_INSTRUCTION
    );
  } catch (err) {
    log.warn('Failed to fetch memory context (non-fatal)', { userId, error: err });
    return '';
  }
}

// Helpers
/**
 * Normalises a raw error string for consistent storage and deduplication.
 * Lowercases, strips quotes, and trims to 120 characters so near-identical
 * errors accumulate on the same row rather than creating separate entries.
 */
function normalizeDescription(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/['"]/g, '')
    .slice(0, 120);
}
