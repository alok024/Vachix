'use client';

import { useState, useRef, useEffect } from 'react';
import { Button, Card, CardHeader, CardBody, Badge, ChipGroup, Spinner } from '@/components/ui';
import { aiApi } from '@/features/ai/api';
import { getElaraSystemPrompt, parseElaraResponse, getLiveFeedback, type ElaraMode } from '@/lib/interview-prompts';
import { Send, RotateCcw } from 'lucide-react';

const MODE_OPTIONS: { label: string; value: ElaraMode }[] = [
  { label: '💬 Conversation', value: 'conversation' },
  { label: '📚 Topics',       value: 'topics' },
  { label: '📝 Correction',   value: 'correction' },
  { label: '🔤 Vocabulary',   value: 'vocabulary' },
];

const TOPICS = ['Daily life', 'Work & career', 'Technology', 'Current affairs', 'Travel', 'Health & fitness', 'Family', 'Education'];

// no client-side cap previously, unlike the interview session
// page's MAX_ANSWER_LENGTH — long messages silently failed against the
// backend's 2000-char cap with a misleading generic error. Same value,
// same pattern.
const MAX_ANSWER_LENGTH = 2_000;

interface ChatMsg {
  role: 'user' | 'assistant';
  content: string;
  analysis?: ReturnType<typeof parseElaraResponse>['analysis'];
}

/** Violet→gold avatar mark used for Elara, consistent with brand */
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

