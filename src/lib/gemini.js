/**
 * Gemini client.
 *
 * The prompt is deliberately strict: an Indian public-health persona, hard
 * safety rules, reference facts the model must ground numbers in, two few-shot
 * examples (one bad-air day, one clean day) and a JSON schema. The response is
 * validated and sanitised before it can reach the DOM, and exactly one retry is
 * made when the reply is not usable JSON.
 */

import { t } from './i18n.js';

export const DEFAULT_MODEL = 'gemini-2.5-flash';
export const MAX_TIPS = 6;
export const API_KEY_PATTERN = /^[A-Za-z0-9_-]{20,120}$/;
export const MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{1,59}$/;

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

const CATEGORIES = new Set(['routine', 'indoors', 'sustainable']);
const EFFORT_ALIASES = { low: 'low', med: 'med', medium: 'med', high: 'high' };

export class PlanError extends Error {
  constructor(code, message) {
    super(message || code);
    this.name = 'PlanError';
    this.code = code;
  }
}

const RESPONSE_SCHEMA = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: {
      category: { type: 'STRING', enum: ['routine', 'indoors', 'sustainable'] },
      action: { type: 'STRING' },
      why_it_helps: { type: 'STRING' },
      estimated_impact: { type: 'STRING' },
      effort: { type: 'STRING', enum: ['low', 'med', 'high'] },
      basis: { type: 'STRING' },
    },
    required: ['category', 'action', 'why_it_helps', 'estimated_impact', 'effort', 'basis'],
    propertyOrdering: ['category', 'action', 'why_it_helps', 'estimated_impact', 'effort', 'basis'],
  },
};

const SYSTEM_PROMPT = `You are "Saaf Saans", a calm public-health assistant helping people in Indian cities get through winter smog.

CONTEXT
- Winter PM2.5 in north Indian cities often reaches 200–400 µg/m³, driven by traffic, construction dust, biomass burning and weather inversions.
- Households vary widely: some have purifiers and cars, many do not. Never assume a purchase is possible.
- People want practical actions for today, not a lecture.

TONE
Calm, specific and practical. Never alarmist. No exclamation marks, no blame, no politics. Plain language at a Class 8 reading level. Each action must be doable today.

HARD RULES
1. Never diagnose or name a medical condition. Never claim a symptom is caused by air pollution. If symptoms are mentioned, advise seeing a doctor.
2. Do not invent statistics. Use only the measured values provided below and the REFERENCE FACTS. If a number is uncertain, hedge with "roughly" or leave it out.
3. Keep each action under 40 words. Keep the whole plan under 350 words.
4. Recommend only actions that fit the profile and the measured AQI. Do not suggest buying something the household already has.
5. Never state an AQI or PM2.5 value for a city other than the one provided.
6. If AQI is 100 or lower, do not suggest masks or emergency measures; suggest outdoor activity and fresh air instead.
7. Return ONE JSON array and nothing else — no markdown fences, no commentary.

REFERENCE FACTS (ground impact claims in these)
- A well-fitted N95 respirator filters about 95% of fine particles.
- A HEPA purifier in a closed room typically lowers indoor PM2.5 by 50–80%.
- A 24-hour average PM2.5 of 22 µg/m³ is roughly 1 cigarette per day.
- A petrol car emits about 0.17 kg CO2 per km; metro about 0.03 kg CO2 per passenger-km.
- Exercise raises breathing rate about 1.6× compared with resting.

OUTPUT
A JSON array of 4–6 objects with exactly these fields:
- category: "routine" (low-emission daily routine), "indoors" (indoor air), or "sustainable" (sustainable alternative)
- action: one concrete instruction, under 40 words
- why_it_helps: one or two sentences explaining the mechanism
- estimated_impact: a hedged, approximate impact, using only the facts above and the measured air data
- effort: "low", "med" or "high"
- basis: the facts or assumptions behind the impact number

Cover all three categories when they apply. Write all user-facing strings in the requested language, but keep the JSON keys in English.`;

