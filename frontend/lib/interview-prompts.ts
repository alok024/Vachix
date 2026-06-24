import { InterviewType } from '@/types';

/**
 * Full port of getProfessionContext() from session.js.
 * Returns a rich system prompt segment for a given profession + interview type.
 */
export function getProfessionContext(
  profession: string,
  interviewType: InterviewType
): string {
  const p = (profession || '').toLowerCase();
  const t = (interviewType || '').toLowerCase();
  const is = (...kws: string[]) => kws.some((k) => p.includes(k));

  if (is('ias', 'upsc', 'civil service', 'ips', 'ifs', 'irs', 'pcs', 'collector', 'sdo', 'sdm')) {
    const base = `DOMAIN: Indian Civil Services (UPSC/State PSC)\nKEY TOPICS to draw questions from:\n- Current affairs: recent government schemes, budgets, foreign policy, Supreme Court judgments\n- Public administration: district management, welfare delivery, grievance redressal, RTI, e-governance\n- Ethics & integrity: Nolan principles, conflict of interest, whistleblowing, public trust\n- Indian Polity & Constitution: federalism, fundamental rights, DPSPs, CAG, UPSC role\n- Governance challenges: rural development, tribal welfare, disaster management, corruption\n- Personal scenarios: "You are an SDM and…" / "As a collector you receive…" — situation-based dilemmas\n- Leadership & initiative: examples of innovation in public service, jugaad, ground-level impact`;
    if (t.includes('behav') || t.includes('hr')) return base + `\nBEHAVIORAL FOCUS: Ask about ethical dilemmas they've faced, moments they stood up for what's right, how they handle political pressure, times they showed initiative to serve communities, handling sensitive communal/caste situations with neutrality.`;
    if (t.includes('tech')) return base + `\nTECHNICAL FOCUS: Ask about specific constitutional articles, landmark judgments, government acts (MGNREGA, PMAY, RTI, PESA), five-year plan history, planning commission vs NITI Aayog, budget terminology, fiscal deficit concepts.`;
    return base + `\nMIXED FOCUS: Blend situational ethics questions with factual/policy knowledge, motivation for civil services, and current affairs.`;
  }

  if (is('software', 'developer', 'engineer', 'programmer', 'sde', 'swe', 'backend', 'frontend', 'full stack', 'fullstack')) {
    const base = `DOMAIN: Software Development\nKEY TOPICS to draw questions from:\n- Data structures & algorithms: time/space complexity, arrays, trees, graphs, DP, sorting\n- System design: scalability, load balancing, caching (Redis), databases (SQL vs NoSQL), microservices, APIs\n- Coding practices: SOLID principles, design patterns, code reviews, refactoring, TDD\n- Real scenarios: debugging production issues, handling deadlines, technical debt decisions\n- Distributed systems: CAP theorem, eventual consistency, message queues, race conditions`;
    if (t.includes('tech')) return base + `\nTECHNICAL FOCUS: Dive deep — ask to explain a specific algorithm, design a URL shortener or Twitter feed, debug a given code snippet concept, compare REST vs GraphQL.`;
    if (t.includes('behav') || t.includes('hr')) return base + `\nBEHAVIORAL FOCUS: Ask about dealing with impossible deadlines, disagreeing with a tech lead's architecture decision, mentoring a junior, a time code review caught a critical bug.`;
    return base + `\nMIXED: Combine a system design question, a behavioral scenario about team conflict on tech choices, and a question about staying current with evolving tech.`;
  }

  if (is('java')) return `DOMAIN: Java Development\nKEY TOPICS: JVM internals (GC, memory model, classloading), OOP principles in Java, collections framework (HashMap internals, ConcurrentHashMap), multithreading (synchronized, volatile, ExecutorService, CompletableFuture), Spring/Spring Boot (IoC, DI, AOP, REST), Hibernate/JPA (N+1 problem, lazy loading, transactions), Java 8+ features (streams, lambdas, Optional, records), design patterns (Singleton, Factory, Observer), microservices with Spring Cloud, testing with JUnit/Mockito.\nINTERVIEW STYLE: Ask "How does X work internally?" questions. Example: "Explain what happens when two threads simultaneously call put() on the same HashMap."`;

  if (is('data scientist', 'data science', 'machine learning', 'ml engineer', 'ai engineer', 'data analyst')) return `DOMAIN: Data Science & Machine Learning\nKEY TOPICS: Statistics (p-values, CLT, Bayesian inference, A/B testing), ML algorithms (regression, decision trees, random forests, XGBoost, SVMs), deep learning (CNNs, RNNs, transformers, backprop), feature engineering & selection, model evaluation (precision/recall tradeoffs, ROC-AUC, cross-validation), overfitting/underfitting, data pipelines (Spark, Airflow), real-world deployment (MLOps, model drift, monitoring), SQL for data analysis, Python (pandas, scikit-learn, PyTorch/TensorFlow).\nINTERVIEW STYLE: Ask scenario-based questions: "Your model has 95% accuracy but terrible recall on fraud cases — what do you do?"`;

  if (is('bank', 'banking', 'bank po', 'ibps', 'sbi', 'rbi', 'nbfc', 'financial analyst', 'finance')) return `DOMAIN: Banking & Finance\nKEY TOPICS: Banking fundamentals (CRR, SLR, repo rate, reverse repo, MCLR), RBI monetary policy and its impact, types of loans and NPA management, BASEL norms (I/II/III), priority sector lending, financial inclusion schemes (Jan Dhan, PM SVANidhi), digital banking (UPI, NEFT, RTGS, IMPS), credit appraisal process, KYC/AML regulations, recent banking sector news (mergers, RBI circulars), basic accounting (balance sheet, P&L, working capital).\nINTERVIEW STYLE: Mix situational, knowledge, and motivation questions.`;

  if (is('doctor', 'medical', 'physician', 'mbbs', 'surgeon', 'dentist', 'nurse', 'healthcare', 'clinical')) return `DOMAIN: Medical / Healthcare\nKEY TOPICS: Clinical reasoning and diagnosis approach, patient communication and consent, medical ethics (autonomy, beneficence, non-maleficence, justice), handling emergencies and triage, recent medical advances, teamwork in ICU/OT settings, error disclosure and patient safety, national health programs (Ayushman Bharat, NHM), research and evidence-based medicine.\nINTERVIEW STYLE: Use clinical scenarios, ethical dilemmas, and behavioral questions.`;

  if (is('teacher', 'teaching', 'educator', 'professor', 'lecturer', 'academic', 'school', 'faculty')) return `DOMAIN: Teaching & Education\nKEY TOPICS: Pedagogy and teaching methodologies (Bloom's taxonomy, constructivism, differentiated instruction), classroom management, student engagement, NEP 2020 implications, inclusive education, use of EdTech tools, parent-teacher communication, curriculum design.\nINTERVIEW STYLE: Use scenario questions, ask them to explain how they'd teach a difficult concept to a weak student.`;

  if (is('marketing', 'brand', 'growth', 'digital marketing', 'seo', 'performance market', 'product market')) return `DOMAIN: Marketing\nKEY TOPICS: Go-to-market strategy, brand positioning, digital marketing channels (SEO, SEM, paid social, email, content), funnel analysis (TOFU/MOFU/BOFU), customer segmentation, A/B testing, marketing metrics (CAC, LTV, ROAS, MQL/SQL), CRM tools (HubSpot, Salesforce).\nINTERVIEW STYLE: Ask case-style questions: "How would you launch a new fintech product to tier-2 Indian cities with ₹10L budget?"`;

  if (is('product manager', 'pm', 'product owner', 'apm', 'associate product')) return `DOMAIN: Product Management\nKEY TOPICS: Product vision and roadmap prioritization (RICE, MoSCoW), user research, writing PRDs, metrics definition (north star metric), A/B testing, working with engineering/design, stakeholder management, product sense, competitive landscape, agile/scrum ceremonies.\nINTERVIEW STYLE: Use PM interview formats: "Design a product for elderly people who can't use smartphones." "DAU dropped 15% last week — walk me through your investigation."`;

  if (is('hr', 'human resource', 'people ops', 'talent acquisition', 'recruiter', 'hrbp')) return `DOMAIN: Human Resources\nKEY TOPICS: Full-cycle recruitment, onboarding and retention, performance management (OKRs, PIP process), employee relations, labor law basics (Shops Act, PF/ESI, POSH Act), compensation & benefits, L&D strategy, HR analytics.\nINTERVIEW STYLE: Scenario-based questions: "A top performer is being poached — how do you retain them?"`;

  if (is('government', 'govt', 'ssc', 'cgl', 'railway', 'defence', 'police', 'army', 'military', 'crpf', 'cisf')) return `DOMAIN: Government / Defence / Security Forces\nKEY TOPICS: Duties and responsibilities of the specific role, current national security concerns, constitutional knowledge, physical and mental fitness standards, discipline and chain of command, ethics in uniform — bribery, use of force, public interaction.\nINTERVIEW STYLE: Ask about why they want to serve the nation, handling sensitive situations, knowledge of the specific department's mandate.`;

  return `DOMAIN: ${profession}\nINTERVIEW APPROACH: Ask questions that a senior ${profession} interviewer at a top firm or institution would actually ask. Avoid generic "tell me about yourself" openers. Focus on:\n- Role-specific technical or domain knowledge relevant to ${profession}\n- Real scenarios and problems common in ${profession} work\n- Past experience and decision-making relevant to ${profession}\n- ${t.includes('behav') ? 'Behavioral: STAR-method situations' : t.includes('tech') ? 'Technical depth: How things work, why decisions are made, tradeoffs' : 'Mix of domain knowledge, situational judgment, and motivation'}\nMake every question feel like it was written by a real ${profession} hiring manager, not an AI.`;
}

