/**
 * First-order exposure and emissions model.
 *
 * The goal is honest, comparable estimates — not measurement. Every constant
 * below is surfaced in the UI ("How is this calculated?"), and the README
 * repeats the assumptions. Units: PM2.5 in µg/m³, time in hours, ventilation in
 * m³ of air breathed per hour.
 */

export const CONSTANTS = Object.freeze({
  cigarettePm25: 22, // 24h-average µg/m³ ≈ 1 cigarette/day (Berkeley Earth)
  n95Filtration: 0.95, // NIOSH, well fitted
  hepaReduction: 0.65, // midpoint of a 50–80% indoor PM2.5 reduction
  infiltrationClosed: 0.72,
  infiltrationOpen: 0.95,
  ventilationRest: 0.55, // m³/h
  ventilationExercise: 1.6, // moderate exercise
  referenceVentilation: 0.8, // converts a daily dose to an equivalent 24h concentration
  commuteHoursPerDay: 1,
  cookingHours: 1.5,
  carCo2PerKm: 0.17,
  metroCo2PerKm: 0.03,
  busCo2PerKm: 0.04,
  twoWheelerCo2PerKm: 0.05,
  workDaysPerWeek: 5,
  exerciseIndoorVentilation: 1.3,
});

/** Outdoor-hours of exercise per day for each profile level. */
export const EXERCISE_HOURS = Object.freeze({ none: 0, light: 0.5, moderate: 1 });

/** Fraction of outdoor PM2.5 inhaled for each commute mode. */
export const MODE_CONCENTRATION = Object.freeze({
  car: 0.6,
  two_wheeler: 1.25,
  bus: 0.85,
  metro: 0.4,
  walk: 1.1,
  cycle: 1.1,
});

export const CO2_PER_KM = Object.freeze({
  car: CONSTANTS.carCo2PerKm,
  two_wheeler: CONSTANTS.twoWheelerCo2PerKm,
  bus: CONSTANTS.busCo2PerKm,
  metro: CONSTANTS.metroCo2PerKm,
  walk: 0,
  cycle: 0,
});

/** Extra indoor PM2.5 (µg/m³) during a 1.5 h cooking session. */
export const COOKING_SURGE = Object.freeze({
  lpg: 12,
  biomass: 90,
  kerosene: 45,
  electric: 0,
});

/** Share of outdoor particles that passes inside while the mask is worn. */
export const MASK_FACTORS = Object.freeze({ never: 1, sometimes: 0.65, always: 0.1 });

export const DEFAULT_SCENARIO = Object.freeze({
  mode: 'two_wheeler',
  oneWayKm: 8,
  wfhDays: 0,
  metroDaysPerWeek: 0,
  purifierHours: 0,
  acHours: 0,
  windowsOpen: true,
  cookingFuel: 'lpg',
  exhaustFan: false,
  mask: 'never',
  exerciseHours: 0.5,
  exerciseIndoor: false,
});

/** Translate a lifestyle profile into a scenario for the model. */
export function profileToScenario(profile) {
  const home = profile.homeSetup || {};
  return {
    ...DEFAULT_SCENARIO,
    mode: profile.commuteMode || DEFAULT_SCENARIO.mode,
    oneWayKm: profile.commuteDistanceKm ?? DEFAULT_SCENARIO.oneWayKm,
    windowsOpen: Boolean(home.windowsOpen),
    purifierHours: home.purifier ? 8 : 0,
    acHours: home.ac ? 8 : 0,
    cookingFuel: profile.cookingFuel || DEFAULT_SCENARIO.cookingFuel,
    exerciseHours: EXERCISE_HOURS[profile.exercise] ?? 0.5,
  };
}

/** Clamp a numeric scenario field into a safe range. */
function clamp(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, number));
}

/** Daily-average indoor PM2.5 for a scenario. */
export function indoorPm25(scenario, outdoorPm25) {
  const outdoor = Math.max(0, Number(outdoorPm25) || 0);
  const infiltration = scenario.windowsOpen
    ? CONSTANTS.infiltrationOpen
    : CONSTANTS.infiltrationClosed;

  let indoor = outdoor * infiltration;

  const purifierHours = clamp(scenario.purifierHours, 0, 24);
  if (purifierHours > 0) {
    indoor *= 1 - CONSTANTS.hepaReduction * (purifierHours / 24);
  }

  const acHours = clamp(scenario.acHours, 0, 24);
  if (acHours > 0) {
    // Recirculating AC with a filter gives a small extra reduction.
    indoor *= 1 - 0.12 * (acHours / 24);
  }

  return indoor;
}

/** Additional indoor concentration from cooking, after ventilation. */
export function cookingPm25(scenario) {
  const surge = COOKING_SURGE[scenario.cookingFuel] ?? 0;
  const fanFactor = scenario.exhaustFan ? 0.4 : 1; // a working exhaust fan removes ~60%
  return surge * fanFactor * (scenario.windowsOpen ? 0.55 : 1);
}

