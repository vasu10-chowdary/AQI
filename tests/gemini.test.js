import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_MODEL,
  PlanError,
  buildRequestBody,
  generatePlan,
  isValidApiKey,
  isValidModel,
  parsePlan,
  parseTimeline,
  refineTimeline,
} from '../src/lib/gemini.js';
import { normalizeProfile } from '../src/lib/profile.js';

const VALID_KEY = 'AIzaSyTESTKEY0123456789abcdefghijklm';
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${DEFAULT_MODEL}:generateContent`;

const CONDITIONS = {
  city: 'Delhi, Delhi, India',
  aqi: 312,
  pm25: 265,
  avg24: 240,
  bandLabel: 'Very poor',
  localTime: '2026-11-18T09:00',
  bestWindow: { startHour: 15, endHour: 17, pm25: 168, date: '2026-11-18' },
};

const PROFILE = normalizeProfile({
  commuteMode: 'two_wheeler',
  commuteDistanceKm: 9,
  household: ['kids'],
  language: 'en',
});

function items(count = 3) {
  return Array.from({ length: count }, (_, index) => ({
    category: ['routine', 'indoors', 'sustainable'][index % 3],
    action: `Action number ${index} for today`,
    why_it_helps: 'Because fine particles are filtered before they reach the lungs.',
    estimated_impact: 'Roughly 20% less PM2.5 today.',
    effort: 'low',
    basis: 'N95 ~95% filtration; HEPA 50-80%.',
  }));
}

function geminiResponse(payload) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ candidates: [{ content: { parts: [{ text: payload }] } }] }),
  };
}

describe('buildRequestBody', () => {
  const body = buildRequestBody({ conditions: CONDITIONS, profile: PROFILE, lang: 'en' });

  it('sends a strict system instruction with the safety rules', () => {
    const system = body.systemInstruction.parts[0].text;
    expect(system).toContain('Never diagnose');
    expect(system).toContain('40 words');
    expect(system).toContain('N95');
    expect(system).toContain('0.17');
  });

  it('includes two few-shot turns and the live prompt', () => {
    expect(body.contents).toHaveLength(5);
    expect(body.contents[0].role).toBe('user');
    expect(body.contents[1].role).toBe('model');
    expect(() => JSON.parse(body.contents[1].parts[0].text)).not.toThrow();

    const prompt = body.contents.at(-1).parts[0].text;
    expect(prompt).toContain('Delhi, Delhi, India');
    expect(prompt).toContain('312');
    expect(prompt).toContain('265');
    expect(prompt).toContain('3 pm');
    expect(prompt).toContain('two_wheeler');
    expect(prompt).toContain('child under 5');
    expect(prompt).toContain('English');
  });

  it('requests structured JSON with the required schema', () => {
    expect(body.generationConfig.responseMimeType).toBe('application/json');
    expect(body.generationConfig.responseSchema.type).toBe('ARRAY');
    expect(body.generationConfig.responseSchema.items.required).toEqual(
      expect.arrayContaining(['category', 'action', 'why_it_helps', 'estimated_impact', 'effort'])
    );
  });

  it('asks for the selected language and appends a repair instruction', () => {
    const hindi = buildRequestBody({ conditions: CONDITIONS, profile: PROFILE, lang: 'hi' });
    expect(hindi.contents.at(-1).parts[0].text).toContain('Hindi (Devanagari script)');

    const repaired = buildRequestBody(
      { conditions: CONDITIONS, profile: PROFILE, lang: 'en' },
      'Return ONLY a valid JSON array.'
    );
    expect(repaired.contents.at(-1).parts[0].text).toContain('Return ONLY a valid JSON array.');
  });

  it('describes a missing forecast window instead of inventing one', () => {
    const bodyWithoutWindow = buildRequestBody({
      conditions: { ...CONDITIONS, bestWindow: null },
      profile: PROFILE,
      lang: 'en',
    });
    expect(bodyWithoutWindow.contents.at(-1).parts[0].text).toContain('not available');
  });
});

describe('parsePlan', () => {
  it('parses a clean JSON array', () => {
    const plan = parsePlan(JSON.stringify(items(3)));
    expect(plan).toHaveLength(3);
    expect(plan[0]).toMatchObject({ category: 'routine', effort: 'low' });
    expect(plan[0].id).toBe('ai-1');
  });

  it('strips markdown fences and surrounding prose', () => {
    const raw = `Here you go:\n\`\`\`json\n${JSON.stringify(items(4))}\n\`\`\`\nHope this helps.`;
    expect(parsePlan(raw)).toHaveLength(4);
  });

  it('sanitises text and normalises effort aliases', () => {
    const raw = JSON.stringify([
      {
        ...items(1)[0],
        action: '  Use   a\u0000 mask\n on the ride ',
        effort: 'medium',
      },
      { ...items(2)[1], action: 'Shut the windows before 6 pm' },
      { ...items(3)[2], action: 'Take the metro twice this week' },
    ]);
    const plan = parsePlan(raw);

    expect(plan[0].action).toBe('Use a mask on the ride');
    expect(plan[0].effort).toBe('med');
  });

  it('drops invalid entries and duplicates, then caps the list at six', () => {
    const valid = items(8);
    const raw = JSON.stringify([
      { nonsense: true },
      { ...valid[0], category: 'wellness' },
      { ...valid[1], action: '' },
      { ...valid[2], effort: 'extreme' },
      ...valid,
      valid[0],
    ]);
    const plan = parsePlan(raw);

    expect(plan).toHaveLength(6);
    const actions = plan.map((item) => item.action.toLowerCase());
    expect(new Set(actions).size).toBe(actions.length);
  });

  it('rejects unusable output with a typed error', () => {
    expect(() => parsePlan('')).toThrow(PlanError);
    expect(() => parsePlan('Sorry, I cannot help with that.')).toThrow(/not-json/);
    expect(() => parsePlan('[{"action": }]')).toThrow(/invalid-json/);
    expect(() => parsePlan(JSON.stringify(items(2)))).toThrow(/insufficient-items/);
    expect(() => parsePlan(null)).toThrow(/empty-response/);
  });
});