/** Two examples: a "Very poor" day and a "Good" day. */
const FEW_SHOTS = [
  {
    role: 'user',
    parts: [
      {
        text: `CURRENT CONDITIONS
City: Kanpur, Uttar Pradesh, India
AQI (CPCB-style, PM2.5 sub-index): 318 — Very poor
Current PM2.5: 268 µg/m³
Next 24-hour average PM2.5: 240 µg/m³
Cleanest outdoor window: 3 pm–5 pm (average 168 µg/m³)

USER PROFILE
Commute: two-wheeler, 12 km each way, 5 days a week
Home: no purifier, no AC, windows usually open
Cooking fuel: LPG
Sensitive household members: child under 5
Outdoor exercise: most days
Preferred language: English

TASK
Return 4–6 recommendations as a JSON array in English.`,
      },
    ],
  },
  {
    role: 'model',
    parts: [
      {
        text: JSON.stringify([
          {
            category: 'routine',
            action: 'Wear a fitted N95 for your two-wheeler commute and keep it on until you reach home',
            why_it_helps:
              'A good seal filters about 95% of fine particles, so far less reaches your lungs during the ride.',
            estimated_impact:
              'Roughly 30% less PM2.5 today, about 2 fewer cigarette-equivalents a week.',
            effort: 'low',
            basis:
              'N95 ≈95% filtration (NIOSH); 24-hour average of 22 µg/m³ ≈ 1 cigarette/day; one hour of daily commuting.',
          },
          {
            category: 'indoors',
            action: 'Shut the windows and run a HEPA purifier in the room where your child sleeps',
            why_it_helps:
              'Closed windows keep outdoor particles out, and a HEPA unit removes half to four-fifths of what remains indoors.',
            estimated_impact: 'About 20–25% lower daily PM2.5 for the household.',
            effort: 'med',
            basis: 'HEPA 50–80% indoor PM2.5 reduction in a closed room.',
          },
          {
            category: 'sustainable',
            action: 'Take the metro twice this week instead of the two-wheeler',
            why_it_helps:
              'You spend less time in roadside traffic and emit far less CO2 for the same journey.',
            estimated_impact: 'Roughly 1 kg CO2 saved over the week.',
            effort: 'med',
            basis:
              'Two-wheeler 0.05 kg CO2/km and metro 0.03 kg CO2/passenger-km over a 24 km daily round trip.',
          },
        ]),
      },
    ],
  },
  {
    role: 'user',
    parts: [
      {
        text: `CURRENT CONDITIONS
City: Bengaluru, Karnataka, India
AQI (CPCB-style, PM2.5 sub-index): 42 — Good
Current PM2.5: 24 µg/m³
Next 24-hour average PM2.5: 27 µg/m³
Cleanest outdoor window: 8 am–10 am (average 19 µg/m³)

USER PROFILE
Commute: metro, 9 km each way, 5 days a week
Home: purifier, no AC, windows usually closed
Cooking fuel: electric / induction
Sensitive household members: none
Outdoor exercise: a few times a week
Preferred language: Kannada

TASK
Return 4–6 recommendations as a JSON array in Kannada.`,
      },
    ],
  },
  {
    role: 'model',
    parts: [
      {
        text: JSON.stringify([
          {
            category: 'routine',
            action: 'Cycle or walk for short errands before 10 am',
            why_it_helps:
              'Air is cleanest in the morning today, so outdoor activity adds very little PM2.5.',
            estimated_impact: 'No meaningful PM2.5 penalty at 24 µg/m³; about 2 kg CO2 saved this week.',
            effort: 'low',
            basis: 'Measured outdoor PM2.5 of 24 µg/m³; car 0.17 kg CO2/km.',
          },
          {
            category: 'indoors',
            action: 'Open the windows for 20–30 minutes this morning',
            why_it_helps:
              'Flushing stale air lowers indoor CO2 and cooking smells without letting in much pollution.',
            estimated_impact: 'No PM2.5 penalty today.',
            effort: 'low',
            basis: 'Outdoor PM2.5 is in the Good band.',
          },
          {
            category: 'sustainable',
            action: 'Keep using the metro for your daily commute',
            why_it_helps:
              'Metro travel is far less carbon-intensive per passenger than a private vehicle.',
            estimated_impact: 'About 2 kg CO2 saved each week compared with driving.',
            effort: 'low',
            basis: 'Metro 0.03 vs car 0.17 kg CO2 per passenger-km.',
          },
        ]),
      },
    ],
  },
];

