import { el, clear } from '../lib/dom.js';
import { BANDS, bandForAqi, cpcbAqiFromPm25, hourOf } from '../lib/aqi.js';
import { formatHour, t } from '../lib/i18n.js';
import { emptyState, loadingState } from './shared.js';

/** Hourly forecast bars, colour-coded by band plus icons and names in the legend. */
export function createChartView() {
  const root = el('section', {
    className: 'card section',
    id: 'chart-section',
    attrs: { 'aria-labelledby': 'chart-title' },
  });

  function update(state) {
    const lang = state.lang;
    clear(root);

    const best = state.bestWindow;
    const bestLabel = best
      ? `${t('chart.best', lang)}: ${formatHour(best.startHour, lang)}–${formatHour(best.endHour, lang)}`
      : null;

    root.append(
      el(
        'div',
        { className: 'section-head' },
        el(
          'div',
          {},
          el('h2', { className: 'section-title', id: 'chart-title', text: t('chart.title', lang) }),
          el('p', { className: 'section-hint', text: t('chart.hint', lang) })
        ),
        best
          ? el(
              'span',
              { className: 'best-chip' },
              el('span', { attrs: { 'aria-hidden': 'true' }, text: '🌤️' }),
              el('span', { text: bestLabel })
            )
          : null
      )
    );

    if (!state.location) {
      root.append(emptyState(t('chart.empty', lang)));
      return;
    }
    if (state.airStatus === 'loading') {
      root.append(loadingState(t('chart.loading', lang)));
      return;
    }
    if (state.airStatus === 'error' || !state.air) {
      root.append(el('p', { className: 'section-hint', text: t('air.error', lang) }));
      return;
    }

    const hourly = state.air.hourly || [];
    if (hourly.length === 0) {
      root.append(emptyState(t('chart.empty', lang)));
      return;
    }

    const peak = hourly.reduce((max, entry) => Math.max(max, entry.pm25), 0);
    const scaleMax = Math.max(60, peak);
    const bandsPresent = new Set();

    const chart = el('div', {
      className: 'chart',
      attrs: {
        role: 'group',
        'aria-label': bestLabel ? `${t('chart.title', lang)} — ${bestLabel}` : t('chart.title', lang),
      },
    });

    for (const entry of hourly) {
      const hour = hourOf(entry.time);
      const aqi = cpcbAqiFromPm25(entry.pm25);
      const band = bandForAqi(aqi);
      bandsPresent.add(band.id);
      const inBest = Boolean(
        best &&
          best.date === String(entry.time).slice(0, 10) &&
          hour >= best.startHour &&
          hour < best.endHour
      );
      const height = Math.max(4, Math.round((entry.pm25 / scaleMax) * 100));
      const bandName = t(`band.${band.id}`, lang);

      chart.append(
        el(
          'div',
          {
            className: `chart-col band-${band.id}${inBest ? ' is-best' : ''}`,
            attrs: {
              role: 'img',
              'aria-label': `${formatHour(hour, lang)}, ${t('air.pm25', lang)} ${Math.round(
                entry.pm25
              )} µg/m³, ${bandName}`,
            },
          },
          el(
            'div',
            { className: 'bar-track' },
            inBest
              ? el('span', {
                  className: 'bar-value',
                  attrs: { 'aria-hidden': 'true' },
                  text: String(Math.round(entry.pm25)),
                })
              : null,
            el('div', {
              className: 'bar',
              attrs: { style: `height:${height}%`, title: `${Math.round(entry.pm25)} µg/m³` },
            })
          ),
          el('span', {
            className: 'bar-label',
            attrs: { 'aria-hidden': 'true' },
            text: formatHour(hour, lang),
          })
        )
      );
    }

    const legend = el(
      'ul',
      { className: 'legend', attrs: { 'aria-label': t('air.bandLegend', lang) } },
      BANDS.filter((band) => bandsPresent.has(band.id)).map((band) =>
        el(
          'li',
          { className: `band-${band.id}` },
          el('span', { className: 'legend-swatch', attrs: { 'aria-hidden': 'true' } }),
          el('span', { attrs: { 'aria-hidden': 'true' }, text: band.icon }),
          el('span', { text: t(`band.${band.id}`, lang) })
        )
      )
    );

    const rows = hourly.map((entry) => {
      const band = bandForAqi(cpcbAqiFromPm25(entry.pm25));
      return el(
        'tr',
        {},
        el('th', {
          attrs: { scope: 'row' },
          text: formatHour(hourOf(entry.time), lang),
        }),
        el('td', { text: `${Math.round(entry.pm25)} µg/m³` }),
        el('td', { text: t(`band.${band.id}`, lang) })
      );
    });

    const table = el(
      'details',
      { className: 'chart-table' },
      el('summary', { text: t('chart.table', lang) }),
      el(
        'div',
        { className: 'table-scroll' },
        el(
          'table',
          {},
          el('caption', { text: t('chart.data', lang) }),
          el(
            'thead',
            {},
            el(
              'tr',
              {},
              el('th', { attrs: { scope: 'col' }, text: t('chart.time', lang) }),
              el('th', { attrs: { scope: 'col' }, text: t('air.pm25', lang) }),
              el('th', { attrs: { scope: 'col' }, text: t('chart.band', lang) })
            )
          ),
          el('tbody', {}, rows)
        )
      )
    );

    root.append(
      el('div', { className: 'chart-scroll' }, chart),
      legend,
      el('p', { className: 'hint', text: t('chart.peak', lang, { pm: Math.round(peak) }) }),
      table
    );
  }

  return { element: root, update };
}
