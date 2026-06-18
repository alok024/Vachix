import winston from 'winston';
import { env }    from '../../core/config/env';

const { combine, timestamp, printf, colorize, json, errors } = winston.format;

const isProd = env.NODE_ENV === 'production';

const devFormat = combine(
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
