'use client';

/**
 * app/(app)/english/page.tsx — Elara English Coach
 *
 * Tier behaviour:
 *
 *   Free     — text chat only. No mic, no TTS. All four modes.
 *              Corrections shown as inline diff cards (no persistence).
 *
 *   Pro+     — voice-enabled. Mic + TTS. Scores persisted to elara_sessions
 *              after conversation ends. Vocab tracker active: errors tracked
 *              automatically, user can tap any error to manually save it.
 *              Vocab sidebar shows saved words. System prompt injected with
 *              top-10 weak words at conversation start.
 *
 *   Elite    — everything Pro has + Hinglish toggle.
 *
 * STS (Speech-to-Speech) mode — Pro+ only, for testing:
 *   Toggle via the 🎙 STS button next to the mic.
 *   When ON: mic tap → STT captures speech → auto-submits → Elara speaks
 *   the full reply aloud (not just corrections).
 *   When OFF: original behaviour (mic fills input, user manually sends).
 *
 * End Session / Debrief:
 *   "End Session" button replaces the Reset button in the chat header.
 *   Calls POST /api/elara/debrief with the session's answer entries,
 *   shows a structured report (scores, error patterns, focus area), and
 *   speaks the summary aloud if STS mode is on.
 *   "Reset" (RotateCcw icon) still available for mid-session restart
 *   without generating a report.
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { Button, Card, CardHeader, CardBody, Badge, ChipGroup, Spinner } from '@/components/ui';
import { useAuthStore } from '@/store/auth';
import { aiApi } from '@/features/ai/api';
import { elaraApi, type VocabWord, type VocabError, type DebriefResult } from '@/features/elara/api';
import { useElaraVoice } from '@/features/elara/useElaraVoice';
import { getElaraSystemPrompt, parseElaraResponse, getLiveFeedback, type ElaraMode } from '@/lib/interview-prompts';
import { Send, RotateCcw, Mic, MicOff, BookMarked, Plus, X } from 'lucide-react';

const MODE_OPTIONS: { label: string; value: ElaraMode }[] = [
  { label: '💬 Conversation', value: 'conversation' },
  { label: '📚 Topics',       value: 'topics' },
  { label: '📝 Correction',   value: 'correction' },
  { label: '🔤 Vocabulary',   value: 'vocabulary' },
];

const TOPICS = ['Daily life', 'Work & career', 'Technology', 'Current affairs', 'Travel', 'Health & fitness', 'Family', 'Education'];

const MAX_ANSWER_LENGTH = 2_000;

interface ChatMsg {
  role: 'user' | 'assistant';
  content: string;
  analysis?: ReturnType<typeof parseElaraResponse>['analysis'];
}

function ElaraAvatar({ size = 28 }: { size?: number }) {
  return (
    <div
      className="flex-shrink-0 rounded-full flex items-center justify-center font-bold text-white"
      style={{ width: size, height: size, fontSize: size * 0.4, background: 'var(--blue)' }}
    >
      E
    </div>
  );
}

function buildCorrectionScript(errors: Array<{ wrong: string; correct: string; rule?: string }>): string {
  if (!errors.length) return '';
  return errors.slice(0, 3)
    .map(e => `Instead of "${e.wrong}", say "${e.correct}".${e.rule ? ` ${e.rule}` : ''}`)
    .join(' ');
}

// ── Vocab sidebar ─────────────────────────────────────────────────────────

function VocabSidebar({
  words,
  onClose,
}: {
  words: VocabWord[];
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-y-0 right-0 w-72 z-30 flex flex-col border-l shadow-xl"
      style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
    >
      <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: 'var(--border)' }}>
        <span className="text-sm font-bold flex items-center gap-2" style={{ color: 'var(--text-1)' }}>
          <BookMarked className="w-4 h-4" style={{ color: 'var(--accent)' }} />
          My Vocab List
        </span>
        <button onClick={onClose} style={{ color: 'var(--text-3)' }}><X className="w-4 h-4" /></button>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
        {words.length === 0 && (
          <p className="text-xs text-center py-8" style={{ color: 'var(--text-3)' }}>
            Tap any correction card to save a word. Words you repeat 3+ times are auto-saved.
          </p>
        )}
        {words.map((w, i) => (
          <div
            key={w.id ?? i}
            className="rounded-xl px-3 py-2 border"
            style={{ background: 'var(--surface-2)', borderColor: 'var(--border)' }}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium" style={{ color: 'var(--error)', textDecoration: 'line-through' }}>
                {w.wrong_form}
              </span>
              <span
                className="text-[9px] font-bold px-1.5 py-0.5 rounded"
                style={w.auto_saved
                  ? { background: 'var(--accent-dim)', color: 'var(--accent)' }
                  : { background: 'var(--surface-3)', color: 'var(--text-3)' }
                }
              >
                {w.auto_saved ? `×${w.occurrences}` : '✓'}
              </span>
            </div>
            <div className="text-xs mt-0.5 font-semibold" style={{ color: 'var(--success)' }}>
              → {w.correct_form}
            </div>
            {w.rule && (
              <div className="text-[10px] mt-0.5" style={{ color: 'var(--text-3)' }}>{w.rule}</div>
            )}
          </div>
        ))}
      </div>

      <div className="px-4 py-3 border-t text-[10px]" style={{ borderColor: 'var(--border)', color: 'var(--text-3)' }}>
        Words flagged 3+ times are auto-saved. Elara will reinforce them in future sessions.
      </div>
    </div>
  );
}

// ── Debrief report ────────────────────────────────────────────────────────

function DebriefReport({
  result,
  avgGrammar,
  avgFluency,
  avgVocab,
  onNewSession,
}: {
  result: DebriefResult;
  avgGrammar: number | null;
  avgFluency: number | null;
  avgVocab: number | null;
  onNewSession: () => void;
}) {
  return (
    <div style={{ padding: '24px 16px', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--text-1)' }}>
        Session Report
      </h3>

      {/* Summary */}
      <div style={{ background: 'var(--surface-2)', borderRadius: 10, padding: '14px 16px', border: '1px solid var(--border)' }}>
        <p style={{ margin: 0, color: 'var(--text-1)', lineHeight: 1.6, fontSize: 14 }}>
          {result.summary}
        </p>
      </div>

      {/* Score tiles */}
      <div style={{ display: 'flex', gap: 10 }}>
        {[
          { label: 'Grammar', val: avgGrammar, color: 'var(--success)' },
          { label: 'Fluency', val: avgFluency, color: 'var(--accent)' },
          { label: 'Vocab',   val: avgVocab,   color: 'var(--warn)' },
        ].map(({ label, val, color }) => (
          <div
            key={label}
            style={{
              flex: 1,
              background: 'var(--surface-2)',
              borderRadius: 10,
              padding: '10px 12px',
              textAlign: 'center',
              border: '1px solid var(--border)',
            }}
          >
            <div style={{ fontSize: 22, fontWeight: 700, color }}>
              {val != null ? `${val}/10` : '—'}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>{label}</div>
          </div>
        ))}
        <div
          style={{
            flex: 1,
            background: 'var(--surface-2)',
            borderRadius: 10,
            padding: '10px 12px',
            textAlign: 'center',
            border: '1px solid var(--border)',
          }}
        >
          <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-1)' }}>
            {result.filler_count}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>Fillers</div>
        </div>
      </div>

      {/* Error patterns */}
      {result.top_patterns.length > 0 && (
        <div>
          <p style={{ margin: '0 0 8px', fontSize: 12, fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Patterns to Fix
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {result.top_patterns.map((p, i) => (
              <div
                key={i}
                style={{
                  background: 'var(--error-dim)',
                  border: '1px solid var(--error-border)',
                  borderRadius: 8,
                  padding: '10px 14px',
                  display: 'flex',
                  gap: 10,
                  alignItems: 'flex-start',
                }}
              >
                <span style={{ color: 'var(--error)', fontWeight: 700, fontSize: 14, flexShrink: 0 }}>
                  #{i + 1}
                </span>
                <span style={{ color: 'var(--text-1)', fontSize: 14, lineHeight: 1.4 }}>{p}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Focus next */}
      <div
        style={{
          background: 'var(--surface-2)',
          borderRadius: 10,
          padding: '14px 16px',
          borderLeft: '3px solid var(--accent)',
          border: '1px solid var(--border)',
          borderLeftWidth: 3,
          borderLeftColor: 'var(--accent)',
        }}
      >
        <p style={{ margin: '0 0 6px', fontSize: 12, fontWeight: 600, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Focus Next Session
        </p>
        <p style={{ margin: 0, color: 'var(--text-1)', fontSize: 14, lineHeight: 1.5 }}>
          {result.focus_next}
        </p>
      </div>

      {/* Vocab range */}
      <p style={{ margin: 0, fontSize: 13, color: 'var(--text-3)', textAlign: 'center' }}>
        Vocabulary range:{' '}
        <strong style={{ color: 'var(--text-1)', textTransform: 'capitalize' }}>
          {result.vocab_range}
        </strong>
      </p>

      <Button onClick={onNewSession}>
        Start New Session
      </Button>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────

export default function EnglishPage() {
  const { user } = useAuthStore();

  const [mode,        setMode]        = useState<ElaraMode>('conversation');
  const [topic,       setTopic]       = useState('Daily life');
  const [messages,    setMessages]    = useState<ChatMsg[]>([]);
  const [input,       setInput]       = useState('');
  const [loading,     setLoading]     = useState(false);
  const [avgGrammar,  setAvgGrammar]  = useState<number | null>(null);
  const [avgFluency,  setAvgFluency]  = useState<number | null>(null);
  const [avgVocab,    setAvgVocab]    = useState<number | null>(null);
  const [sessionId,   setSessionId]   = useState<string>(() => crypto.randomUUID());
  const [msgCount,    setMsgCount]    = useState(0);

  // Voice / Hindi
  const [isListening,  setIsListening]  = useState(false);
  const [hindiPref,    setHindiPref]    = useState(false);
  const [hindiLoading, setHindiLoading] = useState(false);

  // STS (Speech-to-Speech) test mode
  const [stsMode, setStsMode] = useState(false);

  // Debrief
  const [debriefResult,  setDebriefResult]  = useState<DebriefResult | null>(null);
  const [debriefLoading, setDebriefLoading] = useState(false);

  // Vocab
  const [vocabWords,      setVocabWords]      = useState<VocabWord[]>([]);
  const [showVocabPanel,  setShowVocabPanel]  = useState(false);
  const [savingWord,      setSavingWord]      = useState<string | null>(null);

  // Refs
  const vocabPromptRef = useRef<string>('');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null);
  const bottomRef      = useRef<HTMLDivElement>(null);

  // Capture latest stsMode in a ref so startListening closure is always fresh
  // without needing stsMode in its dependency array (which would re-create the
  // recognition object on every toggle and interrupt an active recording).
  const stsModeRef = useRef(stsMode);
  useEffect(() => { stsModeRef.current = stsMode; }, [stsMode]);

  const isElite = user?.plan === 'elite';
  const isPro   = user?.plan === 'pro' || isElite;
  const { speak: elaraSpeak, canSpeak } = useElaraVoice({ user: user ?? null });

  // Load Hindi pref (Elite)
  useEffect(() => {
    if (!isElite) return;
    elaraApi.getPrefs().then(r => { if (r.ok) setHindiPref(r.data.elara_hindi_pref); });
  }, [isElite]);

  // Load vocab list + vocab prompt (Pro+) on mount
  useEffect(() => {
    if (!isPro) return;
    elaraApi.getVocab().then(r => { if (r.ok) setVocabWords(r.data.words); });
    elaraApi.getVocabPrompt().then(r => {
      if (r.ok) vocabPromptRef.current = r.data.prompt_block;
    });
  }, [isPro]);

  // Scroll to bottom
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  // Rolling score averages
  useEffect(() => {
    const analyzed = messages.filter(m => m.role === 'assistant' && m.analysis);
    if (!analyzed.length) return;
    const avg = (key: 'grammar_score' | 'fluency_score' | 'vocab_score') =>
      Math.round(analyzed.reduce((a, m) => a + (m.analysis?.[key] ?? 0), 0) / analyzed.length * 10) / 10;
    setAvgGrammar(avg('grammar_score'));
    setAvgFluency(avg('fluency_score'));
    setAvgVocab(avg('vocab_score'));
  }, [messages]);

  // Save conversation scores when the user resets or leaves (Pro+)
  const flushSession = useCallback(async (
    curSessionId: string,
    grammar: number | null,
    fluency: number | null,
    vocab: number | null,
    count: number,
    curMode: string,
  ) => {
    if (!isPro || count === 0) return;
    elaraApi.saveSession({
      client_session_id: curSessionId,
      grammar_score:     grammar,
      fluency_score:     fluency,
      vocab_score:       vocab,
      message_count:     count,
      mode:              curMode,
    }).catch(() => {/* non-fatal */});
  }, [isPro]);

  // ── Toggle Hindi pref (Elite) ──────────────────────────────────────────

  const toggleHindi = async () => {
    if (hindiLoading) return;
    setHindiLoading(true);
    const next = !hindiPref;
    setHindiPref(next);
    const result = await elaraApi.setHindiPref(next);
    if (!result.ok) setHindiPref(!next);
    setHindiLoading(false);
  };

  // ── Core send logic — accepts text directly so both the button and STS
  //    can call it without going through the input state. ─────────────────

  // Use a ref to always have the latest messages/loading in the STS closure
  // without stale captures.
  const handleSendText = useCallback(async (text: string) => {
    if (!text.trim() || loading) return;

    const userMsg: ChatMsg = { role: 'user', content: text.trim() };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    const hindiInstruction = isElite && hindiPref
      ? '\n\nIMPORTANT: After every correction card, add one sentence explaining the rule in natural Hinglish (mix Hindi + English). Label it "🇮🇳 Hindi note:".'
      : '';

    const vocabInjection = isPro ? vocabPromptRef.current : '';
    const systemPrompt   = getElaraSystemPrompt(mode, topic) + hindiInstruction + vocabInjection;

    // Build prior turns snapshot — capture from state at call time via
    // functional updater pattern not possible here, so we accept a slight
    // race on rapid fire. For a coached conversation this is fine.
    setMessages(prev => {
      // We need the history before the user message was appended —
      // but we already appended above. So slice to exclude the last item
      // (the one we just added) when building priorTurns.
      // We do this inside the updater so we read the committed state.
      // Return prev unchanged — this is a read-only side-effect call.
      // (We'll use a separate ref for priorTurns below instead.)
      return prev;
    });

    // Capture messages for the API call — include the message we just added
    // by reading from the functional snapshot pattern below.
    // Since setState is async, we pass the text directly and reconstruct.
    // priorTurns = last 8 assistant+user turns *before* the current user msg.
    // We track this via a ref that's updated in the rolling score effect.
    // Simplest correct approach: use the messages value from closure
    // (captured at call time, before the setState above committed).
    // This is safe because React batches state updates in event handlers
    // and the closure `messages` here is the pre-update snapshot.
    const priorTurns = messages.slice(-8).map(m => ({ role: m.role, content: m.content }));
    const conversationMessages = [
      { role: 'user' as const, content: `[SYSTEM]: ${systemPrompt}` },
      ...priorTurns,
      { role: 'user' as const, content: text.trim() },
    ];

    try {
      const res = await aiApi.call({
        messages:   conversationMessages,
        topic:      'English coaching',
        session_id: sessionId,
      });

      if (res.ok) {
        const { reply, analysis } = parseElaraResponse(res.data.text);
        const newMsg: ChatMsg = { role: 'assistant', content: reply, analysis };
        setMessages(prev => [...prev, newMsg]);
        setMsgCount(c => c + 1);

        // TTS: STS mode → speak full reply; normal mode → speak corrections only
        if (canSpeak) {
          if (stsModeRef.current) {
            elaraSpeak(reply);
          } else if (analysis?.errors?.length) {
            const script = buildCorrectionScript(analysis.errors);
            if (script) elaraSpeak(script);
          }
        }

        // Pro+: fire-and-forget vocab error tracking
        if (isPro && analysis?.errors?.length) {
          const vocabErrors: VocabError[] = analysis.errors.map(e => ({
            wrong:   e.wrong,
            correct: e.correct,
            rule:    e.rule,
          }));
          elaraApi.trackErrors(vocabErrors, sessionId)
            .then(r => {
              if (r.ok) {
                elaraApi.getVocab().then(vr => { if (vr.ok) setVocabWords(vr.data.words); });
              }
            })
            .catch(() => {/* non-fatal */});
        }
      } else {
        setMessages(prev => [...prev, { role: 'assistant', content: '⚠ Could not get response. Try again.' }]);
      }
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: '⚠ Network error. Check your connection and try again.' }]);
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, messages, isElite, hindiPref, isPro, mode, topic, sessionId, canSpeak, elaraSpeak]);

  // Button send — reads from input state
  const handleSend = useCallback(() => {
    handleSendText(input);
  }, [handleSendText, input]);

  // ── STT / STS ──────────────────────────────────────────────────────────

  // Keep a stable ref to handleSendText so startListening's closure is never
  // stale — avoids putting handleSendText in startListening's dep array which
  // would restart the recognition object on every keystroke.
  const handleSendTextRef = useRef(handleSendText);
  useEffect(() => { handleSendTextRef.current = handleSendText; }, [handleSendText]);

  const startListening = useCallback(() => {
    if (typeof window === 'undefined') return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SR = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
    if (!SR) return;
    const rec = new SR();
    rec.lang = 'en-IN';
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.onresult = (e: { results: { [x: number]: { [x: number]: { transcript: string } } } }) => {
      const t = e.results[0][0].transcript;
      if (stsModeRef.current) {
        // STS: auto-submit, bypass input box
        handleSendTextRef.current(t.slice(0, MAX_ANSWER_LENGTH));
      } else {
        setInput(prev => (prev ? `${prev} ${t}` : t).slice(0, MAX_ANSWER_LENGTH));
      }
    };
    rec.onend  = () => setIsListening(false);
    rec.onerror = () => setIsListening(false);
    recognitionRef.current = rec;
    rec.start();
    setIsListening(true);
  }, []); // stable — reads stsMode via ref, handleSendText via ref

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop();
    setIsListening(false);
  }, []);

  // ── Manual vocab save ──────────────────────────────────────────────────

  const handleManualSave = async (wrong: string, correct: string, rule?: string) => {
    if (!isPro || savingWord) return;
    setSavingWord(wrong);
    await elaraApi.saveWord(wrong, correct, rule);
    const r = await elaraApi.getVocab();
    if (r.ok) setVocabWords(r.data.words);
    setSavingWord(null);
  };

  // ── Reset (no report) ──────────────────────────────────────────────────

  const resetChat = useCallback(() => {
    flushSession(sessionId, avgGrammar, avgFluency, avgVocab, msgCount, mode);
    setMessages([]);
    setAvgGrammar(null);
    setAvgFluency(null);
    setAvgVocab(null);
    setMsgCount(0);
    setDebriefResult(null);
    const newId = crypto.randomUUID();
    setSessionId(newId);
    if (isPro) {
      elaraApi.getVocabPrompt().then(r => {
        if (r.ok) vocabPromptRef.current = r.data.prompt_block;
      });
    }
  }, [flushSession, sessionId, avgGrammar, avgFluency, avgVocab, msgCount, mode, isPro]);

  // ── End Session → generate debrief report ─────────────────────────────

  const handleEndSession = useCallback(async () => {
    // Need at least one full exchange (user + assistant) to generate a report
    const hasExchange = messages.some((m, i) =>
      m.role === 'user' && messages[i + 1]?.role === 'assistant'
    );
    if (!hasExchange) {
      resetChat();
      return;
    }

    // Build AnswerEntry[] — each user message paired with the next assistant's analysis
    const entries: Array<{
      question: string;
      answer: string;
      score: number;
      corrections?: Array<{ wrong: string; correct: string; rule?: string }>;
    }> = [];

    for (let i = 0; i < messages.length - 1; i++) {
      const msg  = messages[i];
      const next = messages[i + 1];
      if (msg.role === 'user' && next?.role === 'assistant') {
        entries.push({
          question:    '(English practice)',
          answer:      msg.content,
          score:       next.analysis?.grammar_score ?? 5,
          corrections: next.analysis?.errors?.map(e => ({
            wrong:   e.wrong,
            correct: e.correct,
            rule:    e.rule,
          })) ?? [],
        });
      }
    }

    setDebriefLoading(true);
    try {
      const res = await elaraApi.debrief(entries);
      if (res.ok) {
        setDebriefResult(res.data);
        // Persist session scores to DB
        flushSession(sessionId, avgGrammar, avgFluency, avgVocab, msgCount, mode);
        // Speak summary in STS mode
        if (stsModeRef.current && canSpeak) {
          elaraSpeak(res.data.summary);
        }
      } else {
        // Debrief failed — fall back to silent reset
        resetChat();
      }
    } catch {
      resetChat();
    } finally {
      setDebriefLoading(false);
    }
  }, [messages, flushSession, sessionId, avgGrammar, avgFluency, avgVocab, msgCount, mode, canSpeak, elaraSpeak, resetChat]);

  // ── New session after debrief ──────────────────────────────────────────

  const handleNewSession = useCallback(() => {
    setDebriefResult(null);
    resetChat();
  }, [resetChat]);

  const liveChips = getLiveFeedback(input);

  return (
    <>
      {/* Vocab sidebar */}
      {showVocabPanel && (
        <VocabSidebar words={vocabWords} onClose={() => setShowVocabPanel(false)} />
      )}

      <div className="p-4 sm:p-6 max-w-2xl mx-auto space-y-4">

        {/* Header */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <ElaraAvatar size={40} />
            <div>
              <h1 className="text-lg font-bold" style={{ color: 'var(--text-1)' }}>Elara — English Coach</h1>
              <p className="text-xs font-medium" style={{ color: 'var(--text-3)' }}>Grammar corrections, vocabulary & fluency coaching</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Pro+: Vocab panel toggle */}
            {isPro && (
              <button
                onClick={() => setShowVocabPanel(v => !v)}
                className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors relative"
                style={showVocabPanel
                  ? { background: 'rgba(var(--accent-rgb,124,95,255),.15)', borderColor: 'var(--accent-border)', color: 'var(--accent)' }
                  : { background: 'var(--surface-2)', borderColor: 'var(--border)', color: 'var(--text-3)' }
                }
                title="My vocabulary list"
              >
                <BookMarked className="w-3.5 h-3.5" />
                Vocab
                {vocabWords.length > 0 && (
                  <span
                    className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full text-[9px] font-bold flex items-center justify-center text-white"
                    style={{ background: 'var(--accent)' }}
                  >
                    {vocabWords.length > 9 ? '9+' : vocabWords.length}
                  </span>
                )}
              </button>
            )}

            {/* Elite: Hindi toggle */}
            {isElite && (
              <button
                onClick={toggleHindi}
                disabled={hindiLoading}
                className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors"
                style={hindiPref
                  ? { background: 'rgba(var(--accent-rgb,124,95,255),.15)', borderColor: 'var(--accent-border)', color: 'var(--accent)' }
                  : { background: 'var(--surface-2)', borderColor: 'var(--border)', color: 'var(--text-3)' }
                }
                title={hindiPref ? 'Hinglish explanations on' : 'Enable Hinglish explanations'}
              >
                🇮🇳 {hindiPref ? 'Hinglish on' : 'Hinglish'}
              </button>
            )}
          </div>
        </div>

        {/* Rolling scores — hidden when debrief is showing */}
        {avgGrammar != null && !debriefResult && (
          <div
            className="flex gap-6 rounded-2xl px-5 py-3 overflow-x-auto border"
            style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
          >
            {[
              { label: 'Grammar',    val: avgGrammar, color: 'var(--success)' },
              { label: 'Fluency',    val: avgFluency, color: 'var(--accent)' },
              { label: 'Vocabulary', val: avgVocab,   color: 'var(--warn)' },
            ].map(s => (
              <div key={s.label} className="text-center min-w-[56px]">
                <div className="text-xl font-bold tabular-nums" style={{ color: s.color }}>{s.val ?? '—'}</div>
                <div className="text-[11px] font-medium" style={{ color: 'var(--text-3)' }}>{s.label}</div>
              </div>
            ))}
          </div>
        )}

        {/* Mode selector — hidden when debrief is showing */}
        {!debriefResult && (
          <Card className="p-4">
            <div className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--text-3)' }}>Mode</div>
            <ChipGroup options={MODE_OPTIONS} value={mode} onChange={v => { setMode(v as ElaraMode); resetChat(); }} />

            {mode === 'topics' && (
              <div className="mt-3">
                <div className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: 'var(--text-3)' }}>Topic</div>
                <div className="flex flex-wrap gap-2">
                  {TOPICS.map(t => (
                    <button
                      key={t}
                      onClick={() => setTopic(t)}
                      className="px-3 py-1 rounded-full text-xs border transition-all"
                      style={topic === t
                        ? { background: 'var(--accent-dim)', borderColor: 'var(--accent-border)', color: 'var(--accent)' }
                        : { background: 'var(--surface-2)', borderColor: 'var(--border)', color: 'var(--text-2)' }}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </Card>
        )}

        {/* Chat card */}
        <Card>
          <CardHeader className="flex items-center justify-between">
            <span className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>
              {debriefResult ? 'Session Complete' : 'Practice'}
            </span>

            {/* Header actions — only shown during active chat, not debrief */}
            {!debriefResult && (
              <div className="flex items-center gap-3">
                {/* End Session → triggers debrief */}
                <button
                  onClick={handleEndSession}
                  disabled={debriefLoading || messages.length === 0}
                  className="text-xs flex items-center gap-1 transition-colors font-medium px-3 py-1 rounded-lg border"
                  style={{
                    background:   messages.length === 0 ? 'var(--surface-2)' : 'var(--accent-dim)',
                    borderColor:  messages.length === 0 ? 'var(--border)'    : 'var(--accent-border)',
                    color:        messages.length === 0 ? 'var(--text-3)'    : 'var(--accent)',
                    opacity:      debriefLoading ? 0.6 : 1,
                    cursor:       messages.length === 0 || debriefLoading ? 'not-allowed' : 'pointer',
                  }}
                >
                  {debriefLoading
                    ? <><Spinner size={12} /> Generating…</>
                    : 'End Session'
                  }
                </button>

                {/* Reset — silent, no report */}
                <button
                  onClick={resetChat}
                  className="text-xs flex items-center gap-1 transition-colors font-medium"
                  style={{ color: 'var(--text-3)' }}
                  onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-2)')}
                  onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-3)')}
                  title="Reset without generating report"
                >
                  <RotateCcw className="w-3 h-3" /> Reset
                </button>
              </div>
            )}
          </CardHeader>

          <CardBody>
            {/* ── Debrief report ── */}
            {debriefResult ? (
              <DebriefReport
                result={debriefResult}
                avgGrammar={avgGrammar}
                avgFluency={avgFluency}
                avgVocab={avgVocab}
                onNewSession={handleNewSession}
              />
            ) : (
              <>
                {/* ── Chat messages ── */}
                <div className="space-y-4 min-h-[240px] sm:min-h-[320px] mb-4">
                  {messages.length === 0 && (
                    <p className="text-sm text-center py-8" style={{ color: 'var(--text-3)' }}>
                      {mode === 'conversation' && 'Start talking — Elara will correct your English naturally.'}
                      {mode === 'topics'       && `Let's talk about: ${topic}. Start whenever you're ready!`}
                      {mode === 'vocabulary'   && 'Type a word or phrase to explore its meaning and usage.'}
                      {mode === 'correction'   && 'Type a sentence and Elara will correct it.'}
                      {isPro && vocabPromptRef.current && (
                        <span className="block mt-2 text-xs" style={{ color: 'var(--accent)' }}>
                          ✦ Elara will reinforce your saved vocab words in this session.
                        </span>
                      )}
                    </p>
                  )}

                  {messages.map((msg, i) => (
                    <div key={i}>
                      <div className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                        {msg.role === 'assistant' && <ElaraAvatar size={28} />}
                        <div
                          className={`max-w-[80%] px-4 py-3 rounded-2xl text-sm leading-relaxed ${msg.role === 'assistant' ? 'ml-2' : ''}`}
                          style={msg.role === 'user'
                            ? { background: 'var(--accent-dim)', border: '1px solid var(--accent-border)', color: 'var(--text-1)' }
                            : { background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-1)' }}
                        >
                          {msg.content}
                        </div>
                      </div>

                      {msg.analysis && (
                        <div className="ml-9 mt-2 space-y-2">
                          <div className="flex flex-wrap gap-2">
                            {msg.analysis.grammar_score != null && <Badge variant="success">Grammar {msg.analysis.grammar_score}/10</Badge>}
                            {msg.analysis.fluency_score != null && <Badge variant="accent">Fluency {msg.analysis.fluency_score}/10</Badge>}
                            {msg.analysis.vocab_score   != null && <Badge variant="warn">Vocab {msg.analysis.vocab_score}/10</Badge>}
                          </div>

                          {msg.analysis.errors && msg.analysis.errors.length > 0 && (
                            <div className="space-y-1">
                              {msg.analysis.errors.map((e, j) => {
                                const isAlreadySaved = vocabWords.some(w => w.wrong_form === e.wrong.toLowerCase().trim());
                                return (
                                  <div
                                    key={j}
                                    className="text-xs rounded-xl px-3 py-2"
                                    style={{ background: 'var(--error-dim)', border: '1px solid var(--error-border)' }}
                                  >
                                    <div className="flex items-center justify-between gap-2">
                                      <div>
                                        <span style={{ color: 'var(--error)', textDecoration: 'line-through' }}>{e.wrong}</span>
                                        <span className="mx-2" style={{ color: 'var(--text-3)' }}>→</span>
                                        <span style={{ color: 'var(--success)' }}>{e.correct}</span>
                                        {e.rule && <div className="mt-0.5" style={{ color: 'var(--text-3)' }}>{e.rule}</div>}
                                        {isElite && hindiPref && e.rule && (
                                          <div className="mt-1 text-xs italic" style={{ color: 'var(--warn)' }}>🇮🇳 {e.rule}</div>
                                        )}
                                      </div>

                                      {isPro && (
                                        <button
                                          onClick={() => handleManualSave(e.wrong, e.correct, e.rule)}
                                          disabled={isAlreadySaved || savingWord === e.wrong}
                                          title={isAlreadySaved ? 'Already saved' : 'Save to vocab list'}
                                          className="flex-shrink-0 w-6 h-6 rounded-lg flex items-center justify-center border transition-colors"
                                          style={isAlreadySaved
                                            ? { background: 'var(--success-dim)', borderColor: 'var(--success)', color: 'var(--success)' }
                                            : { background: 'var(--surface)', borderColor: 'var(--border)', color: 'var(--text-3)' }
                                          }
                                        >
                                          {isAlreadySaved ? '✓' : <Plus className="w-3 h-3" />}
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}

                          {msg.analysis.vocab_upgrade && (
                            <div
                              className="text-xs rounded-xl px-3 py-2"
                              style={{ background: 'var(--warn-dim)', border: '1px solid var(--warn-border)' }}
                            >
                              <span style={{ color: 'var(--text-3)' }}>Basic:</span>{' '}
                              <span style={{ color: 'var(--warn)' }}>{msg.analysis.vocab_upgrade.basic}</span>
                              <span className="mx-2" style={{ color: 'var(--text-3)' }}>→</span>
                              <span style={{ color: 'var(--success)' }}>{msg.analysis.vocab_upgrade.better}</span>
                            </div>
                          )}

                          {msg.analysis.tip && (
                            <p className="text-xs italic font-medium" style={{ color: 'var(--text-3)' }}>{msg.analysis.tip}</p>
                          )}
                        </div>
                      )}
                    </div>
                  ))}

                  {loading && (
                    <div className="flex justify-start items-center gap-2">
                      <ElaraAvatar size={28} />
                      <div className="px-4 py-3 rounded-2xl border" style={{ background: 'var(--surface-2)', borderColor: 'var(--border)' }}>
                        <Spinner size={14} style={{ color: 'var(--accent)' }} />
                      </div>
                    </div>
                  )}

                  <div ref={bottomRef} />
                </div>

                {/* Live feedback chips */}
                {liveChips.length > 0 && input.length > 5 && (
                  <div className="flex flex-wrap gap-2 mb-3">
                    {liveChips.map((chip, i) => (
                      <span
                        key={i}
                        className="text-xs px-2.5 py-1 rounded-full border"
                        style={
                          chip.type === 'ok'     ? { background: 'var(--success-dim)', color: 'var(--success)', borderColor: 'var(--success-border)' } :
                          chip.type === 'filler' ? { background: 'var(--warn-dim)',    color: 'var(--warn)',    borderColor: 'var(--warn-border)' } :
                                                   { background: 'var(--error-dim)',   color: 'var(--error)',   borderColor: 'var(--error-border)' }
                        }
                      >
                        {chip.msg}
                      </span>
                    ))}
                  </div>
                )}

                {/* Input row */}
                <div className="flex gap-2" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
                  {/* Mic button */}
                  {isPro && (
                    <button
                      onClick={isListening ? stopListening : startListening}
                      className="flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center border transition-colors"
                      style={isListening
                        ? { background: 'rgba(239,68,68,.15)', borderColor: '#ef4444', color: '#ef4444' }
                        : { background: 'var(--surface-2)', borderColor: 'var(--border)', color: 'var(--text-3)' }
                      }
                      title={isListening ? 'Stop recording' : 'Speak your message'}
                    >
                      {isListening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                    </button>
                  )}

                  {/* STS toggle — Pro+ only */}
                  {isPro && (
                    <button
                      onClick={() => setStsMode(v => !v)}
                      title={stsMode ? 'STS mode ON — tap to disable' : 'Enable Speech-to-Speech mode'}
                      className="flex-shrink-0 text-xs font-semibold px-3 rounded-xl border transition-colors"
                      style={stsMode
                        ? { background: 'rgba(var(--accent-rgb,124,95,255),.2)', borderColor: 'var(--accent-border)', color: 'var(--accent)' }
                        : { background: 'var(--surface-2)', borderColor: 'var(--border)', color: 'var(--text-3)' }
                      }
                    >
                      {stsMode ? '🎙 STS ON' : '🎙 STS'}
                    </button>
                  )}

                  <input
                    className="flex-1 px-4 py-3 rounded-xl text-sm focus:outline-none"
                    style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-1)' }}
                    placeholder={isPro ? 'Type or speak in English…' : 'Type in English…'}
                    value={input}
                    onChange={e => setInput(e.target.value.slice(0, MAX_ANSWER_LENGTH))}
                    maxLength={MAX_ANSWER_LENGTH}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                    onFocus={e  => (e.currentTarget.style.borderColor = 'var(--accent-border)')}
                    onBlur={e   => (e.currentTarget.style.borderColor = 'var(--border)')}
                  />
                  <Button disabled={!input.trim() || loading} onClick={handleSend}>
                    <Send className="w-4 h-4" />
                  </Button>
                </div>

                {!isPro && (
                  <p className="text-xs mt-2 text-center" style={{ color: 'var(--text-3)' }}>
                    <a href="/pricing" style={{ color: 'var(--accent)' }}>Upgrade to Pro</a> to speak with Elara using voice and track your progress
                  </p>
                )}
              </>
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}