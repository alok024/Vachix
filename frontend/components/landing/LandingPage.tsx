'use client';

/**
 * components/landing/LandingPage.tsx
 * New full-page landing — single client component that owns all the
 * interactive state (theme, topbar, nav scroll, reveals, marquee, FAQ, demo typer).
 * All buttons route to /register, /login, /profile, or mailto — safe for
 * Cloudflare Pages + Railway backend deployment.
 */

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useUIStore } from '@/store/ui';
import '@/app/landing.css';

/* FAQ DATA */
const FAQS = [
  { q: 'Do I need to speak aloud, or can I type my answers?', a: 'Both work. You can type or speak — if your device has a microphone, Vachix will transcribe your answer in real time. Elara then analyses whichever form she receives.' },
  { q: 'Is it useful if my English is already decent?', a: 'Yes — Elara catches the subtle mistakes standard spell-checkers miss: "myself is", "I am having experience", prepositional errors, and bureaucratic phrases that weaken interview impact.' },
  { q: 'Which exams does the interview coach cover?', a: 'UPSC/IAS, Bank PO (IBPS & SBI), SSC CGL/CHSL, Railway (RRB), Defence (NDA/CDS), Software Engineering, Data Science, Product Management, Campus Placements, Teaching, and Healthcare. New tracks are added regularly.' },
  { q: 'Can I cancel my subscription at any time?', a: 'Yes. Cancel from your profile page and you keep access until the end of the billing period. No questions asked, no hidden fees.' },
  { q: 'Is my data private?', a: 'Your interview sessions and corrections are stored only to generate your progress analytics. We do not share your data with third parties.' },
  { q: 'How is Vachix different from other interview prep apps?', a: 'Most prep apps focus on what you know. Vachix also trains how you say it — the live correction loop and real-time language coaching is unique to us.' },
  { q: 'Do you offer plans for colleges or coaching institutes?', a: "Yes. Vachix for Teams gives institutions a shared dashboard, bulk seat management, and per-student progress tracking at seat-based pricing. It's rolling out now — reach out from the \"For Teams\" section above to get early access." },
  { q: 'Can I get free sessions beyond the first 7?', a: "Yes — refer a friend from your profile page and you'll both get +10 bonus AI sessions when they sign up. There's no limit on how many friends you can refer." },
];

const TRACKS = ['UPSC / IAS', 'Bank PO', 'SSC CGL', 'Campus Placement', 'IBPS PO', 'Software Engineer', 'Data Science', 'Railway RRB', 'Defence NDA', 'Product Manager', 'Teaching', 'Healthcare'];

const TESTIMONIALS = [
  { quote: "Elara caught 'myself is Rahul' on my very first session. I had been saying it for years. Got my SBI PO interview call three weeks later.", name: 'Priya Sharma', meta: 'SBI PO 2024 Qualified', avatar: 'P', color: '#9b7fff' },
  { quote: "The UPSC mock questions are eerily accurate. And the fluency score actually moved — I went from 6.2 to 8.1 in six weeks.", name: 'Rahul Verma', meta: 'UPSC Mains 2024', avatar: 'R', color: '#e2c97e' },
  { quote: "Our entire placement batch used Vachix for 30 days. Average interview confidence score jumped 28%. Placement rate went up.", name: 'Dr. Kavita Nair', meta: 'TPO, Tier 2 Engineering College', avatar: 'K', color: '#4dd9ac' },
];

const DEMO_ANS = 'Myself is Rahul Kumar. I am having 2 years of experience in banking sector. I always do the needful on time.';