function profileSummary(profile, lang) {
  const home = [];
  home.push(profile.homeSetup?.purifier ? 'purifier (HEPA)' : 'no purifier');
  home.push(profile.homeSetup?.ac ? 'AC' : 'no AC');
  home.push(profile.homeSetup?.windowsOpen ? 'windows usually open' : 'windows usually closed');

  const sensitive = profile.household?.length
    ? profile.household
        .map((group) => ({ kids: 'child under 5', elderly: 'adult over 65', asthma: 'asthma/lung condition' }[group]))
        .join(', ')
    : 'none reported';

  const exercise = {
    none: 'rarely',
    light: 'a few times a week',
    moderate: 'most days',
  }[profile.exercise] || profile.exercise;

  return [
    `Commute: ${profile.commuteMode}, ${profile.commuteDistanceKm} km each way, 5 days a week`,
    `Home: ${home.join(', ')}`,
    `Cooking fuel: ${profile.cookingFuel}`,
    `Sensitive household members: ${sensitive}`,
    `Outdoor exercise: ${exercise}`,
    `Preferred language: ${t('lang.label', lang)} (${lang})`,
  ].join('\n');
}

/**
 * Build the generateContent request body.
 *
 * @param {object} context
 * @param {object} [context.conditions] city/aqi/pm25/avg24/bestWindow/localTime
 * @param {object} context.profile normalized profile
 * @param {'en'|'hi'|'kn'} context.lang
 * @param {string} [repairInstruction] appended after a failed parse
 */
export function buildRequestBody(context, repairInstruction = '') {
  const { conditions, profile, lang = 'en' } = context;
  const best = conditions.bestWindow
    ? `Cleanest outdoor window: ${formatHourForPrompt(conditions.bestWindow.startHour)}–${formatHourForPrompt(
        conditions.bestWindow.endHour
      )} (average ${Math.round(conditions.bestWindow.pm25)} µg/m³)`
    : 'Cleanest outdoor window: not available';

  const userText = [
    'CURRENT CONDITIONS',
    `City: ${conditions.city}`,
    `Local time: ${conditions.localTime || 'unknown'}`,
    `AQI (CPCB-style, PM2.5 sub-index): ${Math.round(conditions.aqi)} — ${conditions.bandLabel}`,
    `Current PM2.5: ${Math.round(conditions.pm25)} µg/m³`,
    `Next 24-hour average PM2.5: ${Math.round(conditions.avg24)} µg/m³`,
    best,
    '',
    'USER PROFILE',
    profileSummary(profile, lang),
    '',
    'TASK',
    `Return 4–6 recommendations as a JSON array. Write every user-facing string in ${
      lang === 'hi' ? 'Hindi (Devanagari script)' : lang === 'kn' ? 'Kannada script' : 'English'
    }.`,
    repairInstruction,
  ]
    .filter(Boolean)
    .join('\n');

  return {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [...FEW_SHOTS, { role: 'user', parts: [{ text: userText }] }],
    generationConfig: {
      temperature: 0.45,
      maxOutputTokens: 1800,
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA,
    },
  };
}