describe('parseTimeline', () => {
  const valid = [
    { id: 'morning', action: 'Skip the run and walk at 2 pm', impact: 'AQI 280 now vs 160 then.' },
    { id: 'afternoon', action: 'Do errands between 2 pm and 4 pm', impact: 'AQI 160, below the average.' },
    { id: 'evening', action: 'Close the windows before 9 pm', impact: 'Evening AQI 380.' },
  ];

  it('parses a complete schedule into a map', () => {
    const parsed = parseTimeline(JSON.stringify(valid));
    expect(parsed.size).toBe(3);
    expect(parsed.get('evening').action).toContain('Close the windows');
  });

  it('rejects incomplete or unusable schedules', () => {
    expect(() => parseTimeline('')).toThrow(PlanError);
    expect(() => parseTimeline('no json here')).toThrow(/timeline-not-json/);
    expect(() => parseTimeline(JSON.stringify(valid.slice(0, 2)))).toThrow(/timeline-incomplete/);
    expect(() =>
      parseTimeline(JSON.stringify([{ id: 'midday', action: 'x'.repeat(30), impact: 'y'.repeat(30) }]))
    ).toThrow(/timeline-incomplete/);
  });
});

describe('refineTimeline', () => {
  const timeline = [
    { id: 'morning', aqi: 280, action: 'Old morning action', impact: 'Old impact' },
    { id: 'afternoon', aqi: 160, action: 'Old afternoon action', impact: 'Old impact' },
    { id: 'evening', aqi: 380, action: 'Old evening action', impact: 'Old impact' },
  ];
  const refined = [
    { id: 'morning', action: 'Wear an N95 for the school run', impact: 'AQI 280 at 8 am.' },
    { id: 'afternoon', action: 'Take the long walk between 2 pm and 4 pm', impact: 'AQI 160 then.' },
    { id: 'evening', action: 'Shut the windows before 9 pm', impact: 'AQI 380 this evening.' },
  ];

  it('merges reworded copy while keeping the numbers', async () => {
    const fetchImpl = vi.fn(async () => geminiResponse(JSON.stringify(refined)));
    const result = await refineTimeline({
      apiKey: VALID_KEY,
      context: { conditions: CONDITIONS, profile: PROFILE, lang: 'en' },
      timeline,
      fetchImpl,
    });

    expect(result[0].action).toBe('Wear an N95 for the school run');
    expect(result.map((slot) => slot.aqi)).toEqual([280, 160, 380]);

    const [url, options] = fetchImpl.mock.calls[0];
    expect(url).toContain(':generateContent');
    expect(options.headers['x-goog-api-key']).toBe(VALID_KEY);
    const body = JSON.parse(options.body);
    expect(body.generationConfig.responseMimeType).toBe('application/json');
    expect(body.generationConfig.responseSchema.type).toBe('ARRAY');
  });

  it('throws when the reply is not a usable schedule', async () => {
    const fetchImpl = vi.fn(async () => geminiResponse('{"nope":true}'));
    await expect(
      refineTimeline({ apiKey: VALID_KEY, context: { conditions: CONDITIONS }, timeline, fetchImpl })
    ).rejects.toBeInstanceOf(PlanError);
  });

  it('maps HTTP and network failures', async () => {
    const http = vi.fn(async () => ({ ok: false, status: 500 }));
    await expect(
      refineTimeline({ apiKey: VALID_KEY, context: {}, timeline, fetchImpl: http })
    ).rejects.toMatchObject({ code: 'timeline-http' });

    const network = vi.fn(async () => {
      throw new TypeError('offline');
    });
    await expect(
      refineTimeline({ apiKey: VALID_KEY, context: {}, timeline, fetchImpl: network })
    ).rejects.toMatchObject({ code: 'timeline-network' });
  });
});