// Elara English coach system prompts

export type ElaraMode = 'conversation' | 'topics' | 'correction' | 'vocabulary';

export function getElaraSystemPrompt(mode: ElaraMode, topic = 'daily life'): string {
  const base = `You are Elara, a warm and expert English coach for Indian learners. You specialize in fixing Indian English mistakes (subject-verb agreement, tense errors, preposition misuse, Indianisms like "do the needful", "revert back", "myself is", etc.) while being encouraging and never condescending.`;

  if (mode === 'conversation') {
    return base + `\nHave a natural flowing conversation in English on any topic the user brings up. After EVERY user message, reply in two parts:\n1. A natural conversational response (2–3 sentences).\n2. A JSON block at the end marked with ###ANALYSIS### like this:\n###ANALYSIS###\n{"errors":[{"wrong":"...", "correct":"...", "rule":"..."}], "grammar_score":<1-10>, "fluency_score":<1-10>, "vocab_score":<1-10>, "vocab_upgrade": {"basic":"...", "better":"..."}, "tip":"..."}\nIf no errors, return errors:[]. Always include scores and tip. Return ONLY the JSON after ###ANALYSIS###, nothing else after it.`;
  }
  if (mode === 'topics') {
    return base + `\nGuide the user through a structured English speaking practice on the topic: "${topic}". Ask them open questions, respond naturally, correct errors gently. After each user message:\n###ANALYSIS###\n{"errors":[{"wrong":"...", "correct":"...", "rule":"..."}], "grammar_score":<1-10>, "fluency_score":<1-10>, "vocab_score":<1-10>, "vocab_upgrade": {"basic":"...", "better":"..."}, "tip":"..."}\nAlways include scores even if perfect.`;
  }
  if (mode === 'vocabulary') {
    return base + `\nHelp the user expand their English vocabulary. When they say a word or phrase, give: the meaning, 2–3 better alternatives, example sentences, and common mistakes Indians make with it. Then invite them to use one of the words in a sentence so you can check.\nAfter their example sentence:\n###ANALYSIS###\n{"errors":[{"wrong":"...", "correct":"...", "rule":"..."}], "grammar_score":<1-10>, "fluency_score":<1-10>, "vocab_score":<1-10>, "vocab_upgrade": null, "tip":"..."}\nAlways respond naturally and encouragingly.`;
  }
  return base;
}

