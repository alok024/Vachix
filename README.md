# Vachix — v5 Monolith

## Structure

```
VachixIndia/
├── frontend/          ← Next.js 15 + TypeScript + Tailwind + shadcn/ui
│   ├── app/
│   │   ├── layout.tsx              ← Root layout (Sora font, Providers)
│   │   ├── globals.css
│   │   ├── providers.tsx           ← TanStack Query + PostHog providers
│   │   ├── (auth)/                 ← Public auth routes (no AppShell)
│   │   │   ├── login/page.tsx
│   │   │   ├── register/page.tsx
│   │   │   └── forgot-password/page.tsx
│   │   └── (app)/                  ← Protected routes (AppShell layout)
│   │       ├── layout.tsx
│   │       ├── dashboard/page.tsx
│   │       ├── interview/
│   │       │   ├── setup/page.tsx
│   │       │   └── summary/page.tsx
│   │       ├── history/page.tsx
│   │       ├── english/page.tsx    ← Elara English practice
│   │       └── profile/page.tsx
│   ├── components/
│   │   ├── shared/
│   │   │   ├── AppShell.tsx        ← Nav + layout wrapper
│   │   │   ├── ToastStack.tsx
│   │   │   └── UpgradeModal.tsx
│   │   └── ui/
│   │       ├── index.ts            ← Barrel exports
│   │       └── components.tsx      ← Button, Input, Card, Badge, etc.
│   ├── store/
│   │   ├── auth.ts                 ← Zustand auth store (persisted)
│   │   └── interview.ts            ← Zustand interview/session store
│   ├── hooks/
│   │   └── queries.ts              ← TanStack Query hooks
│   ├── lib/
│   │   ├── api.ts                  ← Typed API client
│   │   ├── utils.ts                ← cn(), helpers
│   │   └── interview-prompts.ts    ← Profession context + Elara prompts
│   ├── types/
│   │   └── index.ts                ← Shared domain types (mirrors backend)
│   ├── package.json                ← Next.js 15 deps
│   ├── next.config.ts
│   ├── tailwind.config.ts
│   ├── tsconfig.json
│   └── postcss.config.js
│
└── backend/           ← Express + TypeScript API (keep as-is)
    ├── src/
    │   ├── app.ts                  ← Express entry
    │   ├── worker.ts               ← BullMQ worker entry
    │   ├── core/
    │   │   ├── config/env.ts
    │   │   ├── database/client.ts  ← Supabase client (add Prisma here next)
    │   │   ├── middleware.ts
    │   │   └── utils/
    │   ├── infra/
    │   │   ├── queue/              ← BullMQ dispatcher + worker
    │   │   ├── ai-cache.ts
    │   │   ├── ai-limiter.ts
    │   │   ├── burst-limiter.ts
    │   │   ├── circuit-breaker.ts
    │   │   ├── load-monitor.ts
    │   │   ├── logger/
    │   │   └── observability.ts    ← Sentry DSN goes here
    │   └── modules/
    │       ├── ai/                 ← AI service, adaptive, scoring, memory
    │       ├── auth/               ← Auth, email, token
    │       ├── user/
    │       ├── payment/            ← Razorpay
    │       ├── analytics/          ← Events + sessions
    │       ├── reports/
    │       ├── growth/             ← Referral
    │       ├── admin/
    │       ├── leads/              ← B2B leads
    │       └── voice/
    ├── public/                     ← Static HTML pages served by Express
    │   ├── admin.html
    │   ├── b2b.html
    │   ├── verify-email.html
    │   ├── report.html
    │   ├── privacy.html
    │   └── terms.html
    ├── migrations/                 ← SQL migration files
    ├── MIGRATION.sql
    ├── package.json
    ├── tsconfig.json
    └── .env.example

## What was removed (replaced by Next.js)
- `app.html`     → Next.js (app) route group pages
- `index.html`   → Next.js root
- `auth.js`      → `frontend/store/auth.ts` (Zustand)
- `session.js`   → `frontend/store/interview.ts` (Zustand)

## What was deduplicated
- `interview(1).ts` (profession prompts) → `lib/interview-prompts.ts`
- `interview.ts` (Zustand store) → `store/interview.ts`
- `layout(1).tsx` (app group layout) → `app/(app)/layout.tsx`
- `layout.tsx` (root layout) → `app/layout.tsx`
- `package(1).json` (Next.js) → `frontend/package.json`
- `page.tsx` → login, `page(1).tsx` → register, etc.

## Next steps (per migration plan)
- [ ] Add Prisma on top of Supabase in `backend/src/core/database/`
- [ ] Set Sentry DSN in `backend/src/infra/observability.ts`
- [ ] Add PostHog provider in `frontend/app/providers.tsx` (already scaffolded)
- [ ] Wire `frontend/lib/api.ts` base URL to backend via `NEXT_PUBLIC_API_URL`
