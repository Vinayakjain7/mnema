/**
 * Layer 2 — optional LLM enrichment. Uses the USER'S OWN API key.
 *
 * Layer 1 (git-analyzer.js) produces a factual skeleton: which commits look
 * like decisions, who made them, what files they touched. That's free, local,
 * and never leaves the machine.
 *
 * Layer 2 takes that skeleton and asks an LLM to infer the *reasoning* behind
 * each decision — the "why" that git history doesn't record. This costs money
 * (the user's), makes network calls, and is therefore strictly opt-in via
 * `mnema scan --enrich`.
 *
 * Design notes:
 *  - No SDK dependency. We use the built-in fetch (Node 18+) so the package
 *    stays tiny. Provider differences are isolated to callProvider().
 *  - Provider-agnostic: ANTHROPIC_API_KEY preferred, OPENAI_API_KEY fallback.
 *    Override the model with MNEMA_MODEL.
 *  - Batched: all decisions go in one request (chunked) rather than one call
 *    each, to keep the user's spend and latency down.
 *  - Honest: the model returns a confidence per decision. We surface it. The
 *    model is inferring, not reading minds — low-confidence guesses get flagged
 *    rather than written into the Brain as fact.
 *  - Privacy-conscious: we send commit subjects, changed filenames, and a
 *    diffstat — NOT the diffs themselves. That's enough signal for "why" while
 *    avoiding shipping source/secrets to a third party.
 */

const ANTHROPIC_ENDPOINT = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const OPENAI_ENDPOINT = 'https://api.openai.com/v1/chat/completions';
// Groq exposes an OpenAI-compatible endpoint and has a free tier (no card).
const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';

// Sensible cheap defaults; all overridable via MNEMA_MODEL.
const DEFAULT_ANTHROPIC_MODEL = 'claude-haiku-4-5';
const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';
const DEFAULT_GROQ_MODEL = 'llama-3.3-70b-versatile';

const BATCH_SIZE = 12;       // decisions per request
const MAX_DECISIONS = 25;    // matches the draft cap; don't enrich the long tail

const SYSTEM_PROMPT = [
  'You are a senior engineer reverse-engineering the reasoning behind code changes.',
  'You are given a list of git commits that look like architectural decisions:',
  'each has a commit subject, the files it touched, and a diffstat.',
  '',
  'For each one, infer the LIKELY reasoning a team would have had. Rules:',
  '- Ground every inference in the subject and the files changed. Do NOT invent',
  '  specific facts (library names, ticket IDs, people, benchmarks) that the',
  '  inputs do not support.',
  '- If the change is ambiguous or generic, set "confidence" to "low" and keep',
  '  the reasoning hedged and general rather than fabricating specifics.',
  '- "alternatives" are plausible options the team might have weighed. Keep to',
  '  1-3, and only ones that make sense given the files touched.',
  '- Keep each text field to 1-3 sentences. Be concrete, not flowery.',
  '',
  'Respond with ONLY valid json — a JSON object, no prose and no code fences — of the form:',
  '{ "enrichments": [ {',
  '    "index": <number, the index given in the input>,',
  '    "reason": <string>,',
  '    "alternatives": [<string>, ...],',
  '    "rejectedBecause": <string>,',
  '    "tags": [<string>, ...],',
  '    "confidence": "high" | "medium" | "low"',
  '} ] }',
].join('\n');

/**
 * Resolve which provider/key/model to use from the environment.
 * Returns null if no usable key is set (caller falls back gracefully).
 *
 * Priority:
 *   1. MNEMA_BASE_URL  — any OpenAI-compatible endpoint (e.g. a local Ollama
 *      server at http://localhost:11434/v1). Free + private. Key optional.
 *   2. ANTHROPIC_API_KEY — paid.
 *   3. OPENAI_API_KEY    — paid.
 *   4. GROQ_API_KEY      — free tier, no credit card, OpenAI-compatible.
 *
 * MNEMA_MODEL overrides the model for whichever provider is chosen.
 */
