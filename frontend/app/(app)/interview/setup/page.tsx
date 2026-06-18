'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, Suspense } from 'react';
import { useInterviewStore } from '@/store/interview';
import { useAuthStore } from '@/store/auth';
import { useUIStore } from '@/store/ui';
import { useMe } from '@/hooks/queries';
import { Button, Card, ChipGroup, Input } from '@/components/ui';
import { Difficulty, InterviewType, SessionMode } from '@/types';

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

  useEffect(() => {
    const profession = params.get('profession');
    const mode = params.get('mode') as SessionMode | null;
    if (profession) store.setProfession(profession);
    if (mode) store.setMode(mode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  // Use live /me plan so an upgrade takes effect without a page refresh.
  const livePlan    = meData?.user?.plan ?? user?.plan;
  const isFree      = !livePlan || (livePlan !== 'pro' && livePlan !== 'elite');
  const aiCallsLeft = useAuthStore((s) => s.aiCallsLeft());
  const isLocked    = isFree && aiCallsLeft <= 0;
  const selectedProfession = store.config.profession;

  function selectProfession(p: string) {
    store.setProfession(p);
    setCustomProfession('');
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
            Upgrade to Pro — ₹299/month
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
                style={{ background: 'var(--violet-dim)', color: 'var(--violet)', border: '1px solid var(--violet-border)' }}
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
                <SelectBtn key={l.lang} active={store.config.lang === l.lang} onClick={() => store.setLang(l.lang as 'en' | 'hi' | 'hinglish')}>
                  <div className="text-lg text-center">{l.flag}</div>
                  <div className="text-xs text-center mt-1" style={{ color: 'var(--text-1)' }}>{l.label}</div>
                </SelectBtn>
              ))}
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
