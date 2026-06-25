'use client';

/**
 * components/landing/LandingPage.tsx
 * Phase 4 polish pass — adds:
 *   01 Side Rail (scroll-tracking section index, with tooltips + accent bar)
 *   06 Cursor Aura (follows mouse, desktop only)
 *   08 Toast System (success/error/info/warning, swipe-to-dismiss)
 *   09 Command Palette (⌘K, keyboard navigation)
 *   11 Micro-interaction button ripples
 *   12 Floating CTA Island (appears after scrolling past hero)
 *   15 Glass Modal (used for upgrade prompt from pricing cards)
 */

import Link from 'next/link';
import { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useUIStore } from '@/store/ui';
import '@/app/landing.css';

/* ── DATA ──────────────────────────────────────────────────────────── */
const FAQS = [
  { cat: 'Sessions',  q: 'Do I need to speak aloud, or can I type my answers?', a: 'Both work. You can type or speak — if your device has a microphone, Vachix will transcribe your answer in real time. Elara then analyses whichever form she receives.' },
  { cat: 'Language',  q: 'Is it useful if my English is already decent?', a: 'Yes — Elara catches the subtle mistakes standard spell-checkers miss: "myself is", "I am having experience", prepositional errors, and bureaucratic phrases that weaken interview impact.' },
  { cat: 'Sessions',  q: 'Which exams does the interview coach cover?', a: 'UPSC/IAS, Bank PO (IBPS & SBI), SSC CGL/CHSL, Railway (RRB), Defence (NDA/CDS), Software Engineering, Data Science, Product Management, Campus Placements, Teaching, and Healthcare. New tracks are added regularly.' },
  { cat: 'Pricing',  q: 'What is the Starter plan and who is it for?', a: 'Starter is ₹299/month and gives you 30 AI interview sessions per month across all 11 exam tracks, Elara English correction, and AI memory on your recurring mistakes. It\'s ideal if you want consistent practice without committing to the full Pro plan.' },
  { cat: 'Pricing',  q: 'Can I cancel my subscription at any time?', a: 'Yes. Cancel from your profile page and you keep access until the end of the billing period. No questions asked, no hidden fees.' },
  { cat: 'Privacy',  q: 'Is my data private?', a: 'Your interview sessions and corrections are stored only to generate your progress analytics. We do not share your data with third parties.' },
  { cat: 'General',  q: 'How is Vachix different from other interview prep apps?', a: 'Most prep apps focus on what you know. Vachix also trains how you say it — the live correction loop and real-time language coaching is unique to us.' },
  { cat: 'Pricing',  q: 'Do you offer plans for colleges or coaching institutes?', a: "Yes. Vachix for Teams gives institutions a shared dashboard, bulk seat management, and per-student progress tracking at seat-based pricing. It's rolling out now — reach out from the \"For Teams\" section above to get early access." },
  { cat: 'Sessions',  q: 'Can I get free sessions beyond the first 7?', a: "Yes — refer a friend from your profile page and you'll both get +10 bonus AI sessions when they sign up. There's no limit on how many friends you can refer." },
];

const TRACKS = ['UPSC / IAS', 'Bank PO', 'SSC CGL', 'Campus Placement', 'IBPS PO', 'Software Engineer', 'Data Science', 'Railway RRB', 'Defence NDA', 'Product Manager', 'Teaching', 'Healthcare'];

const TESTIMONIALS: { quote: string; name: string; meta: string; avatar: string; color: string; result?: string }[] = [
  { quote: "Elara caught 'myself is Rahul' on my very first session. I had been saying it for years. Got my SBI PO interview call three weeks later.", name: 'Priya Sharma', meta: 'SBI PO 2024 Qualified', avatar: 'P', color: '#9b7fff' },
  { quote: "The UPSC mock questions are eerily accurate. And the fluency score actually moved — I went from 6.2 to 8.1 in six weeks.", name: 'Rahul Verma', meta: 'UPSC Mains 2024', avatar: 'R', color: '#e2c97e' },
  { quote: "Our entire placement batch used Vachix for 30 days. Average interview confidence score jumped 28%. Placement rate went up.", name: 'Dr. Kavita Nair', meta: 'TPO, Tier 2 Engineering College', avatar: 'K', color: '#4dd9ac' },
];

const DEMO_ANS = 'Myself is Rahul Kumar. I am having 2 years of experience in banking sector. I always do the needful on time.';

const RAIL_SECTIONS = [
  { id: 'hero',    label: 'Intro' },
  { id: 'coaches', label: 'Coaches' },
  { id: 'how',     label: 'How It Works' },
  { id: 'pricing', label: 'Pricing' },
  { id: 'b2b',     label: 'For Teams' },
  { id: 'about',   label: 'About' },
  { id: 'roadmap', label: 'Roadmap' },
  { id: 'faq',     label: 'FAQ' },
];

/* ── TOAST TYPES ────────────────────────────────────────────────────── */
type ToastType = 'success' | 'error' | 'info' | 'warning';
interface Toast { id: number; type: ToastType; title: string; msg: string; }
const TOAST_ICONS: Record<ToastType, string> = { success: '✓', error: '✕', info: 'ℹ', warning: '⚠' };
let _toastId = 0;

/* ── GLASS MODAL CONFIGS ─────────────────────────────────────────── */
interface GlassConfig { icon: string; title: string; body: string; cta: string; onConfirm?: () => void; }

