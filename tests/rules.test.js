import { describe, expect, it } from 'vitest';
import { DEFAULT_PROFILE, normalizeProfile } from '../src/lib/profile.js';
import {
  EFFORT_LABELS,
  PLAN_CATEGORIES,
  buildRulePlan,
  healthWarnings,
} from '../src/lib/rules.js';

const BAD_WINDOW = { startHour: 15, endHour: 17, pm25: 180, date: '2026-11-17' };

function profile(overrides = {}) {
  return normalizeProfile({ ...DEFAULT_PROFILE, ...overrides });
}

const KANNADA = /[\u0C80-\u0CFF]/;
const DEVANAGARI = /[\u0900-\u097F]/;

function expectWellFormed(items) {
  expect(items.length).toBeGreaterThanOrEqual(3);
  expect(items.length).toBeLessThanOrEqual(6);

  for (const item of items) {
    expect(PLAN_CATEGORIES.map((entry) => entry.id)).toContain(item.category);
    expect(Object.keys(EFFORT_LABELS)).toContain(item.effort);
    expect(item.action.length).toBeGreaterThan(0);
    expect(item.why_it_helps.length).toBeGreaterThan(0);
    expect(item.estimated_impact.length).toBeGreaterThan(0);
    expect(item.basis.length).toBeGreaterThan(0);
  }

  const ids = items.map((item) => item.id);
  expect(new Set(ids).size).toBe(ids.length);
}

describe('buildRulePlan', () => {
  it('builds a full, well-formed plan on a very poor day', () => {
    const items = buildRulePlan({
      aqi: 320,
      pm25: 268,
      profile: profile({ household: ['kids'], homeSetup: { purifier: false, ac: false, windowsOpen: true } }),
      bestWindow: BAD_WINDOW,
      lang: 'en',
    });

    expectWellFormed(items);
    const ids = items.map((item) => item.id);
    expect(ids).toContain('mask');
    expect(ids).toContain('sensitive');

    for (const category of ['routine', 'indoors', 'sustainable']) {
      expect(items.some((item) => item.category === category)).toBe(true);
    }
  });

  it('always returns at least one tip for every category', () => {
    const cases = [
      { aqi: 40, pm25: 25, bestWindow: null },
      {
        aqi: 40,
        pm25: 25,
        bestWindow: { startHour: 8, endHour: 10, pm25: 18, date: '2026-11-17' },
      },
      { aqi: 180, pm25: 150, bestWindow: BAD_WINDOW },
      { aqi: 420, pm25: 340, bestWindow: BAD_WINDOW },
    ];

    for (const scenario of cases) {
      const items = buildRulePlan({
        ...scenario,
        profile: profile({ homeSetup: { purifier: true, ac: true, windowsOpen: false }, cookingFuel: 'electric' }),
        lang: 'en',
      });

      for (const category of ['routine', 'indoors', 'sustainable']) {
        expect(
          items.some((item) => item.category === category),
          `missing ${category} at AQI ${scenario.aqi}`
        ).toBe(true);
      }
    }
  });

  it('does not suggest masks or emergency measures on a clean day', () => {
    const items = buildRulePlan({
      aqi: 45,
      pm25: 26,
      profile: profile({ homeSetup: { purifier: false, ac: false, windowsOpen: false }, cookingFuel: 'electric' }),
      bestWindow: { startHour: 7, endHour: 9, pm25: 20, date: '2026-11-17' },
      lang: 'en',
    });

    expectWellFormed(items);
    const ids = items.map((item) => item.id);
    expect(ids).not.toContain('mask');
    expect(ids).toContain('ventilate');
    expect(ids).not.toContain('closeWindows');
  });

  it('explains the mask by commute exposure, not a diluted daily share', () => {
    const items = buildRulePlan({
      aqi: 320,
      pm25: 268,
      profile: profile({ household: ['kids'] }),
      bestWindow: BAD_WINDOW,
      lang: 'en',
    });

    const mask = items.find((item) => item.id === 'mask');
    expect(mask).toBeTruthy();
    expect(mask.estimated_impact).toContain('90%');
    expect(mask.estimated_impact).toMatch(/commute/);
  });

  it('reacts to the profile: biomass cooking and a car commute', () => {
    const items = buildRulePlan({
      aqi: 260,
      pm25: 200,
      profile: profile({ cookingFuel: 'biomass', commuteMode: 'car', household: ['asthma'] }),
      bestWindow: BAD_WINDOW,
      lang: 'en',
    });

    const ids = items.map((item) => item.id);
    expect(ids).toContain('fuel');
    expect(ids).toContain('metroSwap');
    expect(items.find((item) => item.id === 'metroSwap').estimated_impact).toMatch(/\d/);
  });

  it('reports the cooking-plume reduction rather than a rounded 0%', () => {
    const items = buildRulePlan({
      aqi: 320,
      pm25: 268,
      profile: profile({
        cookingFuel: 'lpg',
        homeSetup: { purifier: true, ac: false, windowsOpen: false },
      }),
      bestWindow: BAD_WINDOW,
      lang: 'en',
    });

    const vent = items.find((item) => item.id === 'cookVent');
    expect(vent).toBeTruthy();
    expect(vent.estimated_impact).toContain('60%');
    expect(vent.estimated_impact).not.toContain('About 0%');
  });

  it('reports the full cooking-plume removal when the fuel changes', () => {
    const items = buildRulePlan({
      aqi: 260,
      pm25: 200,
      profile: profile({ cookingFuel: 'kerosene' }),
      bestWindow: BAD_WINDOW,
      lang: 'en',
    });

    const fuel = items.find((item) => item.id === 'fuel');
    expect(fuel).toBeTruthy();
    expect(fuel.estimated_impact).toContain('100% less PM2.5 from cooking');
  });

  it('does not offer a metro swap to someone who already takes the metro', () => {
    const items = buildRulePlan({
      aqi: 260,
      pm25: 200,
      profile: profile({ commuteMode: 'metro' }),
      bestWindow: BAD_WINDOW,
      lang: 'en',
    });

    expect(items.map((item) => item.id)).not.toContain('metroSwap');
  });

  it('writes copy in the selected language', () => {
    const hindi = buildRulePlan({
      aqi: 320,
      pm25: 268,
      profile: profile({ language: 'hi', household: ['kids'] }),
      bestWindow: BAD_WINDOW,
      lang: 'hi',
    });
    const kannada = buildRulePlan({
      aqi: 320,
      pm25: 268,
      profile: profile({ language: 'kn', household: ['kids'] }),
      bestWindow: BAD_WINDOW,
      lang: 'kn',
    });

    expect(hindi.map((item) => item.action).join(' ')).toMatch(DEVANAGARI);
    expect(kannada.map((item) => item.action).join(' ')).toMatch(KANNADA);
    expectWellFormed(hindi);
    expectWellFormed(kannada);
  });

  it('falls back to English copy for an unsupported language', () => {
    const items = buildRulePlan({
      aqi: 250,
      pm25: 190,
      profile: profile(),
      bestWindow: BAD_WINDOW,
      lang: 'fr',
    });

    expect(items.map((item) => item.action).join(' ')).not.toMatch(DEVANAGARI);
    expect(items.map((item) => item.action).join(' ')).not.toMatch(KANNADA);
    expectWellFormed(items);
  });

  it('handles a missing forecast window', () => {
    const items = buildRulePlan({
      aqi: 320,
      pm25: 268,
      profile: profile({ household: ['elderly'] }),
      bestWindow: null,
      lang: 'en',
    });

    expect(items.map((item) => item.id)).not.toContain('bestWindow');
    expectWellFormed(items);
  });
});

