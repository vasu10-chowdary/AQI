import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PROFILE,
  hasSensitiveGroups,
  normalizeProfile,
} from '../src/lib/profile.js';

describe('normalizeProfile', () => {
  it('returns defaults for missing or malformed input', () => {
    expect(normalizeProfile(null)).toEqual(DEFAULT_PROFILE);
    expect(normalizeProfile('nope')).toEqual(DEFAULT_PROFILE);
    expect(normalizeProfile([])).toEqual(DEFAULT_PROFILE);
  });

  it('keeps valid values', () => {
    const profile = normalizeProfile({
      commuteMode: 'metro',
      commuteDistanceKm: 14,
      homeSetup: { purifier: true, ac: false, windowsOpen: false },
      cookingFuel: 'electric',
      household: ['kids', 'asthma'],
      exercise: 'moderate',
      language: 'hi',
    });

    expect(profile).toEqual({
      commuteMode: 'metro',
      commuteDistanceKm: 14,
      homeSetup: { purifier: true, ac: false, windowsOpen: false },
      cookingFuel: 'electric',
      household: ['kids', 'asthma'],
      exercise: 'moderate',
      language: 'hi',
    });
  });

  it('rejects unknown enum values instead of trusting storage', () => {
    const profile = normalizeProfile({
      commuteMode: 'rocket',
      cookingFuel: 'coal',
      exercise: 'extreme',
      language: 'fr',
    });

    expect(profile.commuteMode).toBe(DEFAULT_PROFILE.commuteMode);
    expect(profile.cookingFuel).toBe(DEFAULT_PROFILE.cookingFuel);
    expect(profile.exercise).toBe(DEFAULT_PROFILE.exercise);
    expect(profile.language).toBe(DEFAULT_PROFILE.language);
  });

  it('clamps and rounds the commute distance', () => {
    expect(normalizeProfile({ commuteDistanceKm: 0 }).commuteDistanceKm).toBe(1);
    expect(normalizeProfile({ commuteDistanceKm: 999 }).commuteDistanceKm).toBe(60);
    expect(normalizeProfile({ commuteDistanceKm: 8.6 }).commuteDistanceKm).toBe(9);
    expect(normalizeProfile({ commuteDistanceKm: 'abc' }).commuteDistanceKm).toBe(
      DEFAULT_PROFILE.commuteDistanceKm
    );
  });

  it('filters household groups and defaults windows to open', () => {
    const profile = normalizeProfile({ household: ['kids', 'aliens', 42] });
    expect(profile.household).toEqual(['kids']);
    expect(profile.homeSetup.windowsOpen).toBe(true);
    expect(normalizeProfile({ homeSetup: { purifier: 'yes' } }).homeSetup.purifier).toBe(true);
  });

  it('drops a non-array household list', () => {
    expect(normalizeProfile({ household: 'kids' }).household).toEqual([]);
  });
});

describe('hasSensitiveGroups', () => {
  it('is true only when a group is present', () => {
    expect(hasSensitiveGroups({ household: ['elderly'] })).toBe(true);
    expect(hasSensitiveGroups({ household: [] })).toBe(false);
    expect(hasSensitiveGroups({})).toBe(false);
    expect(hasSensitiveGroups(null)).toBe(false);
  });
});
