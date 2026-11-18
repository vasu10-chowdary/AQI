import { el, clear } from '../lib/dom.js';
import {
  COMMUTE_MODES,
  COOKING_FUELS,
  EXERCISE_LEVELS,
  HOUSEHOLD_GROUPS,
  normalizeProfile,
} from '../lib/profile.js';
import { t } from '../lib/i18n.js';

/** Compact lifestyle form. Native controls keep keyboard and screen-reader behaviour. */
export function createProfileView({ onSave, onClear }) {
  const root = el('section', {
    className: 'card section',
    id: 'profile-section',
    attrs: { 'aria-labelledby': 'profile-title' },
  });

  function update(state) {
    clear(root);
    const lang = state.lang;
    const profile = normalizeProfile(state.profile);

    const commute = el(
      'select',
      { id: 'profile-commute' },
      COMMUTE_MODES.map((mode) =>
        el('option', {
          value: mode,
          text: t(`profile.mode.${mode}`, lang),
          selected: profile.commuteMode === mode,
        })
      )
    );

    const distanceOutput = el('output', {
      attrs: { for: 'profile-distance' },
      text: t('profile.km', lang, { n: profile.commuteDistanceKm }),
    });
    const distance = el('input', {
      type: 'range',
      id: 'profile-distance',
      attrs: {
        min: '1',
        max: '60',
        step: '1',
        value: String(profile.commuteDistanceKm),
      },
    });
    distance.addEventListener('input', () => {
      distanceOutput.textContent = t('profile.km', lang, { n: distance.value });
    });

    const homeChecks = [
      ['purifier', t('profile.purifier', lang)],
      ['ac', t('profile.ac', lang)],
      ['windowsOpen', t('profile.windows', lang)],
    ].map(([key, label]) =>
      el(
        'label',
        { attrs: { for: `profile-home-${key}` } },
        el('input', {
          type: 'checkbox',
          id: `profile-home-${key}`,
          value: key,
          checked: Boolean(profile.homeSetup[key]),
        }),
        el('span', { text: label })
      )
    );

    const fuel = el(
      'select',
      { id: 'profile-fuel' },
      COOKING_FUELS.map((value) =>
        el('option', {
          value,
          text: t(`profile.fuel.${value}`, lang),
          selected: profile.cookingFuel === value,
        })
      )
    );

    const householdChecks = HOUSEHOLD_GROUPS.map((group) =>
      el(
        'label',
        { attrs: { for: `profile-household-${group}` } },
        el('input', {
          type: 'checkbox',
          id: `profile-household-${group}`,
          value: group,
          checked: profile.household.includes(group),
        }),
        el('span', { text: t(`profile.${group}`, lang) })
      )
    );

    const exercise = el(
      'select',
      { id: 'profile-exercise' },
      EXERCISE_LEVELS.map((value) =>
        el('option', {
          value,
          text: t(`profile.exercise.${value}`, lang),
          selected: profile.exercise === value,
        })
      )
    );

    const status = el('p', {
      className: 'saved-status',
      attrs: { role: 'status', 'aria-live': 'polite' },
    });

    const form = el(
      'form',
      { attrs: { novalidate: true } },
      el(
        'div',
        { className: 'section-head' },
        el(
          'div',
          {},
          el('h2', { className: 'section-title', id: 'profile-title', text: t('profile.title', lang) }),
          el('p', { className: 'section-hint', text: t('profile.hint', lang) })
        )
      ),
      el(
        'div',
        { className: 'form-grid' },
        el(
          'div',
          { className: 'field' },
          el('label', { attrs: { for: 'profile-commute' }, text: t('profile.commute', lang) }),
          commute
        ),
        el(
          'div',
          { className: 'field' },
          el('label', { attrs: { for: 'profile-distance' }, text: t('profile.distance', lang) }),
          el('div', { className: 'range-row' }, distance, distanceOutput)
        ),
        el(
          'fieldset',
          { className: 'field' },
          el('legend', { text: t('profile.home', lang) }),
          el('div', { className: 'check-row' }, homeChecks)
        ),
        el(
          'div',
          { className: 'field' },
          el('label', { attrs: { for: 'profile-fuel' }, text: t('profile.fuel', lang) }),
          fuel
        ),
        el(
          'fieldset',
          { className: 'field' },
          el('legend', { text: t('profile.household', lang) }),
          el('p', { className: 'hint', text: t('profile.householdHint', lang) }),
          el('div', { className: 'check-row' }, householdChecks)
        ),
        el(
          'div',
          { className: 'field' },
          el('label', { attrs: { for: 'profile-exercise' }, text: t('profile.exercise', lang) }),
          exercise
        )
      ),
      el(
        'div',
        { className: 'form-actions' },
        el('button', { type: 'submit', className: 'btn primary', text: t('profile.save', lang) }),
        el('button', {
          type: 'button',
          className: 'btn ghost',
          text: t('profile.clear', lang),
          onClick: () => onClear?.(),
        }),
        el('p', { className: 'hint', text: t('profile.note', lang) })
      ),
      status
    );

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const next = normalizeProfile({
        commuteMode: commute.value,
        commuteDistanceKm: Number(distance.value),
        homeSetup: {
          purifier: form.querySelector('#profile-home-purifier').checked,
          ac: form.querySelector('#profile-home-ac').checked,
          windowsOpen: form.querySelector('#profile-home-windowsOpen').checked,
        },
        cookingFuel: fuel.value,
        household: householdChecks.map((node) => {
          const input = node.querySelector('input');
          return input.checked ? input.value : null;
        }),
        exercise: exercise.value,
        language: state.lang,
      });

      onSave(next);
      status.textContent = t('profile.saved', lang);
    });

    root.append(form);
  }

  return { element: root, update };
}
