/**
 * app/sitemap.ts
 *
 * Next.js App Router native sitemap — no extra package needed.
 * Served at: https://vachix.in/sitemap.xml
 *
 * Rules:
 *  - Only public, indexable routes. Never include /dashboard, /admin, /api/*.
 *  - The landing page (/) gets weekly frequency + priority 1.0.
 *  - Marketing/pricing pages get monthly + 0.8.
 *  - Legal pages get yearly + 0.3 (Google still needs them, but they're low-value).
 *
 * After deploying, go to Google Search Console → Sitemaps → submit:
 *   https://vachix.in/sitemap.xml
 */

import { MetadataRoute } from 'next';

const BASE_URL = 'https://vachix.in';

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  return [
    {
      url: BASE_URL,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 1.0,
    },
    {
      url: `${BASE_URL}/pricing`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.8,
    },
    {
      url: `${BASE_URL}/compare`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.6,
    },
    {
      url: `${BASE_URL}/results`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.6,
    },
    {
      url: `${BASE_URL}/privacy`,
      lastModified: now,
      changeFrequency: 'yearly',
      priority: 0.3,
    },
    {
      url: `${BASE_URL}/terms`,
      lastModified: now,
      changeFrequency: 'yearly',
      priority: 0.3,
    },
  ];
}
