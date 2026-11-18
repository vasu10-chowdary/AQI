/**
 * Deterministic "your day" timeline.
 *
 * Three slots are built from the hourly forecast and the profile. The copy is
 * localised, every number comes from the measured/sample data, and the slot
 * choices are stable so the output is testable. Gemini may reword the actions
 * later; it never changes which action applies.
 */

import { cpcbAqiFromPm25, hourOf } from './aqi.js';
import { formatHour, t } from './i18n.js';

export const SLOTS = Object.freeze([
  { id: 'morning', startHour: 6, endHour: 11, labelKey: 'timeline.morning' },
  { id: 'afternoon', startHour: 11, endHour: 17, labelKey: 'timeline.afternoon' },
  { id: 'evening', startHour: 17, endHour: 22, labelKey: 'timeline.evening' },
]);

const MOTORISED = ['car', 'two_wheeler', 'bus'];

/** Mean and peak of the forecast inside a local-hour window. */
export function slotStats(hourly, startHour, endHour) {
  const entries = (hourly || []).filter((entry) => {
    const hour = hourOf(entry.time);
    return Number.isFinite(entry.pm25) && hour !== null && hour >= startHour && hour < endHour;
  });

  if (entries.length === 0) return null;

  const peak = entries.reduce((best, entry) => (entry.pm25 > best.pm25 ? entry : best), entries[0]);
  const mean = entries.reduce((sum, entry) => sum + entry.pm25, 0) / entries.length;

  return {
    meanPm25: mean,
    peakPm25: peak.pm25,
    peakHour: hourOf(peak.time),
    aqi: cpcbAqiFromPm25(mean),
    peakAqi: cpcbAqiFromPm25(peak.pm25),
  };
}

function fallbackStats(pm25) {
  const value = Number.isFinite(pm25) ? pm25 : 0;
  return { meanPm25: value, peakPm25: value, peakHour: 8, aqi: cpcbAqiFromPm25(value), peakAqi: cpcbAqiFromPm25(value) };
}

const pct = (value) => Math.max(0, Math.round(value));

/**
 * Build the Morning / Afternoon / Evening schedule.
 *
 * @param {{aqi:number, pm25:number, hourly:Array, profile:object, bestWindow:?object, lang:string}} input
 * @returns {Array<{id:string,label:string,range:string,aqi:number,action:string,impact:string}>}
 */
