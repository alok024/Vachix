import express, { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import cors       from 'cors';
import helmet     from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit  from 'express-rate-limit';
import { env, IS_PROD }              from './core/config/env';
import { errorHandler }              from './core/middleware';
import { unauthorized, notFound }     from './core/utils/response';
import { logger }                    from './infra/logger';
import { scheduleSubscriptionExpiry, scheduleSessionExpiry, scheduleBlacklistCleanup } from './infra/queue/dispatcher';
import { initSentry, captureException, getMetrics } from './infra/observability';
import { startLoadMonitor, getSystemLoadStats }      from './infra/load-monitor';
import { getAILimiterStats }                         from './infra/ai-limiter';
import { groqBreaker, openaiBreaker }                from './infra/circuit-breaker';

// ── Route modules ─────────────────────────────────────────────────
import authRoutes    from './modules/auth/auth.routes';
import paymentRoutes from './modules/payment/payment.routes';
import userRoutes    from './modules/user/user.routes';
import aiRoutes      from './modules/ai/ai.routes';
import sessionRoutes from './modules/analytics/sessions.routes';
import reportRoutes  from './modules/reports/reports.routes';
import adminRoutes   from './modules/admin/admin.routes';
import leadsRoutes   from './modules/leads/leads.routes';
import voiceRoutes   from './modules/voice/voice.routes';
import eventsRoutes  from './modules/analytics/events.routes';
import { registerShutdownFlush } from './modules/analytics/events.service';

// ── Extend Express Request with requestId ─────────────────────────
declare global {
  namespace Express {
    interface Request {
      requestId?: string;
    }
  }
}

// ── Boot: Sentry + load monitor ───────────────────────────────────
initSentry().catch(() => {});   // fire-and-forget; never blocks startup
startLoadMonitor();              // heartbeat log every 5 min

const app = express();
app.set('trust proxy', 1);

// ── Security headers ──────────────────────────────────────────────
app.use(helmet({
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: IS_PROD ? undefined : false,
}));

// ── CORS ──────────────────────────────────────────────────────────
const PROD_ORIGINS = [
  'https://vachix.in',
  'https://www.vachix.in',
  'https://vachixindia.pages.dev',
  'https://vachixindia.vercel.app',
  'https://vachix.pages.dev',
];

const DEV_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:8080',
  'http://127.0.0.1:5500',
];

// FIX M2: Vercel preview deployments use dynamic subdomain URLs
// (e.g. vachixindia-git-fix-branch-xyz.vercel.app) that can't be
// hardcoded here. EXTRA_ALLOWED_ORIGINS (comma-separated) lets you add
// preview/staging origins via a Railway env var without a code deploy.
// Never set this to a wildcard or an attacker-controlled domain — each
// entry must be an exact origin including scheme (https://...).
const EXTRA_ORIGINS: string[] = env.EXTRA_ALLOWED_ORIGINS
  ? env.EXTRA_ALLOWED_ORIGINS.split(',').map(o => o.trim()).filter(Boolean)
  : [];

const ALLOWED_ORIGINS = IS_PROD
  ? [...PROD_ORIGINS, ...EXTRA_ORIGINS]
  : [...PROD_ORIGINS, ...EXTRA_ORIGINS, ...DEV_ORIGINS];

