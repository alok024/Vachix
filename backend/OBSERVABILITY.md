# Vachix Observability Runbook

Covers: Sentry alerting, external uptime monitoring, log structure, and
weekly review checklist.

---

## 6A — Sentry Alert Rules

Go to: **Sentry → Your Project → Alerts → Create Alert Rule**

### Rule 1 — Error Spike

| Field       | Value                              |
|-------------|------------------------------------|
| Condition   | Number of errors > **10** in **5 minutes** |
| Filter      | `environment = production`         |
| Action      | Send email + Slack notification    |
| When to set | Immediately after deploying        |

Catches: regressions, bot abuse, deploy breakage. You should know before
users start filing reports.

---

### Rule 2 — New Issue Type

| Field       | Value                              |
|-------------|------------------------------------|
| Condition   | **A new issue is created**         |
| Filter      | `environment = production`         |
| Action      | Send email notification            |

Catches: crash types you've never seen before. Rule 1 won't fire on a
single novel crash — this does.

---

### Rule 3 — Payment / Subscription Errors *(revenue-impacting)*

| Field       | Value                                                    |
|-------------|----------------------------------------------------------|
| Condition   | Number of errors > **1** in **5 minutes**                |
| Filter      | `environment = production`                               |
|             | AND tag `payment = true`                                 |
|             | OR title contains `payment` OR `razorpay` OR `subscription` |
| Action      | **Immediate** email + Slack                              |

The threshold is 1, not 10. One missed webhook = lost revenue. The
`payment = true` tag is set automatically by `capturePaymentException()`
in `payment.service.ts`.

**Call `capturePaymentException` (not `captureException`) for any error
in the payment flow.** It's exported from `src/infra/observability.ts`.

```typescript
import { capturePaymentException } from '../../infra/observability';

capturePaymentException(err, { userId, extra: { plan, orderId } });
```

---

## 6B — Uptime Monitoring (external)

Your `/health` endpoint is alive, but nothing outside your infra monitors
it. If Railway itself goes down, you find out from a user complaint.
Set this up now — takes under 5 minutes.

### Recommended: Better Uptime (free tier)

1. Go to https://betteruptime.com → sign up (free)
2. **Monitors → Add Monitor**
3. URL: `https://<your-api-domain>.railway.app/health`
4. Check interval: **1 minute** (free tier allows this)
5. Alert channels: email + Telegram (instant mobile push)
6. Incident timeline is automatic — great for post-mortems

### Alternative: UptimeRobot (also free)

1. https://uptimerobot.com → sign up
2. Add HTTP(s) monitor: `https://<your-api-domain>.railway.app/health`
3. Interval: 5 minutes (free tier)
4. Alert: email + SMS

**Also monitor the frontend Cloudflare Pages URL** — a CDN edge issue
there won't be caught by the backend monitor.

---

## 6C — Winston + requestId Context

As of this patch, `requestId` and `userId` are **automatically injected
into every log line** across the full request lifecycle — services,
ledgers, queue dispatchers — with no manual changes at call sites.

**How it works:**

1. The request-ID middleware in `app.ts` seeds `AsyncLocalStorage` with
   `{ requestId }` before calling `next()`.
2. After JWT verification in `authMiddleware`, `userId` is added to the
   same store.
3. The Winston logger reads the store via a custom format on every
   log call and attaches `requestId` / `userId` to the log record.

**Filtering logs in Railway:**

Filter by `requestId` to reconstruct the full lifecycle of any request:

```
requestId:"f47ac10b-58cc-4372-a567-0e02b2c3d479"
```

Filter by `userId` to see all activity for a specific user:

```
userId:"<supabase-user-uuid>"
```

---

## 6D — Weekly Metrics Review (Monday, 10 min)

Check these every Monday morning before doing anything else.

### 1. `/health/metrics`

```bash
curl -H "X-Metrics-Token: $METRICS_TOKEN" \
  https://<your-api-domain>.railway.app/health/metrics | jq .
```

Look for:
- `rates.failure_rate` — should be < 5%. Rising = Groq degradation or
  prompt bug.
- `rates.cache_hit_rate` — should be > 20%. Falling = cache TTL too short
  or new session patterns.
- `circuit_breakers.groq.state` — should be `closed`. `open` = Groq had
  consecutive failures.
- `queue_depth.failed` — any value > 0 means background jobs (notes,
  weak areas, readiness reports) silently failed for users.

---

### 2. Sentry — Issues from the Past Week

Go to **Sentry → Issues → Last 7 days → Sort by: Events**.

Triage:
- Any new issues (first seen < 7 days ago)? — investigate immediately.
- Any existing issues with a spike in events? — prioritise next sprint.
- Any `payment = true` tagged issues? — fix before anything else.

---

### 3. BullMQ Queue Depth

```bash
curl -H "X-Metrics-Token: $METRICS_TOKEN" \
  https://<your-api-domain>.railway.app/health/metrics | jq '.queue_depth'
```

Expected healthy state:

```json
{
  "waiting": 0,
  "active": 0,
  "failed": 0,
  "delayed": 0,
  "completed": "<any>"
}
```

`failed > 0` means users got a session-saved response but their
interviewer notes / weak areas / readiness report silently didn't
generate. Check Railway logs filtered by `module:worker` for the
failure reason.

---

### 4. Railway Resource Usage

Go to **Railway → Your Service → Metrics tab**.

Look for:
- CPU trending up week-over-week without a corresponding user growth
  → likely a runaway interval or memory leak.
- Memory trending up steadily → likely a reference being held in a
  closure that prevents GC (common in BullMQ job handlers).
- Restart count > 0 in the last week → check `/health/ready` probe
  response times; OOM kills show up here.

---

### Quick Reference — What Alert Means What

| Alert source        | First thing to do                                     |
|---------------------|-------------------------------------------------------|
| Sentry Rule 1 (spike) | Check Railway logs for the error `name` field; filter by `requestId` |
| Sentry Rule 2 (new issue) | Read the full stack trace; check if a recent deploy correlates |
| Sentry Rule 3 (payment) | Check Razorpay dashboard for the `orderId` in the Sentry extra context |
| Better Uptime down  | Check Railway deploy feed; `railway logs --tail`       |
| queue_depth.failed > 0 | `railway logs --filter module:worker` for job failure reason |
