import { describe, expect, it } from 'vitest';
import { DEMO_LOCATION, createDemoSample } from '../src/lib/demo.js';
import { averagePm25, bestOutdoorWindow, cpcbAqiFromPm25 } from '../src/lib/aqi.js';

describe('createDemoSample', () => {
  it('produces the promised bad-air day', () => {
    const { air, location, aqi } = createDemoSample();

    expect(location).toEqual({ ...DEMO_LOCATION });
    expect(aqi).toBe(320);
    expect(cpcbAqiFromPm25(air.current.pm25)).toBe(320);
    expect(air.current.pm25).toBe(145);
    expect(air.sample).toBe(true);
    expect(air.hourly).toHaveLength(24);
  });

  it('has a morning peak, an afternoon dip and an evening peak', () => {
    const { air } = createDemoSample();
    const byHour = Object.fromEntries(
      air.hourly.map((entry) => [Number(entry.time.slice(11, 13)), entry.pm25])
    );

    expect(byHour[8]).toBeGreaterThan(130);
    expect(byHour[15]).toBeLessThan(byHour[8]);
    expect(byHour[21]).toBeGreaterThan(byHour[15]);
    expect(byHour[21]).toBeGreaterThan(180);
  });

  it('puts the cleanest window in the afternoon', () => {
    const { air } = createDemoSample();
    const best = bestOutdoorWindow(air.hourly);

    expect(best).toBeTruthy();
    expect(best.startHour).toBeGreaterThanOrEqual(12);
    expect(best.startHour).toBeLessThan(17);
    expect(best.pm25).toBeLessThan(averagePm25(air.hourly));
  });

  it('returns an independent copy every time', () => {
    const first = createDemoSample();
    const second = createDemoSample();
    first.air.current.pm25 = 1;
    first.location.name = 'Changed';

    expect(second.air.current.pm25).toBe(145);
    expect(second.location.name).toBe('Delhi');
  });
});