function formatHourForPrompt(hour) {
  const suffix = hour >= 12 ? 'pm' : 'am';
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${display} ${suffix}`;
}

function cleanString(value, maxLength) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

/**
 * Validate and sanitise raw model output. Throws PlanError when the reply is not
 * usable so the caller can retry once and then fall back to the rule engine.
 *
 * @param {string} raw
 * @returns {Array<object>}
 */
export function parsePlan(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new PlanError('empty-response');
  }

  const text = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');

  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end <= start) throw new PlanError('not-json');

  let data;
  try {
    data = JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new PlanError('invalid-json');
  }
  if (!Array.isArray(data)) throw new PlanError('not-an-array');

  const items = [];
  const seen = new Set();

  for (const entry of data) {
    if (!entry || typeof entry !== 'object') continue;

    const category = cleanString(entry.category, 20).toLowerCase();
    const action = cleanString(entry.action, 200);
    const why = cleanString(entry.why_it_helps, 320);
    const impact = cleanString(entry.estimated_impact, 200);
    const effort = EFFORT_ALIASES[cleanString(entry.effort, 12).toLowerCase()];
    const basis = cleanString(entry.basis, 320);

    if (!CATEGORIES.has(category) || !effort) continue;
    if (action.length < 8 || why.length < 8 || impact.length < 4) continue;
    if (seen.has(action.toLowerCase())) continue;
    seen.add(action.toLowerCase());

    items.push({
      id: `ai-${items.length + 1}`,
      category,
      action,
      why_it_helps: why,
      estimated_impact: impact,
      effort,
      basis,
    });

    if (items.length >= MAX_TIPS) break;
  }

  if (items.length < 3) throw new PlanError('insufficient-items');
  return items;
}

export function isValidApiKey(key) {
  return typeof key === 'string' && API_KEY_PATTERN.test(key.trim());
}

export function isValidModel(model) {
  return typeof model === 'string' && MODEL_PATTERN.test(model.trim());
}

async function readError(response) {
  try {
    const data = await response.json();
    return data?.error?.status || data?.error?.message || '';
  } catch {
    return '';
  }
}

/**
 * Call Gemini and return validated plan items. Retries once only when the reply
 * could not be parsed; HTTP/auth errors surface immediately.
 *
 * @param {{apiKey: string, model?: string, context: object, fetchImpl?: typeof fetch, signal?: AbortSignal, onRetry?: () => void}} options
 */
export async function generatePlan({
  apiKey,
  model = DEFAULT_MODEL,
  context,
  fetchImpl = globalThis.fetch,
  signal,
  onRetry,
}) {
  const key = typeof apiKey === 'string' ? apiKey.trim() : '';
  if (!isValidApiKey(key)) throw new PlanError('invalid-api-key');
  if (!isValidModel(model)) throw new PlanError('invalid-model');

  const url = `${ENDPOINT}/${encodeURIComponent(model.trim())}:generateContent`;

  const request = async (repairInstruction) => {
    let response;
    try {
      response = await fetchImpl(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Header keeps the key out of URLs, proxies and browser history.
          'x-goog-api-key': key,
        },
        body: JSON.stringify(buildRequestBody(context, repairInstruction)),
        signal,
      });
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      throw new PlanError('network', 'Could not reach Gemini');
    }

    if (!response.ok) {
      const detail = await readError(response);
      const code =
        response.status === 401 || response.status === 403
          ? 'auth'
          : response.status === 404
            ? 'model'
            : response.status === 429
              ? 'rate-limit'
              : 'http';
      throw new PlanError(code, `Gemini request failed (${response.status}) ${detail}`.trim());
    }

    let data;
    try {
      data = await response.json();
    } catch {
      throw new PlanError('bad-response', 'Gemini response was not JSON');
    }

    const content = data?.candidates?.[0]?.content?.parts
      ?.map((part) => (typeof part?.text === 'string' ? part.text : ''))
      .join('');

    return parsePlan(content ?? '');
  };

  try {
    return await request('');
  } catch (error) {
    if (!(error instanceof PlanError)) throw error;
    if (error.name === 'AbortError') throw error;
    // Only a malformed plan is worth a second attempt.
    if (!['empty-response', 'not-json', 'invalid-json', 'not-an-array', 'insufficient-items'].includes(error.code)) {
      throw error;
    }
    onRetry?.();
    return request(
      'The previous reply could not be used. Return ONLY a valid JSON array of 4–6 objects that follow the schema. No prose, no markdown.'
    );
  }
}

/* ------------------------- timeline refinement ------------------------- */

const TIMELINE_SCHEMA = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: {
      id: { type: 'STRING', enum: ['morning', 'afternoon', 'evening'] },
      action: { type: 'STRING' },
      impact: { type: 'STRING' },
    },
    required: ['id', 'action', 'impact'],
    propertyOrdering: ['id', 'action', 'impact'],
  },
};

const REFINE_SYSTEM = `You rewrite a fixed daily air-quality schedule in a calm, practical voice for Indian cities.

RULES
1. Keep the three ids (morning, afternoon, evening) exactly once each, in that order.
2. Keep every time and every AQI number exactly as given. Do not add new numbers or statistics.
3. Action: one concrete instruction under 25 words. Impact: one short sentence explaining the effect.
4. No diagnosis, no medical claims, no alarmism, no exclamation marks.
5. Write action and impact in the requested language. Return ONLY a JSON array, no prose.`;

/** Validate the reworded schedule and return a Map keyed by slot id. */
export function parseTimeline(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') throw new PlanError('timeline-empty');

  const text = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end <= start) throw new PlanError('timeline-not-json');

  let data;
  try {
    data = JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new PlanError('timeline-invalid-json');
  }
  if (!Array.isArray(data)) throw new PlanError('timeline-not-array');

  const byId = new Map();
  for (const entry of data) {
    if (!entry || typeof entry !== 'object') continue;
    const id = cleanString(entry.id, 20).toLowerCase();
    const action = cleanString(entry.action, 160);
    const impact = cleanString(entry.impact, 160);
    if (!['morning', 'afternoon', 'evening'].includes(id)) continue;
    if (action.length < 8 || impact.length < 8) continue;
    byId.set(id, { action, impact });
  }

  if (byId.size < 3) throw new PlanError('timeline-incomplete');
  return byId;
}

/**
 * Ask Gemini to reword the deterministic schedule. Numbers and slot ids stay
 * fixed; only the wording changes. Failures are non-fatal for the caller.
 *
 * @param {{apiKey:string, model?:string, context:object, timeline:Array, fetchImpl?:Function, signal?:AbortSignal}} options
 */
export async function refineTimeline({
  apiKey,
  model = DEFAULT_MODEL,
  context,
  timeline,
  fetchImpl = globalThis.fetch,
  signal,
}) {
  const key = typeof apiKey === 'string' ? apiKey.trim() : '';
  if (!isValidApiKey(key)) throw new PlanError('invalid-api-key');
  if (!isValidModel(model)) throw new PlanError('invalid-model');
  if (!Array.isArray(timeline) || timeline.length === 0) throw new PlanError('timeline-empty-input');

  const { conditions = {}, lang = 'en' } = context || {};
  const schedule = timeline.map((slot) => ({
    id: slot.id,
    aqi: slot.aqi,
    action: slot.action,
    impact: slot.impact,
  }));

  const body = {
    systemInstruction: { parts: [{ text: REFINE_SYSTEM }] },
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: [
              `CITY: ${conditions.city || 'unknown'}`,
              `AQI: ${Math.round(conditions.aqi ?? 0)}`,
              `PM2.5: ${Math.round(conditions.pm25 ?? 0)} µg/m³`,
              `LANGUAGE: ${lang}`,
              '',
              'SCHEDULE TO REWORD (keep ids, times and AQI values):',
              JSON.stringify(schedule, null, 2),
              '',
              'Return the JSON array now.',
            ].join('\n'),
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: 600,
      responseMimeType: 'application/json',
      responseSchema: TIMELINE_SCHEMA,
    },
  };

  let response;
  try {
    response = await fetchImpl(`${ENDPOINT}/${encodeURIComponent(model.trim())}:generateContent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': key,
      },
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    throw new PlanError('timeline-network');
  }

  if (!response.ok) throw new PlanError('timeline-http');

  let data;
  try {
    data = await response.json();
  } catch {
    throw new PlanError('timeline-bad-response');
  }

  const content = data?.candidates?.[0]?.content?.parts
    ?.map((part) => (typeof part?.text === 'string' ? part.text : ''))
    .join('');

  const byId = parseTimeline(content ?? '');
  return timeline.map((slot) => {
    const replacement = byId.get(slot.id);
    return replacement ? { ...slot, action: replacement.action, impact: replacement.impact } : slot;
  });
}
