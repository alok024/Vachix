/**
 * Request Context Store
 *
 * Uses Node's AsyncLocalStorage to propagate per-request context
 * (requestId, userId) through every async call in a request's lifecycle —
 * without threading it through function arguments.
 *
 * How it works:
 *   1. The request-ID middleware in app.ts calls requestContextStore.run()
 *      with { requestId } before calling next().
 *   2. Every async operation spawned within that call chain (service
 *      methods, DB queries, queue dispatches) inherits the same store.
 *   3. The Winston logger reads the store on every log call and injects
 *      requestId automatically — so log.error('X', { ... }) in
 *      sessions.service.ts, voice.ledger.ts, etc. all include requestId
 *      with zero per-call changes.
 *
 * Usage (read from any module):
 *   import { getRequestId } from '../../infra/request-context';
 *   const rid = getRequestId(); // undefined outside a request context
 *
 * Usage (set, done once in app.ts middleware):
 *   requestContextStore.run({ requestId, userId }, () => next());
 */

import { AsyncLocalStorage } from 'async_hooks';

export interface RequestContext {
  requestId: string;
  userId?:   string;
}

export const requestContextStore = new AsyncLocalStorage<RequestContext>();

/** Returns the requestId for the current async context, or undefined. */
export function getRequestId(): string | undefined {
  return requestContextStore.getStore()?.requestId;
}

/** Returns the full context object for the current async context. */
export function getRequestContext(): RequestContext | undefined {
  return requestContextStore.getStore();
}

/**
 * Attach a userId to the current request context.
 * Call this from authMiddleware after the JWT is validated, so every
 * downstream log line (service layer, worker dispatch) includes userId.
 */
export function setContextUserId(userId: string): void {
  const store = requestContextStore.getStore();
  if (store) store.userId = userId;
}
