import { describe, expect, it } from 'vitest';
import {
  AQI_MAX,
  BANDS,
  averagePm25,
  bandClass,
  bandForAqi,
  bestOutdoorWindow,
  cpcbAqiFromPm25,
  hourOf,
  isElevated,
  next24Hours,
} from '../src/lib/aqi.js';

/** Build an hourly series of 24 entries with fixed local timestamps. */
function series(values, date = '2026-11-17') {
  return values.map((pm25, hour) => ({
    time: `${date}T${String(hour).padStart(2, '0')}:00`,
    pm25,
  }));
}

describe('cpcbAqiFromPm25', () => {
  it('maps the CPCB breakpoint edges exactly', () => {
    expect(cpcbAqiFromPm25(0)).toBe(0);
    expect(cpcbAqiFromPm25(30)).toBe(50);
    expect(cpcbAqiFromPm25(60)).toBe(100);
    expect(cpcbAqiFromPm25(90)).toBe(200);
    expect(cpcbAqiFromPm25(120)).toBe(300);
    expect(cpcbAqiFromPm25(250)).toBe(400);
    expect(cpcbAqiFromPm25(500)).toBe(AQI_MAX);
  });

  it('interpolates inside a band', () => {
    expect(cpcbAqiFromPm25(15)).toBe(25);
    expect(cpcbAqiFromPm25(80)).toBe(167);
    expect(cpcbAqiFromPm25(100)).toBe(234);
  });

  it('clamps very high values and rejects invalid input', () => {
    expect(cpcbAqiFromPm25(1200)).toBe(AQI_MAX);
    expect(cpcbAqiFromPm25(-1)).toBeNull();
    expect(cpcbAqiFromPm25(Number.NaN)).toBeNull();
    expect(cpcbAqiFromPm25('90')).toBeNull();
    expect(cpcbAqiFromPm25(undefined)).toBeNull();
  });
});

describe('bandForAqi', () => {
  it.each([
    [0, 'good'],
    [50, 'good'],
    [51, 'satisfactory'],
    [100, 'satisfactory'],
    [101, 'moderate'],
    [200, 'moderate'],
    [201, 'poor'],
    [300, 'poor'],
    [301, 'verypoor'],
    [400, 'verypoor'],
    [401, 'severe'],
    [500, 'severe'],
    [900, 'severe'],
  ])('maps AQI %s to %s', (aqi, id) => {
    expect(bandForAqi(aqi).id).toBe(id);
  });

  it('gives every band a non-colour cue', () => {
    for (const band of BANDS) {
      expect(band.icon.length).toBeGreaterThan(0);
    }
    expect(bandClass(210)).toBe('band-poor');
  });

  it('handles unknown values safely', () => {
    expect(bandForAqi(undefined).id).toBe('unknown');
    expect(bandForAqi(-5).id).toBe('unknown');
  });
});

describe('isElevated', () => {
  it('flags AQI above 100 only', () => {
    expect(isElevated(100)).toBe(false);
    expect(isElevated(101)).toBe(true);
    expect(isElevated(Number.NaN)).toBe(false);
  });
});

describe('averagePm25', () => {
  it('averages the available readings and ignores gaps', () => {
    expect(averagePm25([{ pm25: 10 }, { pm25: null }, { pm25: 20 }])).toBe(15);
    expect(averagePm25([])).toBeNull();
    expect(averagePm25(undefined)).toBeNull();
  });
});

describe('hourOf', () => {
  it('reads the local hour from an Open-Meteo timestamp', () => {
    expect(hourOf('2026-11-17T15:00')).toBe(15);
    expect(hourOf('2026-11-17T00:00')).toBe(0);
    expect(hourOf('nonsense')).toBeNull();
    expect(hourOf(undefined)).toBeNull();
  });
});

describe('bestOutdoorWindow', () => {
  it('picks the cleanest contiguous daylight window', () => {
    const values = Array.from({ length: 24 }, () => 80);
    values[14] = 20;
    values[15] = 20;

    const best = bestOutdoorWindow(series(values));
    expect(best).toEqual({ startHour: 14, endHour: 16, pm25: 20, date: '2026-11-17' });
  });

  it('never runs past the end hour or into a gap', () => {
    const values = Array.from({ length: 24 }, () => 60);
    values[21] = 1; // two-hour window would end at 23, outside the limit
    const best = bestOutdoorWindow(series(values));

    expect(best.startHour).toBeLessThanOrEqual(20);
    expect(best.endHour).toBeLessThanOrEqual(22);
    expect(best.startHour).not.toBe(21);
  });

  it('returns null when there is not enough data', () => {
    expect(bestOutdoorWindow([])).toBeNull();
    expect(bestOutdoorWindow(null)).toBeNull();
    expect(bestOutdoorWindow([{ time: '2026-11-17T10:00', pm25: 40 }])).toBeNull();
  });
});

describe('next24Hours', () => {
  it('starts at the current hour and returns at most 24 entries', () => {
    const hours = Array.from({ length: 36 }, (_, index) => ({
      time: `2026-11-17T${String(index % 24).padStart(2, '0')}:00`,
      pm25: index,
    }));
    const next = next24Hours(hours, '2026-11-17T10:00');

    expect(next).toHaveLength(24);
    expect(next[0].time).toBe('2026-11-17T10:00');
  });

  it('falls back to the start when the current hour is missing', () => {
    const next = next24Hours(series(Array.from({ length: 30 }, () => 50)), '');
    expect(next).toHaveLength(24);
    expect(next[0].time).toBe('2026-11-17T00:00');
    expect(next24Hours([], '2026-11-17T10:00')).toEqual([]);
  });
});
