'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, useRef, Suspense } from 'react';
import { useInterviewStore } from '@/store/interview';
import { useAuthStore } from '@/store/auth';
import { useUIStore } from '@/store/ui';
import { useMe } from '@/hooks/queries';
import { Button, Card, ChipGroup, Input } from '@/components/ui';
import { Difficulty, InterviewType, SessionMode } from '@/types';
import { voiceApi } from '@/features/voice/api';
import { FLAG } from '@/lib/feature-flags'; // P2-A: humanized coaching UI indicator

// ─── F27: Profession picker cards data ────────────────────────────────────────
const PROFESSION_CARDS = [
  { prof: 'Bank PO',          icon: '🏦', hint: 'IBPS & SBI format questions' },
  { prof: 'SSC CGL',          icon: '📋', hint: 'Tier I & II interview rounds' },
  { prof: 'Government Job (SSC/UPSC)', icon: '🏛️', hint: 'Civil services personality test' },
  { prof: 'Software Developer',icon: '💻', hint: 'Behavioural + system design' },
  { prof: 'Data Scientist',   icon: '📊', hint: 'Case study & technical rounds' },
  { prof: 'Doctor / Medical', icon: '🩺', hint: 'Clinical & HR interview rounds' },
  { prof: 'Teacher',          icon: '📚', hint: 'Demo lesson & aptitude format' },
  { prof: 'Marketing Manager',icon: '📣', hint: 'Campaign case & leadership rounds' },
  { prof: 'Full Stack Developer', icon: '🖥️', hint: 'Coding + system design' },
  { prof: 'Police / Defence', icon: '🪖', hint: 'SSB personality & GD rounds' },
];

const DIFFICULTIES: { label: string; value: Difficulty }[] = [
  { label: 'Beginner', value: 'beginner' },
  { label: 'Intermediate', value: 'intermediate' },
  { label: 'Expert', value: 'expert' },
];

const INTERVIEW_TYPES: { label: string; value: InterviewType }[] = [
  { label: 'Technical', value: 'Technical' },
  { label: 'Behavioral (HR)', value: 'Behavioral' },
  { label: 'Mixed', value: 'Mixed' },
];

const QUESTION_COUNTS = [
  { label: '3', value: '3' }, { label: '5', value: '5' },
  { label: '8', value: '8' }, { label: '10', value: '10' },
];

const TIMERS = [
  { label: 'No Timer', value: '0' }, { label: '2 min', value: '120' },
  { label: '3 min', value: '180' },  { label: '5 min', value: '300' },
];

// Voice "warm-up" — Easy build item. One short line per language so the
// preview button actually demonstrates the language it's previewing.
const VOICE_PREVIEW_SAMPLES: Record<'en' | 'hi' | 'hinglish', string> = {
  en:       "Tell me about a time you handled a challenging situation at work.",
  hi:       "मुझे बताइए कि आपने काम के दौरान किसी मुश्किल स्थिति को कैसे संभाला।",
  hinglish: "Apna experience batao ek challenging situation ke baare mein jo aapne kaam ke dauran handle ki.",
};

// ─── F29: Live preview builder ────────────────────────────────────────────────
function buildLivePreview(
  profession: string | null,
  difficulty: Difficulty | null,
  interviewType: InterviewType | null,
  totalQ: number | null,
): { line1: string; line2: string } | null {
  if (!profession) return null;
  const qStr = totalQ ? `${totalQ} questions` : '? questions';
  const line1 = [
    `Your session will have ${qStr} for`,
    profession,
    difficulty ? `· ${difficulty}` : '',
    interviewType ? `· ${interviewType}` : '',
  ].filter(Boolean).join(' ');

  let line2 = '';
  if (profession && difficulty && interviewType && totalQ) {
    const mins: Record<number, number> = { 3: 8, 5: 12, 8: 18, 10: 25 };
    line2 = `Estimated duration: ~${mins[totalQ] ?? 12} min. Aria will evaluate each answer instantly.`;
  } else {
    const missing: string[] = [];
    if (!difficulty) missing.push('difficulty');
    if (!interviewType) missing.push('question type');
    if (!totalQ) missing.push('question count');
    if (missing.length) line2 = `Still need: ${missing.join(', ')}.`;
  }
  return { line1, line2 };
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="block text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--text-3)' }}>
      {children}
    </label>
  );
}

