# Vachix — v6 Changes

## What was fixed and why

### Fix 1: Removed backend/public/ entirely ✅
**Before:** `backend/public/report.html`, `admin.html`, `b2b.html`, `verify-email.html`, `privacy.html`, `terms.html`  
**After:** All UI lives in Next.js under `frontend/app/(public)/`

| Old path | New path |
|----------|----------|
| `backend/public/report.html` | `frontend/app/(public)/report/page.tsx` |
| `backend/public/admin.html` | `frontend/app/(public)/admin/page.tsx` |
| `backend/public/b2b.html` | `frontend/app/(public)/b2b/page.tsx` |
| `backend/public/verify-email.html` | `frontend/app/(public)/verify-email/page.tsx` |
| `backend/public/privacy.html` | `frontend/app/(public)/privacy/page.tsx` |
| `backend/public/terms.html` | `frontend/app/(public)/terms/page.tsx` |

Backend URL updated: `report.html?id=` → `/report?id=` (in both `reports.controller.ts` and `reports.service.ts`)

---

### Fix 2: Shared Zod API schemas ✅
**Before:** Types defined manually in `frontend/types/index.ts`, no runtime validation on responses  
**After:** `shared/schemas/api.schemas.ts` — single source of truth for all domain types

```
shared/
  package.json          ← @vachix/shared package
  index.ts              ← barrel export
  schemas/
    api.schemas.ts      ← all Zod schemas + inferred TypeScript types
```

Both FE and BE import from here → zero drift possible.

**To wire up:**
1. In `backend/package.json`: add `"@vachix/shared": "file:../shared"`
2. In `frontend/package.json`: add `"@vachix/shared": "file:../shared"`
3. Replace `import type { User } from '@/types'` with `import type { User } from '@vachix/shared'`

---

### Fix 3: Feature-based modularization ✅
**Before:** Flat `components/`, `hooks/`, `store/`  
**After:** `features/` folder with domain-driven structure

```
features/
  auth/
    hooks/index.ts      ← re-exports useLogin, useRegister, useLogout, useAuthStore
    schemas/index.ts    ← LoginFormSchema, RegisterFormSchema (Zod)
    components/         ← ready for AuthForm, etc.
  interview/
    hooks/index.ts      ← re-exports useSaveSession, useInterviewStore
    schemas/index.ts    ← InterviewSetupSchema (Zod)
    components/         ← ready for SetupForm, QuestionCard, etc.
  analytics/
    hooks/index.ts      ← re-exports useMe, useSessions, useScoreHistory
    components/         ← ready for ScoreChart, WeakAreaCard, etc.
  payment/
    hooks/index.ts      ← re-exports useCreateOrder, useVerifyPayment
    components/         ← ready for PlanCard, CheckoutModal, etc.
  user/
    hooks/              ← ready
    components/         ← ready for ProfileForm, PlanBadge, etc.
```

**Migration pattern:** When a page file grows beyond ~200 lines, extract its components into the relevant `features/<domain>/components/` folder.

---

### Fix 4: Auth flow enforcement ✅

**Token refresh (store/auth.ts):**
- Added `refreshToken` field to persisted state
- Added `handleRefresh()` — calls `/api/refresh`, retries on 401, auto-logouts on failure
- `isRefreshing` flag prevents concurrent refresh floods

**Auto-refresh in apiCall (lib/api.ts):**
- Any `401` response triggers `handleRefresh()` once
- Request is retried transparently with the new token
- If refresh fails → redirects to `/login?next=<url>`
- Concurrent requests during refresh are deduplicated (single promise)

**Protected routes (components/shared/ProtectedRoute.tsx):**
```tsx
// (app)/layout.tsx now wraps everything:
<ProtectedRoute>
  <AppShell>{children}</AppShell>
</ProtectedRoute>
```
- Waits for Zustand hydration before redirecting (no flash)
- Preserves `?next=` URL for post-login redirect
- `requireAdmin` prop gates admin pages
- Redirects to `/profile?onboarding=1` if onboarding not done

**tokenStore additions:**
- `tokenStore.getRefresh()` / `tokenStore.setRefresh()` — parallel to access token

---

### Fix 5: PWA readiness ✅

| File | Purpose |
|------|---------|
| `frontend/public/manifest.json` | Installability: name, icons, start_url, shortcuts |
| `frontend/public/sw.js` | Service worker: cache-first assets, network-first pages, offline fallback |
| `frontend/public/offline.html` | Shown when offline and no cached page available |
| `frontend/app/layout.tsx` | SW registration script + `<link rel="manifest">` + viewport meta |
| `frontend/next.config.ts` | `Cache-Control` header for `sw.js`, `Service-Worker-Allowed: /` |

**Still needed before "app-ready":**
- [ ] Generate actual icon files: `/public/icons/icon-192.png` and `icon-512.png`
- [ ] Add `apple-touch-icon` PNG
- [ ] Test Lighthouse PWA audit

---

## File structure after v6

```
VachixIndia/
├── shared/                          ← NEW: shared Zod schemas
│   ├── package.json
│   ├── index.ts
│   └── schemas/api.schemas.ts
│
├── frontend/
│   ├── app/
│   │   ├── (auth)/                  ← login, register, forgot-password
│   │   ├── (app)/                   ← protected app shell (+ ProtectedRoute)
│   │   │   ├── layout.tsx           ← UPDATED: wraps ProtectedRoute
│   │   │   ├── dashboard/
│   │   │   ├── interview/
│   │   │   ├── english/
│   │   │   ├── history/
│   │   │   └── profile/
│   │   └── (public)/                ← NEW: migrated from backend/public/
│   │       ├── report/page.tsx
│   │       ├── admin/page.tsx
│   │       ├── b2b/page.tsx
│   │       ├── verify-email/page.tsx
│   │       ├── privacy/page.tsx
│   │       └── terms/page.tsx
│   │
│   ├── features/                    ← NEW: feature-driven modules
│   │   ├── auth/
│   │   ├── interview/
│   │   ├── analytics/
│   │   ├── payment/
│   │   └── user/
│   │
│   ├── components/shared/
│   │   ├── ProtectedRoute.tsx       ← NEW: auth guard
│   │   ├── AppShell.tsx
│   │   ├── UpgradeModal.tsx
│   │   └── ToastStack.tsx
│   │
│   ├── store/
│   │   └── auth.ts                  ← UPDATED: refresh token + handleRefresh
│   │
│   ├── lib/
│   │   └── api.ts                   ← UPDATED: auto-refresh on 401, refreshAccessToken
│   │
│   └── public/
│       ├── manifest.json            ← NEW: PWA
│       ├── sw.js                    ← NEW: service worker
│       └── offline.html             ← NEW: offline fallback
│
└── backend/
    ├── public/                      ← DELETED: no more HTML here
    └── src/
        └── modules/reports/
            ├── reports.controller.ts  ← UPDATED: /report.html → /report
            └── reports.service.ts     ← UPDATED: /report.html → /report
```
