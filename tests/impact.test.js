import { describe, expect, it } from 'vitest';
import {
  CONSTANTS,
  DEFAULT_SCENARIO,
  cigaretteEquivalents,
  compareScenarios,
  cookingPm25,
  estimateExposure,
  indoorPm25,
  profileToScenario,
  weeklyCommuteCo2Kg,
} from '../src/lib/impact.js';
import { DEFAULT_PROFILE, normalizeProfile } from '../src/lib/profile.js';

/** A quiet, fully electric home with no outdoor exercise. */
const BASE = {
  ...DEFAULT_SCENARIO,
  mode: 'two_wheeler',
  oneWayKm: 8,
  wfhDays: 0,
  metroDaysPerWeek: 0,
  windowsOpen: false,
  cookingFuel: 'electric',
  mask: 'never',
  exerciseHours: 0.5,
  exerciseIndoor: false,
  purifierHours: 0,
  acHours: 0,
};

describe('cigaretteEquivalents', () => {
  it('treats 22 µg/m³ as one cigarette a day', () => {
    expect(cigaretteEquivalents(CONSTANTS.cigarettePm25)).toBe(1);
    expect(cigaretteEquivalents(44)).toBe(2);
    expect(cigaretteEquivalents(0)).toBe(0);
    expect(cigaretteEquivalents(-10)).toBe(0);
    expect(cigaretteEquivalents('abc')).toBe(0);
  });
});

describe('indoorPm25', () => {
  it('uses the open/closed infiltration factors', () => {
    expect(indoorPm25({ ...BASE, windowsOpen: true }, 100)).toBeCloseTo(95, 5);
    expect(indoorPm25({ ...BASE, windowsOpen: false }, 100)).toBeCloseTo(72, 5);
  });

  it('applies the HEPA midpoint in proportion to runtime', () => {
    expect(indoorPm25({ ...BASE, purifierHours: 24 }, 100)).toBeCloseTo(72 * 0.35, 5);
    expect(indoorPm25({ ...BASE, purifierHours: 12 }, 100)).toBeCloseTo(72 * (1 - 0.65 * 0.5), 5);
  });

  it('gives a small extra reduction for AC and clamps hours', () => {
    expect(indoorPm25({ ...BASE, acHours: 24 }, 100)).toBeCloseTo(72 * 0.88, 5);
    expect(indoorPm25({ ...BASE, purifierHours: 999 }, 100)).toBeCloseTo(72 * 0.35, 5);
    expect(indoorPm25({ ...BASE, purifierHours: -5 }, 100)).toBeCloseTo(72, 5);
  });

  it('never returns a negative concentration', () => {
    expect(indoorPm25(BASE, -50)).toBe(0);
    expect(indoorPm25(BASE, Number.NaN)).toBe(0);
  });
});

describe('cookingPm25', () => {
  it('adds a fuel-specific surge and credits an exhaust fan', () => {
    expect(cookingPm25({ ...BASE, cookingFuel: 'lpg' })).toBeCloseTo(12, 5);
    expect(cookingPm25({ ...BASE, cookingFuel: 'biomass' })).toBeCloseTo(90, 5);
    expect(cookingPm25({ ...BASE, cookingFuel: 'biomass', exhaustFan: true })).toBeCloseTo(36, 5);
    expect(cookingPm25({ ...BASE, cookingFuel: 'electric' })).toBe(0);
  });
});

describe('estimateExposure', () => {
  it('matches the hand-calculated first-order dose', () => {
    const result = estimateExposure(BASE, 100);

    // commute 125 µg/m³ × 1 h × 0.55; exercise 100 × 0.5 × 1.6;
    // indoor 72 µg/m³ × 22.5 h × 0.55; no cooking surge.
    expect(result.doseUg).toBeCloseTo(68.75 + 80 + 891, 5);
    expect(result.equivalentPm25).toBeCloseTo(1039.75 / (24 * 0.8), 5);
    expect(result.cigarettesPerDay).toBeCloseTo(1039.75 / 19.2 / 22, 5);
  });

  it('counts cooking and indoor exercise', () => {
    const withCooking = estimateExposure({ ...BASE, cookingFuel: 'lpg' }, 100);
    const indoorExercise = estimateExposure({ ...BASE, exerciseIndoor: true }, 100);

    expect(withCooking.doseUg).toBeGreaterThan(estimateExposure(BASE, 100).doseUg);
    expect(indoorExercise.doseUg).toBeLessThan(estimateExposure(BASE, 100).doseUg);
  });

  it('reduces dose with a mask, a purifier, working from home and metro days', () => {
    const base = estimateExposure(BASE, 200).doseUg;

    expect(estimateExposure({ ...BASE, mask: 'always' }, 200).doseUg).toBeLessThan(base);
    expect(estimateExposure({ ...BASE, purifierHours: 24 }, 200).doseUg).toBeLessThan(base);
    expect(estimateExposure({ ...BASE, wfhDays: 5 }, 200).doseUg).toBeLessThan(base);
    expect(estimateExposure({ ...BASE, metroDaysPerWeek: 5 }, 200).doseUg).toBeLessThan(base);
    // A metro trip only replaces private-vehicle days for motorised modes.
    expect(estimateExposure({ ...BASE, mode: 'walk', metroDaysPerWeek: 5 }, 200)).toEqual(
      estimateExposure({ ...BASE, mode: 'walk', metroDaysPerWeek: 0 }, 200)
    );
  });

  it('returns zero dose for zero pollution', () => {
    const result = estimateExposure(BASE, 0);
    expect(result.doseUg).toBe(0);
    expect(result.cigarettesPerDay).toBe(0);
  });
});

