import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
      },
    ],
    // Cloudflare Pages doesn't support Next.js image optimization
    unoptimized: true,
  },
  // Rewrites: proxy /api/* to Express backend on Railway
  async rewrites() {
    // this is the rewrite target apiCall() in lib/api.ts actually
    // hits (it fetches the relative `/api/...` path, which Next.js then
    // proxies here) — so this fallback, not the same-looking one in
    // lib/api.ts's BACKEND_URL export, is what previously sent a
    // forgotten-env-var local dev straight to production. Same fix:
    // fail loudly in development instead of silently proxying to prod.
    const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL;
    if (!backendUrl) {
      if (process.env.NODE_ENV === 'development') {
        throw new Error(
          'NEXT_PUBLIC_BACKEND_URL is not set. Add it to .env.local — without it, ' +
          'the /api/* rewrite would silently proxy local requests to the production backend.'
        );
      }
    }
    return [
      {
        source: '/api/:path*',
        destination: `${backendUrl || 'https://vachix-production.up.railway.app'}/api/:path*`,
      },
    ];
  },
  // Security headers
  async headers() {
    // M11/M12: X-XSS-Protection is deprecated and ignored (or actively
    // harmful) in modern browsers; replaced with a real Content-Security-
    // Policy. Scoped to what this app actually loads:
    // - Razorpay's checkout.js is loaded dynamically (UpgradeModal.tsx)
    // and opens its own iframe/popup for the payment form.
    // - next/font/google self-hosts fonts at build time under
    // /_next/static, so no external font-src is needed.
    // - images.unsplash.com is the only external image host configured
    // in next.config's images.remotePatterns.
    // 'unsafe-inline' is kept for script/style because Next.js (App
    // Router, no custom nonce middleware yet) emits inline hydration data
    // and Tailwind/CSS-in-JS emits inline styles; this is still a real
    // improvement over no CSP, since it blocks loading scripts/frames
    // from any *other* origin. A stricter nonce-based policy can replace
    // this later without changing the rest of the header set.
    const csp = [
      "default-src 'self'",
      // P7-C (barge-in): 'wasm-unsafe-eval' is required by onnxruntime-web to
      // compile the Silero ONNX model inside the browser. Without it, the VAD
      // worker throws a WASM compilation error and barge-in silently degrades.
      "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://checkout.razorpay.com",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https://images.unsplash.com https://*.razorpay.com",
      "font-src 'self' data:",
      "connect-src 'self' https://*.razorpay.com https://app.posthog.com https://eu.posthog.com https://api.simli.com wss://api.simli.com",
      "frame-src https://api.razorpay.com https://checkout.razorpay.com",
      // P7-C (barge-in): vad-web registers an AudioWorklet from a blob: URL.
      // Chrome requires blob: in worker-src for this to succeed.
      "worker-src blob: 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'self'",
    ].join('; ');

    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Content-Security-Policy', value: csp },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(self), geolocation=()' },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
        ],
      },
      {
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=0, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
    ];
  },
};

export default nextConfig;