export default function EnglishPage() {
  const [mode,       setMode]       = useState<ElaraMode>('conversation');
  const [topic,      setTopic]      = useState('Daily life');
  const [messages,   setMessages]   = useState<ChatMsg[]>([]);
  const [input,      setInput]      = useState('');
  const [loading,    setLoading]    = useState(false);
  const [avgGrammar, setAvgGrammar] = useState<number | null>(null);
  const [avgFluency, setAvgFluency] = useState<number | null>(null);
  const [avgVocab,   setAvgVocab]   = useState<number | null>(null);
  // stable per-chat id so the backend can memoize the assembled
  // system prompt across turns instead of rebuilding it every message.
  // Regenerated whenever the chat resets (mode switch or explicit Reset),
  // since a fresh chat is a fresh "session" as far as prompt context goes.
  const [sessionId,  setSessionId]  = useState<string>(() => crypto.randomUUID());
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  useEffect(() => {
    const analyzed = messages.filter((m) => m.role === 'assistant' && m.analysis);
    if (!analyzed.length) return;
    const avg = (key: 'grammar_score' | 'fluency_score' | 'vocab_score') =>
      Math.round(analyzed.reduce((a, m) => a + (m.analysis?.[key] ?? 0), 0) / analyzed.length * 10) / 10;
    setAvgGrammar(avg('grammar_score'));
    setAvgFluency(avg('fluency_score'));
    setAvgVocab(avg('vocab_score'));
  }, [messages]);

  async function handleSend() {
    if (!input.trim() || loading) return;
    const userMsg: ChatMsg = { role: 'user', content: input.trim() };
    const newHistory = [...messages, userMsg];
    setMessages(newHistory);
    setInput('');
    setLoading(true);

    const systemPrompt = getElaraSystemPrompt(mode, topic);
    // the backend schema only accepts 'user' | 'assistant' roles —
    // a 'system' message in the array is rejected at validation (every
    // call from this page was 400ing). Fold the system prompt into a
    // leading user turn instead, the same [SYSTEM]: convention the
    // interview session page's chat mode uses, and resend it every turn
    // (not just the first) so Elara's mode/topic instructions don't fall
    // out of context as the conversation grows and older turns get
    // trimmed by the backend's token-budget trimmer.
    const priorTurns = messages.slice(-8).map((m) => ({ role: m.role, content: m.content }));
    const conversationMessages = [
      { role: 'user' as const, content: `[SYSTEM]: ${systemPrompt}` },
      ...priorTurns,
      { role: 'user' as const, content: input.trim() },
    ];

    try {
      const res = await aiApi.call({
        messages: conversationMessages,
        topic: 'English coaching',
        session_id: sessionId,
      });

      if (res.ok) {
        const { reply, analysis } = parseElaraResponse(res.data.text);
        setMessages((prev) => [...prev, { role: 'assistant', content: reply, analysis }]);
      } else {
        setMessages((prev) => [...prev, { role: 'assistant', content: '⚠ Could not get response. Try again.' }]);
      }
    } catch {
      // Network-level throw (fetch failed, timeout, etc.) — surface a recoverable
      // error rather than leaving loading=true and the input permanently disabled.
      setMessages((prev) => [...prev, { role: 'assistant', content: '⚠ Network error. Check your connection and try again.' }]);
    } finally {
      setLoading(false);
    }
  }

  function resetChat() {
    setMessages([]);
    setAvgGrammar(null);
    setAvgFluency(null);
    setAvgVocab(null);
    // New chat = new prompt-memoization session.
    setSessionId(crypto.randomUUID());
  }

  const liveChips = getLiveFeedback(input);

  return (
    <div className="p-4 sm:p-6 max-w-2xl mx-auto space-y-4">

      {/* Header */}
      <div className="flex items-center gap-3">
        <ElaraAvatar size={40} />
        <div>
          <h1 className="text-lg font-bold" style={{ color: 'var(--text-1)' }}>Elara — English Coach</h1>
          <p className="text-xs" style={{ color: 'var(--text-3)' }}>Grammar corrections, vocabulary & fluency coaching</p>
        </div>
      </div>

      {/* Rolling scores */}
      {avgGrammar != null && (
        <div
          className="flex gap-6 rounded-2xl px-5 py-3 overflow-x-auto border"
          style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
        >
          {[
            { label: 'Grammar',    val: avgGrammar, color: 'var(--success)' },
            { label: 'Fluency',    val: avgFluency, color: 'var(--accent)' },
            { label: 'Vocabulary', val: avgVocab,   color: 'var(--warn)' },
          ].map((s) => (
            <div key={s.label} className="text-center min-w-[56px]">
              <div className="text-xl font-bold tabular-nums" style={{ color: s.color }}>{s.val ?? '—'}</div>
              <div className="text-[10px]" style={{ color: 'var(--text-3)' }}>{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Mode selector */}
      <Card className="p-4">
        <div className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--text-3)' }}>Mode</div>
        <ChipGroup options={MODE_OPTIONS} value={mode} onChange={(v) => { setMode(v as ElaraMode); resetChat(); }} />

        {mode === 'topics' && (
          <div className="mt-3">
            <div className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: 'var(--text-3)' }}>Topic</div>
            <div className="flex flex-wrap gap-2">
              {TOPICS.map((t) => (
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

      {/* Chat */}
      <Card>
        <CardHeader className="flex items-center justify-between">
          <span className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>Practice</span>
          <button
            onClick={resetChat}
            className="text-xs flex items-center gap-1 transition-colors"
            style={{ color: 'var(--text-3)' }}
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-2)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-3)')}
          >
            <RotateCcw className="w-3 h-3" /> Reset
          </button>
        </CardHeader>
        <CardBody>
          <div className="space-y-4 min-h-[240px] sm:min-h-[320px] mb-4">
            {messages.length === 0 && (
              <p className="text-sm text-center py-8" style={{ color: 'var(--text-3)' }}>
                {mode === 'conversation' && 'Start talking — Elara will correct your English naturally.'}
                {mode === 'topics' && `Let's talk about: ${topic}. Start whenever you're ready!`}
                {mode === 'vocabulary' && 'Type a word or phrase to explore its meaning and usage.'}
                {mode === 'correction' && 'Type a sentence and Elara will correct it.'}
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
                        {msg.analysis.errors.map((e, j) => (
                          <div
                            key={j}
                            className="text-xs rounded-xl px-3 py-2"
                            style={{ background: 'var(--error-dim)', border: '1px solid var(--error-border)' }}
                          >
                            <span style={{ color: 'var(--error)', textDecoration: 'line-through' }}>{e.wrong}</span>
                            <span className="mx-2" style={{ color: 'var(--text-3)' }}>→</span>
                            <span style={{ color: 'var(--success)' }}>{e.correct}</span>
                            {e.rule && <div className="mt-0.5" style={{ color: 'var(--text-3)' }}>{e.rule}</div>}
                          </div>
                        ))}
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
                      <p className="text-xs italic" style={{ color: 'var(--text-3)' }}>{msg.analysis.tip}</p>
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
            <input
              className="flex-1 px-4 py-3 rounded-xl text-sm focus:outline-none"
              style={{
                background: 'var(--surface-2)', border: '1px solid var(--border)',
                color: 'var(--text-1)',
              }}
              placeholder="Type in English…"
              value={input}
              onChange={(e) => setInput(e.target.value.slice(0, MAX_ANSWER_LENGTH))}
              maxLength={MAX_ANSWER_LENGTH}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
              onFocus={e  => (e.currentTarget.style.borderColor = 'var(--accent-border)')}
              onBlur={e   => (e.currentTarget.style.borderColor = 'var(--border)')}
            />
            <Button disabled={!input.trim() || loading} onClick={handleSend}>
              <Send className="w-4 h-4" />
            </Button>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
