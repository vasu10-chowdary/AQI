import { el, clear, num } from '../lib/dom.js';
import { AQI_MAX, BANDS, bandForAqi } from '../lib/aqi.js';
import { formatHour, formatLocalTime, localeFor, t } from '../lib/i18n.js';
import { emptyState, errorState, loadingState } from './shared.js';

/** AQI hero, band chip, scale and supporting measurements. */
export function createOverviewView({ onRetry }) {
  const root = el('section', {
    className: 'card section',
    id: 'air-section',
    attrs: { 'aria-labelledby': 'air-title' },
  });

  function update(state) {
    const lang = state.lang;
    clear(root);
    root.removeAttribute('aria-busy');

    const head = el(
      'div',
      { className: 'overview-head' },
      el(
        'div',
        {},
        el('h2', { className: 'section-title', id: 'air-title', text: t('air.title', lang) }),
        state.location
          ? el('p', { className: 'section-hint', text: `${state.location.name}${state.location.admin1 ? ', ' + state.location.admin1 : ''}` })
          : null
      ),
      state.airStatus === 'ready' && state.air
        ? el(
            'div',
            { className: 'overview-meta' },
            state.demo
              ? el(
                  'span',
                  { className: 'sample-badge' },
                  el('span', { attrs: { 'aria-hidden': 'true' }, text: '🧪' }),
                  el('span', { text: t('demo.badge', lang) })
                )
              : null,
            el('span', {
              className: 'updated',
              text: state.demo
                ? t('demo.sampleTime', lang)
                : t('air.updated', lang, {
                    time: formatLocalTime(state.air.current.time, lang),
                  }),
            })
          )
        : null
    );
    root.append(head);

    if (state.demo) {
      root.append(
        el(
          'p',
          { className: 'demo-banner' },
          el('span', { attrs: { 'aria-hidden': 'true' }, text: '🧪' }),
          el('span', { text: t('demo.notice', lang) })
        )
      );
    }

    if (state.staleAt) {
      root.append(
        el(
          'div',
          { className: 'stale-note', attrs: { role: 'status' } },
          el('span', {
            text: t('air.stale', lang, { time: formatSavedAt(state.staleAt, lang) }),
          }),
          el('button', {
            type: 'button',
            className: 'btn secondary',
            text: t('air.retry', lang),
            onClick: onRetry,
          })
        )
      );
    }

    if (!state.location) {
      root.append(emptyState(t('air.emptyTitle', lang), t('air.emptyBody', lang)));
      return;
    }

    if (state.airStatus === 'loading') {
      root.setAttribute('aria-busy', 'true');
      root.append(loadingState(t('air.loading', lang)));
      return;
    }

    if (state.airStatus === 'error' || !state.air) {
      root.append(
        errorState(t('air.error', lang), onRetry, t('air.retry', lang)),
        el('p', { className: 'hint', text: state.airError || '' })
      );
      return;
    }

    const { current } = state.air;
    const aqi = state.aqi;
    const band = bandForAqi(aqi);
    const bandName = t(`band.${band.id}`, lang);

    const marker = aqi === null ? null : Math.min(100, Math.max(0, (aqi / AQI_MAX) * 100));

    const scale = el(
      'div',
      { attrs: { 'aria-hidden': 'true' } },
      el(
        'div',
        { className: 'scale' },
        BANDS.map((entry) =>
          el('span', {
            className: `scale-seg band-${entry.id}`,
            attrs: {
              style: `width:${entry.id === 'good' || entry.id === 'satisfactory' ? 10 : 20}%`,
            },
          })
        ),
        marker === null
          ? null
          : el('span', { className: 'scale-marker', attrs: { style: `left:${marker}%` } })
      ),
      el(
        'div',
        { className: 'scale-labels' },
        el('span', { text: '0' }),
        el('span', { text: t('band.moderate', lang) }),
        el('span', { text: String(AQI_MAX) })
      )
    );

    const stats = el(
      'div',
      { className: 'air-stats' },
      el(
        'div',
        { className: 'stat' },
        el('div', { className: 'stat-label', text: t('air.pm25', lang) }),
        el('div', { className: 'stat-value', text: `${num(Math.round(current.pm25))} µg/m³` }),
        el('div', {
          className: 'stat-detail',
          text: state.avg24 ? t('air.avg24', lang, { n: num(Math.round(state.avg24)) }) : '',
        })
      ),
      el(
        'div',
        { className: 'stat' },
        el('div', { className: 'stat-label', text: t('air.usAqi', lang) }),
        el('div', {
          className: 'stat-value',
          text: Number.isFinite(current.usAqi) ? num(Math.round(current.usAqi)) : '—',
        }),
        el('div', { className: 'stat-detail', text: 'Open-Meteo' })
      ),
      el(
        'div',
        { className: 'stat wide' },
        el('div', { className: 'stat-label', text: t('air.bestOut', lang) }),
        el('div', {
          className: 'stat-value',
          text: state.bestWindow
            ? `${formatHour(state.bestWindow.startHour, lang)}–${formatHour(state.bestWindow.endHour, lang)}`
            : '—',
        }),
        el('div', {
          className: 'stat-detail',
          text: state.bestWindow
            ? t('air.bestDetail', lang, { pm: num(Math.round(state.bestWindow.pm25)) })
            : t('air.aqiNote', lang),
        })
      )
    );

    const bandList = el(
      'ul',
      { className: 'band-list', attrs: { 'aria-label': t('air.bandLegend', lang) } },
      BANDS.map((entry, index) => {
        const lower = index === 0 ? 0 : BANDS[index - 1].max + 1;
        return el(
          'li',
          {
            className: `chip band-${entry.id}`,
            attrs: { 'aria-label': `${t(`band.${entry.id}`, lang)} (${lower}–${entry.max})` },
          },
          el('span', { className: 'chip-icon', attrs: { 'aria-hidden': 'true' }, text: entry.icon }),
          el('span', { text: t(`band.${entry.id}`, lang) })
        );
      })
    );

    const critical =
      aqi !== null && aqi > 200
        ? el(
            'div',
            { className: 'banner-critical', attrs: { 'aria-labelledby': 'critical-title' } },
            el(
              'h3',
              { className: 'banner-title', id: 'critical-title' },
              el('span', { attrs: { 'aria-hidden': 'true' }, text: '⛔ ' }),
              t('banner.title', lang, { aqi })
            ),
            el('p', { text: t('banner.sensitive', lang) }),
            el('p', { text: t('banner.everyone', lang) }),
            el('p', { className: 'banner-note', text: t('safetyShort', lang) })
          )
        : null;

    if (critical) root.append(critical);

    root.append(
      el(
        'div',
        { className: 'air-hero' },
        el(
          'div',
          { className: 'aqi-block' },
          el('span', { className: 'aqi-caption', text: `${t('air.aqiLabel', lang)} · PM2.5` }),
          el(
            'div',
            { className: 'aqi-value-row' },
            el('span', { className: 'aqi-value', text: aqi === null ? '—' : String(aqi) }),
            el('span', { className: 'aqi-unit', text: bandName })
          ),
          el(
            'span',
            { className: `chip band-${band.id}` },
            el('span', { className: 'chip-icon', attrs: { 'aria-hidden': 'true' }, text: band.icon }),
            el('span', { text: bandName })
          ),
          el('p', { className: 'aqi-note', text: t('air.aqiNote', lang) }),
          scale
        ),
        stats
      ),
      el(
        'details',
        { className: 'scale-details' },
        el('summary', { text: t('air.scaleTitle', lang) }),
        el('p', { className: 'hint', text: t('air.scaleBody', lang) }),
        bandList
      ),
      el('p', { className: 'hint', text: t('air.source', lang) })
    );
  }

  return { element: root, update };
}

function formatSavedAt(timestamp, lang) {
  try {
    return new Date(timestamp).toLocaleString(localeFor(lang), {
      day: 'numeric',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return '—';
  }
}
