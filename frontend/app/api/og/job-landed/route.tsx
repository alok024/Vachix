/**
 * app/api/og/job-landed/route.ts
 *
 * Generates a shareable OG image for job-landed users.
 * Verifies the HMAC token so this endpoint can't be scraped for
 * arbitrary user data — token is built server-side in results-board.service.ts
 * using the same JWT_SECRET key.
 *
 * URL: /api/og/job-landed?uid=<userId>&token=<hmac>
 *
 * Returns a 1200×630 PNG via Next.js ImageResponse.
 *
 * NOTE: ImageResponse uses the Edge runtime. We keep this file
 * self-contained (no imports from the Express backend) so it stays
 * compatible with Cloudflare Pages / Vercel Edge.
 */

import { ImageResponse } from 'next/og';
import { NextRequest } from 'next/server';
import crypto from 'crypto';

export const runtime = 'edge';

const OG_W = 1200;
const OG_H = 630;

function buildExpectedToken(userId: string, secret: string): string {
  return crypto
    .createHmac('sha256', secret)
    .update(`og:job-landed:${userId}`)
    .digest('hex')
    .slice(0, 40);
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const uid   = searchParams.get('uid')   ?? '';
  const token = searchParams.get('token') ?? '';

  const secret = process.env.JWT_SECRET ?? '';
  if (!uid || !token || !secret) {
    return new Response('Bad request', { status: 400 });
  }

  // Constant-time comparison — identical to the backend's verifyOgToken()
  const expected = buildExpectedToken(uid, secret);
  if (expected.length !== token.length) {
    return new Response('Forbidden', { status: 403 });
  }
  const valid = crypto.timingSafeEqual(
    Buffer.from(expected, 'utf8'),
    Buffer.from(token,    'utf8'),
  );
  if (!valid) {
    return new Response('Forbidden', { status: 403 });
  }

  // Fetch the board entry for this user from our own backend
  // (Next.js rewrites proxy /api/* → backend, but from the Edge runtime
  //  we must hit the backend URL directly because Next.js rewrites only
  //  apply to browser requests, not server-side fetch).
  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL
    ?? 'https://vachix-production.up.railway.app';

  let displayName = 'A Vachix User';
  let role        = 'New Role';
  let company     = '';

  try {
    const boardRes = await fetch(
      `${backendUrl}/api/user/results-board`,
      { next: { revalidate: 3600 } }          // cache for 1h — cards rarely change
    );
    if (boardRes.ok) {
      const json = (await boardRes.json()) as {
        data: {
          entries: Array<{
            display_name:   string;
            role:           string;
            company:        string | null;
            og_image_url:   string;
          }>;
        };
      };
      // Match by og_image_url containing this uid (cheapest way to filter
      // without adding a separate /api/user/board-entry/:userId endpoint)
      const entry = json.data.entries.find(e => e.og_image_url.includes(uid));
      if (entry) {
        displayName = entry.display_name;
        role        = entry.role;
        company     = entry.company ?? '';
      }
    }
  } catch {
    // Non-fatal — fall back to generic card
  }

  const headline = company
    ? `${displayName} landed ${role} at ${company}!`
    : `${displayName} landed ${role}!`;

  return new ImageResponse(
    (
      <div
        style={{
          width:       OG_W,
          height:      OG_H,
          display:     'flex',
          flexDirection: 'column',
          alignItems:  'center',
          justifyContent: 'center',
          background:  'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
          fontFamily:  'system-ui, -apple-system, sans-serif',
          padding:     60,
        }}
      >
        {/* Logo badge */}
        <div
          style={{
            display:       'flex',
            alignItems:    'center',
            gap:           12,
            marginBottom:  32,
          }}
        >
          <div
            style={{
              width:        48,
              height:       48,
              borderRadius: 12,
              background:   '#4F8EF7',
              display:      'flex',
              alignItems:   'center',
              justifyContent: 'center',
              fontSize:     24,
            }}
          >
            🎙️
          </div>
          <span style={{ color: '#4F8EF7', fontWeight: 700, fontSize: 22, letterSpacing: -0.5 }}>
            Vachix
          </span>
        </div>

        {/* Trophy */}
        <div style={{ fontSize: 72, marginBottom: 16 }}>🏆</div>

        {/* Headline */}
        <div
          style={{
            color:       '#f8fafc',
            fontSize:    headline.length > 60 ? 36 : 44,
            fontWeight:  800,
            textAlign:   'center',
            lineHeight:  1.2,
            letterSpacing: -1,
            maxWidth:    900,
            marginBottom: 20,
          }}
        >
          {headline}
        </div>

        {/* Sub-text */}
        <div
          style={{
            color:      '#94a3b8',
            fontSize:   22,
            textAlign:  'center',
            marginBottom: 36,
          }}
        >
          Prep → Practice → Land. AI interview coach that actually works.
        </div>

        {/* CTA badge */}
        <div
          style={{
            display:       'flex',
            alignItems:    'center',
            gap:           10,
            background:    '#22c55e22',
            border:        '1.5px solid #22c55e',
            borderRadius:  999,
            padding:       '10px 24px',
          }}
        >
          <span style={{ color: '#22c55e', fontSize: 18, fontWeight: 700 }}>
            ✓ Interview Prep with Vachix
          </span>
        </div>

        {/* Footer */}
        <div
          style={{
            position:    'absolute',
            bottom:      32,
            color:       '#475569',
            fontSize:    16,
          }}
        >
          vachix.in · AI Interview Coach for India
        </div>
      </div>
    ),
    { width: OG_W, height: OG_H }
  );
}