describe('weeklyCommuteCo2Kg', () => {
  it('uses per-passenger-km factors over a five-day week', () => {
    expect(weeklyCommuteCo2Kg({ ...BASE, mode: 'car' })).toBeCloseTo(16 * 5 * 0.17, 5);
    expect(weeklyCommuteCo2Kg({ ...BASE, mode: 'metro' })).toBeCloseTo(16 * 5 * 0.03, 5);
    expect(weeklyCommuteCo2Kg({ ...BASE, mode: 'walk' })).toBe(0);
    expect(weeklyCommuteCo2Kg({ ...BASE, mode: 'cycle' })).toBe(0);
  });

  it('accounts for WFH days and partial metro swaps', () => {
    expect(weeklyCommuteCo2Kg({ ...BASE, mode: 'car', wfhDays: 2 })).toBeCloseTo(16 * 3 * 0.17, 5);
    expect(
      weeklyCommuteCo2Kg({ ...BASE, mode: 'car', metroDaysPerWeek: 2 })
    ).toBeCloseTo(16 * (2 * 0.03 + 3 * 0.17), 5);
  });

  it('clamps invalid distances and negative days', () => {
    expect(weeklyCommuteCo2Kg({ ...BASE, mode: 'car', oneWayKm: -4 })).toBe(0);
    expect(weeklyCommuteCo2Kg({ ...BASE, mode: 'car', wfhDays: 99 })).toBe(0);
    expect(weeklyCommuteCo2Kg({ ...BASE, mode: 'car', oneWayKm: 'abc' })).toBe(0);
  });
});

describe('compareScenarios', () => {
  it('reports exposure and CO₂ savings for a metro swap', () => {
    const result = compareScenarios({
      baseline: { ...BASE, mode: 'car' },
      modified: { ...BASE, mode: 'metro' },
      outdoorPm25: 180,
    });

    expect(result.before.doseUg).toBeGreaterThan(result.after.doseUg);
    expect(result.exposureReductionPct).toBeGreaterThan(0);
    expect(result.exposureReductionPct).toBeLessThan(100);
    expect(result.co2SavedWeekly).toBeCloseTo(16 * 5 * (0.17 - 0.03), 5);
    expect(result.cigarettesSavedPerWeek).toBeGreaterThan(0);
  });

  it('never reports negative savings', () => {
    const result = compareScenarios({
      baseline: { ...BASE, mode: 'metro' },
      modified: { ...BASE, mode: 'car' },
      outdoorPm25: 180,
    });

    expect(result.exposureReductionPct).toBe(0);
    expect(result.co2SavedWeekly).toBe(0);
    expect(result.cigarettesSavedPerWeek).toBe(0);
  });

  it('handles zero pollution without dividing by zero', () => {
    const result = compareScenarios({
      baseline: BASE,
      modified: { ...BASE, purifierHours: 24 },
      outdoorPm25: 0,
    });
    expect(result.exposureReductionPct).toBe(0);
  });
});

describe('profileToScenario', () => {
  it('carries the profile into the exposure model', () => {
    const scenario = profileToScenario(
      normalizeProfile({
        ...DEFAULT_PROFILE,
        commuteMode: 'car',
        commuteDistanceKm: 12,
        homeSetup: { purifier: true, ac: true, windowsOpen: false },
        cookingFuel: 'biomass',
        exercise: 'moderate',
      })
    );

    expect(scenario.mode).toBe('car');
    expect(scenario.oneWayKm).toBe(12);
    expect(scenario.purifierHours).toBe(8);
    expect(scenario.acHours).toBe(8);
    expect(scenario.windowsOpen).toBe(false);
    expect(scenario.cookingFuel).toBe('biomass');
    expect(scenario.exerciseHours).toBe(1);
  });

  it('falls back to safe defaults for an empty profile', () => {
    const scenario = profileToScenario(normalizeProfile(null));
    expect(scenario.mode).toBe(DEFAULT_PROFILE.commuteMode);
    expect(scenario.oneWayKm).toBe(DEFAULT_PROFILE.commuteDistanceKm);
    expect(scenario.windowsOpen).toBe(true);
  });
});
