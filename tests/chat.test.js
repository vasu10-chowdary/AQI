import { describe, expect, it, vi } from 'vitest';
import {
  ChatError,
  buildChatContext,
  buildChatRequest,
  createSseParser,
  detectTopic,
  fallbackAnswer,
  parseSseLine,
  sanitizeChatText,
  streamChat,
} from '../src/lib/chat.js';
import { normalizeProfile } from '../src/lib/profile.js';

const KEY = 'AIzaSyTESTKEY0123456789abcdefghijklm';
const CONDITIONS = {
  city: 'Delhi, Delhi',
  aqi: 320,
  pm25: 146,
  avg24: 145,
  bestWindow: { startHour: 14, endHour: 16, pm25: 98, date: '2026-11-18' },
};
const PROFILE = normalizeProfile({
  commuteMode: 'two_wheeler',
  household: ['kids'],
  homeSetup: { purifier: true, ac: false, windowsOpen: false },
  language: 'en',
});
const PLAN = [
  { action: 'Wear a fitted N95', estimated_impact: 'About 90% fewer particles.' },
  { action: 'Close the windows', estimated_impact: 'About 20% less indoor PM2.5.' },
];

function sseChunk(text) {
  return `data: ${JSON.stringify({
    candidates: [{ content: { parts: [{ text }] } }],
  })}\n\n`;
}

function streamingResponse(chunks) {
  const encoder = new TextEncoder();
  return {
    ok: true,
    status: 200,
    body: new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    }),
  };
}

describe('sanitizeChatText', () => {
  it('strips control characters, collapses whitespace and caps length', () => {
    expect(sanitizeChatText('  Is it\n\n safe\u0000 to go out?  ')).toBe('Is it safe to go out?');
    expect(sanitizeChatText('a'.repeat(900)).length).toBe(500);
    expect(sanitizeChatText(null)).toBe('');
    expect(sanitizeChatText(42)).toBe('');
  });
});

describe('buildChatContext', () => {
  it('includes city, readings, window, profile and plan', () => {
    const context = buildChatContext({ conditions: CONDITIONS, profile: PROFILE, plan: PLAN, lang: 'en' });

    expect(context).toContain('Delhi');
    expect(context).toContain('320');
    expect(context).toContain('146');
    expect(context).toContain('2 pm');
    expect(context).toContain('two_wheeler');
    expect(context).toContain('kids');
    expect(context).toContain('Wear a fitted N95');
  });
});

describe('buildChatRequest', () => {
  const history = [
    { role: 'user', text: 'Is it safe to go out?' },
    { role: 'assistant', text: 'At AQI 320, keep it short.' },
  ];
  const request = buildChatRequest({ context: 'CONTEXT', history });

  it('keeps the safety and injection rules in the system prompt', () => {
    const system = request.systemInstruction.parts[0].text;
    expect(system).toContain('Never diagnose');
    expect(system).toContain("I'm not sure");
    expect(system).toContain('under 120 words');
    expect(system).toContain('<user_data>');
    expect(system).toContain('never instructions');
  });

  it('wraps user turns as data and leaves assistant turns plain', () => {
    expect(request.contents[2].role).toBe('user');
    expect(request.contents[2].parts[0].text).toBe('<user_data>\nIs it safe to go out?\n</user_data>');
    expect(request.contents[3].role).toBe('model');
    expect(request.contents[3].parts[0].text).toBe('At AQI 320, keep it short.');
  });

  it('trims history to the last six turns', () => {
    const long = Array.from({ length: 20 }, (_, index) => ({
      role: index % 2 ? 'assistant' : 'user',
      text: `turn ${index}`,
    }));
    const trimmed = buildChatRequest({ context: 'c', history: long });

    expect(trimmed.contents).toHaveLength(2 + 12);
    expect(trimmed.contents.at(-1).parts[0].text).toContain('turn 19');
  });
});

describe('SSE parsing', () => {
  it('reads text from a Gemini data line', () => {
    expect(parseSseLine(sseChunk('Hello').split('\n')[0])).toBe('Hello');
    expect(parseSseLine('event: ping')).toBeNull();
    expect(parseSseLine('data: not json')).toBeNull();
    expect(parseSseLine('data: [DONE]')).toBeNull();
  });

  it('reassembles tokens split across chunks', () => {
    const parser = createSseParser();
    const pieces = [
      ...parser.push('data: {"candidates":[{"content":{"parts":[{"text":"Hel'),
      ...parser.push('lo"}]}}]}\n'),
      ...parser.push(sseChunk(' there')),
      ...parser.flush(),
    ];
    expect(pieces.join('')).toBe('Hello there');
  });
});

