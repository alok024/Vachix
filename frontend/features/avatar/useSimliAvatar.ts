/**
 * useSimliAvatar.ts
 *
 * Manages the Simli avatar lifecycle for the interview session page.
 *
 * Design decisions:
 *   - If `avatarMode` is 'voice-only' (set by the user or auto-detected),
 *     this hook is a no-op: the SimliClient is never imported or constructed.
 *   - If `avatarMode` is 'full' (or undefined), we attempt to initialise
 *     SimliClient inside a try/catch. Any failure — missing env var, network
 *     timeout, WebRTC unavailable — silently falls back to voice-only and
 *     updates the store so the session page re-renders without the avatar
 *     container.
 *   - The hook accepts an optional `clientRef` that it populates once the
 *     SimliClient connects. The barge-in hook reads this ref to call
 *     `stopSpeaking()` without re-renders. When Simli is not available the
 *     ref stays null and barge-in's stopSpeaking() call is skipped.
 *   - The hook returns `{ ready, voiceOnly }` so callers can branch their
 *     render without needing to know *why* we're in voice-only mode.
 *
 * Usage (session/page.tsx):
 *
 *   const simliClientRef = useRef<SimliHandle | null>(null);
 *   const { ready, voiceOnly } = useSimliAvatar(videoRef, simliClientRef);
 *   if (!voiceOnly) return <div ref={videoRef} />;
 *
 * When SimliClient is available as a proper npm package, replace the
 * `simulateSimliInit` stub below with the real client constructor and
 * call the returned handle's `.connect()` method.
 *
 * See also: P7-B in the build plan — Phase 0.4.
 */

'use client';

import { useEffect, useRef, useState } from 'react';
import { useInterviewStore } from '@/store/interview';
import type { SimliHandle } from './useBargeIn';

export interface SimliAvatarState {
  /** True once the avatar is connected and streaming video. */
  ready: boolean;
  /**
   * True when we are running without the avatar (either because the user
   * requested voice-only, or because Simli init failed and we fell back).
   */
  voiceOnly: boolean;
}

// ---------------------------------------------------------------------------
// Stub — replace with real SimliClient when the package is installed.
//
// The real implementation returns a SimliHandle so useBargeIn can call
// stopSpeaking() to flush Simli's internal audio queue on barge-in.
// The stub returns null (voice-only path; stopSpeaking is never called).
// ---------------------------------------------------------------------------
async function simulateSimliInit(
  _containerEl: HTMLElement | null,
): Promise<SimliHandle | null> {
  // Real implementation will be something like:
  //
  //   const { SimliClient } = await import('@simli/client');
  //   const client = new SimliClient({
  //     apiKey:    process.env.NEXT_PUBLIC_SIMLI_API_KEY!,
  //     faceId:    process.env.NEXT_PUBLIC_SIMLI_FACE_ID ?? 'aria',
  //     container: containerEl,
  //   });
  //   await client.connect();
  //   return { stopSpeaking: () => client.stopSpeaking() };
  //
  // For now, resolve to null (voice-only path is always taken in prod until
  // Simli is wired, which is intentional — the fallback is the live product).
  return null;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useSimliAvatar(
  containerRef: React.RefObject<HTMLElement | null>,
  /** Optional ref that this hook populates once SimliClient connects.
   *  Pass the same ref to useBargeIn so it can call stopSpeaking().
   *  If Simli is unavailable (voice-only) the ref stays null. */
  clientRef?: React.RefObject<SimliHandle | null>,
): SimliAvatarState {
  const store = useInterviewStore();
  const requestedVoiceOnly = store.config.avatarMode === 'voice-only';

  const [ready, setReady] = useState(false);
  const [voiceOnly, setVoiceOnly] = useState(requestedVoiceOnly);
  const didInit = useRef(false);

  useEffect(() => {
    // Skip entirely if voice-only was requested
    if (requestedVoiceOnly) {
      setVoiceOnly(true);
      return;
    }

    if (didInit.current) return;
    didInit.current = true;

    (async () => {
      try {
        const handle = await simulateSimliInit(containerRef.current);

        if (handle === null) {
          // Stub returned null — no real Simli SDK yet; fall back to voice-only.
          // This is the expected prod path until @simli/client is installed.
          store.setAvatarMode('voice-only');
          setVoiceOnly(true);
          return;
        }

        // Real client connected — populate the ref for barge-in before
        // marking ready so useBargeIn never reads a stale null.
        if (clientRef) {
          (clientRef as React.MutableRefObject<SimliHandle | null>).current = handle;
        }
        setReady(true);
      } catch (err) {
        // Simli failed — fall back to voice-only silently.
        // Log for Sentry but don't surface to the user; the session
        // continues without the avatar and the user gets no error flash.
        console.error('[Simli] Avatar init failed, falling back to voice-only:', err);
        store.setAvatarMode('voice-only');
        setVoiceOnly(true);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // Intentional: containerRef and clientRef are React refs (stable identity);
    // store.setAvatarMode is a zustand action (stable across renders).
    // didInit guards against double-init on StrictMode double-invoke.
    // The only value that should restart the effect is requestedVoiceOnly.
  }, [requestedVoiceOnly]);

  return { ready, voiceOnly };
}
