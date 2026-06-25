/**
 * Circuit Breaker — AI Providers
 *
 * Problem: when Groq is flaky, every request tries Groq, waits 15 s to
 *          timeout, THEN falls back to OpenAI.  This makes every response
 *          take 15+ seconds and burns the global concurrency slots.
 *
 * Solution: a per-provider circuit breaker.
 *
 *   CLOSED  → requests go through normally.
 *   OPEN    → requests are rejected immediately (no network call).
 *             After RESET_TIMEOUT_MS the breaker moves to HALF-OPEN.
 *   HALF-OPEN → one probe request is allowed through.
 *               Success → CLOSED.  Failure → back to OPEN.
 *
 * Config (env):
 *   CB_FAILURE_THRESHOLD   — consecutive failures to trip breaker (default 5)
 *   CB_RESET_TIMEOUT_MS    — how long to stay OPEN (default 60000 = 1 min)
 *
 * Usage:
 *   import { groqBreaker, openaiBreaker } from '../../infra/circuit-breaker';
 *   const text = await groqBreaker.run(() => callGroqRaw(messages, maxTokens));
 */

import { logger } from './logger';
import { env }    from '../core/config/env';

const log = logger.child({ module: 'circuit-breaker' });

const FAILURE_THRESHOLD = env.CB_FAILURE_THRESHOLD;
const RESET_TIMEOUT     = env.CB_RESET_TIMEOUT_MS;

type State = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export class CircuitBreaker {
  private state:       State  = 'CLOSED';
  private failures:    number = 0;
  private lastFailure: number = 0;
  private probeActive: boolean = false;

  constructor(private readonly name: string) {}

  /** Returns true if the circuit will allow a call right now */
  isAvailable(): boolean {
    if (this.state === 'CLOSED') return true;

    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailure >= RESET_TIMEOUT) {
        this.state      = 'HALF_OPEN';
        this.probeActive = false;
        log.info(`Circuit ${this.name}: OPEN → HALF_OPEN`);
      } else {
        return false;
      }
    }

    // HALF_OPEN — only one probe at a time
    if (this.state === 'HALF_OPEN') {
      if (this.probeActive) return false;
      this.probeActive = true;
      return true;
    }

    return false;
  }

  /** Wrap a provider call with circuit-breaker logic */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (!this.isAvailable()) {
      const err = Object.assign(
        new Error(`${this.name} circuit is OPEN — provider temporarily disabled`),
        { code: 'CIRCUIT_OPEN' }
      );
      throw err;
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  /** Public hooks for callers that manage their own try/catch (e.g. streaming) */
  reportSuccess(): void { this.onSuccess(); }
  reportFailure(): void { this.onFailure(); }

  private onSuccess(): void {
    if (this.state === 'HALF_OPEN') {
      log.info(`Circuit ${this.name}: HALF_OPEN → CLOSED (probe succeeded)`);
    }
    this.state      = 'CLOSED';
    this.failures   = 0;
    this.probeActive = false;
  }

  private onFailure(): void {
    this.failures++;
    this.lastFailure = Date.now();
    this.probeActive  = false;

    if (this.state === 'HALF_OPEN' || this.failures >= FAILURE_THRESHOLD) {
      if (this.state !== 'OPEN') {
        log.warn(`Circuit ${this.name}: → OPEN (failures=${this.failures})`, {
          threshold: FAILURE_THRESHOLD,
          resetInMs: RESET_TIMEOUT,
        });
      }
      this.state = 'OPEN';
    }
  }

  getState(): { state: State; failures: number; provider: string } {
    return { state: this.state, failures: this.failures, provider: this.name };
  }

  /** Force-reset — useful in tests or manual recovery */
  reset(): void {
    this.state      = 'CLOSED';
    this.failures   = 0;
    this.probeActive = false;
    log.info(`Circuit ${this.name}: manually reset to CLOSED`);
  }
}

// Singleton breakers — one per provider
//
// NOTE: these breakers are process-local. Under multi-instance deployment
// each instance maintains independent state — Instance A can have Groq OPEN
// while Instance B keeps hammering it. For shared breaker state, migrate to
// a Redis-backed implementation keyed on `circuit:state:<name>`.
// Acceptable at current scale (single Railway instance). Revisit when
// Railway auto-scaling or a second region is introduced.
export const groqBreaker   = new CircuitBreaker('Groq');
export const openaiBreaker = new CircuitBreaker('OpenAI');
