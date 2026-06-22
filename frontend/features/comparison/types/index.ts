/**
 * features/comparison/types/index.ts
 *
 * Types for the Friend Score Comparison feature.
 * Field names are snake_case to match backend JSON serialization (ok(res, data)
 * passes the object as-is — same convention as reports, sessions, etc.).
 */

/** Response from POST /api/sessions/:id/compare (auth required — sharer creates the link) */
export interface ComparisonCreateResponse {
  share_token: string;
  share_url:   string;
}

/** One challenger response inside PublicComparisonResponse */
export interface ComparisonResponse {
  id:               string;
  challenger_name:  string | null;
  challenger_score: number;
  ai_feedback:      string | null;
  created_at:       string;
}

/** Response from GET /api/compare/:token (public, no auth) */
export interface PublicComparisonResponse {
  comparison_id:  string;
  share_token:    string;
  question_text:  string;
  sharer_score:   number;
  sharer_answer:  string;
  expires_at:     string;
  responses:      ComparisonResponse[];
}

/** Response from POST /api/compare/:token/respond (public, no auth) */
export interface ChallengeSubmitResponse {
  challenger_score: number;
  ai_feedback:      string;
  sharer_score:     number;
  delta:            number; // positive = challenger beat sharer, negative = sharer won
}
