/**
 * features/user/types/index.ts
 *
 * Types for the user/profile domain.
 * User, Usage, UserStats, WeakArea, JobReadiness primitives live in @/types.
 */
import type { User, Usage, UserStats, WeakArea, JobReadiness } from '@/types';

/** Shape returned by GET /api/me */
export interface MeResponse {
  user:               User;
  usage:              Usage;
  stats:              UserStats;
  onboarding:         OnboardingStatus;
  job_readiness?:     JobReadiness;
  weak_areas?:        WeakArea[];
  // these were computed by the backend on every /api/me call
  // but the frontend type never declared them, so neither the dashboard
  // recommendations panel nor the session-setup pre-fill ever actually
  // consumed them.
  session_defaults?:  SessionDefaults;
  recommendations?:   DashboardRecommendation[];
}

export interface SessionDefaults {
  profession:     string;
  difficulty:     'beginner' | 'intermediate' | 'expert';
  interview_type: string;
}

export interface DashboardRecommendation {
  type:    'session' | 'focus' | 'milestone';
  title:   string;
  reason:  string;
  action?: string;
}

export interface OnboardingStatus {
  completed:    boolean;
  profession?:  string;
  goal?:        string;
}