export default function LandingPage() {
  const [topbarOpen, setTopbarOpen] = useState(true);
  const [navScrolled, setNavScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  // Fix: the landing page used to keep its own private `theme` state +
  
  // `useUIStore` that the rest of the app (AppShell, etc.) reads from. That
  // meant toggling theme here never updated the store, so the very next
  // client-side navigation into the app could show a stale toggle state,
  // and clicking the landing toggle a second time sometimes looked like it
  // "did nothing" because the DOM attribute and the store had drifted apart.
  // Now the landing page reads/writes the SAME store as everywhere else.
  const isDark = useUIStore((s) => s.isDark);
  const toggleTheme = useUIStore((s) => s.toggleTheme);
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [bigNum, setBigNum] = useState('0%');
  const bigNumRef = useRef<HTMLSpanElement>(null);
  const demoRef = useRef<HTMLDivElement>(null);
  const barsRef = useRef<HTMLDivElement>(null);
  const [demoTyped, setDemoTyped] = useState(false);
  const [showCorr, setShowCorr] = useState(false);
  const [showScores, setShowScores] = useState(false);
  const [ansText, setAnsText] = useState('');

  /* Nav scroll */
  useEffect(() => {
    const onScroll = () => setNavScrolled(window.scrollY > 40);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  /* Reveal observer */
  useEffect(() => {
    const io = new IntersectionObserver(entries => {
      entries.forEach(e => { if (e.isIntersecting) { (e.target as HTMLElement).classList.add('in'); io.unobserve(e.target); } });
    }, { threshold: 0, rootMargin: '0px 0px -40px 0px' });
    document.querySelectorAll('.ssi-rv,.ssi-rvl,.ssi-rvr,.ssi-rvs').forEach(el => io.observe(el));
    requestAnimationFrame(() => {
      document.querySelectorAll('.ssi-rv,.ssi-rvl,.ssi-rvr,.ssi-rvs').forEach(el => {
        const r = el.getBoundingClientRect();
        if (r.top < window.innerHeight && r.bottom > 0) el.classList.add('in');
      });
    });
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
      // hero score bars
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

  /* Demo typer */
  useEffect(() => {
    if (!demoRef.current) return;
    const obs = new IntersectionObserver(entries => {
      if (!entries[0].isIntersecting || demoTyped) return;
      setDemoTyped(true);
      let i = 0;
      const iv = setInterval(() => {
        if (i >= DEMO_ANS.length) {
          clearInterval(iv);
          setTimeout(() => setShowCorr(true), 700);
          setTimeout(() => setShowScores(true), 1400);
          return;
        }
        setAnsText(DEMO_ANS.slice(0, ++i));
      }, 38);
      obs.disconnect();
    }, { threshold: 0.25 });
    obs.observe(demoRef.current);
    return () => obs.disconnect();
  }, [demoTyped]);

  /* Marquee content */
  const mqItems = TRACKS.map((t, i) => (
    <span key={i} className="ssi-mq-item"><span className="ssi-mq-dot" />{t}</span>
  ));


  return (
    <>
      {/* TOP BAR */}
      {topbarOpen && (
        <div className="ssi-topbar">
          <div className="ssi-topbar-text">
            <span className="ssi-topbar-pill">New</span>
            Elara now corrects Hindi-medium answers in real time
          </div>
          <button className="ssi-topbar-close" onClick={() => setTopbarOpen(false)} aria-label="Close">✕</button>
        </div>
      )}

      {/* NAV */}
      <nav className={`ssi-nav${navScrolled ? ' s' : ''}${!topbarOpen ? ' topbar-gone' : ''}`} style={{ top: topbarOpen ? 36 : 0 }}>
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
            <li key={href}><a href={href}>{label}</a></li>
          ))}
        </ul>

        <div className="ssi-nav-end">
          <button
            className="ssi-theme-toggle"
            onClick={toggleTheme}
            aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            aria-pressed={isDark}
          >
            <div className="ssi-tt-pill">
              <div className="ssi-tt-track">
                <svg className="ssi-tt-icon ssi-tt-moon" viewBox="0 0 24 24" fill="currentColor"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></svg>
                <svg className="ssi-tt-icon ssi-tt-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="4.5" /><line x1="12" y1="2" x2="12" y2="4" /><line x1="12" y1="20" x2="12" y2="22" />
                  <line x1="4.93" y1="4.93" x2="6.34" y2="6.34" /><line x1="17.66" y1="17.66" x2="19.07" y2="19.07" />
                  <line x1="2" y1="12" x2="4" y2="12" /><line x1="20" y1="12" x2="22" y2="12" />
                  <line x1="4.93" y1="19.07" x2="6.34" y2="17.66" /><line x1="17.66" y1="6.34" x2="19.07" y2="4.93" />
                </svg>
              </div>
            </div>
          </button>
          <Link href="/login" className="ssi-btn-signin">Sign In</Link>
          <Link href="/register" className="ssi-btn-cta">Start Free</Link>
        </div>

        <button className="ssi-ham" onClick={() => setMobileOpen(o => !o)} aria-label="Menu">
          {mobileOpen ? '✕' : '☰'}
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
            <button
              className="ssi-theme-toggle"
              onClick={toggleTheme}
              aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
              aria-pressed={isDark}
            >
              <div className="ssi-tt-pill">
                <div className="ssi-tt-track">
                  <svg className="ssi-tt-icon ssi-tt-moon" viewBox="0 0 24 24" fill="currentColor"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></svg>
                  <svg className="ssi-tt-icon ssi-tt-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="4.5" /><line x1="12" y1="2" x2="12" y2="4" /><line x1="12" y1="20" x2="12" y2="22" />
                    <line x1="4.93" y1="4.93" x2="6.34" y2="6.34" /><line x1="17.66" y1="17.66" x2="19.07" y2="19.07" />
                    <line x1="2" y1="12" x2="4" y2="12" /><line x1="20" y1="12" x2="22" y2="12" />
                    <line x1="4.93" y1="19.07" x2="6.34" y2="17.66" /><line x1="17.66" y1="6.34" x2="19.07" y2="4.93" />
                  </svg>
                </div>
              </div>
            </button>
          </div>
          <Link href="/login" onClick={() => setMobileOpen(false)} className="ssi-btn-signin" style={{ textAlign: 'center' }}>Sign In</Link>
          <Link href="/register" onClick={() => setMobileOpen(false)} className="ssi-btn-cta" style={{ justifyContent: 'center' }}>Start Free</Link>
        </div>
      </div>

      {/* HERO */}
      <section className="ssi-hero" id="hero">
        <div className="ssi-hero-bg">
          <div className="ssi-h-grid" />
          <div className="ssi-h-orb ssi-h-orb-1" />
          <div className="ssi-h-orb ssi-h-orb-2" />
          <div className="ssi-h-orb ssi-h-orb-3" />
          <div className="ssi-h-grain" />
        </div>
        <div className="ssi-hero-inner">
          <div className="ssi-hero-left">
            <div className="ssi-badge-live ssi-rv"><div className="ssi-bdot" />Live AI coach · Real-time English correction</div>
            <p className="ssi-hero-eyebrow ssi-rv d1"><span className="ssi-hero-eyebrow-dot" />Built for the most competitive interviews</p>
            <h1 className="ssi-hero-h1 ssi-rv d2">
              <span className="upright">Say it like<br />you mean it.</span><br />
              <span className="glow-word">We'll fix<br />the rest.</span>
            </h1>
            <p className="ssi-hero-sub ssi-rv d3">Practice real questions for UPSC, Bank PO, SSC, campus placements and tech roles — then let Aria ask the questions and Elara catch every language slip.</p>
            <div className="ssi-hero-actions ssi-rv d4">
              <Link href="/register" className="ssi-h-cta">Start practicing free →</Link>
              <a href="#coaches" className="ssi-h-ghost">See how it works</a>
            </div>
            <p className="ssi-hero-fine ssi-rv d5">Free to start · No credit card · Results in 10 minutes</p>
          </div>

          <div className="ssi-hero-visual ssi-rv d2">
            <div className="ssi-fcard ssi-fcard-a">
              <img src="https://images.unsplash.com/photo-1571260899304-425eee4c7efc?w=600&q=80&fit=crop&crop=faces" alt="Student preparing for exam" loading="eager" />
            </div>
            <div className="ssi-fcard ssi-fcard-b">
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
          {[['11', 'Exam & Role Tracks', 'c-v'], ['7', 'Free AI Sessions to Try', 'c-g'], ['₹699', 'Pro Plan / Month', ''], ['₹0', 'To Start, No Card', '']].map(([n, l, cls]) => (
            <div key={l as string} className="ssi-ss-item ssi-rv">
              <span className={`ssi-ss-n ${cls}`}>{n}</span>
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
            <span className="ssi-eyebrow">Your AI coaching team</span>
            <h2 className="ssi-sh2">Two coaches.<br /><span className="upright">One goal.</span></h2>
          </div>
          <div className="ssi-coaches-grid" style={{ marginTop: 56 }}>
            <div className="ssi-coach-card ssi-rv d1">
              <div className="ssi-cc-icon" style={{ background: 'var(--blue-dim)' }}>🧑‍💼</div>
              <div className="ssi-cc-name">Aria</div>
              <div className="ssi-cc-role">Interview coach · All 11 tracks</div>
              <p className="ssi-cc-desc">Fires realistic questions from official UPSC, Bank PO, SSC, tech, and campus interview formats. Adapts difficulty as your readiness score rises.</p>
              <div className="ssi-cc-tags">
                <span className="ssi-tag">UPSC / IAS</span><span className="ssi-tag">Bank PO</span><span className="ssi-tag">SSC</span><span className="ssi-tag">Tech</span><span className="ssi-tag">Campus</span>
              </div>
            </div>
            <div className="ssi-coach-card ssi-rv d2">
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
            <span className="ssi-eyebrow">How it works</span>
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
              <div style={{ marginBottom: 12, fontSize: 13, fontWeight: 600, color: 'var(--text1)' }}>⚡ Elara's corrections</div>
              {[
                ['"Myself is Rahul Kumar"', '"I am Rahul Kumar"', "'Myself' is reflexive — can't be subject."],
                ['"I am having experience"', '"I have experience"', 'Continuous tense is wrong for states/facts.'],
                ['"Do the needful"', '"Handle it promptly"', 'Bureaucratic filler — weakens your answer.'],
              ].map(([wrong, right, rule]) => (
                <div key={wrong as string} style={{ marginBottom: 12, paddingBottom: 12, borderBottom: '1px solid var(--border)' }}>
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

      {/* TESTIMONIALS */}
      <section className="ssi-sect">
        <div className="ssi-si">
          <div className="ssi-rv" style={{ textAlign: 'center' }}>
            <span className="ssi-eyebrow">What candidates say</span>
            <h2 className="ssi-sh2">Real results.<br /><span className="upright">Real interviews.</span></h2>
          </div>
          <div className="ssi-test-grid">
            {TESTIMONIALS.map((t, i) => (
              <div key={i} className={`ssi-tc-card ssi-rv d${i + 1}`}>
                <div className="ssi-tc-stars">{Array(5).fill(0).map((_, j) => <span key={j} className="ssi-tc-star">★</span>)}</div>
                <p className="ssi-tc-quote">"{t.quote}"</p>
                <div className="ssi-tc-author">
                  <div className="ssi-tc-avatar" style={{ background: t.color }}>{t.avatar}</div>
                  <div><div className="ssi-tc-name">{t.name}</div><div className="ssi-tc-meta">{t.meta}</div></div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* PRICING */}
      <section className="ssi-sect" id="pricing">
        <div className="ssi-si">
          <div className="ssi-rv" style={{ textAlign: 'center' }}>
            <span className="ssi-eyebrow">Pricing</span>
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
                <Link href="/register" className="ssi-plan-cta std">Start free, then upgrade</Link>
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
                <Link href="/register" className="ssi-plan-cta prime">Start free, then upgrade</Link>
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
                <Link href="/register?plan=elite" className="ssi-plan-cta std">Go Elite</Link>
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
              <span className="ssi-eyebrow">For institutions & teams</span>
              <h2 className="ssi-sh2">Training a batch?<br /><span className="upright">Coaching 50+ students?</span></h2>
              <p className="ssi-body-copy" style={{ marginTop: 16 }}>Coaching institutes, colleges, and placement cells can bring Vachix to an entire batch — one shared view of who's practicing, who's stuck, and where to focus the next class.</p>
              <ul className="ssi-b2b-feats">
                {['Bulk seat management — onboard a whole batch at once', 'Per-student progress tracking for coordinators', 'Shared dashboard across your institution', 'Seat-based pricing — cheaper per student at volume', 'Dedicated onboarding for your batch'].map(f => (
                  <li key={f}><span className="ssi-b2b-check">✓</span>{f}</li>
                ))}
              </ul>
              <Link href="/b2b" className="ssi-h-cta" style={{ marginTop: 28, display: 'inline-flex' }}>Talk to us about your batch →</Link>
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
            <span className="ssi-eyebrow">Why Vachix exists</span>
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
            <span className="ssi-eyebrow">Coming next</span>
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
            <span className="ssi-eyebrow">FAQ</span>
            <h2 className="ssi-sh2">Questions we<br /><span className="upright">get asked</span></h2>
          </div>
          <div className="ssi-faq-list">
            {FAQS.map((f, i) => (
              <div key={i} className={`ssi-fi ssi-rv${openFaq === i ? ' open' : ''}`}>
                <button className="ssi-fb" onClick={() => setOpenFaq(openFaq === i ? null : i)} aria-expanded={openFaq === i}>
                  <span>{f.q}</span><span className="ssi-fi-icon">+</span>
                </button>
                <div className="ssi-fans"><div className="ssi-fa">{f.a}</div></div>
              </div>
            ))}
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
            <Link href="/register" className="ssi-cta-h-cta">Start practicing free →</Link>
            <Link href="/register?plan=elite" className="ssi-cta-h-ghost">Go Elite — ₹1,299/mo</Link>
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
            <a href="mailto:hello@vachix.in">hello@vachix.in</a>
          </div>
          <span className="ssi-foot-cr">© {new Date().getFullYear()} Vachix</span>
        </div>
      </footer>
    </>
  );
}
