/**
 * Unit tests for CircuitBreaker (src/infra/circuit-breaker.ts)
 *
 * No network calls, no database, no Redis. Pure state machine.
 * These tests are the fastest feedback loop in the repo — run them first
 * after any change to the CB or env config.
 */

import { CircuitBreaker } from '../../src/infra/circuit-breaker';

// Silence the winston logger output during tests — we care about state, not logs.
jest.mock('../../src/infra/logger', () => ({
  logger: {
    child: () => ({
      info:  jest.fn(),
      warn:  jest.fn(),
      error: jest.fn(),
    }),
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Trip the breaker by running the default failure threshold (5) of failures. */
async function tripBreaker(breaker: CircuitBreaker, count = 5): Promise<void> {
  for (let i = 0; i < count; i++) {
    try {
      await breaker.run(() => Promise.reject(new Error('provider down')));
    } catch {
      // expected — swallow so the loop continues
    }
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CircuitBreaker', () => {
  let breaker: CircuitBreaker;

  beforeEach(() => {
    breaker = new CircuitBreaker('test');
  });

  // --- CLOSED state ---------------------------------------------------------

  it('starts CLOSED and allows calls through', () => {
    expect(breaker.getState().state).toBe('CLOSED');
    expect(breaker.isAvailable()).toBe(true);
  });

  it('returns the resolved value of the wrapped function', async () => {
    const result = await breaker.run(() => Promise.resolve('hello'));
    expect(result).toBe('hello');
  });

  it('stays CLOSED after fewer failures than the threshold', async () => {
    for (let i = 0; i < 4; i++) {
      try { await breaker.run(() => Promise.reject(new Error('flap'))); } catch {}
    }
    expect(breaker.getState().state).toBe('CLOSED');
    expect(breaker.isAvailable()).toBe(true);
  });

  it('resets failure count to 0 after a success', async () => {
    // Two failures, then a success
    for (let i = 0; i < 2; i++) {
      try { await breaker.run(() => Promise.reject(new Error('err'))); } catch {}
    }
    await breaker.run(() => Promise.resolve('ok'));
    expect(breaker.getState().failures).toBe(0);
  });

  // --- OPEN state -----------------------------------------------------------

  it('opens after FAILURE_THRESHOLD (5) consecutive failures', async () => {
    await tripBreaker(breaker);
    expect(breaker.getState().state).toBe('OPEN');
    expect(breaker.isAvailable()).toBe(false);
  });

  it('rejects immediately when OPEN without calling the provider', async () => {
    await tripBreaker(breaker);

    const fn = jest.fn<Promise<string>, []>().mockResolvedValue('ok');
    await expect(breaker.run(fn)).rejects.toThrow('circuit is OPEN');
    // Provider must never be called — we short-circuit before it
    expect(fn).not.toHaveBeenCalled();
  });

  it('attaches CIRCUIT_OPEN error code when rejecting', async () => {
    await tripBreaker(breaker);

    try {
      await breaker.run(() => Promise.resolve('ok'));
      fail('should have thrown');
    } catch (err: unknown) {
      expect((err as NodeJS.ErrnoException).code).toBe('CIRCUIT_OPEN');
    }
  });

  it('does not reset failure count after extra failures while OPEN', async () => {
    await tripBreaker(breaker);
    const failuresAtOpen = breaker.getState().failures;

    breaker.reportFailure(); // extra kick while already OPEN
    expect(breaker.getState().state).toBe('OPEN');
    expect(breaker.getState().failures).toBeGreaterThan(failuresAtOpen);
  });

  // --- HALF_OPEN / recovery -------------------------------------------------

  it('moves to HALF_OPEN after RESET_TIMEOUT elapses', async () => {
    await tripBreaker(breaker);

    const now = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(now + 70_000); // > 60 000 ms default

    // isAvailable() triggers the OPEN→HALF_OPEN transition
    expect(breaker.isAvailable()).toBe(true);
    expect(breaker.getState().state).toBe('HALF_OPEN');

    jest.restoreAllMocks();
  });

  it('closes again after a successful probe in HALF_OPEN', async () => {
    await tripBreaker(breaker);

    const now = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(now + 70_000);

    const result = await breaker.run(() => Promise.resolve('recovered'));
    expect(result).toBe('recovered');
    expect(breaker.getState().state).toBe('CLOSED');
    expect(breaker.getState().failures).toBe(0);

    jest.restoreAllMocks();
  });

  it('goes back to OPEN if the probe in HALF_OPEN fails', async () => {
    await tripBreaker(breaker);

    const now = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(now + 70_000);

    try {
      await breaker.run(() => Promise.reject(new Error('still down')));
    } catch {}

    expect(breaker.getState().state).toBe('OPEN');

    jest.restoreAllMocks();
  });

  it('blocks a second concurrent probe in HALF_OPEN (only one probe at a time)', async () => {
    await tripBreaker(breaker);

    const now = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(now + 70_000);

    // First isAvailable() call gates the probe slot
    breaker.isAvailable(); // → HALF_OPEN, probeActive = true

    // Second isAvailable() must be blocked
    expect(breaker.isAvailable()).toBe(false);

    jest.restoreAllMocks();
  });

  // --- reset() --------------------------------------------------------------

  it('reset() returns the breaker to CLOSED with zero failures', async () => {
    await tripBreaker(breaker);
    breaker.reset();
    expect(breaker.getState().state).toBe('CLOSED');
    expect(breaker.getState().failures).toBe(0);
    expect(breaker.isAvailable()).toBe(true);
  });

  // --- reportSuccess / reportFailure public hooks ---------------------------

  it('reportSuccess() while CLOSED keeps state CLOSED', () => {
    breaker.reportSuccess();
    expect(breaker.getState().state).toBe('CLOSED');
  });

  it('reportFailure() accumulates failures and trips at threshold', () => {
    for (let i = 0; i < 5; i++) {
      breaker.reportFailure();
    }
    expect(breaker.getState().state).toBe('OPEN');
  });

  // --- getState() -----------------------------------------------------------

  it('getState() includes provider name', () => {
    const s = breaker.getState();
    expect(s.provider).toBe('test');
  });
});
