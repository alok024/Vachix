/**
 * app/robots.ts
 *
 * Next.js App Router native robots.txt — no extra package needed.
 * Served at: https://vachix.in/robots.txt
 *
 * Allow all public pages. Block authenticated routes, admin, and all API
 * endpoints — these should never appear in search results.
 */

import { MetadataRoute } from 'next';

const BASE_URL = 'https://vachix.in';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/dashboard',
          '/interview/',
          '/english',
          '/history',
          '/profile',
          '/referral',
          '/prep-paths',
          '/admin',
          '/api/',
        ],
      },
    ],
    sitemap: `${BASE_URL}/sitemap.xml`,
  };
}
