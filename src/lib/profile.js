/** Profile vocabulary and validation. All persisted/restored input goes through here. */

export const COMMUTE_MODES = ['car', 'two_wheeler', 'bus', 'metro', 'walk', 'cycle'];
export const COOKING_FUELS = ['lpg', 'biomass', 'kerosene', 'electric'];
export const EXERCISE_LEVELS = ['none', 'light', 'moderate'];
export const HOUSEHOLD_GROUPS = ['kids', 'elderly', 'asthma'];
export const LANGUAGES = ['en', 'hi', 'kn'];

export const DEFAULT_PROFILE = Object.freeze({
  commuteMode: 'two_wheeler',
  commuteDistanceKm: 8,
  homeSetup: { purifier: false, ac: false, windowsOpen: true },
  cookingFuel: 'lpg',
  household: [],
  exercise: 'light',
  language: 'en',
});

function pick(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

/**
 * Coerce arbitrary input (localStorage, form data) into a valid profile.
 *
 * @param {unknown} input
 * @returns {typeof DEFAULT_PROFILE}
 */
export function normalizeProfile(input) {
  const source = input && typeof input === 'object' ? input : {};
  const home = source.homeSetup && typeof source.homeSetup === 'object' ? source.homeSetup : {};
  const distance = Number(source.commuteDistanceKm);

  return {
    commuteMode: pick(source.commuteMode, COMMUTE_MODES, DEFAULT_PROFILE.commuteMode),
    commuteDistanceKm: Number.isFinite(distance)
      ? Math.min(60, Math.max(1, Math.round(distance)))
      : DEFAULT_PROFILE.commuteDistanceKm,
    homeSetup: {
      purifier: Boolean(home.purifier),
      ac: Boolean(home.ac),
      windowsOpen: home.windowsOpen === undefined ? true : Boolean(home.windowsOpen),
    },
    cookingFuel: pick(source.cookingFuel, COOKING_FUELS, DEFAULT_PROFILE.cookingFuel),
    household: Array.isArray(source.household)
      ? source.household.filter((group) => HOUSEHOLD_GROUPS.includes(group))
      : [],
    exercise: pick(source.exercise, EXERCISE_LEVELS, DEFAULT_PROFILE.exercise),
    language: pick(source.language, LANGUAGES, DEFAULT_PROFILE.language),
  };
}

/** True when the household includes at least one sensitive group. */
export function hasSensitiveGroups(profile) {
  return (profile?.household || []).length > 0;
}
