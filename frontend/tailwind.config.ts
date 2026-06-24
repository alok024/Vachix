import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: ['class', '[data-theme="dark"]'],
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './hooks/**/*.{js,ts,jsx,tsx}',
    './store/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      // Vachix design tokens (v6)
      colors: {
        // Background layers
        bg: {
          base: '#0C0A10',    // page background
          surface: '#141118', // cards, sidebar
          muted: '#1E1A26',   // inputs, subtle surfaces
        },
        // Brand
        brand: {
          orange: '#F97316',
          violet: '#8B5CF6',
          emerald: '#10B981',
          purple: '#8B5CF6',
        },
        // Semantic
        border: 'rgba(255,255,255,0.07)',
        text: {
          primary: '#F5F3FF',
          secondary: '#9490A8',
          muted: '#5C5770',
        },
      },
      fontFamily: {
        sans: ['var(--font-sans-var)', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        '2xl': '1rem',
        '3xl': '1.25rem',
      },
      boxShadow: {
        glow: '0 0 20px rgba(249,115,22,0.3)',
        'glow-lg': '0 0 32px rgba(249,115,22,0.25)',
      },
      transitionDuration: {
        '250': '250ms',
      },
      animation: {
        'fade-in': 'fadeIn 0.2s ease-out',
        'slide-up': 'slideUp 0.3s ease-out',
        'spin-slow': 'spin 2s linear infinite',
      },
      keyframes: {
        fadeIn: {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        slideUp: {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
};

export default config;