export function getApiConfig(env = process.env) {
  const override = env.MNEMA_MODEL && env.MNEMA_MODEL.trim();

  // 1. Explicit custom OpenAI-compatible endpoint (Ollama, LM Studio, etc.).
  if (env.MNEMA_BASE_URL && env.MNEMA_BASE_URL.trim()) {
    const base = env.MNEMA_BASE_URL.trim().replace(/\/+$/, '');
    return {
      provider: 'openai-compatible',
      apiKey: (env.MNEMA_API_KEY || env.OPENAI_API_KEY || env.GROQ_API_KEY || '').trim(),
      model: override || '',
      endpoint: `${base}/chat/completions`,
      keyVar: 'MNEMA_BASE_URL',
    };
  }

  if (env.ANTHROPIC_API_KEY && env.ANTHROPIC_API_KEY.trim()) {
    return {
      provider: 'anthropic',
      apiKey: env.ANTHROPIC_API_KEY.trim(),
      model: override || DEFAULT_ANTHROPIC_MODEL,
      endpoint: ANTHROPIC_ENDPOINT,
      keyVar: 'ANTHROPIC_API_KEY',
    };
  }

  if (env.OPENAI_API_KEY && env.OPENAI_API_KEY.trim()) {
    return {
      provider: 'openai',
      apiKey: env.OPENAI_API_KEY.trim(),
      model: override || DEFAULT_OPENAI_MODEL,
      endpoint: OPENAI_ENDPOINT,
      keyVar: 'OPENAI_API_KEY',
    };
  }

  // 4. Groq — free tier, OpenAI-compatible. Just set GROQ_API_KEY and go.
  if (env.GROQ_API_KEY && env.GROQ_API_KEY.trim()) {
    return {
      provider: 'groq',
      apiKey: env.GROQ_API_KEY.trim(),
      model: override || DEFAULT_GROQ_MODEL,
      endpoint: GROQ_ENDPOINT,
      keyVar: 'GROQ_API_KEY',
    };
  }

  return null;
}

/**
 * Enrich a list of decisions (each already carrying { subject, date, author,
 * hash, files, stat }). Returns a Map keyed by decision.hash → enrichment.
 *
 * Never throws on per-request failure: a failed chunk simply yields no
 * enrichments for its decisions, so the caller keeps the Layer 1 placeholders
 * for those. The whole thing only throws if `fetch` itself is unavailable.
 *
 * @returns {Promise<{ results: Map, requests: number, failures: number }>}
 */
export async function enrichDecisions(decisions, config) {
  if (typeof fetch !== 'function') {
    throw new Error(
      'Global fetch is not available. Node 18+ is required for `mnema scan --enrich`.'
    );
  }

  const subset = decisions.slice(0, MAX_DECISIONS);
  const results = new Map();
  let requests = 0;
  let failures = 0;
  let lastError = null;

  // Stable index → hash mapping so we can realign the model's JSON to commits.
  const indexed = subset.map((d, i) => ({ index: i, decision: d }));

  for (let i = 0; i < indexed.length; i += BATCH_SIZE) {
    const batch = indexed.slice(i, i + BATCH_SIZE);
    requests += 1;

    let enrichments;
    try {
      const userContent = buildUserContent(batch);
      const raw = await callProvider(config, userContent);
      enrichments = parseEnrichments(raw);
      if (!Array.isArray(enrichments)) {
        failures += 1;
        lastError = `the model's reply wasn't in the expected JSON shape. It returned: ${truncate(raw)}`;
        continue;
      }
    } catch (err) {
      failures += 1;
      lastError = err.message;
      continue; // keep placeholders for this batch
    }

    // Map each enrichment back to its commit hash via the index we sent.
    const byIndex = new Map(batch.map(b => [b.index, b.decision]));
    for (const e of enrichments) {
      const decision = byIndex.get(e.index);
      if (!decision) continue;
      results.set(decision.hash, sanitizeEnrichment(e));
    }
  }

  // If we made requests but nothing came back usable, surface why rather than
  // failing silently. Partial success (some batches worked) is kept as-is.
  if (results.size === 0 && requests > 0) {
    throw new Error(lastError || 'the enrichment request failed for an unknown reason.');
  }

  return { results, requests, failures };
}

