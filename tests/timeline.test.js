import { describe, expect, it } from 'vitest';
import { buildTimeline, slotStats, SLOTS } from '../src/lib/timeline.js';
import { createDemoSample } from '../src/lib/demo.js';
import { bestOutdoorWindow } from '../src/lib/aqi.js';
import { DEFAULT_PROFILE, normalizeProfile } from '../src/lib/profile.js';

const { air } = createDemoSample();
const bestWindow = bestOutdoorWindow(air.hourly);

function profile(overrides = {}) {
  return normalizeProfile({ ...DEFAULT_PROFILE, ...overrides });
}

function build(overrides = {}, lang = 'en') {
  return buildTimeline({
    aqi: 320,
    pm25: 146,
    hourly: air.hourly,
    profile: profile(overrides.profile),
    bestWindow: 'bestWindow' in overrides ? overrides.bestWindow : bestWindow,
    lang,
  });
}

describe('slotStats', () => {
  it('finds the window mean and peak hour', () => {
    const stats = slotStats(air.hourly, 17, 22);

    expect(stats.meanPm25).toBeGreaterThan(150);
    expect(stats.peakHour).toBe(21);
    expect(stats.peakAqi).toBeGreaterThan(stats.aqi);
  });

  it('returns null without usable data', () => {
    expect(slotStats([], 6, 11)).toBeNull();
    expect(slotStats([{ time: 'bad', pm25: 10 }], 6, 11)).toBeNull();
  });
});

describe('buildTimeline', () => {
  it('returns exactly three ordered slots with copy', () => {
    const timeline = build();

    expect(timeline.map((slot) => slot.id)).toEqual(SLOTS.map((slot) => slot.id));
    expect(timeline.map((slot) => slot.label)).toEqual(['Morning', 'Afternoon', 'Evening']);

    for (const slot of timeline) {
      expect(slot.action.length).toBeGreaterThan(8);
      expect(slot.impact.length).toBeGreaterThan(8);
      expect(slot.range).toMatch(/–/);
      expect(Number.isFinite(slot.aqi)).toBe(true);
    }
  });

  it('moves an outdoor workout to the clean window on a bad morning', () => {
    const morning = build({ profile: { exercise: 'moderate' } })[0];

    expect(morning.action).toMatch(/^Skip the/);
    expect(morning.action).toContain('7 am');
    expect(morning.action).toMatch(/go out at/);
    expect(morning.impact).toMatch(/AQI \d+ this morning vs \d+/);
    expect(morning.time).toContain('7 am');
  });

  it('tells a motorised commuter to mask up when they do not exercise', () => {
    const morning = build({ profile: { exercise: 'none', commuteMode: 'two_wheeler' } })[0];
    expect(morning.action).toMatch(/N95/);
  });

  it('uses the school run when the household has children', () => {
    const morning = build({
      profile: { exercise: 'none', commuteMode: 'car', household: ['kids'] },
    })[0];
    expect(morning.action).toMatch(/school run/i);
  });

  it('schedules errands into an afternoon clean window', () => {
    const afternoon = build()[1];

    expect(afternoon.action).toMatch(/errands/);
    expect(afternoon.action).toContain('2 pm');
    expect(afternoon.impact).toMatch(/below today’s average/);
  });

  it('closes windows before the evening peak', () => {
    const evening = build()[2];

    expect(evening.action).toMatch(/Close the windows before/);
    expect(evening.action).toContain('9 pm');
    expect(evening.impact).toMatch(/above midday/);
  });

  it('opens up on a clean day', () => {
    const cleanHourly = air.hourly.map((entry) => ({ ...entry, pm25: 20 }));
    const timeline = buildTimeline({
      aqi: 33,
      pm25: 20,
      hourly: cleanHourly,
      profile: profile({ exercise: 'moderate' }),
      bestWindow: { startHour: 8, endHour: 10, pm25: 18, date: '2026-11-18' },
      lang: 'en',
    });

    expect(timeline[0].action).toMatch(/Open the windows/);
    expect(timeline[2].action).toMatch(/after dinner/);
    for (const slot of timeline) expect(slot.aqi).toBeLessThanOrEqual(50);
  });

  it('falls back to the current PM2.5 when the forecast is missing', () => {
    const timeline = build({ hourly: [], bestWindow: null });

    expect(timeline).toHaveLength(3);
    for (const slot of timeline) {
      expect(slot.action.length).toBeGreaterThan(8);
      expect(slot.impact.length).toBeGreaterThan(8);
    }
  });

  it('localises both the slots and the actions', () => {
    const hindi = build({ profile: { exercise: 'moderate' } }, 'hi');
    const kannada = build({ profile: { exercise: 'moderate' } }, 'kn');

    expect(hindi.map((slot) => slot.label)).toEqual(['सुबह', 'दोपहर', 'शाम']);
    expect(hindi[0].action).toMatch(/[\u0900-\u097F]/);
    expect(kannada[0].action).toMatch(/[\u0C80-\u0CFF]/);
  });
});
