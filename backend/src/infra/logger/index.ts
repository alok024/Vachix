import winston from 'winston';
import { env }    from '../../core/config/env';
import { getRequestId } from '../request-context';

const { combine, timestamp, printf, colorize, json, errors } = winston.format;

const isProd = env.NODE_ENV === 'production';

/**
 * Auto-inject requestId from AsyncLocalStorage into every log record.
 * This means any log.error() call inside a service, ledger, or dispatcher
 * automatically includes the requestId for the in-flight request — with no
 * manual threading required at the call site.
 */
const requestContextFormat = winston.format((info) => {
  const requestId = getRequestId();
  if (requestId && !info.requestId) {
    info.requestId = requestId;
  }
  return info;
})();

const devFormat = combine(
  requestContextFormat,
  colorize(),
  timestamp({ format: 'HH:mm:ss' }),
  errors({ stack: true }),
  printf(({ level, message, timestamp: ts, stack, ...meta }) => {
    const metaStr = Object.keys(meta).length
      ? '\n' + JSON.stringify(meta, null, 2)
      : '';
    return `${ts} [${level}] ${String(message)}${stack ? '\n' + String(stack) : ''}${metaStr}`;
  })
);

const prodFormat = combine(
  requestContextFormat,
  timestamp(),
  errors({ stack: true }),
  json()
);

export const logger = winston.createLogger({
  level:       isProd ? 'info' : 'debug',
  format:      isProd ? prodFormat : devFormat,
  defaultMeta: { service: 'vachix-api' },
  transports:  [new winston.transports.Console()],
});

// Named child loggers — filterable per domain
export const authLogger         = logger.child({ module: 'auth' });
export const paymentLogger      = logger.child({ module: 'payment' });
export const aiLogger           = logger.child({ module: 'ai' });
export const subscriptionLogger = logger.child({ module: 'subscription' });
