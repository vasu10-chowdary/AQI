/**
 * AQI utilities.
 *
 * Winter smog in Indian cities is dominated by PM2.5, so the app derives a
 * CPCB-style AQI from the PM2.5 sub-index instead of borrowing a US or EU
 * scale. The sub-index uses the official 24-hour PM2.5 breakpoints.
 */

/** CPCB 24-hour PM2.5 breakpoints: [concentration low, high, AQI low, high]. */
const PM25_BREAKPOINTS = [
  [0, 30, 0, 50],
  [30, 60, 51, 100],
  [60, 90, 101, 200],
  [90, 120, 201, 300],
  [120, 250, 301, 400],
  [250, 500, 401, 500],
];

/** Ordered AQI bands. `icon` is a redundant (non-colour) cue for each band. */
export const BANDS = [
  { id: 'good', max: 50, icon: '🙂' },
  { id: 'satisfactory', max: 100, icon: '😌' },
  { id: 'moderate', max: 200, icon: '😐' },
  { id: 'poor', max: 300, icon: '😷' },
  { id: 'verypoor', max: 400, icon: '⚠️' },
  { id: 'severe', max: 500, icon: '🚨' },
];

export const AQI_MAX = 500;

/**
 * CPCB AQI from a PM2.5 concentration (µg/m³, 24-hour average basis).
 * Returns null for invalid input and clamps very high values at 500.
 *
 * @param {number} pm25
 * @returns {number|null}
 */
export function cpcbAqiFromPm25(pm25) {
  if (!Number.isFinite(pm25) || pm25 < 0) return null;
  const value = Math.min(pm25, PM25_BREAKPOINTS.at(-1)[1]);

  for (const [cLow, cHigh, iLow, iHigh] of PM25_BREAKPOINTS) {
    if (value <= cHigh) {
      const aqi = iLow + ((iHigh - iLow) / (cHigh - cLow)) * (value - cLow);
      return Math.round(Math.max(iLow, Math.min(iHigh, aqi)));
    }
  }
  return AQI_MAX;
}

/**
 * @param {number|null|undefined} aqi
 * @returns {{id: string, max: number, icon: string}}
 */
export function bandForAqi(aqi) {
  if (!Number.isFinite(aqi) || aqi < 0) return { id: 'unknown', max: 0, icon: '❔' };
  return BANDS.find((band) => aqi <= band.max) ?? BANDS.at(-1);
}

/** CSS class carrying the band colour tokens. */
export function bandClass(aqi) {
  return `band-${bandForAqi(aqi).id}`;
}

/** True when outdoor activity should be limited for sensitive groups. */
export function isElevated(aqi) {
  return Number.isFinite(aqi) && aqi > 100;
}

/** Mean PM2.5 across hourly entries, ignoring gaps. */
export function averagePm25(hourly) {
  const values = (hourly || []).map((entry) => entry.pm25).filter(Number.isFinite);
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Local hour (0–23) encoded in an Open-Meteo ISO-like local timestamp. */
export function hourOf(timestamp) {
  const match = /T(\d{2}):/.exec(String(timestamp ?? ''));
  return match ? Number(match[1]) : null;
}

/**
 * Find the cleanest 2-hour daylight window in the forecast.
 *
 * @param {Array<{time: string, pm25: number}>} hourly
 * @param {{startHour?: number, endHour?: number, windowHours?: number}} [options]
 * @returns {{startHour: number, endHour: number, pm25: number, date: string} | null}
 */
export function bestOutdoorWindow(hourly, options = {}) {
  const { startHour = 6, endHour = 22, windowHours = 2 } = options;
  const usable = (hourly || []).filter(
    (entry) => Number.isFinite(entry.pm25) && hourOf(entry.time) !== null
  );
  if (usable.length < windowHours) return null;

  let best = null;
  for (let index = 0; index + windowHours <= usable.length; index += 1) {
    const window = usable.slice(index, index + windowHours);
    const start = hourOf(window[0].time);
    if (start === null || start < startHour || start + windowHours > endHour) continue;

    // Reject windows that skip an hour (e.g. after filtering or across midnight).
    const contiguous = window.every((entry, offset) => hourOf(entry.time) === start + offset);
    if (!contiguous) continue;

    const mean = window.reduce((sum, entry) => sum + entry.pm25, 0) / windowHours;
    if (!best || mean < best.pm25) {
      best = {
        startHour: start,
        endHour: start + windowHours,
        pm25: mean,
        date: String(window[0].time).slice(0, 10),
      };
    }
  }
  return best;
}

/**
 * Keep the next 24 forecast hours starting at (and including) the current hour.
 * Open-Meteo returns local timestamps without offsets, so string comparison is
 * safe and avoids the browser's timezone.
 */
export function next24Hours(hourly, currentTime) {
  const entries = (hourly || []).filter(
    (entry) => typeof entry.time === 'string' && Number.isFinite(entry.pm25)
  );
  if (entries.length === 0) return [];
  const from = typeof currentTime === 'string' ? currentTime.slice(0, 13) : '';
  const startIndex = entries.findIndex((entry) => entry.time.slice(0, 13) >= from);
  return entries.slice(Math.max(0, startIndex), Math.max(0, startIndex) + 24);
}