app.use(cors({
  origin: (origin, cb) => {
    // FIX H2: Always validate against the allowlist regardless of environment.
    // Previously `if (!IS_PROD) return cb(null, true)` allowed every origin on
    // staging/preview deployments, making credentialed cross-origin requests
    // possible from any attacker-controlled site. Same-origin and null-origin
    // (curl / server-to-server) are still allowed via the !origin check below.
    if (!origin) return cb(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
}));

// ── Webhook — raw body BEFORE express.json() ─────────────────────
app.post(
  '/api/payment/webhook',
  express.raw({ type: 'application/json' }),
  (req, res, next) => {
    import('./modules/payment/payment.controller')
      .then(m => m.webhook(req, res))
      .catch(next);
  }
);

// ── Body parsing ──────────────────────────────────────────────────
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(cookieParser());

// ── Global rate limit ─────────────────────────────────────────────
app.use(rateLimit({
  windowMs: 60_000, max: 200,
  standardHeaders: true, legacyHeaders: false,
  message: { success: false, error: { code: 'rate_limited', message: 'Too many requests. Please slow down.' } },
}));

// ── Request ID + structured request logging ────────────────────────
// Every request gets a unique requestId attached to req and to the
// response header (X-Request-Id). Downstream log calls reference
// req.requestId so every log line for a request is trivially filterable.
app.use((req: Request, res: Response, next: NextFunction) => {
  req.requestId = (req.headers['x-request-id'] as string | undefined) ?? crypto.randomUUID();
  res.setHeader('X-Request-Id', req.requestId);
  logger.info('incoming_request', {
    requestId: req.requestId,
    method:    req.method,
    path:      req.path,
    ip:        req.ip,
    origin:    req.headers.origin,
  });
  next();
});

// ── Health & status endpoints ─────────────────────────────────────

app.get('/', (_req: Request, res: Response) => {
  res.json({
    status:  'Vachix API running ✅',
    version: env.VERSION,
    env:     env.NODE_ENV,
    queue:   env.REDIS_URL ? 'BullMQ (Redis)' : 'inline (no Redis)',
  });
});

app.get('/health', (_req: Request, res: Response) => {
  res.json({ ok: true, timestamp: new Date().toISOString() });
});

/**
 * GET /health/metrics  — internal ops dashboard (never expose publicly)
 *
 * Returns:
 *   - AI call counters + cache/fallback/failure rates
 *   - System load (RPM, concurrency slots)
 *   - Circuit breaker states per provider
 *
 * Protect this in production with a METRICS_TOKEN header check or
 * restrict to internal network only.
 */
app.get('/health/metrics', (req: Request, res: Response) => {
  const token    = env.METRICS_TOKEN || undefined;
  const provided = req.headers['x-metrics-token'];

  // In production: always require a token — fail closed if one isn't configured.
  // In development: allow access when no token is set (local debugging convenience).
  const authOk = IS_PROD
    ? (!!token && provided === token)
    : (!token || provided === token);

  if (!authOk) {
    unauthorized(res, 'Unauthorized', 'unauthorized');
    return;
  }

  res.json({
    metrics:        getMetrics(),
    system_load:    getSystemLoadStats(),
    ai_concurrency: getAILimiterStats(),
    circuit_breakers: {
      groq:   groqBreaker.getState(),
      openai: openaiBreaker.getState(),
    },
  });
});

// ── Routes ────────────────────────────────────────────────────────
app.use('/api',          userRoutes);
app.use('/api',          authRoutes);
app.use('/api/payment',  paymentRoutes);
app.use('/api/ai',       aiRoutes);
app.use('/api/sessions', sessionRoutes);
app.use('/api/report',   reportRoutes);
app.use('/api/admin',    adminRoutes);
app.use('/api/leads',    leadsRoutes);
app.use('/api/voice',    voiceRoutes);
app.use('/api/events',   eventsRoutes);

registerShutdownFlush();

// ── 404 ───────────────────────────────────────────────────────────
app.use((_req: Request, res: Response) => {
  notFound(res, 'Route not found');
});

// ── Global error handler ──────────────────────────────────────────
app.use((err: Error, req: Request, res: Response, next: express.NextFunction) => {
  captureException(err, {
    userId:    (req as Request & { user?: { id: string; plan: string } }).user?.id,
    plan:      (req as Request & { user?: { id: string; plan: string } }).user?.plan,
    extra:     { requestId: req.requestId },
  });
  errorHandler(err, req, res, next);
});

// ── Start ─────────────────────────────────────────────────────────
const PORT = env.PORT;

app.listen(PORT, () => {
  logger.info('🚀 Vachix API started', {
    port: PORT, env: env.NODE_ENV, version: env.VERSION,
    queue: env.REDIS_URL ? 'BullMQ (Redis)' : 'inline (no Redis)',
  });

  // ── Health-check assertion: B2B lead follow-up depends on Redis ──
  // Without REDIS_URL, dispatchLeadFollowUp() silently skips scheduling
  // the 24h follow-up job. That's expected in dev, but in production it
  // means every new B2B lead gets zero automated follow-up — surface it
  // loudly at boot rather than only as a per-lead warn log.
  if (!env.REDIS_URL) {
    if (IS_PROD) {
      logger.error('REDIS_URL is not set — B2B lead 24h follow-up emails will NOT be scheduled in production');
    } else {
      logger.warn('REDIS_URL is not set — B2B lead 24h follow-up emails are disabled (expected in dev)');
    }
  }

  // FIX L2: Warn loudly at boot when METRICS_TOKEN is absent in production.
  // Without a token, the /health/metrics endpoint is publicly accessible —
  // anyone can read AI call counters, system RPM, concurrency stats, and
  // circuit-breaker states. The auth logic in app.get('/health/metrics')
  // is correct (it checks the token), but it silently passes when the env
  // var is not set (token === undefined, provided === undefined → authOk = true).
  // Surfacing this at startup means it shows up in Railway boot logs on
  // every deploy, making misconfiguration impossible to miss.
  if (IS_PROD && !env.METRICS_TOKEN) {
    logger.warn(
      'METRICS_TOKEN is not set — /health/metrics is publicly accessible in production. ' +
      'Set METRICS_TOKEN in Railway env vars to restrict access.'
    );
  }

  scheduleSubscriptionExpiry().catch(err =>
    logger.error('Failed to schedule subscription expiry', { error: err })
  );

  scheduleSessionExpiry().catch(err =>
    logger.error('Failed to schedule session expiry', { error: err })
  );

  // Nightly cleanup of expired token_blacklist rows to prevent unbounded
  // table growth and keep isTokenBlacklisted() fast under heavy auth load.
  scheduleBlacklistCleanup();
});

export default app;
