/**
 * Fixed sample data for demos, screenshots and talks.
 *
 * The numbers are internally consistent with the CPCB PM2.5 sub-index used by
 * the app: 146 µg/m³ maps to AQI 320, which is the winter-smog story we want to
 * show. Presenting 190 µg/m³ next to "AQI 320" would contradict the app's own
 * breakpoints, so the sample uses the concentration that actually produces 320.
 */

import { cpcbAqiFromPm25 } from './aqi.js';

export const DEMO_LOCATION = Object.freeze({
  name: 'Delhi',
  admin1: 'Delhi',
  lat: 28.6139,
  lon: 77.209,
});

/** PM2.5 by local hour: a smoggy morning, a cleaner afternoon, an evening peak. */
const HOURLY_BY_HOUR = {
  0: 172,
  1: 160,
  2: 152,
  3: 148,
  4: 145,
  5: 150,
  6: 138,
  7: 152,
  8: 145,
  9: 138,
  10: 130,
  11: 122,
  12: 115,
  13: 108,
  14: 100,
  15: 96,
  16: 104,
  17: 118,
  18: 140,
  19: 170,
  20: 195,
  21: 210,
  22: 202,
  23: 185,
};

const SAMPLE_DATE = '2026-11-18';
const SAMPLE_START_HOUR = 6;

/**
 * Build a fresh copy of the sample. Times are fixed so screenshots and tests are
 * stable; the data is never presented as live.
 */
export function createDemoSample() {
  const hourly = [];
  for (let index = 0; index < 24; index += 1) {
    const hour = (SAMPLE_START_HOUR + index) % 24;
    const day = SAMPLE_START_HOUR + index < 24 ? SAMPLE_DATE : '2026-11-19';
    hourly.push({
      time: `${day}T${String(hour).padStart(2, '0')}:00`,
      pm25: HOURLY_BY_HOUR[hour],
      usAqi: null,
    });
  }

  const currentPm25 = HOURLY_BY_HOUR[8];

  return {
    location: { ...DEMO_LOCATION },
    air: {
      current: {
        pm25: currentPm25,
        pm10: 212,
        usAqi: 197,
        carbonMonoxide: 1400,
        nitrogenDioxide: 52,
        time: `${SAMPLE_DATE}T08:00`,
      },
      hourly,
      timezone: 'Asia/Kolkata',
      fetchedAt: Date.parse(`${SAMPLE_DATE}T08:00:00+05:30`),
      sample: true,
    },
    aqi: cpcbAqiFromPm25(currentPm25),
  };
}