export default function LandingPage() {
  const router = useRouter();
  const [topbarOpen, setTopbarOpen] = useState(true);
  const [navScrolled, setNavScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const isDark = useUIStore((s: { isDark: boolean }) => s.isDark);
  const toggleTheme = useUIStore((s: { toggleTheme: () => void }) => s.toggleTheme);
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [faqFilter, setFaqFilter] = useState<string>('All');
  const [bigNum, setBigNum] = useState('0%');
  const bigNumRef = useRef<HTMLSpanElement>(null);
  const demoRef = useRef<HTMLDivElement>(null);
  const barsRef = useRef<HTMLDivElement>(null);
  const [demoTyped, setDemoTyped] = useState(false);
  const [showCorr, setShowCorr] = useState(false);
  const [showScores, setShowScores] = useState(false);
  const [ansText, setAnsText] = useState('');
  const [corrStep, setCorrStep] = useState(0); // F19: 0–3, one per correction revealed

  /* ── F20: TESTIMONIAL CAROUSEL ──────────────────────────────── */
  const [tcActive, setTcActive] = useState(0);
  const tcAutoRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tcCount = TESTIMONIALS.length;

  /* ── F17: PARALLAX + F14: SCROLL TYPOGRAPHY ──────────────────── */
  const [scrollY, setScrollY] = useState(0);
  const heroRef = useRef<HTMLElement>(null);
  /* F17: dot-grid parallax ref + one-time reduced-motion check */
  const gridRef    = useRef<HTMLDivElement>(null);
  const noMotionRef = useRef(
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );

  /* ── F01: SIDE RAIL ────────────────────────────────────────────── */
  const [railActive, setRailActive] = useState(0);
  /* F13: per-section scroll progress [0..1] for gradient rings */
  const [sectionProgress, setSectionProgress] = useState<number[]>(() => RAIL_SECTIONS.map(() => 0));
  const railPillRef = useRef<HTMLDivElement>(null);
  const BAR_H = 14;
  const leaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pulseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevRailRef = useRef(-1);

  const updateRailBar = useCallback((idx: number) => {
    const pill = railPillRef.current;
    if (!pill) return;
    const items = pill.querySelectorAll<HTMLElement>('.ssi-rail-item');
    if (!items[idx]) return;
    const pillRect = pill.getBoundingClientRect();
    const itemRect = items[idx].getBoundingClientRect();
    const y = (itemRect.top - pillRect.top) + (itemRect.height / 2) - (BAR_H / 2);
    pill.style.setProperty('--rail-active-y', y + 'px');
    // pulse
    pill.classList.remove('bar-pulse');
    clearTimeout(pulseTimerRef.current ?? undefined);
    void (pill as HTMLElement).offsetWidth;
    pill.classList.add('bar-pulse');
    pulseTimerRef.current = setTimeout(() => pill.classList.remove('bar-pulse'), 400);
  }, []);

  /* ── F06: CURSOR AURA ──────────────────────────────────────────── */
  const auraRef = useRef<HTMLDivElement>(null);
  const dotRef  = useRef<HTMLDivElement>(null);
  const trailRef = useRef<HTMLCanvasElement>(null); // F06: particle trail

  useEffect(() => {
    if (window.matchMedia('(pointer:coarse)').matches) return;
    let ax = 0, ay = 0, tx = 0, ty = 0, raf = 0;
    const aura = auraRef.current;
    const dot  = dotRef.current;
    const canvas = trailRef.current;
    if (!aura || !dot || !canvas) return;

    // F06: particle trail setup
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    const ctx = canvas.getContext('2d')!;
    const particles: { x: number; y: number; life: number; size: number }[] = [];
    let lpx = 0, lpy = 0;
    const onResize = () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight; };
    window.addEventListener('resize', onResize);

    const onMove = (e: MouseEvent) => {
      tx = e.clientX; ty = e.clientY;
      aura.style.opacity = '1';
      dot.style.opacity  = '1';
      dot.style.left = tx + 'px';
      dot.style.top  = ty + 'px';
      // emit particle every ~14px of movement
      if (Math.hypot(tx - lpx, ty - lpy) > 14) {
        particles.push({ x: tx, y: ty, life: 1, size: Math.random() * 2.2 + 0.6 });
        lpx = tx; lpy = ty;
      }
      if (!raf) raf = requestAnimationFrame(tick);
    };
    const tick = () => {
      ax += (tx - ax) * 0.08;
      ay += (ty - ay) * 0.08;
      aura.style.left = ax + 'px';
      aura.style.top  = ay + 'px';
      // draw particles
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.life -= 0.045;
        if (p.life <= 0) { particles.splice(i, 1); continue; }
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(96,165,250,${p.life * 0.45})`;
        ctx.fill();
      }
      raf = requestAnimationFrame(tick);
    };
    const onLeave = () => { aura.style.opacity = '0'; dot.style.opacity = '0'; };
    document.addEventListener('mousemove', onMove, { passive: true });
    document.addEventListener('mouseleave', onLeave);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseleave', onLeave);
      window.removeEventListener('resize', onResize);
      cancelAnimationFrame(raf);
    };
  }, []);

  /* ── F17: MOUNT — pause float animations while JS drives transforms ──
     CSS animations and inline JS transforms both target the same
     `transform` property. When they coexist the browser alternates
     between them every frame → visible jank. Pausing the CSS
     animations on mount gives JS exclusive ownership of transform
     for the life of this component. The noMotion guard means
     reduced-motion users never get any parallax motion at all. */
  useEffect(() => {
    if (noMotionRef.current) return;
    const orbs = [
      document.querySelector<HTMLElement>('.ssi-h-orb-1'),
      document.querySelector<HTMLElement>('.ssi-h-orb-2'),
      document.querySelector<HTMLElement>('.ssi-h-orb-3'),
    ];
    orbs.forEach(el => { if (el) el.style.animationPlayState = 'paused'; });
    return () => {
      orbs.forEach(el => { if (el) el.style.animationPlayState = ''; });
    };
  }, []);

  /* ── F08: TOAST SYSTEM ─────────────────────────────────────────── */
  const [toasts, setToasts] = useState<Toast[]>([]);
  const showToast = useCallback((type: ToastType, title: string, msg: string, dur = 4200) => {
    const id = ++_toastId;
    setToasts((prev: Toast[]) => [...prev.slice(-4), { id, type, title, msg }]);
    setTimeout(() => setToasts((prev: Toast[]) => prev.filter((t: Toast) => t.id !== id)), dur);
  }, []);
  const dismissToast = useCallback((id: number) => {
    setToasts((prev: Toast[]) => prev.filter((t: Toast) => t.id !== id));
  }, []);

  /* ── F09: COMMAND PALETTE ──────────────────────────────────────── */
  /* ── F12: FLOATING CTA ISLAND ──────────────────────────────────── */
  const [ctaVisible, setCtaVisible] = useState(false);
  const [ctaCollapsed, setCtaCollapsed] = useState(false);
  const lastScrollY = useRef(0);

  /* ── F15: GLASS MODAL ──────────────────────────────────────────── */
  const [glassOpen, setGlassOpen] = useState(false);
  const [glassCfg, setGlassCfg] = useState<GlassConfig | null>(null);
  const [glassClosing, setGlassClosing] = useState(false);

  const openGlass = (cfg: GlassConfig) => { setGlassCfg(cfg); setGlassOpen(true); setGlassClosing(false); };
  const closeGlass = () => {
    setGlassClosing(true);
    setTimeout(() => { setGlassOpen(false); setGlassClosing(false); }, 300);
  };

  /* ── NAV SCROLL + REVEAL + BARS + BIG NUM + DEMO + CTA ISLAND ── */
  useEffect(() => {
    let ticking = false;
    let scrollRaf = 0;
    const handleScroll = () => {
      const y = window.scrollY;
      setScrollY(y);
      setNavScrolled(y > 40);
      // F07: nav scroll progress bar
      const docH = document.documentElement.scrollHeight - window.innerHeight;
      const fill = document.getElementById('ssi-nav-prog-fill');
      if (fill && docH > 0) fill.style.width = Math.min(100, (y / docH) * 100) + '%';
      // floating CTA
      setCtaVisible(y > window.innerHeight * 0.6);
      // F17: drive dot-grid at slowest depth (0.08×) for background parallax
      if (!noMotionRef.current && gridRef.current) {
        gridRef.current.style.transform = `translateY(${y * 0.08}px)`;
      }
      setCtaCollapsed(y > lastScrollY.current + 5 && y > 200);
      if (y < lastScrollY.current - 5) setCtaCollapsed(false);
      lastScrollY.current = y;
      // rail
      const probe = window.innerHeight * 0.38;
      let idx = 0;
      RAIL_SECTIONS.forEach((s, i) => {
        const el = document.getElementById(s.id);
        if (el && el.getBoundingClientRect().top <= probe) idx = i;
      });
      if (idx !== prevRailRef.current) {
        const pill = railPillRef.current;
        if (pill) {
          const items = pill.querySelectorAll<HTMLElement>('.ssi-rail-item');
          if (prevRailRef.current >= 0 && items[prevRailRef.current]) {
            const old = items[prevRailRef.current];
            old.classList.add('leaving');
            clearTimeout(leaveTimerRef.current ?? undefined);
            leaveTimerRef.current = setTimeout(() => old.classList.remove('leaving'), 220);
          }
          items.forEach((el: HTMLElement, i: number) => el.classList.toggle('active', i === idx));
          updateRailBar(idx);
        }
        prevRailRef.current = idx;
        setRailActive(idx);
      }
      /* F13: compute per-section scroll progress for gradient rings */
      const vh = window.innerHeight;
      const progArr = RAIL_SECTIONS.map((s, i) => {
        if (i < idx) return 1;
        if (i > idx) return 0;
        const el = document.getElementById(s.id);
        if (!el) return 0.5;
        const rect = el.getBoundingClientRect();
        const next = RAIL_SECTIONS[i + 1] ? document.getElementById(RAIL_SECTIONS[i + 1].id) : null;
        const sectionH = next ? (next.getBoundingClientRect().top - rect.top) : rect.height;
        if (sectionH <= 0) return 0.5;
        const scrolled = Math.max(0, probe - rect.top);
        return Math.min(1, scrolled / sectionH);
      });
      setSectionProgress(progArr);
    };
    // F17: rAF-gated scroll listener — coalesces rapid scroll events so
    // handleScroll (which writes styles + several setState calls) runs
    // at most once per animation frame instead of once per scroll event.
    const onScroll = () => {
      if (!ticking) {
        ticking = true;
        scrollRaf = requestAnimationFrame(() => {
          handleScroll();
          ticking = false;
        });
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(scrollRaf);
    };
  }, [updateRailBar]);

  // init rail bar position after mount
  useEffect(() => { setTimeout(() => updateRailBar(0), 200); }, [updateRailBar]);

  /* Reveal observer */
  useEffect(() => {
    const io = new IntersectionObserver(entries => {
      entries.forEach(e => { if (e.isIntersecting) { (e.target as HTMLElement).classList.add('in'); io.unobserve(e.target); } });
    }, { threshold: 0, rootMargin: '0px 0px -40px 0px' });
    document.querySelectorAll('.ssi-rv,.ssi-rvl,.ssi-rvr,.ssi-rvs,.ssi-rvc').forEach(el => io.observe(el));

    // F16: delay the mount-time visible-check so the browser paints opacity:0 first,
    // letting CSS transitions actually animate. sessionStorage guards once-per-session.
    const wasAnimated = sessionStorage.getItem('ssi_hero_done');
    const mountDelay = wasAnimated ? 0 : 100;
    if (!wasAnimated) sessionStorage.setItem('ssi_hero_done', '1');
    setTimeout(() => {
      document.querySelectorAll('.ssi-rv,.ssi-rvl,.ssi-rvr,.ssi-rvs,.ssi-rvc').forEach(el => {
        const r = el.getBoundingClientRect();
        if (r.top < window.innerHeight && r.bottom > 0) el.classList.add('in');
      });
    }, mountDelay);

    return () => io.disconnect();
  }, []);

  /* Stat bars animate */
  useEffect(() => {
    if (!barsRef.current) return;
    const obs = new IntersectionObserver(entries => {
      if (!entries[0].isIntersecting) return;
      document.querySelectorAll('.ssi-sbar-fill').forEach((bar, i) => {
        setTimeout(() => { (bar as HTMLElement).style.width = (bar as HTMLElement).dataset.w || '0%'; }, i * 120 + 200);
      });
      document.querySelectorAll('.ssi-fcs-bar-fill').forEach((b, i) => {
        const el = b as HTMLElement;
        setTimeout(() => { el.style.width = el.dataset.w || '70%'; }, i * 120);
      });
      obs.disconnect();
    }, { threshold: 0.2 });
    obs.observe(barsRef.current);
    return () => obs.disconnect();
  }, []);

  /* Big number counter */
  useEffect(() => {
    if (!bigNumRef.current) return;
    const obs = new IntersectionObserver(entries => {
      if (!entries[0].isIntersecting) return;
      let c = 0;
      setTimeout(() => {
        const iv = setInterval(() => { c = Math.min(c + 2, 87); setBigNum(c + '%'); if (c >= 87) clearInterval(iv); }, 28);
      }, 400);
      obs.disconnect();
    }, { threshold: 0.3 });
    obs.observe(bigNumRef.current);
    return () => obs.disconnect();
  }, []);

  /* Demo typer — F19: variable speed + staggered correction step dots */
  useEffect(() => {
    if (!demoRef.current) return;
    const obs = new IntersectionObserver(entries => {
      if (!entries[0].isIntersecting || demoTyped) return;
      setDemoTyped(true);
      obs.disconnect();
      let i = 0;
      // Variable speed: slow at capitals (new word after pause), faster mid-word
      const type = () => {
        if (i >= DEMO_ANS.length) {
          // stagger corrections one-by-one
          setTimeout(() => { setShowCorr(true); setCorrStep(1); }, 600);
          setTimeout(() => setCorrStep(2), 1100);
          setTimeout(() => setCorrStep(3), 1600);
          setTimeout(() => setShowScores(true), 2000);
          return;
        }
        const ch = DEMO_ANS[i];
        setAnsText(DEMO_ANS.slice(0, ++i));
        // Delay rules: space = short pause, period = longer pause, uppercase after space = brief hesitate
        const delay = ch === '.' ? 130
          : ch === ' ' ? 60
          : /[A-Z]/.test(ch) ? 75 + Math.random() * 20
          : 28 + Math.random() * 22;
        setTimeout(type, delay);
      };
      setTimeout(type, 500);
    }, { threshold: 0.25 });
    obs.observe(demoRef.current);
    return () => obs.disconnect();
  }, [demoTyped]);

  /* ── F20: TESTIMONIAL CAROUSEL auto-advance ─────────────────── */
  useEffect(() => {
    tcAutoRef.current = setInterval(() => {
      setTcActive(p => (p + 1) % tcCount);
    }, 5000);
    return () => { if (tcAutoRef.current) clearInterval(tcAutoRef.current); };
  }, [tcCount]);

  const tcGo = (n: number) => {
    if (tcAutoRef.current) clearInterval(tcAutoRef.current);
    const next = ((n % tcCount) + tcCount) % tcCount;
    setTcActive(next);
    tcAutoRef.current = setInterval(() => {
      setTcActive(p => (p + 1) % tcCount);
    }, 5000);
  };

  /* ── F05: COUNT-UP on stat strip ─────────────────────────────── */
  useEffect(() => {
    const els = document.querySelectorAll<HTMLElement>('[data-count]');
    if (!els.length) return;
    const obs = new IntersectionObserver(entries => {
      entries.forEach(el => {
        if (!el.isIntersecting) return;
        const target = el.target as HTMLElement;
        const raw = target.dataset.count ?? '0';
        const prefix = raw.replace(/[\d.]+/, '');
        const suffix = raw.slice((prefix + parseFloat(raw.replace(prefix, '')).toString()).length);
        const end = parseFloat(raw.replace(prefix, ''));
        const isInt = Number.isInteger(end);
        let start: number | null = null;
        const dur = 900;
        const step = (ts: number) => {
          if (!start) start = ts;
          const t = Math.min((ts - start) / dur, 1);
          const ease = 1 - Math.pow(1 - t, 3);
          const cur = end * ease;
          target.textContent = prefix + (isInt ? Math.round(cur) : cur.toFixed(1)) + suffix;
          if (t < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
        obs.unobserve(target);
      });
    }, { threshold: 0.4 });
    els.forEach(el => obs.observe(el));
    return () => obs.disconnect();
  }, []);

  /* Escape closes glass modal */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && glassOpen) closeGlass(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [glassOpen]);

  /* F03: Numbered section headers — ghost big-number + eyebrow shimmer
     1. Propagate data-num to the parent .ssi-rv via --section-num CSS var so
        the ghost ::before positions against the full section div (not the tiny span).
     2. Trigger ghost entrance animation (.ssi-bignum-in) on section entry.
     3. Fire eyebrow shimmer (.ssi-num-entered) with a delay so it clears the
        clip-path reveal animation before the gradient paint kicks in. */
  useEffect(() => {
    const heads = document.querySelectorAll<HTMLElement>('.ssi-num-head[data-num]');
    heads.forEach(span => {
      const num = span.dataset.num ?? '';
      const parent = span.closest<HTMLElement>('.ssi-rv');
      if (!parent) return;
      // set CSS custom property so ::before can use it
      parent.style.setProperty('--section-num', `"${num}"`);
      parent.classList.add('num-rv');
    });

    const obs = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        const rv = entry.target as HTMLElement;
        // ghost entrance
        rv.classList.remove('ssi-bignum-in');
        void rv.offsetWidth; // force reflow so animation restarts cleanly
        rv.classList.add('ssi-bignum-in');
        // eyebrow shimmer — delay past the clip-path wipe (~560ms)
        const eyebrow = rv.querySelector<HTMLElement>('.ssi-num-head');
        if (eyebrow) {
          setTimeout(() => eyebrow.classList.add('ssi-num-entered'), 580);
        }
        obs.unobserve(rv);
      });
    }, { threshold: 0.15, rootMargin: '0px 0px -30px 0px' });

    document.querySelectorAll<HTMLElement>('.ssi-rv.num-rv').forEach(el => obs.observe(el));
    return () => obs.disconnect();
  }, []);

  /* F04: Coach card 3D tilt + cursor-speed scan line */
  useEffect(() => {
    const plates = document.querySelectorAll<HTMLElement>('.ssi-tilt-card');
    const cleanups: (() => void)[] = [];

    plates.forEach(plate => {
      let lastX = 0, lastY = 0, lastT = 0;

      const onMove = (e: MouseEvent) => {
        const r = plate.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        const dx = (e.clientX - cx) / (r.width / 2);
        const dy = (e.clientY - cy) / (r.height / 2);
        plate.style.setProperty('--tilt-x', (-dy * 8).toFixed(2) + 'deg');
        plate.style.setProperty('--tilt-y', (dx * 8).toFixed(2) + 'deg');
        plate.classList.remove('tilt-reset');

        const now = Date.now();
        const dist = Math.hypot(e.clientX - lastX, e.clientY - lastY);
        const dt = now - lastT || 16;
        const speed = dist / dt;
        const scanDur = Math.max(0.6, 2.4 - speed * 1.8).toFixed(2) + 's';
        plate.style.setProperty('--scan-dur', scanDur);

        lastX = e.clientX; lastY = e.clientY; lastT = now;
      };

      const onLeave = () => {
        plate.classList.add('tilt-reset');
        plate.style.setProperty('--tilt-x', '0deg');
        plate.style.setProperty('--tilt-y', '0deg');
      };

      plate.addEventListener('mousemove', onMove, { passive: true });
      plate.addEventListener('mouseleave', onLeave);
      cleanups.push(() => {
        plate.removeEventListener('mousemove', onMove);
        plate.removeEventListener('mouseleave', onLeave);
      });
    });

    return () => cleanups.forEach(fn => fn());
  }, []);

  /* Ripple helper — F11: also triggers loading → success flash */
  const addRipple = (e: React.MouseEvent<HTMLElement>) => {
    const btn = e.currentTarget;
    const rect = btn.getBoundingClientRect();
    const r = document.createElement('span');
    r.className = 'micro-ripple-el';
    r.style.left = (e.clientX - rect.left - 2) + 'px';
    r.style.top  = (e.clientY - rect.top - 2) + 'px';
    btn.appendChild(r);
    setTimeout(() => r.remove(), 560);
    // F11: brief loading → success state before navigation takes over
    btn.classList.add('btn-loading');
    setTimeout(() => {
      btn.classList.remove('btn-loading');
      btn.classList.add('btn-success-flash');
      setTimeout(() => btn.classList.remove('btn-success-flash'), 420);
    }, 220);
  };

  const mqItems = TRACKS.map((t, i) => (
    <span key={i} className="ssi-mq-item"><span className="ssi-mq-dot" />{t}</span>
  ));

  return (
    <div className="ssi-page-root" style={{ position: 'relative' }}>
      {/* ── CURSOR AURA (F06) ─────────────────────────────────────── */}
      <div ref={auraRef} className="ssi-aura" aria-hidden="true" />
      <div ref={dotRef}  className="ssi-cursor-dot" aria-hidden="true" />
      <canvas ref={trailRef} className="ssi-trail-canvas" aria-hidden="true" />

      {/* ── TOAST CONTAINER (F08) ─────────────────────────────────── */}
      <div id="ssi-toast-container" aria-live="polite" aria-atomic="false">
        {toasts.map((t: Toast) => (
          <div key={t.id} className={`ssi-toast toast-${t.type}`} style={{ '--toast-dur': '4200ms' } as React.CSSProperties}>
            <div className="toast-icon-wrap">
              {/* F08: SVG countdown ring */}
              <svg className="toast-ring" viewBox="0 0 36 36" aria-hidden="true">
                <circle className="toast-ring-track" cx="18" cy="18" r="15" />
                <circle className="toast-ring-fill" cx="18" cy="18" r="15"
                  style={{ '--toast-dur': '4200ms' } as React.CSSProperties} />
              </svg>
              <div className="toast-icon">{TOAST_ICONS[t.type]}</div>
            </div>
            <div className="toast-body">
              <div className="toast-title">{t.title}</div>
              <div className="toast-msg">{t.msg}</div>
            </div>
            <button className="toast-close" onClick={() => dismissToast(t.id)} aria-label="Dismiss">✕</button>
            <div className="toast-timer-bar"><div className="toast-timer-fill" /></div>
          </div>
        ))}
      </div>

      {/* ── SIDE RAIL (F01) ───────────────────────────────────────── */}
      <nav className="ssi-rail" aria-label="Page sections">
        <div className="ssi-rail-pill" ref={railPillRef}>
          {RAIL_SECTIONS.map((s, i) => {
            const pct = Math.round((i / (RAIL_SECTIONS.length - 1)) * 100);
            return (
              <a
                key={s.id}
                href={`#${s.id}`}
                className={`ssi-rail-item${railActive === i ? ' active' : ''}`}
                data-idx={i}
                aria-label={s.label}
              >
                {/* F13: section progress ring — gradient fill + neon glow */}
                {(() => {
                  const R = 7, C = +(2 * Math.PI * R).toFixed(2);
                  const pct = sectionProgress[i] ?? 0;
                  const offset = +(C * (1 - pct)).toFixed(2);
                  const gradId = `rg-${i}`;
                  return (
                    <svg className="ssi-rail-ring" viewBox="0 0 20 20" aria-hidden="true">
                      <defs>
                        <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
                          <stop offset="0%" stopColor="#60a5fa" />
                          <stop offset="100%" stopColor="#818cf8" />
                        </linearGradient>
                      </defs>
                      <circle className="ssi-rail-ring-track" cx="10" cy="10" r={R} />
                      <circle className="ssi-rail-ring-glow" cx="10" cy="10" r={R}
                        strokeDasharray={C} strokeDashoffset={offset}
                        transform="rotate(-90 10 10)" />
                      <circle className="ssi-rail-ring-fill" cx="10" cy="10" r={R}
                        stroke={`url(#${gradId})`}
                        strokeDasharray={C} strokeDashoffset={offset}
                        transform="rotate(-90 10 10)" />
                    </svg>
                  );
                })()}
                <span className="ssi-rail-num">{String(i).padStart(2, '0')}</span>
                <span className="ssi-rail-label">{s.label}</span>
                <span className="ssi-rail-tooltip">
                  {s.label}<br />
                  <small style={{ color: 'var(--text2)', fontSize: 8, letterSpacing: '.06em' }}>{pct}% through page</small>
                  <span className="ssi-rail-tooltip-bar">
                    <span className="ssi-rail-tooltip-fill" style={{ width: pct + '%' }} />
                  </span>
                </span>
              </a>
            );
          })}
          <span className="ssi-rail-time" id="ssi-rail-time" aria-hidden="true">
            ~{Math.max(1, Math.round((RAIL_SECTIONS.length - 1 - railActive) * 0.4))} min left
          </span>
        </div>
      </nav>

      {/* ── FLOATING CTA ISLAND (F12) ─────────────────────────────── */}
      <div
        id="ssi-floating-cta"
        className={`${ctaVisible ? 'visible' : ''}${ctaCollapsed ? ' collapsed' : ''}`}
        aria-hidden={!ctaVisible}
      >
        <div className="cta-island-inner">
          <span className="cta-island-dot" aria-hidden="true" />
          <span className="cta-island-text">Ready to practice?</span>
          <Link href="/register" className="cta-island-btn" onClick={addRipple}>Start free →</Link>
        </div>
      </div>

      {/* ── GLASS MODAL (F15) ─────────────────────────────────────── */}
      {glassOpen && glassCfg && (
        <div
          id="ssi-glass-backdrop"
          className="open"
          onClick={(e: React.MouseEvent<HTMLDivElement>) => { if (e.target === e.currentTarget) closeGlass(); }}
        >
          <div className={`ssi-glass-modal${glassClosing ? ' glass-closing' : ''}`} role="dialog" aria-modal="true">
            <div className="glass-modal-glow" aria-hidden="true" />
            <div className="glass-modal-header">
              <div className="glass-modal-icon">{glassCfg.icon}</div>
              <h2 className="glass-modal-title">{glassCfg.title}</h2>
              <button className="glass-modal-close" onClick={closeGlass} aria-label="Close">✕</button>
            </div>
            <div className="glass-modal-body" dangerouslySetInnerHTML={{ __html: glassCfg.body }} />
            <div className="glass-modal-footer">
              <button className="glass-btn-secondary" onClick={closeGlass}>Cancel</button>
              <button
                className="glass-btn-primary"
                onClick={() => {
                  closeGlass();
                  glassCfg.onConfirm?.();
                }}
              >
                {glassCfg.cta}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── TOP BAR ──────────────────────────────────────────────── */}
      {topbarOpen && (
        <div className="ssi-topbar">
          <div className="ssi-topbar-text">
            <span className="ssi-topbar-pill">New</span>
            Elara now corrects Hindi-medium answers in real time
          </div>
          <button className="ssi-topbar-close" onClick={() => setTopbarOpen(false)} aria-label="Close">✕</button>
        </div>
      )}

      {/* ── NAV ──────────────────────────────────────────────────── */}
      <nav className={`ssi-nav${navScrolled ? ' s' : ''}`} style={{ top: topbarOpen ? 36 : 0 }}>
        {/* F07: scroll progress bar */}
        <div className="ssi-nav-progress" aria-hidden="true"><div className="ssi-nav-progress-fill" id="ssi-nav-prog-fill" /></div>
        <a href="#hero" className="ssi-nlogo">
          <svg className="ssi-nlogo-mark" width="30" height="30" viewBox="0 0 44 44" fill="none" aria-hidden="true">
            <defs>
              <linearGradient id="vachixLogoGrad" x1="0" y1="0" x2="44" y2="44" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stopColor="#F97316" />
                <stop offset="100%" stopColor="#8B5CF6" />
              </linearGradient>
            </defs>
            <rect width="44" height="44" rx="11" fill="url(#vachixLogoGrad)" />
            <polyline points="11,13 22,31 33,13" fill="none" stroke="white" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="22" cy="36" r="2.5" fill="white" opacity="0.85" />
          </svg>
          <span>Vachi<span className="ssi-nlogo-accent">x</span></span>
        </a>

        <ul className="ssi-nlinks">
          {[['#coaches', 'Coaches'], ['#how', 'How It Works'], ['#pricing', 'Pricing'], ['#b2b', 'For Teams'], ['#about', 'About'], ['#faq', 'FAQ']].map(([href, label]) => (
            <li key={href}><a href={href} className={railActive === RAIL_SECTIONS.findIndex(s => '#' + s.id === href) ? 'ssi-nav-active' : ''}>{label}</a></li>
          ))}
        </ul>

        <div className="ssi-nav-end">
          <button
            className="ssi-theme-toggle"
            onClick={toggleTheme}
            aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            aria-pressed={isDark}
          >
            <span className="ssi-tt-pill">
              <span className="ssi-tt-star" />
              <span className="ssi-tt-star" />
              <span className="ssi-tt-star" />
              <span className="ssi-tt-track">
                <span className="ssi-tt-crescent">
                  <span className="ssi-tt-crater" />
                  <span className="ssi-tt-crater" />
                </span>
                <span className="ssi-tt-rays">
                  <i /><i /><i /><i /><i /><i /><i /><i />
                </span>
              </span>
            </span>
          </button>
          <Link href="/login" className="ssi-btn-signin">Sign In</Link>
          <Link href="/register" className="ssi-btn-cta ssi-btn-micro" onClick={addRipple}>Start Free</Link>
        </div>

        <button className={`ssi-ham${mobileOpen ? ' open' : ''}`} onClick={() => setMobileOpen((o: boolean) => !o)} aria-label="Menu">
          <svg className="ssi-ham-svg" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line className="ssi-ham-l1" x1="3" y1="6"  x2="21" y2="6"  />
            <line className="ssi-ham-l2" x1="3" y1="12" x2="21" y2="12" />
            <line className="ssi-ham-l3" x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
      </nav>

      {/* Mobile menu */}
      <div className={`ssi-mobile-menu${mobileOpen ? ' open' : ''}`} style={{ position: 'fixed', top: topbarOpen ? 100 : 64, left: 0, right: 0, zIndex: 199 }}>
        {[['#coaches', 'Coaches'], ['#how', 'How It Works'], ['#pricing', 'Pricing'], ['#b2b', 'For Teams'], ['#about', 'About'], ['#faq', 'FAQ']].map(([href, label]) => (
          <a key={href} href={href} onClick={() => setMobileOpen(false)}>{label}</a>
        ))}
        <div className="ssi-mobile-menu-btns">
          <div className="ssi-mobile-theme-row">
            <span className="ssi-mobile-theme-label">{isDark ? 'Dark mode' : 'Light mode'}</span>
            <button className="ssi-theme-toggle" onClick={toggleTheme} aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'} aria-pressed={isDark}>
              <span className="ssi-tt-pill">
                <span className="ssi-tt-star" />
                <span className="ssi-tt-star" />
                <span className="ssi-tt-star" />
                <span className="ssi-tt-track">
                  <span className="ssi-tt-crescent">
                    <span className="ssi-tt-crater" />
                    <span className="ssi-tt-crater" />
                  </span>
                  <span className="ssi-tt-rays">
                    <i /><i /><i /><i /><i /><i /><i /><i />
                  </span>
                </span>
              </span>
            </button>
          </div>
          <Link href="/login" onClick={() => setMobileOpen(false)} className="ssi-btn-signin" style={{ textAlign: 'center' }}>Sign In</Link>
          <Link href="/register" onClick={() => setMobileOpen(false)} className="ssi-btn-cta" style={{ justifyContent: 'center' }}>Start Free</Link>
        </div>
      </div>

      {/* ── HERO ─────────────────────────────────────────────────── */}
      <section className="ssi-hero" id="hero" ref={heroRef}>
        <div className="ssi-hero-bg">
          <div className="ssi-h-grid" ref={gridRef} />
          <div className="ssi-h-orb ssi-h-orb-1" style={{ transform: `translateY(${scrollY * 0.18}px)` }} />
          <div className="ssi-h-orb ssi-h-orb-2" style={{ transform: `translateY(${scrollY * 0.10}px) translateX(${scrollY * 0.05}px)` }} />
          <div className="ssi-h-orb ssi-h-orb-3" style={{ transform: `translateY(${scrollY * 0.24}px) translateX(${-scrollY * 0.04}px)` }} />
          <div className="ssi-h-grain" />
        </div>
        <div className="ssi-hero-inner">
          <div className="ssi-hero-left">
            <div className="ssi-badge-live ssi-rv"><div className="ssi-bdot" />Live AI coach · Real-time English correction</div>
            <p className="ssi-hero-eyebrow ssi-rv d1"><span className="ssi-hero-eyebrow-dot" />Built for the most competitive interviews</p>
            <h1 className="ssi-hero-h1 ssi-rv d2" style={{
              opacity: Math.max(0, 1 - scrollY / 380),
              transform: `translateY(${Math.min(scrollY * 0.12, 30)}px) scale(${Math.max(0.94, 1 - scrollY * 0.00012)})`,
            }}>
              <span className="upright">Say it like<br />you mean it.</span><br />
              <span className="glow-word">We'll fix<br />the rest.</span>
            </h1>
            <p className="ssi-hero-sub ssi-rv d3">Practice real questions for UPSC, Bank PO, SSC, campus placements and tech roles — then let Aria ask the questions and Elara catch every language slip.</p>
            <div className="ssi-hero-actions ssi-rv d4">
              <Link href="/register" className="ssi-h-cta ssi-btn-micro" onClick={addRipple}>Start practicing free →</Link>
              <a href="#coaches" className="ssi-h-ghost">See how it works</a>
            </div>
            <p className="ssi-hero-fine ssi-rv d5">Free to start · No credit card · Results in 10 minutes</p>
          </div>

          <div className="ssi-hero-visual ssi-rv d2">
            <div
              className="ssi-fcard ssi-fcard-a"
              onMouseMove={e => {
                const el = e.currentTarget;
                const r = el.getBoundingClientRect();
                const x = (e.clientX - r.left - r.width  / 2) / (r.width  / 2);
                const y = (e.clientY - r.top  - r.height / 2) / (r.height / 2);
                el.style.setProperty('--fc-rx', (-y * 6).toFixed(2) + 'deg');
                el.style.setProperty('--fc-ry', ( x * 6).toFixed(2) + 'deg');
                el.style.animationPlayState = 'paused';
              }}
              onMouseLeave={e => {
                const el = e.currentTarget;
                el.style.setProperty('--fc-rx', '0deg');
                el.style.setProperty('--fc-ry', '0deg');
                el.style.animationPlayState = 'running';
              }}
            >
              <div className="ssi-fc-scan" aria-hidden="true" />
              <div className="ssi-fcard-br" aria-hidden="true" />
              <img src="https://images.unsplash.com/photo-1571260899304-425eee4c7efc?w=600&q=80&fit=crop&crop=faces" alt="Student preparing for exam" loading="eager" />
            </div>
            <div
              className="ssi-fcard ssi-fcard-b"
              onMouseMove={e => {
                const el = e.currentTarget;
                const r = el.getBoundingClientRect();
                const x = (e.clientX - r.left - r.width  / 2) / (r.width  / 2);
                const y = (e.clientY - r.top  - r.height / 2) / (r.height / 2);
                el.style.setProperty('--fc-rx', (-y * 6).toFixed(2) + 'deg');
                el.style.setProperty('--fc-ry', ( x * 6).toFixed(2) + 'deg');
                el.style.animationPlayState = 'paused';
              }}
              onMouseLeave={e => {
                const el = e.currentTarget;
                el.style.setProperty('--fc-rx', '0deg');
                el.style.setProperty('--fc-ry', '0deg');
                el.style.animationPlayState = 'running';
              }}
            >
              <div className="ssi-fc-scan" aria-hidden="true" />
              <div className="ssi-fcard-br" aria-hidden="true" />
              <img src="https://images.unsplash.com/photo-1553877522-43269d4ea984?w=500&q=80&fit=crop&crop=top" alt="Interview setting" loading="eager" />
            </div>
            <div className="ssi-fcard-bubble">
              <span className="ssi-fb-badge">⚡ Elara caught a slip</span>
              <span className="ssi-fb-wrong">Myself is Rahul Kumar</span>
              <span className="ssi-fb-right">I am Rahul Kumar</span>
              <span className="ssi-fb-rule">'Myself' is reflexive — use 'I' as subject.</span>
            </div>
            <div className="ssi-fcard-score">
              <span className="ssi-fcs-title">Interview Readiness · Live</span>
              {[['Grammar', '8.1', 'var(--success)', '81%'], ['Fluency', '7.4', 'var(--warn)', '74%'], ['Vocabulary', '7.9', 'var(--accent)', '79%']].map(([label, val, color, w]) => (
                <div key={label as string}>
                  <div className="ssi-fcs-row">
                    <span className="ssi-fcs-label">{label}</span>
                    <span className="ssi-fcs-val" style={{ color: color as string }}>{val}</span>
                  </div>
                  <div className="ssi-fcs-bar"><div className="ssi-fcs-bar-fill" data-w={w} style={{ background: color as string }} /></div>
                </div>
              ))}
              <div className="ssi-fcs-row" style={{ marginTop: 10, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                <span className="ssi-fcs-label" style={{ color: 'var(--text1)', fontWeight: 700 }}>Readiness</span>
                <span className="ssi-fcs-val" style={{ color: 'var(--accent)', fontSize: 16 }}>87%</span>
              </div>
            </div>
            <div className="ssi-fcard-users">
              <div className="ssi-fu-avs">
                <div className="ssi-fu-av ssi-fu-av-1">P</div>
                <div className="ssi-fu-av ssi-fu-av-2">R</div>
                <div className="ssi-fu-av ssi-fu-av-3">K</div>
              </div>
              <div className="ssi-fu-text">
                <span>Sample session score</span>
                <span className="ssi-fu-live"><span className="ssi-fu-live-dot" />Elara live</span>
              </div>
            </div>
          </div>
        </div>
        <div className="ssi-scroll-hint"><div className="ssi-scroll-line" />scroll</div>
      </section>

      {/* STAT STRIP */}
      <div className="ssi-stat-strip">
        <div className="ssi-ss-inner">
          {[['11', 'Exam & Role Tracks', 'c-v', '11'], ['7', 'Free AI Sessions to Try', 'c-g', '7'], ['₹699', 'Pro Plan / Month', '', '699'], ['₹0', 'To Start, No Card', '', '0']].map(([n, l, cls, count]) => (
            <div key={l as string} className="ssi-ss-item ssi-rv">
              <span className={`ssi-ss-n ${cls}`} data-count={`${(n as string).startsWith('₹') ? '₹' : ''}${count}`}>{n}</span>
              <span className="ssi-ss-l">{l}</span>
            </div>
          ))}
        </div>
      </div>

      {/* TRUST BAND */}
      <div className="ssi-trust-band ssi-rv">
        <span className="ssi-trust-label">Tracks Covered</span>
        <div className="ssi-trust-badges">
          {['UPSC / IAS', 'IBPS PO', 'SBI PO', 'SSC CGL', 'Railway RRB', 'Defence NDA', 'Software Eng', 'Data Science', 'Campus Placement', 'Teaching', 'Healthcare'].map(t => (
            <span key={t} className="ssi-trust-badge">{t}</span>
          ))}
        </div>
      </div>

      {/* MARQUEE */}
      <div className="ssi-mq">
        <div className="ssi-mq-track">{mqItems}{mqItems}</div>
      </div>

      {/* COACHES */}
      <section className="ssi-sect" id="coaches">
        <div className="ssi-si">
          <div className="ssi-rv" style={{ textAlign: 'center' }}>
            <span className="ssi-eyebrow ssi-rvc ssi-num-head" data-num="01">Your AI coaching team</span>
            <h2 className="ssi-sh2">Two coaches.<br /><span className="upright">One goal.</span></h2>
          </div>
          <div className="ssi-coaches-grid" style={{ marginTop: 56 }}>
            <div className="ssi-coach-card ssi-rv ssi-tilt-card d1">
              <div className="ssi-cc-corner ssi-cc-tl" /><div className="ssi-cc-corner ssi-cc-tr" />
              <div className="ssi-cc-corner ssi-cc-bl" /><div className="ssi-cc-corner ssi-cc-br" />
              <div className="ssi-cc-scan" aria-hidden="true" />
              <div className="ssi-cc-icon" style={{ background: 'var(--blue-dim)' }}>🧑‍💼</div>
              <div className="ssi-cc-name">Aria</div>
              <div className="ssi-cc-role">Interview coach · All 11 tracks</div>
              <p className="ssi-cc-desc">Fires realistic questions from official UPSC, Bank PO, SSC, tech, and campus interview formats. Adapts difficulty as your readiness score rises.</p>
              <div className="ssi-cc-tags">
                <span className="ssi-tag">UPSC / IAS</span><span className="ssi-tag">Bank PO</span><span className="ssi-tag">SSC</span><span className="ssi-tag">Tech</span><span className="ssi-tag">Campus</span>
              </div>
            </div>
            <div className="ssi-coach-card ssi-rv ssi-tilt-card d2">
              <div className="ssi-cc-corner ssi-cc-tl" /><div className="ssi-cc-corner ssi-cc-tr" />
              <div className="ssi-cc-corner ssi-cc-bl" /><div className="ssi-cc-corner ssi-cc-br" />
              <div className="ssi-cc-scan" aria-hidden="true" />
              <div className="ssi-cc-icon" style={{ background: 'var(--warn-dim)' }}>✨</div>
              <div className="ssi-cc-name">Elara</div>
              <div className="ssi-cc-role">English coach · Real-time correction</div>
              <p className="ssi-cc-desc">Catches every grammar slip, Hinglish error, and filler phrase the moment you answer — not after. Scores your Grammar, Fluency, and Vocabulary separately.</p>
              <div className="ssi-cc-tags">
                <span className="ssi-tag">Grammar</span><span className="ssi-tag">Fluency</span><span className="ssi-tag">Vocabulary</span><span className="ssi-tag">Hinglish</span>
              </div>
            </div>
          </div>

          <div className="ssi-coaches-stat ssi-rv" ref={barsRef}>
            <span className="ssi-big-num" ref={bigNumRef}>{bigNum}</span>
            <span className="ssi-big-label">of candidates score higher on their second session after Elara's corrections on their first.</span>
          </div>

          <div className="ssi-score-section" style={{ marginTop: 72 }}>
            <div>
              <span className="ssi-eyebrow ssi-rv">Every answer scored live</span>
              <h2 className="ssi-sh2 ssi-rv d1">Three numbers that<br /><span className="upright">tell the whole story</span></h2>
              <p className="ssi-body-copy ssi-rv d2" style={{ marginTop: 16 }}>Grammar, Fluency, and Vocabulary — tracked across every session so you can see which dimension is holding you back and fix it before your real panel.</p>
            </div>
            <div className="ssi-score-bars">
              {[['Grammar', '8.1 / 10', 'var(--success)', '81%'], ['Fluency', '7.4 / 10', 'var(--warn)', '74%'], ['Vocabulary', '7.9 / 10', 'var(--accent)', '79%'], ['Interview Readiness', '87%', 'var(--text1)', '87%']].map(([label, val, color, w]) => (
                <div key={label as string} className="ssi-sbar ssi-rv">
                  <div className="ssi-sbar-header">
                    <span className="ssi-sbar-label">{label}</span>
                    <span className="ssi-sbar-val" style={{ color: color as string }}>{val}</span>
                  </div>
                  <div className="ssi-sbar-track"><div className="ssi-sbar-fill" data-w={w} style={{ background: color as string }} /></div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="ssi-sect" id="how">
        <div className="ssi-si">
          <div className="ssi-rv" style={{ textAlign: 'center' }}>
            <span className="ssi-eyebrow ssi-rvc ssi-num-head" data-num="02">How it works</span>
            <h2 className="ssi-sh2">Three steps.<br /><span className="upright">Ten minutes.</span></h2>
          </div>
          <div className="ssi-steps">
            {[
              ['01', 'Pick your track', 'Choose your exam or role — UPSC, Bank PO, SSC, Software Eng, and 7 more. The coach loads questions specific to that panel format.'],
              ['02', 'Answer aloud or type', 'Speak or type your answer. Elara watches in real time — she doesn\'t wait until the end to tell you what went wrong.'],
              ['03', 'Read the score, fix the slip', 'Grammar, Fluency, and Vocabulary scores appear instantly. Each correction links to the exact rule you broke and the correct form.'],
            ].map(([num, title, desc]) => (
              <div key={num as string} className="ssi-step ssi-rv">
                <div className="ssi-step-num">{num}</div>
                <div className="ssi-step-title">{title}</div>
                <p className="ssi-step-desc">{desc}</p>
              </div>
            ))}
          </div>

          {/* DEMO TYPER */}
          <div className="ssi-demo-card ssi-rv" ref={demoRef}>
            <div className="ssi-dc-q">Live correction demo — IBPS PO introduction question</div>
            <div className="ssi-dc-ans">{ansText}<span className="ssi-tc" /></div>
            <div className={`ssi-dc-corr${showCorr ? ' show' : ''}`}>
              <div style={{ marginBottom: 4, fontSize: 13, fontWeight: 600, color: 'var(--text1)' }}>⚡ Elara's corrections</div>
              {/* F19: step progress dots */}
              <div className="ssi-step-dots" aria-hidden="true">
                {[1, 2, 3].map(n => (
                  <div key={n} className={`ssi-step-dot${corrStep >= n ? ' active' : ''}`} />
                ))}
              </div>
              {[
                ['"Myself is Rahul Kumar"', '"I am Rahul Kumar"', "'Myself' is reflexive — can't be subject."],
                ['"I am having experience"', '"I have experience"', 'Continuous tense is wrong for states/facts.'],
                ['"Do the needful"', '"Handle it promptly"', 'Bureaucratic filler — weakens your answer.'],
              ].map(([wrong, right, rule], idx) => (
                <div key={wrong as string} className={`ssi-dc-corr-item${corrStep > idx ? ' show' : ''}`}>
                  <span style={{ color: 'var(--wrong)', fontSize: 13, textDecoration: 'line-through' }}>{wrong}</span>
                  <span style={{ margin: '0 8px', color: 'var(--text3)' }}>→</span>
                  <span style={{ color: 'var(--right)', fontSize: 13, fontWeight: 600 }}>{right}</span>
                  <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>{rule}</div>
                </div>
              ))}
            </div>
            <div className={`ssi-dc-scores${showScores ? ' show' : ''}`}>
              {[['6.1', 'var(--wrong)', 'Grammar'], ['7.2', 'var(--warn)', 'Fluency'], ['6.8', 'var(--accent)', 'Vocabulary']].map(([val, color, label]) => (
                <div key={label as string} className="ssi-ds">
                  <span className="ssi-ds-val" style={{ color: color as string }}>{val}</span>
                  <span className="ssi-ds-label">{label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* TESTIMONIALS — F20: carousel with auto-advance, dot nav, prev/next */}
      <section className="ssi-sect">
        <div className="ssi-si">
          <div className="ssi-rv" style={{ textAlign: 'center' }}>
            <span className="ssi-eyebrow ssi-num-head" data-num="03">What candidates say</span>
            <h2 className="ssi-sh2">Real results.<br /><span className="upright">Real interviews.</span></h2>
          </div>
          <div className="ssi-tc-carousel ssi-rv">
            <div className="ssi-tc-track">
              {TESTIMONIALS.map((t, i) => (
                <div
                  key={i}
                  className={`ssi-tc-card d${i + 1}${i === tcActive ? ' tc-active' : i === (tcActive - 1 + tcCount) % tcCount ? ' tc-leaving' : ''}`}
                >
                  <div className="ssi-tc-stars">{Array(5).fill(0).map((_, j) => <span key={j} className="ssi-tc-star">★</span>)}</div>
                  <p className="ssi-tc-quote">&#8220;{t.quote}&#8221;</p>
                  <div className="ssi-tc-author">
                    <div className="ssi-tc-avatar" style={{ background: t.color }}>{t.avatar}</div>
                    <div><div className="ssi-tc-name">{t.name}</div><div className="ssi-tc-meta">{t.meta}</div></div>
                    {t.result && <span className="ssi-tc-result">{t.result}</span>}
                  </div>
                </div>
              ))}
            </div>
            <div className="ssi-tc-controls">
              <button className="ssi-tc-arrow" onClick={() => tcGo(tcActive - 1)} aria-label="Previous testimonial">←</button>
              <button className="ssi-tc-arrow" onClick={() => tcGo(tcActive + 1)} aria-label="Next testimonial">→</button>
              <div className="ssi-tc-dots">
                {TESTIMONIALS.map((_, i) => (
                  <button key={i} className={`ssi-tc-dot${i === tcActive ? ' active' : ''}`} onClick={() => tcGo(i)} aria-label={`Go to testimonial ${i + 1}`} />
                ))}
              </div>
              <span className="ssi-tc-auto-label">Auto-advances · 5s</span>
            </div>
          </div>
        </div>
      </section>

      {/* PRICING — plan cards now open glass modal (F15) */}
      <section className="ssi-sect" id="pricing">
        <div className="ssi-si">
          <div className="ssi-rv" style={{ textAlign: 'center' }}>
            <span className="ssi-eyebrow ssi-num-head" data-num="04">Pricing</span>
            <h2 className="ssi-sh2">Honest pricing,<br /><span className="upright">no surprises</span></h2>
            <p className="ssi-body-copy" style={{ marginTop: 16, textAlign: 'center', maxWidth: '100%' }}>Start free. Upgrade when you need more. Cancel any time.</p>
          </div>
          <div style={{ maxWidth: 760, margin: '0 auto' }}>
            <div className="ssi-plan-free-callout ssi-rv" style={{ marginTop: 56 }}>
              <div>
                <div className="ssi-pfc-title">Free plan — always free, no card needed</div>
                <div className="ssi-pfc-sub">7 free AI sessions to try · All 11 exam tracks · Elara corrections included</div>
              </div>
              <Link href="/register" className="ssi-pfc-link">Start free →</Link>
            </div>
            <div className="ssi-pgrid">
              <div className="ssi-plan ssi-rvl d1">
                <div className="ssi-plan-top-line" />
                <span className="ssi-plan-name">Starter</span>
                <p className="ssi-plan-tag">Get serious without the full commitment</p>
                <div className="ssi-plan-price"><span className="ssi-plan-amt">₹299</span><span className="ssi-plan-per">/month</span></div>
                <p className="ssi-plan-gst">+ 18% GST · billed monthly</p>
                <ul className="ssi-plan-feats">
                  {['30 AI interview sessions/month', 'All 11 exam tracks', 'Elara English correction', 'Grammar & Fluency scoring', 'AI memory on your mistakes'].map(f => <li key={f}>{f}</li>)}
                </ul>
                <button
                  className="ssi-plan-cta std"
                  onClick={() => openGlass({
                    icon: '⚡',
                    title: 'Upgrade to Starter',
                    body: '<p>Get 30 sessions/month across all 11 exam tracks for ₹299/month + GST. Cancel any time.</p>',
                    cta: 'Continue to checkout',
                    onConfirm: () => { router.push('/register?plan=starter'); showToast('info', 'Redirecting…', 'Taking you to checkout.'); },
                  })}
                >
                  Start free, then upgrade
                </button>
              </div>
              <div className="ssi-plan featured ssi-rvr d2">
                <div className="ssi-plan-top-line" />
                <span className="ssi-plan-badge">Best value</span>
                <span className="ssi-plan-name">Pro</span>
                <p className="ssi-plan-tag">Everything you need to crack your interview</p>
                <div className="ssi-plan-price"><span className="ssi-plan-amt">₹699</span><span className="ssi-plan-per">/month</span></div>
                <p className="ssi-plan-gst">+ 18% GST · billed monthly</p>
                <ul className="ssi-plan-feats">
                  {['Unlimited interview sessions', 'All 11 exam tracks (UPSC, Bank PO, SSC…)', 'Elara English correction on every answer', 'Grammar, Fluency & Vocabulary scoring', 'AI memory — tracks your recurring mistakes', 'Weak-area detection & adaptive difficulty', 'AI Chat coach between sessions', 'Session history & Readiness dashboard'].map(f => <li key={f}>{f}</li>)}
                </ul>
                <button
                  className="ssi-plan-cta prime ssi-btn-micro"
                  onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
                    addRipple(e);
                    openGlass({
                      icon: '🚀',
                      title: 'Upgrade to Pro',
                      body: '<p>Unlock unlimited sessions, Interview Readiness Reports, and full history for ₹699/month + GST.</p>',
                      cta: 'Continue to checkout',
                      onConfirm: () => { router.push('/register?plan=pro'); showToast('info', 'Redirecting…', 'Taking you to checkout.'); },
                    });
                  }}
                >
                  Start free, then upgrade
                </button>
              </div>
              <div className="ssi-plan ssi-rv d3">
                <div className="ssi-plan-top-line" />
                <span className="ssi-plan-badge">Most popular</span>
                <span className="ssi-plan-name">Elite</span>
                <p className="ssi-plan-tag">For serious candidates preparing every day</p>
                <div className="ssi-plan-price"><span className="ssi-plan-amt">₹1,299</span><span className="ssi-plan-per">/month</span></div>
                <p className="ssi-plan-gst">+ 18% GST · billed monthly</p>
                <ul className="ssi-plan-feats">
                  {['Everything in Pro', 'Priority AI — faster responses', 'Detailed grammar breakdowns with examples', 'Full session history & PDF exports', 'Personalised improvement plan', 'Early access to new features (voice & avatar)'].map(f => <li key={f}>{f}</li>)}
                </ul>
                <button
                  className="ssi-plan-cta std"
                  onClick={() => openGlass({
                    icon: '👑',
                    title: 'Go Elite',
                    body: '<p>Everything in Pro, plus priority AI, PDF exports, and a personalised improvement plan. ₹1,299/month + GST.</p>',
                    cta: 'Continue to checkout',
                    onConfirm: () => { router.push('/register?plan=elite'); showToast('info', 'Redirecting…', 'Taking you to checkout.'); },
                  })}
                >
                  Go Elite
                </button>
              </div>
            </div>
            <p className="ssi-free-note">Or <Link href="/register">start completely free</Link> — 7 AI sessions to try, all tracks, no card needed</p>
            <p className="ssi-referral-note">Already have an account? <Link href="/profile">Refer a friend</Link> and earn +10 bonus AI sessions when they sign up.</p>
          </div>
        </div>
      </section>

      {/* B2B */}
      <section className="ssi-sect" id="b2b">
        <div className="ssi-si">
          <div className="ssi-b2b-wrap ssi-rv">
            <div>
              <span className="ssi-eyebrow ssi-num-head" data-num="05">For institutions & teams</span>
              <h2 className="ssi-sh2">Training a batch?<br /><span className="upright">Coaching 50+ students?</span></h2>
              <p className="ssi-body-copy" style={{ marginTop: 16 }}>Coaching institutes, colleges, and placement cells can bring Vachix to an entire batch — one shared view of who's practicing, who's stuck, and where to focus the next class.</p>
              <ul className="ssi-b2b-feats">
                {['Bulk seat management — onboard a whole batch at once', 'Per-student progress tracking for coordinators', 'Shared dashboard across your institution', 'Seat-based pricing — cheaper per student at volume', 'Dedicated onboarding for your batch'].map(f => (
                  <li key={f}><span className="ssi-b2b-check">✓</span>{f}</li>
                ))}
              </ul>
              <Link href="/b2b" className="ssi-h-cta ssi-btn-micro" style={{ marginTop: 28, display: 'inline-flex' }} onClick={addRipple}>Talk to us about your batch →</Link>
              <p className="ssi-b2b-note">B2B plans are launching shortly — reach out now to lock in early-access pricing.</p>
            </div>
            <div>
              <div className="ssi-b2b-card">
                <span className="ssi-fcs-title">Built for coordinators</span>
                {[['Students placed under one dashboard', 'Unlimited'], ['Per-seat pricing', 'Volume discount'], ['Setup time', 'Same week'], ['Support', 'Dedicated contact']].map(([label, val], i) => (
                  <div key={i} className="ssi-b2b-stat-row" style={i === 3 ? { borderBottom: 'none' } : undefined}>
                    <span>{label}</span><strong>{val}</strong>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* INDIA / ABOUT */}
      <section className="ssi-india-sect" id="about">
        <div className="ssi-india-inner">
          <div className="ssi-rvl">
            <span className="ssi-eyebrow ssi-num-head" data-num="06">Why Vachix exists</span>
            <h2 className="ssi-sh2">The gap no coaching<br /><span className="upright">class ever fills</span></h2>
            <p className="ssi-body-copy" style={{ marginTop: 20 }}>Every year, millions of qualified candidates walk into competitive panels — knowing every answer — and lose marks on how they say it. Filler words, tense slips, and phrasing that reads as uncertain. Coaching classes teach content. Nobody teaches delivery. Vachix does.</p>
            <div className="ssi-india-quote ssi-rv d2">
              <p>"A coaching class with 200 students teaches everyone the same content. It can't tell you, individually, that you've been saying 'myself is' for three years. Elara can — on your very first session."</p>
              <cite>What Elara is built to catch</cite>
            </div>
          </div>
          <div className="ssi-rvr d1">
            <div className="ssi-india-stats-grid">
              {[['11', 'Exam & role tracks'], ['7', 'Free AI sessions to try'], ['₹699', 'Pro plan / month'], ['₹0', 'To start, no card']].map(([n, l]) => (
                <div key={l as string} className="ssi-india-stat">
                  <span className="ssi-india-stat-num">{n}</span>
                  <span className="ssi-india-stat-label">{l}</span>
                </div>
              ))}
            </div>
            <p className="ssi-body-copy" style={{ marginTop: 28, fontSize: 13 }}>Candidates from Tier 2 and Tier 3 cities use Vachix to close the communication gap that big-city coaching students never have to think about.</p>
          </div>
        </div>
      </section>

      {/* ROADMAP */}
      <section className="ssi-sect" id="roadmap">
        <div className="ssi-si">
          <div className="ssi-rv" style={{ textAlign: 'center', maxWidth: 640, margin: '0 auto' }}>
            <span className="ssi-eyebrow ssi-num-head" data-num="07">Coming next</span>
            <h2 className="ssi-sh2">Elara is about<br /><span className="upright">to get a voice</span></h2>
            <p className="ssi-body-copy" style={{ marginTop: 16, textAlign: 'center', maxWidth: '100%' }}>These are in active development, not live yet. Pro and Elite members get them first, at no extra cost, the moment they ship.</p>
          </div>
          <div className="ssi-roadmap-grid">
            {[
              ['pro', '🎙️', 'Sharper voice recognition', 'An upgraded speech engine tuned for diverse accents, on top of the voice input that already works today.', 'ssi-rvl d1'],
              ['pro', '🗣️', 'Elara speaks back', 'Natural spoken responses from Elara during your session, instead of reading her corrections off the screen.', 'ssi-rv d2'],
              ['elite', '🎯', 'Pronunciation scoring', 'Word-by-word pronunciation feedback — not just grammar — so you know exactly how you sounded, not only what you said.', 'ssi-rv d3'],
              ['elite', '🧑‍💼', "Elara's face", 'A live animated avatar that responds to you in real time — built to feel closer to an actual panel than a chat window.', 'ssi-rvr d4'],
            ].map(([tier, icon, title, desc, cls]) => (
              <div key={title as string} className={`ssi-roadmap-card ${cls}`}>
                <span className={`ssi-roadmap-tag ${tier}`}>{tier === 'pro' ? 'Pro & Elite' : 'Elite'}</span>
                <div className="ssi-smart-icon">{icon}</div>
                <h3 className="ssi-smart-h">{title}</h3>
                <p className="ssi-smart-p">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="ssi-sect" id="faq">
        <div className="ssi-si">
          <div className="ssi-rv" style={{ textAlign: 'center' }}>
            <span className="ssi-eyebrow ssi-num-head" data-num="08">FAQ</span>
            <h2 className="ssi-sh2">Questions we<br /><span className="upright">get asked</span></h2>
          </div>
          <div className="ssi-faq-list">
            <div className="ssi-faq-filter-row">
              {['All', 'Pricing', 'Sessions', 'Language', 'Privacy', 'General'].map(cat => (
                <button
                  key={cat}
                  className={`ssi-faq-filter-btn${faqFilter === cat ? ' active' : ''}`}
                  onClick={() => { setFaqFilter(cat); setOpenFaq(null); }}
                >
                  {cat}
                </button>
              ))}
            </div>
            {FAQS.filter(f => faqFilter === 'All' || f.cat === faqFilter).map((f, i) => {
              const globalIdx = FAQS.indexOf(f);
              return (
              <div key={globalIdx} className={`ssi-fi${openFaq === globalIdx ? ' open' : ''}`}>
                <button className="ssi-fb" onClick={() => setOpenFaq(openFaq === globalIdx ? null : globalIdx)} aria-expanded={openFaq === globalIdx}>
                  <span>{f.q}</span>
                  {/* F21: SVG lines — rotate(45deg) on parent makes + → × cleanly */}
                  <svg className="ssi-fi-icon" width="16" height="16" viewBox="0 0 16 16" fill="none"
                    stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
                    <line x1="1.5" y1="8" x2="14.5" y2="8" />
                    <line x1="8" y1="1.5" x2="8" y2="14.5" />
                  </svg>
                </button>
                <div className="ssi-fans"><div className="ssi-fa">{f.a}</div></div>
              </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* FINAL CTA */}
      <section className="ssi-cta-sect">
        <div className="ssi-cta-orb-1" />
        <div className="ssi-cta-orb-2" />
        <div className="ssi-cta-inner ssi-rv">
          <span className="ssi-cta-eyebrow">Your panel is waiting</span>
          <h2 className="ssi-cta-h">Start talking.<br /><span className="glow-word">Right now.</span></h2>
          <p className="ssi-cta-sub">Five minutes from now you could have your first answer scored, your first language slip corrected, and your first readiness number on the board.</p>
          <div className="ssi-cta-acts">
            <Link href="/register" className="ssi-cta-h-cta ssi-btn-micro" onClick={addRipple}>Start practicing free →</Link>
            <button
              className="ssi-cta-h-ghost"
              onClick={() => openGlass({
                icon: '👑', title: 'Go Elite',
                body: '<p>Everything in Pro, plus priority AI, PDF exports, and a personalised improvement plan. ₹1,299/month + GST. Cancel any time.</p>',
                cta: 'Continue to checkout',
                onConfirm: () => router.push('/register?plan=elite'),
              })}
            >
              Go Elite — ₹1,299/mo
            </button>
          </div>
          <p className="ssi-cta-fine">UPI, cards & net banking · Cancel any time · Results in under 10 minutes</p>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="ssi-footer">
        <div className="ssi-footer-inner">
          <span className="ssi-foot-brand">Vachix</span>
          <div className="ssi-foot-links">
            <Link href="/privacy">Privacy</Link>
            <Link href="/terms">Terms</Link>
            <a href="#faq">FAQ</a>
            <a
              href="mailto:support@vachix.in?subject=Bug%20Report&body=Page%3A%20%0AWhat%20happened%3A%20%0ASteps%20to%20reproduce%3A%20"
            >
              Report a bug
            </a>
            <a href="mailto:support@vachix.in">support@vachix.in</a>
          </div>
          <span className="ssi-foot-cr">© {new Date().getFullYear()} Vachix</span>
        </div>
      </footer>
    </div>
  );
}
