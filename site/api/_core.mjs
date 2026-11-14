// Ogonek's follow-up answers. The page sends the visitor's question and the facts it already shows
// (all computed from NASA's tables). Shared by the Vercel function (api/ogonek.mjs) and the local server
// (site_build/serve.mjs).
//
// Needs GEMINI_API_KEY (no npm packages: plain fetch).
// Without it, it answers 503 and the page says follow-ups are off; everything else still works.
//
// Limits: 12 questions a minute per visitor and OGONEK_DAILY_LIMIT (default 1000) a day for the whole site.
// On a serverless host every instance has its own memory, so the counts must live in a shared store: set
// KV_REST_API_URL and KV_REST_API_TOKEN (Vercel KV / Upstash Redis; UPSTASH_REDIS_REST_* also work). Without
// them each process counts alone, which holds for one server (site_build/serve.mjs) but not across instances.
// The hard ceiling on spend is the quota set on the API key in Google Cloud.
import { createHash } from 'node:crypto';

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
const MODEL = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
const LABEL = 'Follow-up';

const SYSTEM = `You are Ogonek, the guide inside Codex of Fire, a dashboard over NASA's Physical Sciences Informatics (PSI) microgravity-combustion data. A visitor right-clicked something on screen and asked a follow-up question. Visitors range from students to combustion scientists, so answer in plain words that a scientist would still accept as correct.

Answer from the FACTS block. The page computed it from NASA's tables, so it is the only source of numbers you have. You may add well-established combustion science to explain why something happens. Every number you state must appear in FACTS. If the visitor asks for a value or a test result that FACTS does not contain, say that it is not in the data on screen and name what to open to see it (a cabin, an investigation, a test), instead of estimating.

Keep these distinctions, because the site is built on them: values NASA recorded; values computed from NASA's (marked ƒ); values from the site's flame model (marked ≈ model); and things with no test in PSI (marked ∅). PSI holds no partial-gravity test and no test in 100 % oxygen around the flame. Say "no test in PSI", not "NASA has not tested": ground tests exist outside this repository.

Reply in plain text with no markdown and no lists, in three sentences or fewer. Start with the answer itself.`;

const PER_MINUTE = 12;
const PER_DAY = Number(process.env.OGONEK_DAILY_LIMIT) || 1000;
const KV_URL = (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '').replace(/\/+$/, '');
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';

/** Atomic fixed-window counter in the shared store: create the key with its expiry if missing, then INCR. */
async function kvCount(key, ttlSeconds) {
  const res = await fetch(KV_URL + '/pipeline', {
    method: 'POST', headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(3000),
    body: JSON.stringify([['SET', key, '0', 'EX', String(ttlSeconds), 'NX'], ['INCR', key]])
  });
  if (!res.ok) throw new Error('kv ' + res.status);
  const r = (await res.json())?.[1];
  if (!r || r.error != null || typeof r.result !== 'number') throw new Error('kv reply');
  return r.result;
}
// Per-process fallback: used when no store is configured or the store cannot be reached.
const local = { visitors: new Map(), day: -1, n: 0 };
function localVisitor(id, now) {
  const list = (local.visitors.get(id) || []).filter(t => now - t < 60000);
  list.push(now); local.visitors.set(id, list);
  if (local.visitors.size > 5000) local.visitors.clear();
  return list.length;
}
function localDay(day) { if (local.day !== day) { local.day = day; local.n = 0; } return ++local.n; }

/** null when the question may go to the model, else 'slow down' or 'daily limit'. The day is only charged once
 *  the visitor is inside their own limit, so one visitor hammering the endpoint cannot use up everyone's day. */
async function limited(who) {
  const now = Date.now(), minute = Math.floor(now / 60000), day = Math.floor(now / 86400000);
  const id = createHash('sha256').update(String(who)).digest('hex').slice(0, 16);   // no raw addresses in the store
  let shared = !!(KV_URL && KV_TOKEN), n;
  try { n = shared ? await kvCount(`ogonek:v:${id}:${minute}`, 61) : localVisitor(id, now); }
  catch { shared = false; n = localVisitor(id, now); }
  if (n > PER_MINUTE) return 'slow down';
  try { n = shared ? await kvCount(`ogonek:day:${day}`, 90000) : localDay(day); }
  catch { n = localDay(day); }
  return n > PER_DAY ? 'daily limit' : null;
}

/** → { status, body }. body is { answer, model } or { error }. */
export async function answer(input, apiKey, who = 'local') {
  const question = typeof input?.question === 'string' ? input.question.trim() : '';
  const facts = typeof input?.facts === 'string' ? input.facts.trim() : '';
  if (!question || question.length > 400 || !facts || facts.length > 8000) return { status: 400, body: { error: 'bad request' } };
  if (!apiKey) return { status: 503, body: { error: 'not configured' } };
  const over = await limited(who);
  if (over) return { status: 429, body: { error: over } };
  let res;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(45000),
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 400,                      // the reply is three sentences
        reasoning_effort: 'none',             // no thinking: ~1.9 s vs ~4.3 s at 'low', and it kept to FACTS as well in tests
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: `FACTS (computed by the page from NASA PSI tables)\n${facts}\n\nQUESTION\n${question}` }
        ]
      })
    });
  } catch {
    return { status: 502, body: { error: 'network error' } };
  }
  if (res.status === 401 || res.status === 403) return { status: 503, body: { error: 'not configured' } };
  if (res.status === 429) return { status: 429, body: { error: 'slow down' } };
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    if (/valid API key|API_KEY_INVALID|API key not valid/i.test(detail)) return { status: 503, body: { error: 'not configured' } };
    return { status: 502, body: { error: 'model error ' + res.status } };
  }
  const data = await res.json().catch(() => null);
  const choice = data?.choices?.[0];
  if (choice?.finish_reason === 'content_filter') return { status: 200, body: { answer: 'I can’t answer that one. Ask me about what is on screen.', model: LABEL } };
  const text = String(choice?.message?.content || '').trim();
  return { status: 200, body: { answer: text || 'No answer came back. Try again.', model: LABEL } };
}
