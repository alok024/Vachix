import type { Metadata, Viewport } from 'next';
import { DM_Sans, DM_Serif_Display, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import { Providers } from './providers';

const dmSans = DM_Sans({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600'],
  variable: '--font-sans-var',
  display: 'swap',
});

const dmSerif = DM_Serif_Display({
  subsets: ['latin'],
  weight: ['400'],
  style: ['normal', 'italic'],
  variable: '--font-serif-var',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  variable: '--font-mono-var',
  display: 'swap',
});

export const metadata: Metadata = {
  metadataBase: new URL('https://vachix.in'),
  title: 'Vachix — Say it like you mean it.',
  description:
    'AI-powered English speaking and interview preparation for Indian students and job seekers. Practice real questions for UPSC, Bank PO, SSC, campus placements.',
  keywords: [
    'interview preparation india',
    'english speaking practice',
    'ai interview coach',
    'bank po preparation',
    'upsc interview',
    'hinglish english correction',
    'elara ai coach',
  ],
  alternates: {
    canonical: 'https://vachix.in',
  },
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Vachix',
  },
  openGraph: {
    title: 'Vachix — Say it like you mean it.',
    description: 'Practice interviews in Hindi, English, or Hinglish. Get real feedback.',
    url: 'https://vachix.in',
    siteName: 'Vachix',
    type: 'website',
  },
};

export const viewport: Viewport = {
  themeColor: '#9b7fff',
  width: 'device-width',
  initialScale: 1,
  // Prevent iOS from zooming in on input focus (complement to the CSS font-size fix)
  maximumScale: 1,
  // Allow content to extend into the notch / home indicator area
  // so we can use env(safe-area-inset-*) for proper padding
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        <link rel="apple-touch-icon" href="/icons/icon-192.png" />
        {/* Theme init script — runs before paint to prevent flash */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function(){
                try {
                  // One-time migration: move old ss-* keys to vachix-* keys.
                  // Safe to run on every load — noop once old keys are gone.
                  ['ss-ui','ss-auth'].forEach(function(old){
                    var val = localStorage.getItem(old);
                    if(val){
                      var next = old === 'ss-ui' ? 'vachix-ui' : 'vachix-auth';
                      if(!localStorage.getItem(next)) localStorage.setItem(next, val);
                      localStorage.removeItem(old);
                    }
                  });
                  // Read theme from the canonical vachix-ui key (no second key needed).
                  var raw = localStorage.getItem('vachix-ui');
                  if (raw) {
                    var parsed = JSON.parse(raw);
                    var dark = parsed && parsed.state && parsed.state.isDark;
                    document.documentElement.setAttribute('data-theme', dark === false ? 'light' : 'dark');
                  }
                } catch(e){}
              })();
            `,
          }}
        />
        {/* Service Worker */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              if ('serviceWorker' in navigator) {
                window.addEventListener('load', function() {
                  navigator.serviceWorker.register('/sw.js');
                });
              }
            `,
          }}
        />
      </head>
      <body className={`${dmSans.variable} ${dmSerif.variable} ${jetbrainsMono.variable}`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}