/** Trim a raw model reply to a short, log-friendly snippet. */
function truncate(text, max = 220) {
  const s = (text || '').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/** Build the per-batch user message: a compact JSON array of decisions. */
function buildUserContent(batch) {
  const payload = batch.map(({ index, decision }) => ({
    index,
    subject: decision.subject,
    date: decision.date,
    author: decision.author,
    files_changed: (decision.files || []).slice(0, 20),
    diffstat: decision.stat || '',
  }));

  return (
    'Here are the candidate decisions to enrich:\n\n' +
    JSON.stringify(payload, null, 2)
  );
}

/** Dispatch to the right provider. Returns the raw text the model produced. */
async function callProvider(config, userContent) {
  if (config.provider === 'anthropic') {
    return callAnthropic(config, userContent);
  }
  // openai, groq, and any openai-compatible endpoint share the same wire format.
  return callOpenAI(config, userContent);
}

async function callAnthropic(config, userContent) {
  const res = await fetch(config.endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': config.apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: 2000,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userContent }],
    }),
  });

  if (!res.ok) {
    throw new Error(await describeHttpError(res));
  }

  const data = await res.json();
  const text = (data.content || [])
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('');
  return text;
}

async function callOpenAI(config, userContent) {
  const headers = { 'content-type': 'application/json' };
  // Local servers (e.g. Ollama) need no key; only send auth when we have one.
  if (config.apiKey) headers.authorization = `Bearer ${config.apiKey}`;

  const res = await fetch(config.endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: config.model,
      max_tokens: 2000,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userContent },
      ],
    }),
  });

  if (!res.ok) {
    throw new Error(await describeHttpError(res));
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

async function describeHttpError(res) {
  let detail = '';
  try {
    const body = await res.json();
    detail = body?.error?.message || JSON.stringify(body);
  } catch {
    detail = res.statusText;
  }
  return `API request failed (${res.status}): ${detail}`;
}

/**
 * Tolerant JSON extraction. Models sometimes wrap output in ```json fences or
 * add a stray sentence; we strip those and grab the outermost JSON object.
 */
function parseEnrichments(raw) {
  if (!raw || !raw.trim()) return null;

  let text = raw.trim();

  // Strip code fences if present.
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

  const tryParse = s => { try { return JSON.parse(s); } catch { return undefined; } };

  // 1. Try the cleaned text as-is (handles clean objects AND bare arrays).
  // 2. Fall back to slicing the outermost {...} (object wrapped in prose).
  // 3. Fall back to slicing the outermost [...] (array wrapped in prose).
  let parsed = tryParse(text);
  if (parsed === undefined) {
    const o1 = text.indexOf('{'), o2 = text.lastIndexOf('}');
    if (o1 !== -1 && o2 > o1) parsed = tryParse(text.slice(o1, o2 + 1));
  }
  if (parsed === undefined) {
    const a1 = text.indexOf('['), a2 = text.lastIndexOf(']');
    if (a1 !== -1 && a2 > a1) parsed = tryParse(text.slice(a1, a2 + 1));
  }
  if (parsed === undefined) return null;

  // Accept { enrichments: [...] }, a bare array, or a single enrichment object
  // (some models drop the array wrapper when there's only one decision).
  if (Array.isArray(parsed)) return parsed;
  if (parsed && Array.isArray(parsed.enrichments)) return parsed.enrichments;
  if (
    parsed &&
    typeof parsed === 'object' &&
    ('reason' in parsed || 'index' in parsed || 'confidence' in parsed)
  ) {
    return [parsed];
  }
  return null;
}

/** Coerce a model enrichment into a clean, predictable shape. */
function sanitizeEnrichment(e) {
  const str = v => (typeof v === 'string' ? v.trim() : '');
  const arr = v =>
    Array.isArray(v) ? v.map(x => str(x)).filter(Boolean) : [];

  const confidence = ['high', 'medium', 'low'].includes(e.confidence)
    ? e.confidence
    : 'low';

  return {
    reason: str(e.reason),
    alternatives: arr(e.alternatives),
    rejectedBecause: str(e.rejectedBecause),
    tags: arr(e.tags),
    confidence,
  };
}
