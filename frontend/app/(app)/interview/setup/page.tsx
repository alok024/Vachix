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

const PROFESSIONS = [
  'Software Developer', 'Java Developer', 'Government Job (SSC/UPSC)',
  'Data Scientist', 'Doctor / Medical', 'Teacher', 'Bank PO',
  'Marketing Manager', 'Full Stack Developer', 'Police / Defence',
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
// preview button actually demonstrates the language it's previewing,
// not just a generic English sentence read in an accent.
const VOICE_PREVIEW_SAMPLES: Record<'en' | 'hi' | 'hinglish', string> = {
  en:       "Tell me about a time you handled a challenging situation at work.",
  hi:       "मुझे बताइए कि आपने काम के दौरान किसी मुश्किल स्थिति को कैसे संभाला।",
  hinglish: "Apna experience batao ek challenging situation ke baare mein jo aapne kaam ke dauran handle ki.",
};

// Reusable inline selection button
function SelectBtn({
  active, onClick, children,
}: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="p-4 rounded-xl border text-left transition-all duration-200"
      style={active
        ? { borderColor: 'var(--accent-border)', background: 'var(--accent-dim)' }
        : { borderColor: 'var(--border)', background: 'var(--surface-2)' }}
      onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.borderColor = 'var(--border2)'; }}
      onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)'; }}
    >
      {children}
    </button>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="block text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--text-3)' }}>
      {children}
    </label>
  );
}

function InterviewSetupPageInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { user } = useAuthStore();
  const { showUpgradeModal } = useUIStore();
  const { data: meData } = useMe();
  const store = useInterviewStore();

  const [customProfession, setCustomProfession] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewMsg, setPreviewMsg] = useState<string | null>(null);
  const [hasPreviewedToday, setHasPreviewedToday] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Stop any in-flight preview audio and revoke its object URL on unmount
  // — otherwise a user who navigates away mid-preview leaks the blob URL
  // and leaves audio playing in the background.
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
    if (profession) store.setProfession(profession);
    if (mode) store.setMode(mode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  // Fix (#13): session_defaults was computed by the backend on every
  // /api/me call but never consumed here — pre-fill the form from it so
  // a user's first session is already personalised, the same way the
  // backend intended. Only applies when nothing else has already set a
  // profession (an explicit ?profession= query param, or the user's own
  // selection, takes priority).
  useEffect(() => {
    if (!meData?.session_defaults) return;
    if (params.get('profession')) return;
    if (store.config.profession) return;

    const { profession, difficulty, interview_type } = meData.session_defaults;
    if (profession) store.setProfession(profession);
    if (difficulty) store.setDifficulty(difficulty as Difficulty);
    if (interview_type) store.setInterviewType(interview_type as InterviewType);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meData?.session_defaults]);

  // Use live /me plan so an upgrade takes effect without a page refresh.
  const livePlan    = meData?.user?.plan ?? user?.plan;
  const isFree      = !livePlan || (livePlan !== 'pro' && livePlan !== 'elite');
  // Starter (and above) gets the real, ledger-metered /tts endpoint
  // (VOICE_CAP_STARTER seconds/month) instead of the once-a-day free
  // taste — they're paying for capped HD voice, not a daily sample.
  const hasVoiceQuota = livePlan === 'starter' || livePlan === 'pro' || livePlan === 'elite';
  const aiCallsLeft = useAuthStore((s) => s.aiCallsLeft());
  const isLocked    = isFree && aiCallsLeft <= 0;
  const selectedProfession = store.config.profession;

  function selectProfession(p: string) {
    store.setProfession(p);
    setCustomProfession('');
  }

  // Voice "warm-up" — Easy build item. Free tier gets the once-per-IST-day
  // warm-up endpoint; Starter/Pro/Elite get the real (ledger-metered) TTS
  // endpoint since they're paying for HD voice, capped by plan (Starter
  // 10 min/mo, Pro 60 min/mo, Elite unlimited — see VOICE_CAP_* in env.ts).
  async function playVoicePreview() {
    if (previewLoading) return;
    setPreviewLoading(true);
    setPreviewMsg(null);

    const sample = VOICE_PREVIEW_SAMPLES[store.config.lang];

    // Already successfully fetched once this visit — replay the cached
    // audio instead of hitting the once-per-IST-day endpoint again.
    // (Switching language still needs a fresh fetch since the cached
    // blob is for the old language; hasPreviewedToday only short-circuits
    // a repeat tap of the same preview.)
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

    // Starter/Pro/Elite — real voice pipeline, language-aware (Sarvam for hi/hinglish).
    // Metered server-side by requireVoiceQuota; not unlimited below Elite.
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
    const profession = customProfession.trim() || selectedProfession;
    if (!profession) { setError('Please select or type a profession / field.'); return; }
    setError('');
    setStarting(true);
    store.setProfession(profession);
    store.startSession();
    router.push('/interview/session');
    setStarting(false);
  }

  return (
    <div className="p-4 sm:p-6 max-w-2xl mx-auto space-y-6">

      {isLocked && (
        <Card className="p-6 text-center" style={{ borderColor: 'var(--error-border)' }}>
          <div className="text-3xl mb-3">🔒</div>
          <h3 className="text-lg font-bold mb-2" style={{ color: 'var(--text-1)' }}>
            You've used all your free sessions
          </h3>
          <p className="text-sm mb-4" style={{ color: 'var(--text-3)' }}>
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

      {/* Mode */}
      <Card className="p-5">
        <SectionLabel>Interview Mode</SectionLabel>
        <div className="grid grid-cols-2 gap-3">
          {[
            { value: 'classic', emoji: '📝', title: 'Classic Mode', desc: 'One question at a time. Detailed per-answer feedback with English corrections.' },
            { value: 'chat',    emoji: '💬', title: 'AI Chat Mode', desc: 'Natural back-and-forth with an AI interviewer. Most realistic experience.' },
          ].map((m) => (
            <SelectBtn key={m.value} active={store.config.mode === m.value} onClick={() => store.setMode(m.value as SessionMode)}>
              <div className="text-2xl mb-2">{m.emoji}</div>
              <div className="text-sm font-semibold mb-1" style={{ color: 'var(--text-1)' }}>{m.title}</div>
              <div className="text-xs leading-snug" style={{ color: 'var(--text-3)' }}>{m.desc}</div>
            </SelectBtn>
          ))}
        </div>
      </Card>

      {/* Profession */}
      <Card className="p-5">
        <SectionLabel>Profession / Field</SectionLabel>
        <div className="flex flex-wrap gap-2 mb-3">
          {PROFESSIONS.map((p) => (
            <button
              key={p}
              onClick={() => selectProfession(p)}
              className="px-3 py-2 rounded-full text-xs font-semibold border transition-all"
              style={selectedProfession === p && !customProfession
                ? { background: 'var(--accent-dim)', borderColor: 'var(--accent-border)', color: 'var(--accent)' }
                : { background: 'var(--surface-2)', borderColor: 'var(--border)', color: 'var(--text-2)' }}
              onMouseEnter={e => { if (!(selectedProfession === p && !customProfession)) (e.currentTarget as HTMLElement).style.borderColor = 'var(--border2)'; }}
              onMouseLeave={e => { if (!(selectedProfession === p && !customProfession)) (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)'; }}
            >
              {p}
            </button>
          ))}
        </div>
        <Input
          placeholder="Or type any field — MBA, Nurse, IAS Officer, CA…"
          value={customProfession}
          onChange={(e) => setCustomProfession(e.target.value)}
        />
      </Card>

      {/* Difficulty */}
      <Card className="p-5">
        <SectionLabel>Difficulty</SectionLabel>
        <ChipGroup options={DIFFICULTIES} value={store.config.difficulty} onChange={(v) => store.setDifficulty(v as Difficulty)} />
      </Card>

      {/* Advanced toggle */}
      <button
        onClick={() => setShowAdvanced(!showAdvanced)}
        className="text-sm flex items-center gap-2 transition-colors"
        style={{ color: 'var(--text-3)' }}
        onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-2)')}
        onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-3)')}
      >
        <span>⚙</span>
        {showAdvanced ? 'Hide advanced options' : 'Show advanced options'}
      </button>

      {showAdvanced && (
        <div className="space-y-4">
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
              ].map((l) => (
                <SelectBtn key={l.lang} active={store.config.lang === l.lang} onClick={() => { store.setLang(l.lang as 'en' | 'hi' | 'hinglish'); setPreviewMsg(null); }}>
                  <div className="text-lg text-center">{l.flag}</div>
                  <div className="text-xs text-center mt-1" style={{ color: 'var(--text-1)' }}>{l.label}</div>
                </SelectBtn>
              ))}
            </div>

            {/* Voice "warm-up" — Easy build item. ~30s HD voice taste,
                available on Free tier too (once/day server-side gate);
                Starter+ get the real metered endpoint instead. */}
            <div className="mt-3 pt-3 border-t" style={{ borderColor: 'var(--border)' }}>
              <button
                type="button"
                onClick={playVoicePreview}
                disabled={previewLoading}
                className="text-xs font-semibold px-3 py-2 rounded-lg border transition-colors disabled:opacity-60 flex items-center gap-2"
                style={{ borderColor: 'var(--blue-border)', background: 'var(--blue-dim)', color: 'var(--accent)' }}
              >
                {previewLoading ? (
                  <>🔊 Loading preview…</>
                ) : !hasVoiceQuota && hasPreviewedToday ? (
                  <>🔊 Replay preview</>
                ) : (
                  <>🔊 Preview HD voice {!hasVoiceQuota ? '(free taste)' : ''}</>
                )}
              </button>
              {previewMsg && (
                <p className="text-xs mt-2" style={{ color: 'var(--text-3)' }}>{previewMsg}</p>
              )}
            </div>
          </Card>
        </div>
      )}

      {error && (
        <p className="text-sm rounded-xl px-4 py-3" style={{ color: 'var(--error)', background: 'var(--error-dim)', border: '1px solid var(--error-border)' }}>
          {error}
        </p>
      )}

      <Button
        size="lg"
        className="w-full"
        loading={starting}
        disabled={isLocked}
        onClick={handleStart}
      >
        ▶ Start Interview
      </Button>
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