// ─── F28: Step indicator component ───────────────────────────────────────────
function StepIndicator({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center gap-0 mb-6">
      {Array.from({ length: total }).map((_, i) => (
        <div key={i} className="flex items-center flex-1 last:flex-none">
          <div
            className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 transition-all duration-300 z-10"
            style={{
              background: i < current ? 'var(--accent)' : i === current ? 'var(--accent)' : 'var(--surface-2)',
              border: `1.5px solid ${i <= current ? 'var(--accent)' : 'var(--border2)'}`,
              color: i <= current ? '#fff' : 'var(--text-2)',
              boxShadow: i === current ? '0 0 0 3px var(--accent-dim)' : 'none',
            }}
          >
            {i < current ? '✓' : i + 1}
          </div>
          {i < total - 1 && (
            <div
              className="flex-1 h-px mx-1 transition-all duration-500"
              style={{ background: i < current ? 'var(--accent)' : 'var(--border2)' }}
            />
          )}
        </div>
      ))}
    </div>
  );
}

function InterviewSetupPageInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { user } = useAuthStore();
  const { showUpgradeModal } = useUIStore();
  const { data: meData } = useMe();
  const store = useInterviewStore();

  // ─── F28: Multi-step state ───────────────────────────────────────────────
  const [step, setStep] = useState(0); // 0=profession, 1=style, 2=review+start
  const [slideDir, setSlideDir] = useState<'forward' | 'back'>('forward');

  function goToStep(n: number) {
    setSlideDir(n > step ? 'forward' : 'back');
    setStep(n);
  }

  const [customProfession, setCustomProfession] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showJd, setShowJd] = useState(false);
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewMsg, setPreviewMsg] = useState<string | null>(null);
  const [hasPreviewedToday, setHasPreviewedToday] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Auto-detect low-end devices and default to voice-only mode.
  useEffect(() => {
    if (useInterviewStore.getState().config.avatarMode !== undefined) return;
    if (typeof window === 'undefined') return;
    const nav = navigator as Navigator & {
      deviceMemory?: number;
      connection?: { effectiveType?: string };
    };
    const isLowMemory  = (nav.deviceMemory ?? Infinity) < 2;
    const isSlow2G     = nav.connection?.effectiveType === '2g';
    if (isLowMemory || isSlow2G) useInterviewStore.getState().setAvatarMode('voice-only');
  }, []);

  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        URL.revokeObjectURL(audioRef.current.src);
      }
    };
  }, []);

  useEffect(() => {
    const profession = params.get('profession');
    const mode = params.get('mode') as SessionMode | null;
    const difficulty = params.get('difficulty') as Difficulty | null;
    const interviewType = params.get('interview_type') as InterviewType | null;
    const s = useInterviewStore.getState();
    if (profession) s.setProfession(profession);
    if (mode) s.setMode(mode);
    if (difficulty) s.setDifficulty(difficulty);
    if (interviewType) s.setInterviewType(interviewType);
  }, [params]);

  useEffect(() => {
    if (!meData?.session_defaults) return;
    if (params.get('profession')) return;
    if (useInterviewStore.getState().config.profession) return;
    const { profession, difficulty, interview_type } = meData.session_defaults;
    const s = useInterviewStore.getState();
    if (profession) s.setProfession(profession);
    if (difficulty) s.setDifficulty(difficulty as Difficulty);
    if (interview_type) s.setInterviewType(interview_type as InterviewType);
  }, [meData?.session_defaults, params]);

  const livePlan    = meData?.user?.plan ?? user?.plan;
  const isFree      = !livePlan || (livePlan !== 'pro' && livePlan !== 'elite');
  const hasVoiceQuota = livePlan === 'starter' || livePlan === 'pro' || livePlan === 'elite';
  const aiCallsLeft = useAuthStore((s) => s.aiCallsLeft());

  const sessionCount = meData?.usage?.session_count ?? 0;
  const sessionLimit = meData?.usage?.session_limit ?? null;
  const isFreeSessionCapReached = isFree && sessionLimit !== null && sessionCount >= sessionLimit;

  const isLocked = isFree && (aiCallsLeft <= 0 || isFreeSessionCapReached);
  const selectedProfession = store.config.profession;

  function selectProfession(p: string) {
    store.setProfession(p);
    setCustomProfession('');
  }

  async function playVoicePreview() {
    if (previewLoading) return;
    setPreviewLoading(true);
    setPreviewMsg(null);
    const sample = VOICE_PREVIEW_SAMPLES[store.config.lang];
    if (!hasVoiceQuota && hasPreviewedToday && audioRef.current && audioRef.current.dataset.lang === store.config.lang) {
      setPreviewLoading(false);
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch(() => {});
      return;
    }
    if (!hasVoiceQuota) {
      const result = await voiceApi.ttsWarmup(sample);
      setPreviewLoading(false);
      if (!result.ok) {
        if (result.reason === 'already_used_today') {
          setPreviewMsg("You've already used today's free preview — upgrade to Pro for unlimited HD voice, or come back tomorrow.");
        } else if (result.reason === 'not_configured') {
          setPreviewMsg('Voice preview is temporarily unavailable.');
        } else {
          setPreviewMsg('Could not play preview — please try again.');
        }
        return;
      }
      setHasPreviewedToday(true);
      playBlob(result.blob, store.config.lang);
      return;
    }
    const blob = await voiceApi.tts(sample, store.config.lang);
    setPreviewLoading(false);
    if (!blob) {
      setPreviewMsg('Could not play preview — please try again.');
      return;
    }
    playBlob(blob, store.config.lang);
  }

  function playBlob(blob: Blob, lang: string) {
    if (audioRef.current) {
      audioRef.current.pause();
      URL.revokeObjectURL(audioRef.current.src);
    }
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.dataset.lang = lang;
    audioRef.current = audio;
    audio.play().catch(() => setPreviewMsg('Could not play preview — please try again.'));
  }

  async function handleStart() {
    if (isLocked) { showUpgradeModal('limit_hit'); return; }
    const profession = customProfession.trim() || selectedProfession;
    if (!profession) { setError('Please select or type a profession / field.'); return; }
    setError('');
    setStarting(true);
    store.setProfession(profession);
    store.startSession();
    router.push('/interview/session');
    setStarting(false);
  }

  // ─── F29: Live preview ────────────────────────────────────────────────────
  const livePreview = buildLivePreview(
    customProfession.trim() || selectedProfession || null,
    store.config.difficulty ?? null,
    store.config.interviewType ?? null,
    store.config.totalQ ?? null,
  );

  // Step 1 is complete when profession is picked
  const step1Complete = !!(customProfession.trim() || selectedProfession);
  // Step 2 is complete when difficulty + type + count are set
  const step2Complete = !!(store.config.difficulty && store.config.interviewType && store.config.totalQ);

  return (
    <div className="p-4 sm:p-6 max-w-2xl mx-auto space-y-6">

      {isLocked && (
        <Card className="p-6 text-center" style={{ borderColor: 'var(--error-border)' }}>
          <div className="text-3xl mb-3">🔒</div>
          <h3 className="text-lg font-bold mb-2" style={{ color: 'var(--text-1)' }}>
            {isFreeSessionCapReached
              ? `You've used all ${sessionLimit} free sessions this month`
              : "You've used all your free AI calls this month"}
          </h3>
          <p className="text-sm mb-4" style={{ color: 'var(--text-3)' }}>
            {meData?.usage?.resets_at
              ? `Your sessions reset on ${new Date(meData.usage.resets_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'long' })}.`
              : 'Your sessions reset at the start of next month.'
            }{' '}
            Upgrade to Pro for unlimited AI interviews, full history, and advanced analytics.
          </p>
          <Button variant="upgrade" onClick={() => showUpgradeModal('limit_hit')}>
            Upgrade to Pro — ₹699/month
          </Button>
        </Card>
      )}

      <div>
        <h1 className="text-2xl font-bold" style={{ color: 'var(--text-1)' }}>Set Up Your Interview</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--text-3)' }}>
          Choose your field and mode — AI Chat is the most realistic practice available.
        </p>
      </div>

      {/* ─── F28: Step indicator ─────────────────────────────────────────── */}
      <StepIndicator current={step} total={3} />

      {/* ─── Step 0: Profession ──────────────────────────────────────────── */}
      {step === 0 && (
        <div
          key={step}
          className="space-y-5"
          style={{
            animation: slideDir === 'forward'
              ? 'slideInRight 0.28s cubic-bezier(.22,.68,0,1.2) both'
              : 'slideInLeft 0.28s cubic-bezier(.22,.68,0,1.2) both',
          }}
        >
          {/* ─── F27: Profession picker cards ─────────────────────────── */}
          <Card className="p-5">
            <SectionLabel>Profession / Field</SectionLabel>
            <div
              className="grid gap-3 mb-4"
              style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}
            >
              {PROFESSION_CARDS.map((card) => {
                const isSelected = selectedProfession === card.prof && !customProfession;
                return (
                  <button
                    key={card.prof}
                    onClick={() => selectProfession(card.prof)}
                    className="relative rounded-2xl p-4 flex flex-col items-center gap-2 text-center cursor-pointer transition-all duration-200 border"
                    style={{
                      background: isSelected ? 'var(--accent-dim)' : 'var(--surface-2)',
                      borderColor: isSelected ? 'var(--accent-border)' : 'var(--border2)',
                      transform: isSelected ? 'translateY(-2px)' : 'none',
                      boxShadow: isSelected ? '0 4px 16px rgba(var(--accent-rgb, 99,102,241),.18)' : 'none',
                    }}
                  >
                    {/* Checkmark */}
                    <span
                      className="absolute top-2 right-2 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold transition-all duration-200"
                      style={{
                        background: isSelected ? 'var(--accent)' : 'var(--border)',
                        color: '#fff',
                        opacity: isSelected ? 1 : 0,
                        transform: isSelected ? 'scale(1)' : 'scale(0)',
                      }}
                    >
                      ✓
                    </span>
                    <div className="text-2xl">{card.icon}</div>
                    <div className="text-xs font-semibold leading-tight" style={{ color: 'var(--text-1)' }}>{card.prof}</div>
                    <div className="text-[10px] leading-snug" style={{ color: 'var(--text-3)' }}>{card.hint}</div>
                  </button>
                );
              })}
            </div>
            <Input
              placeholder="Or type any field — MBA, Nurse, IAS Officer, CA…"
              value={customProfession}
              onChange={(e) => { setCustomProfession(e.target.value); if (e.target.value) store.setProfession(''); }}
            />
          </Card>

          {/* Mode */}
          <Card className="p-5">
            <SectionLabel>Interview Mode</SectionLabel>
            <div className="grid grid-cols-2 gap-3">
              {[
                { value: 'classic', emoji: '📝', title: 'Classic Mode', desc: 'One question at a time. Detailed per-answer feedback with English corrections.' },
                { value: 'chat',    emoji: '💬', title: 'AI Chat Mode', desc: 'Natural back-and-forth with an AI interviewer. Most realistic experience.' },
              ].map((m) => {
                const isActive = store.config.mode === m.value;
                return (
                  <button
                    key={m.value}
                    onClick={() => store.setMode(m.value as SessionMode)}
                    className="p-4 rounded-xl border text-left transition-all duration-200"
                    style={isActive
                      ? { borderColor: 'var(--accent-border)', background: 'var(--accent-dim)' }
                      : { borderColor: 'var(--border)', background: 'var(--surface-2)' }}
                  >
                    <div className="text-2xl mb-2">{m.emoji}</div>
                    <div className="text-sm font-semibold mb-1" style={{ color: 'var(--text-1)' }}>{m.title}</div>
                    <div className="text-xs leading-snug" style={{ color: 'var(--text-3)' }}>{m.desc}</div>
                  </button>
                );
              })}
            </div>
          </Card>

          {/* F28: Next button */}
          <div className="flex justify-end">
            <Button
              disabled={!step1Complete}
              onClick={() => goToStep(1)}
            >
              Choose Style →
            </Button>
          </div>
        </div>
      )}

      {/* ─── Step 1: Style ───────────────────────────────────────────────── */}
      {step === 1 && (
        <div
          key={step}
          className="space-y-4"
            <ChipGroup options={DIFFICULTIES} value={store.config.difficulty} onChange={(v) => store.setDifficulty(v as Difficulty)} />
          </Card>

          <Card className="p-5">
            <SectionLabel>Interview Type</SectionLabel>
            <ChipGroup options={INTERVIEW_TYPES} value={store.config.interviewType} onChange={(v) => store.setInterviewType(v as InterviewType)} />
          </Card>

          {store.config.mode === 'classic' && (
            <>
              <Card className="p-5">
                <SectionLabel>Number of Questions</SectionLabel>
                <ChipGroup options={QUESTION_COUNTS} value={String(store.config.totalQ)} onChange={(v) => store.setTotalQ(Number(v))} />
              </Card>
              <Card className="p-5">
                <SectionLabel>Time per Question</SectionLabel>
                <ChipGroup options={TIMERS} value={String(store.config.timerSecs)} onChange={(v) => store.setTimerSecs(Number(v))} />
              </Card>
            </>
          )}

          <Card className="p-5">
            <SectionLabel>
              Interview Language{' '}
              <span
                className="ml-2 text-[9px] rounded px-1.5 py-0.5 normal-case tracking-normal"
                style={{ background: 'var(--blue-dim)', color: 'var(--accent)', border: '1px solid var(--blue-border)' }}
              >
                UNIQUE IN INDIA
              </span>
            </SectionLabel>
            <p className="text-xs mb-3" style={{ color: 'var(--text-3)' }}>AI + voice input adapts to your chosen language</p>
            <div className="grid grid-cols-3 gap-2">
              {[
                { lang: 'en',      flag: '🇬🇧', label: 'English' },
                { lang: 'hi',      flag: '🇮🇳', label: 'हिंदी' },
                { lang: 'hinglish',flag: '🇮🇳', label: 'Hinglish' },
              ].map((l) => {
                const isActive = store.config.lang === l.lang;
                return (
                  <button
                    key={l.lang}
                    onClick={() => { store.setLang(l.lang as 'en' | 'hi' | 'hinglish'); setPreviewMsg(null); }}
                    className="p-4 rounded-xl border text-left transition-all duration-200"
                    style={isActive
                      ? { borderColor: 'var(--accent-border)', background: 'var(--accent-dim)' }
                      : { borderColor: 'var(--border)', background: 'var(--surface-2)' }}
                  >
                    <div className="text-lg text-center">{l.flag}</div>
                    <div className="text-xs text-center mt-1" style={{ color: 'var(--text-1)' }}>{l.label}</div>
                  </button>
                );
              })}
            </div>
            <div className="mt-3 pt-3 border-t" style={{ borderColor: 'var(--border)' }}>
              <button
                type="button"
                onClick={playVoicePreview}
                disabled={previewLoading}
                className="text-xs font-semibold px-3 py-2 rounded-lg border transition-colors disabled:opacity-60 flex items-center gap-2"
                style={{ borderColor: 'var(--blue-border)', background: 'var(--blue-dim)', color: 'var(--accent)' }}
              >
                {previewLoading ? <>🔊 Loading preview…</> : !hasVoiceQuota && hasPreviewedToday ? <>🔊 Replay preview</> : <>🔊 Preview HD voice {!hasVoiceQuota ? '(free taste)' : ''}</>}
              </button>
              {previewMsg && (<p className="text-xs mt-2" style={{ color: 'var(--text-3)' }}>{previewMsg}</p>)}
            </div>
          </Card>

          {/* JD paste */}
          <div>
            <button
              onClick={() => { setShowJd(!showJd); if (showJd) store.setJdText(''); }}
              className="text-sm flex items-center gap-2 transition-colors"
              style={{ color: 'var(--text-3)' }}
            >
              <span>📋</span>
              {showJd ? 'Remove job description' : 'Paste a job description (optional)'}
            </button>
            {showJd && (
              <div className="mt-3">
                <Card className="p-5">
                  <SectionLabel>Job Description</SectionLabel>
                  <p className="text-xs mb-3" style={{ color: 'var(--text-3)' }}>
                    AI will generate questions tailored to this specific role instead of generic ones.
                  </p>
                  <textarea
                    value={store.config.jdText ?? ''}
                    onChange={(e) => store.setJdText(e.target.value.slice(0, 4_000))}
                    placeholder="Paste the job description here…"
                    rows={6}
                    maxLength={4_000}
                    className="w-full px-4 py-3 rounded-xl border text-sm resize-y focus:outline-none transition-colors"
                    style={{
                      background: 'var(--surface-2)',
                      borderColor: store.config.jdText ? 'var(--accent-border)' : 'var(--border)',
                      color: 'var(--text-1)',
                    }}
                    onFocus={e  => (e.currentTarget.style.borderColor = 'var(--accent-border)')}
                    onBlur={e   => (e.currentTarget.style.borderColor = store.config.jdText ? 'var(--accent-border)' : 'var(--border)')}
                  />
                  <p className="text-xs mt-2" style={{ color: 'var(--text-3)' }}>
                    {store.config.jdText
                      ? `✓ ${store.config.jdText.length.toLocaleString()} / 4,000 chars — questions will be tailored to this JD`
                      : 'Supports English, Hindi, or mixed — paste any JD'}
                  </p>
                </Card>
              </div>
            )}
          </div>

          {/* Voice-only toggle */}
          <div
            className="flex items-center justify-between rounded-xl px-4 py-3 border"
            style={{ background: 'var(--surface-2)', borderColor: 'var(--border)' }}
          >
            <div>
              <p className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>📵 Voice only (saves data)</p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>Disables the AI avatar — audio only. Best for 2G / low-memory devices.</p>
            </div>
            <button
              role="switch"
              aria-checked={store.config.avatarMode === 'voice-only'}
              onClick={() => store.setAvatarMode(store.config.avatarMode === 'voice-only' ? 'full' : 'voice-only')}
              className="relative flex-shrink-0 w-11 h-6 rounded-full border-2 transition-colors duration-200 focus:outline-none"
              style={{
                background: store.config.avatarMode === 'voice-only' ? 'var(--accent)' : 'var(--surface-3, #d1d5db)',
                borderColor: store.config.avatarMode === 'voice-only' ? 'var(--accent)' : 'var(--border)',
              }}
            >
              <span
                className="block w-4 h-4 rounded-full bg-white shadow transition-transform duration-200"
                style={{
                  transform: store.config.avatarMode === 'voice-only' ? 'translateX(20px)' : 'translateX(2px)',
                  marginTop: '1px',
                }}
              />
            </button>
          </div>

          <div className="flex gap-3">
            <Button variant="secondary" onClick={() => goToStep(0)}>← Back</Button>
            <Button className="flex-1" disabled={!step2Complete} onClick={() => goToStep(2)}>Review →</Button>
          </div>
        </div>
      )}

      {/* ─── Step 2: Review + Start ──────────────────────────────────────── */}
      {step === 2 && (
        <div
          key={step}
          className="space-y-4"
          style={{
            animation: slideDir === 'forward'
              ? 'slideInRight 0.28s cubic-bezier(.22,.68,0,1.2) both'
              : 'slideInLeft 0.28s cubic-bezier(.22,.68,0,1.2) both',
          }}
        >
          {/* ─── F29: Live preview card ───────────────────────────────────── */}
          {livePreview && (
            <Card
              className="p-5 transition-all duration-300"
              style={{
                background: 'var(--blue-dim)',
                borderColor: 'var(--blue-border)',
              }}
            >
              <div className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: 'var(--accent)' }}>
                Session Preview
              </div>
              <p className="text-sm font-medium leading-relaxed mb-1" style={{ color: 'var(--text-1)' }}>
                {livePreview.line1.split(' ').map((word, i) => {
                  // Highlight profession, difficulty, type tokens
                  const isProfession = word === (customProfession.trim() || selectedProfession);
                  const isDiff = store.config.difficulty && word.includes(store.config.difficulty);
                  const isType = store.config.interviewType && word.includes(store.config.interviewType);
                  if (isProfession || isDiff || isType) {
                    return (
                      <span key={i} className="inline-block px-1.5 py-0.5 rounded mx-0.5 text-xs font-bold"
                        style={{ background: 'var(--accent)', color: '#fff' }}>
                        {word}
                      </span>
                    );
                  }
                  return <span key={i}>{word} </span>;
                })}
              </p>
              {livePreview.line2 && (
                <p className="text-xs" style={{ color: 'var(--text-3)' }}>{livePreview.line2}</p>
              )}
            </Card>
          )}

          {/* Review summary */}
          <Card className="p-5 space-y-3">
            <SectionLabel>Your Setup</SectionLabel>
            {[
              { label: 'Profession', value: customProfession.trim() || selectedProfession || '—' },
              { label: 'Mode', value: store.config.mode === 'chat' ? 'AI Chat Mode' : 'Classic Mode' },
              { label: 'Difficulty', value: store.config.difficulty || '—' },
              { label: 'Type', value: store.config.interviewType || '—' },
              ...(store.config.mode === 'classic' ? [
                { label: 'Questions', value: `${store.config.totalQ}` },
                { label: 'Timer', value: store.config.timerSecs ? `${store.config.timerSecs / 60} min` : 'No Timer' },
              ] : []),
              { label: 'Language', value: store.config.lang === 'hi' ? 'हिंदी' : store.config.lang === 'hinglish' ? 'Hinglish' : 'English' },
            ].map(({ label, value }) => (
              <div key={label} className="flex items-center justify-between">
                <span className="text-xs" style={{ color: 'var(--text-3)' }}>{label}</span>
                <span className="text-xs font-semibold" style={{ color: 'var(--text-1)' }}>{value}</span>
              </div>
            ))}
            <button
              onClick={() => goToStep(0)}
              className="text-xs mt-2 transition-colors"
              style={{ color: 'var(--accent)' }}
            >
              ✏ Edit profession / mode
            </button>
            {' · '}
            <button
              onClick={() => goToStep(1)}
              className="text-xs transition-colors"
              style={{ color: 'var(--accent)' }}
            >
              ✏ Edit style
            </button>
          </Card>

          {FLAG.HUMANIZED_COACH_PROMPT && (
            <div
              className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium"
              style={{ background: 'var(--accent-dim)', color: 'var(--accent)', border: '1px solid var(--accent-border)' }}
            >
              <span aria-hidden>✨</span>
              Smart coaching active — Aria adapts her feedback style to your confidence
            </div>
          )}

          {error && (
            <p className="text-sm rounded-xl px-4 py-3" style={{ color: 'var(--error)', background: 'var(--error-dim)', border: '1px solid var(--error-border)' }}>
              {error}
            </p>
          )}

          <div className="flex gap-3">
            <Button variant="secondary" onClick={() => goToStep(1)}>← Back</Button>
            <Button
              size="lg"
              className="flex-1"
              loading={starting}
              disabled={isLocked || (!customProfession.trim() && !selectedProfession)}
              onClick={handleStart}
              style={step1Complete && step2Complete ? {
                boxShadow: '0 0 0 3px var(--accent-dim), 0 4px 20px rgba(99,102,241,.3)',
              } : undefined}
            >
              🎙 Start Interview
            </Button>
          </div>
        </div>
      )}

      {/* Slide animation keyframes */}
      <style>{`
        @keyframes slideInRight {
          from { opacity: 0; transform: translateX(32px); }
          to   { opacity: 1; transform: translateX(0); }
        }
        @keyframes slideInLeft {
          from { opacity: 0; transform: translateX(-32px); }
          to   { opacity: 1; transform: translateX(0); }
        }
        @media (max-width: 480px) {
          .pp27-grid { grid-template-columns: repeat(2, 1fr) !important; }
        }
      `}</style>
    </div>
  );
}

export default function InterviewSetupPage() {
  return (
    <Suspense fallback={<div />}>
      <InterviewSetupPageInner />
    </Suspense>
  );
}