describe('healthWarnings', () => {
  it('gives a danger warning above 300 and always the doctor notice', () => {
    const warnings = healthWarnings({ aqi: 340, profile: profile(), lang: 'en' });

    expect(warnings[0].level).toBe('danger');
    expect(warnings.at(-1).text).toMatch(/doctor/i);
  });

  it('escalates for sensitive groups at lower AQI', () => {
    const kids = healthWarnings({ aqi: 240, profile: profile({ household: ['kids'] }), lang: 'en' });
    const asthma = healthWarnings({
      aqi: 240,
      profile: profile({ household: ['asthma'] }),
      lang: 'en',
    });

    expect(kids.some((entry) => entry.level === 'danger')).toBe(true);
    expect(asthma.filter((entry) => entry.level === 'warn')).toHaveLength(1);
    expect(asthma.map((entry) => entry.text).join(' ')).toMatch(/doctor/i);
  });

  it('is reassuring on a clean day and never empty', () => {
    const warnings = healthWarnings({ aqi: 40, profile: profile(), lang: 'en' });
    expect(warnings.length).toBeGreaterThanOrEqual(2);
    expect(warnings[0].level).toBe('info');
  });

  it('localises the safety notices', () => {
    const warnings = healthWarnings({ aqi: 340, profile: profile(), lang: 'hi' });
    expect(warnings.map((entry) => entry.text).join(' ')).toMatch(DEVANAGARI);
  });
});
