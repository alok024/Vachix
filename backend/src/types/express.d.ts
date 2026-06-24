/**
 * backend/src/types/express.d.ts
 *
 * Augments the Express `Response` type to declare the optional `flush()`
 * method present on compressed responses (via the `compression` middleware)
 * and on some SSE-aware middleware stacks.
 *
 * Without this, `res.flush?.()` in ai.controller.ts requires a
 * `@ts-expect-error` suppression — which is a false signal (it implies the
 * call is unsafe, when in fact it's a well-understood no-op optional call).
 *
 * The optional-chain (`?.`) at the call site is the real safety guard —
 * this declaration just removes the spurious type error.
 */

declare namespace Express {
  interface Response {
    /**
     * Flushes buffered data to the client. Present when the `compression`
     * middleware is active; a no-op or undefined otherwise. Always call
     * via optional-chain: `res.flush?.()`.
     */
    flush?: () => void;
  }
}