describe('validation helpers', () => {
  it('accepts Google-style keys and rejects junk', () => {
    expect(isValidApiKey(VALID_KEY)).toBe(true);
    expect(isValidApiKey(' short ')).toBe(false);
    expect(isValidApiKey(undefined)).toBe(false);
    expect(isValidApiKey('bad key with spaces 123456789012345')).toBe(false);
  });

  it('accepts model ids and rejects unsafe ones', () => {
    expect(isValidModel('gemini-2.5-flash')).toBe(true);
    expect(isValidModel('gemini-1.5-pro')).toBe(true);
    expect(isValidModel('../../etc/passwd')).toBe(false);
    expect(isValidModel('')).toBe(false);
  });
});

describe('generatePlan', () => {
  it('refuses to call the API without a valid key', async () => {
    const fetchImpl = vi.fn();
    await expect(
      generatePlan({ apiKey: 'nope', context: { conditions: CONDITIONS, profile: PROFILE }, fetchImpl })
    ).rejects.toThrow(/invalid-api-key/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('sends the key in a header, never in the URL', async () => {
    const fetchImpl = vi.fn(async () => geminiResponse(JSON.stringify(items(3))));
    const plan = await generatePlan({
      apiKey: VALID_KEY,
      context: { conditions: CONDITIONS, profile: PROFILE, lang: 'en' },
      fetchImpl,
    });

    expect(plan).toHaveLength(3);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const [url, options] = fetchImpl.mock.calls[0];
    expect(url).toBe(API_URL);
    expect(url).not.toContain(VALID_KEY);
    expect(options.method).toBe('POST');
    expect(options.headers['x-goog-api-key']).toBe(VALID_KEY);
    expect(JSON.parse(options.body).generationConfig.responseMimeType).toBe('application/json');
  });

  it('retries once when the model returns unusable JSON', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(geminiResponse('I am sorry, here is a plan instead.'))
      .mockResolvedValueOnce(geminiResponse(JSON.stringify(items(4))));
    const onRetry = vi.fn();

    const plan = await generatePlan({
      apiKey: VALID_KEY,
      context: { conditions: CONDITIONS, profile: PROFILE },
      fetchImpl,
      onRetry,
    });

    expect(plan).toHaveLength(4);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body).contents.at(-1).parts[0].text).toContain(
      'Return ONLY a valid JSON array'
    );
  });

  it('gives up after a second invalid reply', async () => {
    const fetchImpl = vi.fn(async () => geminiResponse('still not json'));
    await expect(
      generatePlan({
        apiKey: VALID_KEY,
        context: { conditions: CONDITIONS, profile: PROFILE },
        fetchImpl,
      })
    ).rejects.toMatchObject({ name: 'PlanError', code: 'not-json' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('does not retry an HTTP error and maps the status', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 429,
      json: async () => ({ error: { status: 'RESOURCE_EXHAUSTED' } }),
    }));

    await expect(
      generatePlan({
        apiKey: VALID_KEY,
        context: { conditions: CONDITIONS, profile: PROFILE },
        fetchImpl,
      })
    ).rejects.toMatchObject({ code: 'rate-limit' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('maps auth and model errors', async () => {
    for (const [status, code] of [
      [401, 'auth'],
      [403, 'auth'],
      [404, 'model'],
      [500, 'http'],
    ]) {
      const fetchImpl = vi.fn(async () => ({ ok: false, status, json: async () => ({}) }));
      await expect(
        generatePlan({
          apiKey: VALID_KEY,
          context: { conditions: CONDITIONS, profile: PROFILE },
          fetchImpl,
        })
      ).rejects.toMatchObject({ code });
    }
  });

  it('reports network failures as a typed error', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(
      generatePlan({
        apiKey: VALID_KEY,
        context: { conditions: CONDITIONS, profile: PROFILE },
        fetchImpl,
      })
    ).rejects.toMatchObject({ code: 'network' });
  });

  it('lets an abort propagate so stale plans are dropped', async () => {
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
    const fetchImpl = vi.fn(async () => {
      throw abort;
    });
    await expect(
      generatePlan({
        apiKey: VALID_KEY,
        context: { conditions: CONDITIONS, profile: PROFILE },
        fetchImpl,
      })
    ).rejects.toBe(abort);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