export function buildTimeline({ aqi, pm25, hourly = [], profile, bestWindow, lang = 'en' }) {
  const morning = slotStats(hourly, 6, 11) || fallbackStats(pm25);
  const afternoon = slotStats(hourly, 11, 17) || fallbackStats(pm25);
  const evening = slotStats(hourly, 17, 22) || fallbackStats(pm25);

  const hasWindow = Boolean(bestWindow);
  const bestAqi = hasWindow ? cpcbAqiFromPm25(bestWindow.pm25) ?? 0 : null;
  const bestStart = hasWindow ? formatHour(bestWindow.startHour, lang) : '';
  const bestEnd = hasWindow ? formatHour(bestWindow.endHour, lang) : '';
  const bestLabel = hasWindow ? `${bestStart}–${bestEnd}` : '';
  const exercise = profile.exercise !== 'none';
  const motorised = MOTORISED.includes(profile.commuteMode);
  const hasChildren = (profile.household || []).includes('kids');
  const hasPurifier = Boolean(profile.homeSetup?.purifier);

  const slots = [];

  /* ------------------------------- morning ------------------------------- */
  if (exercise && morning.peakAqi > 100) {
    slots.push({
      id: 'morning',
      aqi: morning.peakAqi,
      hour: morning.peakHour,
      action: hasWindow
        ? t('timeline.exerciseAction', lang, { time: formatHour(morning.peakHour, lang), best: bestLabel })
        : t('timeline.exerciseIndoorAction', lang, { time: formatHour(morning.peakHour, lang) }),
      impact: hasWindow
        ? t('timeline.exerciseImpact', lang, { now: morning.peakAqi, best: bestAqi })
        : t('timeline.exerciseIndoorImpact', lang, { aqi: afternoon.aqi }),
    });
  } else if (motorised && morning.peakAqi > 100) {
    slots.push({
      id: 'morning',
      aqi: morning.peakAqi,
      hour: morning.peakHour,
      action: hasChildren ? t('timeline.schoolAction', lang) : t('timeline.maskAction', lang),
      impact: t('timeline.maskImpact', lang),
    });
  } else {
    slots.push({
      id: 'morning',
      aqi: morning.aqi,
      hour: morning.peakHour,
      action: t('timeline.cleanMorningAction', lang),
      impact: t('timeline.cleanMorningImpact', lang, { aqi: morning.aqi }),
    });
  }

  /* ------------------------------ afternoon ------------------------------ */
  const windowInAfternoon = hasWindow && bestWindow.startHour >= 11 && bestWindow.startHour < 17;
  const windowPct = hasWindow && pm25 > 0 ? pct((1 - bestWindow.pm25 / pm25) * 100) : 0;

  if (windowInAfternoon) {
    slots.push({
      id: 'afternoon',
      aqi: bestAqi,
      hour: bestWindow.startHour,
      action: t('timeline.errandAction', lang, { start: bestStart, end: bestEnd }),
      impact: t('timeline.errandImpact', lang, { aqi: bestAqi, pct: windowPct }),
    });
  } else if (hasPurifier) {
    slots.push({
      id: 'afternoon',
      aqi: afternoon.aqi,
      hour: afternoon.peakHour,
      action: t('timeline.purifierAction', lang),
      impact: t('timeline.purifierImpact', lang),
    });
  } else {
    slots.push({
      id: 'afternoon',
      aqi: afternoon.aqi,
      hour: afternoon.peakHour,
      action: t('timeline.windowsAction', lang),
      impact: t('timeline.windowsImpact', lang, { aqi: afternoon.aqi }),
    });
  }

  /* ------------------------------- evening ------------------------------- */
  const eveningIsPeak = evening.peakPm25 > afternoon.meanPm25 && evening.peakAqi > 150;
  const peakPct =
    afternoon.aqi > 0 ? pct((evening.peakAqi / afternoon.aqi - 1) * 100) : 0;

  if (eveningIsPeak) {
    slots.push({
      id: 'evening',
      aqi: evening.peakAqi,
      hour: evening.peakHour,
      action: t('timeline.peakAction', lang, { time: formatHour(evening.peakHour, lang) }),
      impact: t('timeline.peakImpact', lang, { aqi: evening.peakAqi, pct: peakPct }),
    });
  } else if (motorised && evening.aqi > 100) {
    slots.push({
      id: 'evening',
      aqi: evening.aqi,
      hour: evening.peakHour,
      action: t('timeline.maskAction', lang),
      impact: t('timeline.maskImpact', lang),
    });
  } else {
    slots.push({
      id: 'evening',
      aqi: evening.aqi,
      hour: evening.peakHour,
      action: t('timeline.ventilateAction', lang),
      impact: t('timeline.ventilateImpact', lang, { aqi: evening.aqi }),
    });
  }

  return SLOTS.map((slot) => {
    const item = slots.find((entry) => entry.id === slot.id);
    return {
      id: slot.id,
      label: t(slot.labelKey, lang),
      range: `${formatHour(slot.startHour, lang)}–${formatHour(slot.endHour, lang)}`,
      aqi: item?.aqi ?? 0,
      action: item?.action ?? '',
      impact: item?.impact ?? '',
      time: t('timeline.now', lang, {
        aqi: item?.aqi ?? 0,
        time: formatHour(item?.hour ?? slot.startHour + 2, lang),
      }),
    };
  });
}