/**
 * Mean commute concentration (µg/m³) for the week. `metroDaysPerWeek` replaces
 * private-vehicle trips with metro trips on that many workdays.
 */
export function commuteConcentration(scenario, outdoorPm25) {
  const outdoor = Math.max(0, Number(outdoorPm25) || 0);
  const baseFactor = MODE_CONCENTRATION[scenario.mode] ?? 1;
  const metroDays = ['car', 'two_wheeler', 'bus'].includes(scenario.mode)
    ? clamp(scenario.metroDaysPerWeek, 0, CONSTANTS.workDaysPerWeek)
    : 0;
  const weighted =
    (metroDays * MODE_CONCENTRATION.metro + (CONSTANTS.workDaysPerWeek - metroDays) * baseFactor) /
    CONSTANTS.workDaysPerWeek;
  const maskFactor = MASK_FACTORS[scenario.mask] ?? 1;
  return outdoor * weighted * maskFactor;
}

/**
 * Estimate the PM2.5 mass a person inhales in one day and convert it into an
 * equivalent 24-hour concentration and cigarette-equivalents.
 *
 * @param {typeof DEFAULT_SCENARIO} scenario
 * @param {number} outdoorPm25 24-hour average outdoor PM2.5 (µg/m³)
 */
export function estimateExposure(scenario, outdoorPm25) {
  const outdoor = Math.max(0, Number(outdoorPm25) || 0);
  const indoor = indoorPm25(scenario, outdoor);
  const cooking = cookingPm25(scenario);

  const commuteDays = Math.max(
    0,
    CONSTANTS.workDaysPerWeek - clamp(scenario.wfhDays, 0, CONSTANTS.workDaysPerWeek)
  );
  const commuteHours = CONSTANTS.commuteHoursPerDay * (commuteDays / CONSTANTS.workDaysPerWeek);

  const exerciseHours = clamp(scenario.exerciseHours, 0, 6);
  const exerciseConcentration = scenario.exerciseIndoor ? indoor : outdoor;
  const exerciseVentilation = scenario.exerciseIndoor
    ? CONSTANTS.exerciseIndoorVentilation
    : CONSTANTS.ventilationExercise;

  const indoorHours = Math.max(0, 24 - commuteHours - exerciseHours);

  const commuteDose =
    commuteConcentration(scenario, outdoor) * commuteHours * CONSTANTS.ventilationRest;
  const exerciseDose = exerciseConcentration * exerciseHours * exerciseVentilation;
  const indoorDose = indoor * indoorHours * CONSTANTS.ventilationRest;
  const cookingDose = cooking * CONSTANTS.cookingHours * CONSTANTS.ventilationRest;

  const doseUg = commuteDose + exerciseDose + indoorDose + cookingDose;
  const equivalentPm25 = doseUg / (24 * CONSTANTS.referenceVentilation);

  return {
    doseUg,
    equivalentPm25,
    cigarettesPerDay: cigaretteEquivalents(equivalentPm25),
    indoorPm25: indoor,
  };
}

/** Cigarette-equivalents for a 24-hour average PM2.5 concentration. */
export function cigaretteEquivalents(avgPm25) {
  const value = Number(avgPm25);
  if (!Number.isFinite(value) || value <= 0) return 0;
  return value / CONSTANTS.cigarettePm25;
}

/** Weekly commuting CO₂ in kg for a scenario (workdays only). */
export function weeklyCommuteCo2Kg(scenario) {
  const oneWay = Math.max(0, Number(scenario.oneWayKm) || 0);
  const tripKm = oneWay * 2;
  const days = Math.max(
    0,
    CONSTANTS.workDaysPerWeek - clamp(scenario.wfhDays, 0, CONSTANTS.workDaysPerWeek)
  );
  const baseFactor = CO2_PER_KM[scenario.mode] ?? 0;

  if (scenario.mode === 'metro' || baseFactor === 0) {
    return tripKm * days * baseFactor;
  }

  const metroDays = Math.min(days, clamp(scenario.metroDaysPerWeek, 0, days));
  return tripKm * (metroDays * CO2_PER_KM.metro + (days - metroDays) * baseFactor);
}

/**
 * Compare a modified scenario against the user's current routine.
 *
 * @param {{baseline: object, modified: object, outdoorPm25: number}} input
 */
export function compareScenarios({ baseline, modified, outdoorPm25 }) {
  const before = estimateExposure(baseline, outdoorPm25);
  const after = estimateExposure(modified, outdoorPm25);
  const co2Before = weeklyCommuteCo2Kg(baseline);
  const co2After = weeklyCommuteCo2Kg(modified);

  const exposureReductionPct =
    before.doseUg > 0 ? Math.max(0, (1 - after.doseUg / before.doseUg) * 100) : 0;

  return {
    before,
    after,
    exposureReductionPct,
    cigarettesSavedPerWeek: Math.max(
      0,
      (before.cigarettesPerDay - after.cigarettesPerDay) * 7
    ),
    co2Before,
    co2After,
    co2SavedWeekly: Math.max(0, co2Before - co2After),
  };
}
