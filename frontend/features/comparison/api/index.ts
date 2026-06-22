/**
 * features/comparison/api/index.ts
 *
 * HTTP client for the Friend Score Comparison feature.
 *
 * createComparison — auth required (sharer, from summary page)
 * getComparison    — public (challenger landing page)
 * submitResponse   — public (challenger submits their answer)
 */
import { apiCall } from '@/lib/api';
import type {
  ComparisonCreateResponse,
  PublicComparisonResponse,
  ChallengeSubmitResponse,
} from '../types';

export const comparisonApi = {
  /**
   * Auth required. Creates a comparison challenge for one question in a
   * completed session. Returns a shareable link the sharer can send to friends.
   */
  createComparison: (sessionId: string, questionIndex: number) =>
    apiCall<ComparisonCreateResponse>(
      `/sessions/${sessionId}/compare`,
      'POST',
      { question_index: questionIndex }
    ),

  /**
   * Public — no auth required. Fetches the comparison data for the landing
   * page, including the original question, sharer score, and all prior
   * challenger responses.
   */
  getComparison: (token: string) =>
    apiCall<PublicComparisonResponse>(`/compare/${token}`),

  /**
   * Public — no auth required. Submits a challenger's answer for AI scoring.
   * Returns the challenger's score, AI feedback, and the delta vs. sharer.
   */
  submitResponse: (token: string, answer: string, name?: string) =>
    apiCall<ChallengeSubmitResponse>(
      `/compare/${token}/respond`,
      'POST',
      { answer, ...(name ? { name } : {}) }
    ),
};
