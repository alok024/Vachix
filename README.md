<div align="center">

<img src="https://img.shields.io/badge/status-active%20development-brightgreen?style=flat-square" alt="Status" />
<img src="https://img.shields.io/badge/license-proprietary-red?style=flat-square" alt="License" />
<img src="https://img.shields.io/badge/version-5.1.0-blue?style=flat-square" alt="Version" />

# Vachix

**AI-powered interview practice and English coaching for Indian job seekers.**

Two AI coaches. Eleven exam tracks. Live language correction with real-time feedback.  
Built for UPSC, Bank PO, SSC, campus placements, and tech roles.

[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Next.js](https://img.shields.io/badge/Next.js%2015-000000?style=flat-square&logo=next.js&logoColor=white)](https://nextjs.org/)
[![Express](https://img.shields.io/badge/Express-404D59?style=flat-square&logo=express&logoColor=white)](https://expressjs.com/)
[![Supabase](https://img.shields.io/badge/Supabase-3FCF8E?style=flat-square&logo=supabase&logoColor=white)](https://supabase.com/)
[![Cloudflare Pages](https://img.shields.io/badge/Cloudflare%20Pages-F38020?style=flat-square&logo=cloudflare&logoColor=white)](https://pages.cloudflare.com/)
[![Railway](https://img.shields.io/badge/Railway-0B0D0E?style=flat-square&logo=railway&logoColor=white)](https://railway.app/)
[![CI](https://img.shields.io/github/actions/workflow/status/your-org/vachix/ci.yml?branch=main&style=flat-square&label=CI)](https://github.com/your-org/vachix/actions)

</div>

---

## What is Vachix?

Most competitive-exam coaching teaches candidates *what* to say. Nobody trains them on *how* they say it — the grammar slips, the filler phrases, the Hinglish patterns that cost marks in front of a real panel.

Vachix puts two AI coaches in the room:

- **Aria** — fires realistic questions across 11 exam and role tracks (UPSC/IAS, Bank PO, SSC CGL, Railway, Defence, Software Engineering, Data Science, Product Management, Campus Placements, Teaching, Healthcare). Adapts difficulty, coaching depth, and feedback style automatically as your session history grows — beginner, intermediate, and advanced modes with trajectory-aware coaching.
- **Elara** — watches every answer in real time and catches grammar errors, incorrect tenses, bureaucratic filler, and Hinglish patterns the moment they appear — not at the end of the session. Scores each answer independently across Grammar, Fluency, and Vocabulary.

Sessions run via text or voice. Feedback is instant. Scores are tracked per-dimension over time so candidates can see exactly which axis is holding them back. Voice input uses VAD (voice activity detection) in the browser — no audio uploads, no latency, no privacy leak.

---

## Table of Contents

- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Feature Map](#feature-map)
- [Getting Started](#getting-started)
- [Environment Variables](#environment-variables)
- [Database Migrations](#database-migrations)
- [Scripts](#scripts)
- [Security Model](#security-model)
- [Deployment](#deployment)
- [CI](#ci)
- [Roadmap](#roadmap)

---

## Architecture

```
┌──────────────────────────────┐        /api/* rewrite proxy          ┌──────────────────────────────┐
│   Next.js 15  (App Router)   │ ───────────────────────────────────► │   Express + TypeScript API    │
│   Cloudflare Pages           │ ◄─────────── httpOnly cookies ─────── │   Railway  (v5.1.0)           │
└──────────────────────────────┘                                       └──────────────────────────────┘
                                                                                │
          ┌──────────────────────────────────────┬───────────────────┬──────────┴──────────────────────┐
          ▼                                      ▼                   ▼                                  ▼
┌──────────────────┐              ┌────────────────────────┐  ┌──────────────────┐          ┌──────────────────┐
│  Supabase        │              │  Groq (primary LLM)    │  │  BullMQ + Redis  │          │  Razorpay        │
│  Postgres + RLS  │              │  llama-3.3-70b         │  │  Background jobs │          │  Subscriptions   │
└──────────────────┘              ├────────────────────────┤  └──────────────────┘          └──────────────────┘
                                  │  Sarvam TTS (primary)  │
                                  │  ElevenLabs (fallback) │
                                  └────────────────────────┘
```

**Key design decisions:**

**Edge proxy, no CORS.** The Next.js frontend rewrites all `/api/*` traffic to the Express backend at the CDN edge. Cookies are treated as same-origin by the browser regardless of where the API runs — no CORS credential juggling in development or production.

**Token storage in httpOnly cookies only.** Short-lived JWT access tokens and rotating refresh tokens are stored exclusively in `httpOnly`, `Secure`, `SameSite=Lax` cookies. Frontend JavaScript never sees a token, which eliminates the XSS → account-takeover attack path that `localStorage` / bearer-token setups leave open.

**Trust no JWT claim for privilege.** Plan tier, admin role, and email-verification status are re-read from the database on every request. Revoking a session or downgrading a plan takes effect immediately — no wait for token expiry. Migration `006` adds a `tokens_invalidated_at` column for per-user instant invalidation.

**TTS with a circuit breaker.** Voice responses go to **Sarvam** `bulbul:v3` (Indian-English–tuned). A Redis-backed circuit breaker monitors consecutive failures; after `SARVAM_BREAKER_FAILURE_THRESHOLD` (default 3) it opens and routes straight to **ElevenLabs**, skipping Sarvam entirely until a probe succeeds.

---

## Tech Stack

### Frontend

| Layer | Technology |
|---|---|
| Framework | Next.js 15 (App Router) + React 18 + TypeScript |
| Styling | Tailwind CSS + custom CSS (landing animations, theme system) |
| Components | shadcn/ui + Radix UI primitives + Lucide icons |
| Server state | TanStack Query v5 |
| Client state | Zustand (auth, UI, interview session) |
| Validation | Zod (schemas shared with backend via `shared/`) |
| Analytics | PostHog |
| Error tracking | Sentry (`@sentry/nextjs`) |
| Voice input | Web Speech API + `@ricky0123/vad-web` (Silero VAD, ONNX runtime, in-browser) |
| Charts | Recharts |

### Backend

| Layer | Technology |
|---|---|
| Runtime | Node.js 20+ / TypeScript 5 |
| Framework | Express 4 |
| Database | Supabase (Postgres + Row Level Security) |
| Auth | Custom JWT (httpOnly cookies) — no Supabase Auth |
| Queue | BullMQ 5 + ioredis |
| AI | Groq (`llama-3.3-70b`) — primary LLM |
| TTS | Sarvam `bulbul:v3` (primary) → ElevenLabs (fallback) |
| Payments | Razorpay (subscriptions + webhooks) |
| Email | Resend |
| Push | Web Push (VAPID) |
| Observability | Sentry + Winston + custom load monitor |
| Validation | Zod |
| Testing | Jest + Supertest |

### Infrastructure

| Layer | Technology |
|---|---|
| Frontend hosting | Cloudflare Pages (`@cloudflare/next-on-pages`) |
| Backend hosting | Railway |
| Database | Supabase (managed Postgres) |
| Cache / Queue | Redis (Railway-managed) |
| CI/CD | GitHub Actions |

---

## Project Structure

```
vachix/
├── frontend/                        Next.js 15 application
│   ├── app/
│   │   ├── (app)/                   Authenticated routes
│   │   │   ├── dashboard/
│   │   │   ├── interview/           Setup → session → summary flow
│   │   │   ├── english/             Elara English coaching
│   │   │   ├── history/
│   │   │   ├── leaderboard/
│   │   │   ├── prep-paths/
│   │   │   ├── profile/
│   │   │   ├── referral/
│   │   │   └── admin/
│   │   ├── (auth)/                  Public auth routes (login, register, reset)
│   │   ├── (public)/                Unauthenticated pages (reports, certificates, compare)
│   │   └── api/og/                  Edge OG image generation
│   ├── components/
│   │   └── landing/                 Marketing landing page
│   └── features/                    Feature slices (api/ hooks/ types/ schemas/ per feature)
│
├── backend/                         Express + TypeScript API
│   ├── src/
│   │   ├── app.ts                   Express bootstrap + route registration
│   │   ├── core/
│   │   │   ├── config/env.ts        Zod-validated env schema — hard-fails on boot if invalid
│   │   │   ├── database/client.ts   Supabase client + typed query helpers
│   │   │   ├── middleware.ts        Auth, rate-limit, CORS, error handler
│   │   │   └── utils/              Shared error types, response helpers, schemas, tokens
│   │   ├── infra/
│   │   │   ├── ai-cache.ts          Per-user AI response cache (Redis TTL)
│   │   │   ├── ai-limiter.ts        Concurrency cap on upstream LLM calls
│   │   │   ├── burst-limiter.ts     Per-user burst rate limiter
│   │   │   ├── circuit-breaker.ts   Generic circuit breaker (Groq / OpenAI)
│   │   │   ├── sarvam-circuit-breaker.ts  TTS-specific breaker → ElevenLabs fallback
│   │   │   ├── load-monitor.ts      System load heartbeat logger
│   │   │   ├── observability.ts     Sentry init + metrics helpers
│   │   │   ├── request-context.ts   AsyncLocalStorage request-id propagation
│   │   │   └── queue/               BullMQ queues, worker, dispatcher
│   │   └── modules/
│   │       ├── ai/                  Aria interview engine, adaptive coaching, scoring
│   │       ├── elara/               English coaching module
│   │       ├── auth/                JWT auth, email verification, password reset
│   │       ├── user/                Profile, results board
│   │       ├── payment/             Razorpay subscription lifecycle + webhook
│   │       ├── analytics/           Sessions, events, leaderboard, weekly cards, readiness
│   │       ├── voice/               TTS with Sarvam/ElevenLabs + usage ledger
│   │       ├── speech/              Filler-word + WPM metrics
│   │       ├── interview/           Interview session state management
│   │       ├── prep-paths/          Structured exam prep programs
│   │       ├── reports/             Shareable HMAC-signed session reports
│   │       ├── certificates/        Certificate generation
│   │       ├── comparison/          Cross-session score comparison
│   │       ├── gamification/        XP, streaks, streak freezes, milestone rewards
│   │       ├── growth/              Referral system
│   │       ├── leads/               B2B lead capture
│   │       ├── push/                Web Push / VAPID subscriptions
│   │       └── admin/               Admin dashboard API
│   ├── migrations/                  28 ordered SQL migration files
│   ├── .env.example                 Documented env template
│   └── OBSERVABILITY.md             Logging and metrics reference
│
├── shared/                          Zod schemas + types shared across frontend and backend
│   ├── index.ts
│   └── schemas/api.schemas.ts
│
├── .github/
│   ├── workflows/ci.yml             GitHub Actions — build, type-check, Jest, security audit
│   └── dependabot.yml
└── package.json                     npm workspaces root
```

Each `features/<name>/` slice in the frontend owns its own `api/`, `types/`, `hooks/`, and `schemas/` subdirectories. There is no shared god-object API client. Adding a new endpoint means touching exactly one feature slice.

---

## Feature Map

### Live and Shipped

| Feature | Notes |
|---|---|
| AI interview sessions (Aria) | Streaming responses, 11 exam/role tracks |
| Adaptive coaching | Depth, trajectory, focus, and engagement adapt automatically per user history |
| JD-based questions | Upload a job description, get role-specific interview questions |
| Impromptu practice mode | DB-seeded topic library, quota-gated Groq calls |
| Daily question | One focused practice question per day |
| Live English correction (Elara) | Grammar, Fluency, Vocabulary scored per answer in real time |
| Web Speech API voice input | Real-time transcription with Silero VAD; no audio upload |
| TTS voice responses | Sarvam `bulbul:v3` (Indian-English–tuned) with ElevenLabs fallback + circuit breaker |
| Voice usage ledger | Monthly per-plan caps with streak-milestone bonus pools; atomic Postgres RPCs |
| Speech metrics | Filler-word count + WPM tracked per session; charted after 3+ data points |
| Session history + score tracking | Per-dimension charts, weak-area detection over time |
| Shareable session reports | HMAC-SHA256 signed links — tamper-proof, publicly accessible |
| Certificates | Generated on qualifying sessions |
| Guided prep paths | Structured multi-day exam-track programs; enrollment + day-by-day progress |
| XP + Leaderboard | Global and weekly XP leaderboard |
| Streak tracking | IST-timezone-aware daily streaks with streak-milestone bonus voice seconds |
| Streak freezes | Spend XP to protect a streak |
| Milestone rewards | Bonus voice seconds and XP unlocked at streak milestones |
| Referral system | Unique codes, bonus session grants on verified signup |
| Subscriptions — Free / Starter / Pro / Elite | Razorpay-powered, webhook-verified, instant plan changes |
| Monthly session cap (Free tier) | Atomic `increment_session_count` RPC — race-condition safe |
| Results board | Community-visible job-landed outcomes |
| Weekly progress cards | BullMQ-generated summaries dispatched weekly |
| B2B lead capture | Rate-limited intake, automated email follow-up via Resend |
| Push notifications | Web Push / VAPID subscription management |
| Admin dashboard | Users, subscriptions, lead funnel — DB-role gated |
| PWA / offline support | Service worker, app manifest, offline fallback page |
| Animated day/night toggle | Sun↔moon morph with spring knob, twinkling stars, crescent mask |
| Responsive landing page | Scroll-tracking side rail, parallax, toast system, glass modals |

### In Development / Coming Next

| Feature | Target tier |
|---|---|
| Accent-tuned speech engine upgrade | Pro + Elite |
| Elara spoken feedback (audio responses during sessions) | Pro + Elite |
| Pronunciation scoring — word-by-word | Elite |
| Live avatar (animated face, real-time response) | Elite |

---

## Getting Started

### Prerequisites

- **Node.js 20+** (Node 22 used in CI)
- A **[Supabase](https://supabase.com/)** project (Postgres + RLS)
- A **[Groq](https://groq.com/)** API key — primary LLM provider
- A **[Razorpay](https://razorpay.com/)** account — test mode works for local dev
- **Redis** — optional locally; BullMQ jobs degrade gracefully to inline execution if absent

### Installation

```bash
git clone https://github.com/<your-org>/vachix.git
cd vachix

# Install all workspace packages from root
npm install

# Backend
cd backend
cp .env.example .env     # fill in required keys — see Environment Variables below
npm run dev              # starts on :8080 by default

# Frontend (new terminal)
cd ../frontend
npm run dev              # starts on :3000, proxies /api/* to NEXT_PUBLIC_BACKEND_URL
```

The frontend dev server proxies `/api/*` to `NEXT_PUBLIC_BACKEND_URL`. No manual CORS configuration is needed in development.

### Running the background worker

BullMQ jobs (email follow-ups, subscription expiry, weekly cards) run in a separate process:

```bash
cd backend
npm run worker
```

In production this should be a separate Railway service pointing at the same repo — see [Deployment](#deployment).

---

## Environment Variables

Copy `backend/.env.example` → `backend/.env`. The server **will refuse to start** in production if any required variable is missing — `env.ts` uses Zod to validate everything on boot and prints a clear error for each missing or malformed variable.

### Required

| Variable | Purpose |
|---|---|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_KEY` | Service role key — full DB access, **never expose** |
| `SUPABASE_ANON_KEY` | Anon/public key for RLS-scoped operations |
| `JWT_SECRET` | Access token signing key |
| `JWT_REFRESH_SECRET` | Refresh token signing key (must differ from access key) |
| `REPORT_SECRET` | HMAC key for shareable session report links |
| `GROQ_API_KEY` | Groq inference — primary LLM provider |
| `RAZORPAY_KEY_ID` | Razorpay public key |
| `RAZORPAY_KEY_SECRET` | Razorpay secret key |
| `RAZORPAY_WEBHOOK_SECRET` | Razorpay webhook signature verification |
| `FRONTEND_URL` | Allowed CORS origin (e.g. `https://vachix.com`) |

### Optional (degrade gracefully or have sane defaults)

| Variable | Default | Purpose |
|---|---|---|
| `REDIS_URL` | — | BullMQ job queue — jobs run inline if absent |
| `RESEND_API_KEY` | — | Transactional email — verification, resets, B2B follow-ups |
| `ELEVENLABS_API_KEY` | — | TTS fallback when Sarvam circuit breaker is open |
| `ELEVENLABS_VOICE_ID` | `21m00Tcm4TlvDq8ikWAM` | ElevenLabs voice selection |
| `SARVAM_API_KEY` | — | Primary TTS provider (Indian-English–tuned) |
| `SARVAM_TTS_SPEAKER` | `shubh` | Sarvam `bulbul:v3` speaker name |
| `SARVAM_TTS_MODEL` | `bulbul:v3` | Sarvam TTS model |
| `SARVAM_PRIMARY` | `true` | Set to `false` to route all TTS directly to ElevenLabs |
| `SARVAM_EN_LANG_CODE` | `en-IN` | Language code passed to Sarvam for English requests |
| `SARVAM_BREAKER_FAILURE_THRESHOLD` | `3` | Consecutive failures before circuit opens |
| `SARVAM_BREAKER_COOLDOWN_MS` | `15000` | Time before circuit allows a probe request |
| `OPENAI_API_KEY` | — | Reserved for future fallback — not used in primary path |
| `MAX_CONCURRENT_AI_CALLS` | `10` | Concurrency cap on upstream LLM calls |
| `AI_QUEUE_TIMEOUT_MS` | `30000` | Max wait time in AI concurrency queue (ms) |
| `AI_BURST_LIMIT` | `3` | Max AI calls per user per burst window |
| `AI_BURST_WINDOW_MS` | `10000` | Burst window duration (ms) |
| `AI_CONTEXT_TOKEN_BUDGET` | `8000` | Token budget for conversation history trimming |
| `AI_CACHE_TTL_SECONDS` | — | Global AI response cache TTL (omit to disable) |
| `AI_PROMPT_CACHE_TTL_SECONDS` | `1800` | Per-user personalised prompt cache TTL |
| `MAX_BONUS_VOICE_SECONDS` | `3600` | Hard ceiling on streak-milestone voice bonus (60 min) |
| `EXTRA_ALLOWED_ORIGINS` | — | Comma-separated origins to extend the CORS allowlist (preview deploys) |
| `SENTRY_DSN` | — | Sentry error tracking DSN |
| `VAPID_PUBLIC_KEY` | — | Web Push public key |
| `VAPID_PRIVATE_KEY` | — | Web Push private key |

> **Never commit a populated `.env` file.** `SUPABASE_SERVICE_KEY` and the Razorpay secret grant full backend access. `.gitignore` already excludes `.env`.

---

## Database Migrations

Migrations live in `backend/migrations/` and must be applied in order before first deploy. Run them against your Supabase project via the SQL editor or Supabase CLI.

All migrations are idempotent (`CREATE TABLE IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION`) and safe to re-run.

| # | File | What it adds |
|---|---|---|
| 001 | `001_email_verification.sql` | Email verification tokens table |
| 002 | `002_onboarding_admin.sql` | Onboarding fields + admin flag on users |
| 003 | `003_b2b_leads.sql` | B2B lead capture table |
| 004 | `004_analytics_events.sql` | Client-side analytics event store |
| 005 | `005_referral.sql` | Referral codes, tracking, bonus session grants |
| 006 | `006_tokens_invalidated_at.sql` | Per-user token invalidation timestamp for instant revocation |
| 007 | `007_referral_bonus_cap.sql` | Hard ceiling on referral bonus sessions via atomic RPC |
| 008 | `008_rls_default_deny.sql` | **Default-deny RLS on all tables** |
| 009 | `009_streak_timezone_ist.sql` | IST-aware streak calendar day fix |
| 010 | `010_interviewer_notes_daily_question.sql` | Interviewer notes field + daily question table |
| 011 | `011_voice_usage_ledger.sql` | Monthly voice/avatar usage tracking with streak bonus pool |
| 012 | `012_readiness_reports.sql` | Per-session readiness score snapshots |
| 013 | `013_score_comparisons.sql` | Cross-session score comparison materialisation |
| 014 | `014_job_landed_results_board.sql` | Community results board |
| 015 | `015_weekly_progress_card.sql` | Weekly summary card generation tracking |
| 016 | `016_speech_metrics.sql` | Per-session filler-word count + WPM |
| 017 | `017_prep_paths.sql` | Prep path catalogue + user enrollment table |
| 018 | `018_monthly_session_cap.sql` | Monthly session cap for Free tier with atomic increment RPC |
| 019 | `019_free_tts_and_hd_voice_pref.sql` | Free-tier TTS grant + HD voice preference flag |
| 020 | `020_avatar_quota.sql` | Avatar usage quota table |
| 021 | `021_elara_hindi_pref.sql` | Elara Hindi language preference |
| 022 | `022_elara_sessions_vocab.sql` | Elara session vocabulary tracking |
| 023 | `023_xp_leaderboard.sql` | Global XP + leaderboard tables |
| 024 | `024_streak_freeze_weekly_leaderboard.sql` | Streak freeze item + weekly leaderboard snapshot |
| 025 | `025_referral_session_bonus.sql` | Session bonus grants from referrals |
| 026 | `026_milestone_rewards.sql` | Streak milestone reward definitions and claims |
| 027 | `027_fix_voice_ledger_types.sql` | Voice ledger column type corrections |
| 028 | `028_daf_and_company_mode.sql` | DAF document support + company interview mode |

---

## Scripts

### Backend (`/backend`)

```bash
npm run dev              # ts-node-dev watch mode — starts on :8080
npm run build            # tsc → dist/
npm start                # run compiled build (production)
npm run worker           # BullMQ background worker (separate process in prod)
npm test                 # Jest test suite
npm run test:coverage    # Jest with coverage report
```

### Frontend (`/frontend`)

```bash
npm run dev              # Next.js dev server — starts on :3000
npm run build            # Standard Next.js production build
npm run build:cf         # Next.js build + Cloudflare Pages adapter
npm run type-check       # tsc --noEmit (zero errors enforced)
npm run lint             # ESLint
npm run deploy           # build:cf + wrangler pages deploy
```

### Root (workspace)

```bash
npm install              # installs all workspace packages
```

---

## Security Model

Defense in depth — neither surface is trusted to police the other.

**Token handling.** Short-lived JWT access tokens and rotating refresh tokens live exclusively in `httpOnly`, `Secure`, `SameSite=Lax` cookies. Frontend JavaScript has no token access, which eliminates XSS-to-session-hijack as an attack class. Next.js edge middleware rejects unauthenticated requests before they reach React.

**Server-side privilege validation.** Every privileged attribute — plan tier, admin role, email verification — is re-read from the database on every request. JWT claims are never trusted in isolation. Revoking a session or downgrading a plan takes effect immediately with no wait for token expiry. The `tokens_invalidated_at` column (migration 006) provides per-user instant invalidation.

**Payment integrity.** Razorpay webhooks are verified using constant-time HMAC comparison before any plan change is applied. The order-verify flow requires both the frontend signature and a passing webhook before a subscription is activated.

**Public endpoints.** Shareable report links use HMAC-SHA256 with constant-time verification — not Base64 or sequential IDs. Per-route rate limiting covers every public or auth-sensitive endpoint: login, registration, password reset, B2B lead intake, TTS, and public report access.

**Database.** Row Level Security is default-deny on all tables (migration 008). Only the service-role key used by `database/client.ts` can read or write. All monthly counters and ledger operations use atomic Postgres RPCs to prevent read-then-write race conditions under concurrent load.

**Status code discipline.** `422` for client input errors, `502` for upstream failures. Never mixed.

**Secrets.** No secrets in source. `.env.example` ships with placeholder values and inline documentation — no defaults that silently work in production.

---

## Deployment

### Frontend → Cloudflare Pages

```bash
cd frontend
npm run deploy    # next build + @cloudflare/next-on-pages + wrangler pages deploy
```

Set `EXTRA_ALLOWED_ORIGINS` on the backend to include your Cloudflare Pages preview URLs so CORS does not block PR deploys.

### Backend → Railway

1. Connect the `/backend` directory as the Railway service root.
2. Set all required environment variables in the Railway dashboard.
3. Railway auto-detects `npm run build && npm start` as the build/start command (`railway.toml` handles this).
4. Run `npm run worker` as a **separate Railway service** pointing at the same repo — BullMQ background jobs (email follow-ups, subscription expiry, weekly cards) run in this process and must not share a dyno with the API server.

### Database migrations

Apply migrations in ascending order via the Supabase SQL editor or Supabase CLI before first deploy. Re-runs are safe — all migrations are idempotent.

---

## CI

GitHub Actions runs on every push to `main`/`develop` and on every PR targeting `main`.

Two jobs run in parallel:

**`build-and-test`** (Node 22 + Redis service container):
1. Validate all `package.json` files
2. Install npm workspace dependencies
3. Build the `shared` package
4. Compile the backend via `tsc`
5. Type-check the frontend via `tsc --noEmit`
6. Build the frontend
7. Run the Jest test suite against the backend

**`security-audit`**:
1. `npm audit --audit-level=high` on the backend workspace
2. `npm audit --audit-level=high` on the frontend workspace (non-blocking — `continue-on-error: true`)

> **Note on ESLint in CI:** `eslint-config-next@15` + ESLint 9 in a monorepo causes `ajv` schema resolution failures in the current pipeline. TypeScript compilation above catches type errors; run `npx next lint` locally before pushing. This will be re-evaluated when Next.js ships flat config support.

---

## Roadmap

**Active development**
- Accent-tuned speech engine upgrade (Pro/Elite)
- Elara spoken audio responses during sessions (Pro/Elite)
- Pronunciation scoring, word-by-word (Elite)
- Animated live avatar (Elite)

**Medium-term**
- B2B institution dashboard — batch seat management, coordinator view, per-student progress
- Mobile app (React Native, same backend)
- Hindi-medium question sets and Hindi coaching mode

---

<div align="center">

Built for India's most competitive candidates — the ones who know every answer and just need to sound like it.

</div>