export function parseElaraResponse(raw: string): {
  reply: string;
  analysis: {
    errors?: Array<{ wrong: string; correct: string; rule?: string }>;
    grammar_score?: number;
    fluency_score?: number;
    vocab_score?: number;
    vocab_upgrade?: { basic: string; better: string } | null;
    tip?: string;
  } | null;
} {
  const markerIdx = raw.indexOf('###ANALYSIS###');
  if (markerIdx === -1) return { reply: raw.trim(), analysis: null };
  const reply = raw.slice(0, markerIdx).trim();
  const jsonPart = raw.slice(markerIdx + 14).trim();
  let analysis = null;
  try {
    const start = jsonPart.indexOf('{');
    const end = jsonPart.lastIndexOf('}');
    if (start !== -1 && end > start) {
      analysis = JSON.parse(jsonPart.slice(start, end + 1));
    }
  } catch {
    /* non-fatal */
  }
  return { reply, analysis };
}

// Live feedback (client-side, no API)

const FILLER_WORDS = ['um', 'uh', 'umm', 'uhh', 'like', 'basically', 'actually', 'literally', 'you know', 'i mean', 'sort of', 'kind of'];
const GRAMMAR_PATTERNS = [
  { re: /\bi am knowing\b/i, msg: '"I am knowing" → "I know"' },
  { re: /\bi am having\b/i, msg: '"I am having" → "I have"' },
  { re: /\bsince (\d+) years?\b/i, msg: '"since X years" → "for X years"' },
  { re: /\bdiscuss about\b/i, msg: '"discuss about" → "discuss"' },
  { re: /\brevert back\b/i, msg: '"revert back" → "revert" or "reply"' },
  { re: /\bi will (do|make) the needful\b/i, msg: '"do the needful" sounds dated — say what you\'ll actually do' },
  { re: /\bhe don't\b|\bshe don't\b|\bit don't\b/i, msg: '"don\'t" → "doesn\'t" after he/she/it' },
  { re: /\bhave went\b/i, msg: '"have went" → "have gone"' },
];

export interface LiveFeedbackChip {
  type: 'filler' | 'grammar' | 'ok';
  msg: string;
}

export function getLiveFeedback(text: string): LiveFeedbackChip[] {
  const trimmed = (text || '').trim();
  if (!trimmed) return [];
  const lower = ' ' + trimmed.toLowerCase().replace(/\s+/g, ' ') + ' ';
  const chips: LiveFeedbackChip[] = [];

  let fillerCount = 0;
  const seen: Record<string, number> = {};
  FILLER_WORDS.forEach((w) => {
    const re = new RegExp('\\b' + w.replace(/\s+/g, '\\s+') + '\\b', 'gi');
    const matches = lower.match(re);
    if (matches) { fillerCount += matches.length; seen[w] = matches.length; }
  });
  if (fillerCount > 0) {
    const top = Object.entries(seen).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([w, c]) => `"${w}"${c > 1 ? ` ×${c}` : ''}`).join(', ');
    chips.push({ type: 'filler', msg: `${fillerCount} filler word${fillerCount > 1 ? 's' : ''} — ${top}` });
  }

  let grammarHits = 0;
  for (const g of GRAMMAR_PATTERNS) {
    if (g.re.test(trimmed)) {
      chips.push({ type: 'grammar', msg: g.msg });
      grammarHits++;
      if (grammarHits >= 2) break;
    }
  }

  if (chips.length === 0 && trimmed.split(/\s+/).length >= 4) {
    chips.push({ type: 'ok', msg: 'Looking clean — no fillers detected' });
  }
  return chips;
}
