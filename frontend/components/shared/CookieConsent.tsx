'use client';

/**
 * components/shared/CookieConsent.tsx
 *
 * GDPR/cookie consent banner — gates PostHog init until the user accepts.
 * Storage key: 'vachix-cookie-consent' → 'accepted' | 'declined'
 *
 * Design: matches the Vachix dark-first system (--bg2, --border2, --accent,
 * --mono, --sans, var(--ease-spring)) — no hardcoded colours.
 *
 * Placement: rendered inside <Providers> so it appears on every route
 * (public landing AND authenticated app shell) without duplicating markup.
 */

import { useEffect, useState } from 'react';

const STORAGE_KEY = 'vachix-cookie-consent';

export function CookieConsent() {
  const [visible, setVisible] = useState(false);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    // Only show when no decision has been recorded yet.
    // Run after mount so SSR never sees this component.
    try {
      if (!localStorage.getItem(STORAGE_KEY)) {
        // Small delay so the banner doesn't flash in before the page paints.
        const t = setTimeout(() => setVisible(true), 600);
        return () => clearTimeout(t);
      }
    } catch {
      // localStorage blocked (private mode in some browsers) — fail silently.
    }
  }, []);

  if (!visible) return null;

  function dismiss(decision: 'accepted' | 'declined') {
    try {
      localStorage.setItem(STORAGE_KEY, decision);
    } catch {
      // ignore
    }
    // Slide out before unmounting
    setLeaving(true);
    setTimeout(() => setVisible(false), 380);
  }

  return (
    <>
      <style>{`
        @keyframes vachix-cookie-in {
          from { opacity: 0; transform: translateY(16px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes vachix-cookie-out {
          from { opacity: 1; transform: translateY(0); }
          to   { opacity: 0; transform: translateY(16px); }
        }
        .vachix-cookie-wrap {
          position: fixed;
          bottom: 24px;
          left: 50%;
          transform: translateX(-50%);
          z-index: 9000;
          width: calc(100vw - 48px);
          max-width: 600px;
          animation: vachix-cookie-in 0.42s cubic-bezier(0.16, 1, 0.3, 1) both;
        }
        .vachix-cookie-wrap.leaving {
          animation: vachix-cookie-out 0.36s cubic-bezier(0.4, 0, 1, 1) both;
        }
        .vachix-cookie-card {
          background: var(--bg2);
          border: 1px solid var(--border2);
          border-radius: 16px;
          box-shadow: 0 8px 48px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(255,255,255,0.05);
          padding: 18px 20px;
          display: flex;
          align-items: center;
          gap: 20px;
        }
        @media (max-width: 520px) {
          .vachix-cookie-card {
            flex-direction: column;
            align-items: flex-start;
            gap: 14px;
          }
          .vachix-cookie-actions {
            width: 100%;
          }
          .vachix-cookie-btn-accept,
          .vachix-cookie-btn-decline {
            flex: 1;
            justify-content: center;
          }
        }
        .vachix-cookie-icon {
          flex-shrink: 0;
          width: 36px;
          height: 36px;
          border-radius: 10px;
          background: var(--blue-dim);
          border: 1px solid var(--blue-border);
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .vachix-cookie-body {
          flex: 1;
          min-width: 0;
        }
        .vachix-cookie-title {
          font-family: var(--sans);
          font-size: 13px;
          font-weight: 600;
          color: var(--text1);
          margin-bottom: 3px;
          line-height: 1.3;
        }
        .vachix-cookie-text {
          font-family: var(--sans);
          font-size: 12px;
          color: var(--text2);
          line-height: 1.5;
        }
        .vachix-cookie-text a {
          color: var(--accent);
          text-decoration: none;
        }
        .vachix-cookie-text a:hover {
          text-decoration: underline;
        }
        .vachix-cookie-actions {
          display: flex;
          gap: 8px;
          flex-shrink: 0;
        }
        .vachix-cookie-btn-accept {
          display: inline-flex;
          align-items: center;
          font-family: var(--mono);
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: #fff;
          background: var(--blue);
          border: none;
          padding: 9px 18px;
          border-radius: 8px;
          cursor: pointer;
          transition: opacity 0.18s, transform 0.18s;
          white-space: nowrap;
        }
        .vachix-cookie-btn-accept:hover {
          opacity: 0.88;
          transform: translateY(-1px);
        }
        .vachix-cookie-btn-accept:active {
          transform: translateY(0);
          opacity: 1;
        }
        .vachix-cookie-btn-decline {
          display: inline-flex;
          align-items: center;
          font-family: var(--mono);
          font-size: 11px;
          font-weight: 500;
          letter-spacing: 0.06em;
          color: var(--text2);
          background: none;
          border: 1px solid var(--border2);
          padding: 9px 14px;
          border-radius: 8px;
          cursor: pointer;
          transition: color 0.18s, border-color 0.18s;
          white-space: nowrap;
        }
        .vachix-cookie-btn-decline:hover {
          color: var(--text1);
          border-color: var(--border3);
        }
      `}</style>

      <div
        className={`vachix-cookie-wrap${leaving ? ' leaving' : ''}`}
        role="region"
        aria-label="Cookie consent"
      >
        <div className="vachix-cookie-card">

          {/* Icon */}
          <div className="vachix-cookie-icon" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
              stroke="var(--blue-light)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22C6.477 22 2 17.523 2 12S6.477 2 12 2"/>
              <path d="M12 2a10 10 0 0 1 9.93 8.83"/>
              <circle cx="16" cy="5" r="1" fill="var(--blue-light)" stroke="none"/>
              <circle cx="20" cy="9" r="1" fill="var(--blue-light)" stroke="none"/>
              <circle cx="9"  cy="8" r="1.5" fill="var(--blue-light)" stroke="none"/>
              <circle cx="7"  cy="14" r="1.5" fill="var(--blue-light)" stroke="none"/>
              <circle cx="14" cy="15" r="1.5" fill="var(--blue-light)" stroke="none"/>
            </svg>
          </div>

          {/* Body */}
          <div className="vachix-cookie-body">
            <p className="vachix-cookie-title">We use analytics cookies</p>
            <p className="vachix-cookie-text">
              Vachix uses PostHog to understand how you use the app and improve it.
              No advertising or third-party tracking.{' '}
              <a href="/privacy">Privacy policy →</a>
            </p>
          </div>

          {/* Actions */}
          <div className="vachix-cookie-actions">
            <button
              className="vachix-cookie-btn-accept"
              onClick={() => dismiss('accepted')}
              aria-label="Accept analytics cookies"
            >
              Accept
            </button>
            <button
              className="vachix-cookie-btn-decline"
              onClick={() => dismiss('declined')}
              aria-label="Decline analytics cookies"
            >
              Decline
            </button>
          </div>

        </div>
      </div>
    </>
  );
}
