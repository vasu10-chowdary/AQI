import { el, clear, num } from '../lib/dom.js';
import { compareScenarios, profileToScenario } from '../lib/impact.js';
import { t } from '../lib/i18n.js';
import { emptyState } from './shared.js';
import { sourceList } from './sources.js';

/**
 * What-if simulator. Controls are built once per state change; moving a slider
 * only re-renders the results panel, so keyboard focus is never lost.
 */
export function createSimulatorView({ onScenarioChange = () => {} } = {}) {
  const root = el('section', {
    className: 'card section',
    id: 'simulator-section',
    attrs: { 'aria-labelledby': 'sim-title' },
  });

  let ctx = null;
  let refs = {};

  function update(state) {
    ctx = state;
    build(state);
  }

  function build(state) {
    clear(root);
    refs = {};
    const lang = state.lang;

    root.append(
      el(
        'div',
        { className: 'section-head' },
        el(
          'div',
          {},
          el('h2', { className: 'section-title', id: 'sim-title', text: t('sim.title', lang) }),
          el('p', { className: 'section-hint', text: t('sim.hint', lang) })
        )
      )
    );

    if (!state.location || !state.air) {
      root.append(emptyState(t('sim.empty', lang)));
      return;
    }

    const base = profileToScenario(state.profile);
    const saved = state.simScenario || {};

    const values = {
      metroDaysPerWeek: saved.metroDaysPerWeek ?? 0,
      purifierHours: saved.purifierHours ?? base.purifierHours,
      mask: saved.mask ?? base.mask,
      wfhDays: saved.wfhDays ?? 0,
      exerciseIndoor: saved.exerciseIndoor ?? false,
    };

    const commuteCanUseMetro = ['car', 'two_wheeler', 'bus'].includes(base.mode);

    const metro = slider({
      id: 'sim-metro',
      label: t('sim.metro', lang),
      min: 0,
      max: 5,
      step: 1,
      value: values.metroDaysPerWeek,
      disabled: !commuteCanUseMetro,
      format: (value) => t('sim.days', lang, { n: value }),
    });

    const purifier = slider({
      id: 'sim-purifier',
      label: t('sim.purifier', lang),
      min: 0,
      max: 24,
      step: 1,
      value: values.purifierHours,
      format: (value) => t('sim.hours', lang, { n: value }),
    });

    const maskLabel = el('label', { attrs: { for: 'sim-mask' }, text: t('sim.mask', lang) });
    const mask = el(
      'select',
      { id: 'sim-mask' },
      ['never', 'sometimes', 'always'].map((value) =>
        el('option', {
          value,
          text: t(`sim.mask.${value}`, lang),
          selected: values.mask === value,
        })
      )
    );
    mask.addEventListener('change', handleChange);

    const wfh = slider({
      id: 'sim-wfh',
      label: t('sim.wfh', lang),
      min: 0,
      max: 5,
      step: 1,
      value: values.wfhDays,
      format: (value) => t('sim.days', lang, { n: value }),
    });

    const exerciseIndoor = el('input', {
      type: 'checkbox',
      id: 'sim-exercise-indoor',
      checked: values.exerciseIndoor,
      disabled: base.exerciseHours === 0,
    });
    exerciseIndoor.addEventListener('change', handleChange);
    const exerciseRow = el(
      'div',
      { className: 'sim-control' },
      el(
        'div',
        { className: 'check-row' },
        el(
          'label',
          { attrs: { for: 'sim-exercise-indoor' } },
          exerciseIndoor,
          el('span', { text: t('sim.exercise', lang) })
        )
      )
    );

    const results = el('div', { className: 'sim-results' });
    refs = { metro, purifier, mask, wfh, exerciseIndoor, results };

    const controls = el(
      'div',
      { className: 'sim-controls' },
      metro.element,
      purifier.element,
      el(
        'div',
        { className: 'sim-control' },
        el('div', { className: 'sim-control-head' }, maskLabel),
        mask
      ),
      wfh.element,
      exerciseRow
    );

    root.append(
      el(
        'div',
        { className: 'sim-layout' },
        controls,
        results,
        el(
          'div',
          { className: 'sim-note' },
          el('p', { text: t('sim.note', lang) }),
          el(
            'details',
            { className: 'method' },
            el('summary', { text: t('plan.how', lang) }),
            el('p', { text: t('sim.method', lang) }),
            sourceList(lang)
          )
        )
      )
    );

    renderResults();
  }

  function slider({ id, label, min, max, step, value, format, disabled = false }) {
    const output = el('span', {
      className: 'sim-value',
      attrs: { 'aria-hidden': 'true' },
      text: format(Number(value)),
    });
    const input = el('input', {
      type: 'range',
      id,
      attrs: {
        min: String(min),
        max: String(max),
        step: String(step),
        value: String(value),
      },
    });
    input.disabled = disabled;
    input.setAttribute('aria-valuetext', format(Number(value)));
    input.addEventListener('input', () => {
      const next = Number(input.value);
      output.textContent = format(next);
      input.setAttribute('aria-valuetext', format(next));
      handleChange();
    });

    const element = el(
      'div',
      { className: 'sim-control' },
      el(
        'div',
        { className: 'sim-control-head' },
        el('label', { attrs: { for: id }, text: label }),
        output
      ),
      input
    );

    return { element, input, output, format };
  }

  function readValues() {
    return {
      metroDaysPerWeek: Number(refs.metro?.input.value ?? 0),
      purifierHours: Number(refs.purifier?.input.value ?? 0),
      mask: refs.mask?.value ?? 'never',
      wfhDays: Number(refs.wfh?.input.value ?? 0),
      exerciseIndoor: Boolean(refs.exerciseIndoor?.checked),
    };
  }

  function handleChange() {
    const values = readValues();
    onScenarioChange(values);
    renderResults();
  }

  function renderResults() {
    if (!ctx || !refs.results) return;
    const lang = ctx.lang;
    const base = profileToScenario(ctx.profile);
    const modified = { ...base, ...readValues() };
    const pm25 = ctx.avg24 ?? ctx.air?.current?.pm25 ?? 0;
    const comparison = compareScenarios({ baseline: base, modified, outdoorPm25: pm25 });

    const reduction = comparison.exposureReductionPct;
    const co2Saved = comparison.co2SavedWeekly;

    const signedPct =
      reduction >= 0.5
        ? `−${Math.round(reduction)}%`
        : reduction <= -0.5
          ? `+${Math.round(Math.abs(reduction))}%`
          : '0%';

    const statusText =
      reduction >= 0.5
        ? t('sim.statusReduced', lang, {
            pct: Math.round(reduction),
            co2: num(co2Saved, 1),
          })
        : reduction <= -0.5
          ? t('sim.statusIncreased', lang, { pct: Math.round(Math.abs(reduction)) })
          : t('sim.statusSame', lang);

    clear(refs.results);
    refs.results.append(
      el(
        'div',
        { className: 'sim-headline', attrs: { role: 'status', 'aria-live': 'polite' } },
        el('span', {
          className: `sim-headline-value${reduction >= 0.5 ? ' good' : ''}`,
          text: signedPct,
        }),
        el('span', { className: 'sim-headline-label', text: t('sim.headline', lang) })
      ),
      el('p', { className: 'sim-delta-text', text: statusText }),
      el(
        'div',
        { className: 'sim-compare' },
        comparisonColumn(t('sim.before', lang), t('sim.beforeHint', lang), [
          [
            t('sim.exposure', lang),
            num(Math.round(comparison.before.doseUg)),
            t('sim.exposureUnit', lang),
          ],
          [
            t('sim.cigs', lang),
            num(comparison.before.cigarettesPerDay, 1),
            t('sim.cigsUnit', lang, { n: num(comparison.before.cigarettesPerDay, 1) }),
          ],
          [
            t('sim.co2Weekly', lang),
            `${num(comparison.co2Before, 1)} kg`,
            t('sim.co2Unit', lang),
          ],
        ]),
        comparisonColumn(
          t('sim.after', lang),
          t('sim.afterHint', lang),
          [
            [
              t('sim.exposure', lang),
              num(Math.round(comparison.after.doseUg)),
              t('sim.exposureUnit', lang),
            ],
            [
              t('sim.cigs', lang),
              num(comparison.after.cigarettesPerDay, 1),
              t('sim.cigsUnit', lang, { n: num(comparison.after.cigarettesPerDay, 1) }),
            ],
            [t('sim.co2', lang), `${num(co2Saved, 1)} kg`, t('sim.co2Unit', lang)],
          ],
          true
        )
      )
    );
  }

  /** One side of the before/after comparison. */
  function comparisonColumn(title, hint, rows, highlight = false) {
    return el(
      'section',
      { className: `sim-col${highlight ? ' after' : ''}` },
      el('h3', { className: 'sim-col-title', text: title }),
      el('p', { className: 'sim-col-hint', text: hint }),
      el(
        'dl',
        { className: 'sim-rows' },
        rows.map(([label, value, detail]) =>
          el(
            'div',
            { className: 'sim-row' },
            el('dt', { text: label }),
            el(
              'dd',
              {},
              el('span', { className: 'sim-row-value', text: value }),
              el('span', { className: 'sim-row-detail', text: detail })
            )
          )
        )
      )
    );
  }

  return { element: root, update };
}