describe('streamChat', () => {
  it('streams tokens in order and returns the full answer', async () => {
    const fetchImpl = vi.fn(async () => streamingResponse([sseChunk('Wear'), sseChunk(' an N95.')]));
    const tokens = [];

    const answer = await streamChat({
      apiKey: KEY,
      context: 'ctx',
      history: [],
      fetchImpl,
      onToken: (token) => tokens.push(token),
    });

    expect(answer).toBe('Wear an N95.');
    expect(tokens).toEqual(['Wear', ' an N95.']);
    const [url, options] = fetchImpl.mock.calls[0];
    expect(url).toContain(':streamGenerateContent?alt=sse');
    expect(url).not.toContain(KEY);
    expect(options.headers['x-goog-api-key']).toBe(KEY);
  });

  it('rejects a missing key without calling the network', async () => {
    const fetchImpl = vi.fn();
    await expect(streamChat({ apiKey: '', context: 'c', fetchImpl })).rejects.toThrow(/invalid-api-key/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('maps HTTP failures to typed errors', async () => {
    for (const [status, code] of [
      [401, 'auth'],
      [429, 'rate-limit'],
      [500, 'http'],
    ]) {
      const fetchImpl = vi.fn(async () => ({ ok: false, status }));
      await expect(streamChat({ apiKey: KEY, context: 'c', fetchImpl })).rejects.toMatchObject({ code });
    }
  });

  it('reports an empty stream and network failures', async () => {
    const emptyFetch = vi.fn(async () => streamingResponse([]));
    await expect(streamChat({ apiKey: KEY, context: 'c', fetchImpl: emptyFetch })).rejects.toBeInstanceOf(
      ChatError
    );

    const failing = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(streamChat({ apiKey: KEY, context: 'c', fetchImpl: failing })).rejects.toMatchObject({
      code: 'network',
    });
  });

  it('lets an abort propagate', async () => {
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
    const fetchImpl = vi.fn(async () => {
      throw abort;
    });
    await expect(streamChat({ apiKey: KEY, context: 'c', fetchImpl })).rejects.toBe(abort);
  });
});

describe('fallback answers', () => {
  const base = { conditions: CONDITIONS, profile: PROFILE, plan: PLAN, lang: 'en' };

  it('routes common questions to specific answers', () => {
    expect(detectTopic('Is it safe to go out tonight?')).toBe('out');
    expect(detectTopic('Should I wear an N95?')).toBe('mask');
    expect(detectTopic('What about my child?')).toBe('kids');
    expect(detectTopic('Can I run at 6 pm?')).toBe('exercise');
    expect(detectTopic('Tell me something')).toBe('general');
  });

  it('grounds answers in today’s readings', () => {
    const out = fallbackAnswer({ ...base, question: 'Is it safe to go out?' });
    expect(out.topic).toBe('out');
    expect(out.text).toContain('320');
    expect(out.text).toContain('2 pm');

    const mask = fallbackAnswer({ ...base, question: 'Should I wear a mask?' });
    expect(mask.text).toContain('95%');

    const kids = fallbackAnswer({ ...base, question: 'What about my child?' });
    expect(kids.text).toMatch(/doctor/i);
  });

  it('answers in the selected language', () => {
    const hindi = fallbackAnswer({ ...base, question: 'क्या बाहर जाना सुरक्षित है?', lang: 'hi' });
    const kannada = fallbackAnswer({ ...base, question: 'ಮಾಸ್ಕ್ ಬೇಕೇ?', lang: 'kn' });

    expect(hindi.text).toMatch(/[\u0900-\u097F]/);
    expect(kannada.text).toMatch(/[\u0C80-\u0CFF]/);
  });

  it('still answers when the forecast window is missing', () => {
    const out = fallbackAnswer({
      ...base,
      conditions: { ...CONDITIONS, bestWindow: null },
      question: 'safe to go out?',
    });
    expect(out.text).toContain('not available today');
    expect(out.text.length).toBeGreaterThan(40);
  });
});
