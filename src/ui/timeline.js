import { el, clear } from '../lib/dom.js';
import { bandForAqi } from '../lib/aqi.js';
import { t } from '../lib/i18n.js';
import { emptyState, loadingState } from './shared.js';

/** Morning / afternoon / evening schedule as an accessible ordered list. */
export function createTimelineView() {
  const root = el('section', {
    className: 'card section',
    id: 'timeline-section',
    attrs: { 'aria-labelledby': 'timeline-title' },
  });

  function update(state) {
    const lang = state.lang;
    clear(root);

    root.append(
      el(
        'div',
        { className: 'section-head' },
        el(
          'div',
          {},
          el('h2', { className: 'section-title', id: 'timeline-title', text: t('timeline.title', lang) }),
          el('p', { className: 'section-hint', text: t('timeline.hint', lang) })
        )
      )
    );

    if (!state.location) {
      root.append(emptyState(t('timeline.title', lang), t('timeline.hint', lang)));
      return;
    }
    if (state.airStatus === 'loading') {
      root.append(loadingState(t('plan.loading', lang)));
      return;
    }
    if (state.airStatus === 'error' || !state.air) {
      root.append(el('p', { className: 'section-hint', text: t('air.error', lang) }));
      return;
    }

    const items = state.timeline || [];
    if (items.length === 0) {
      root.append(emptyState(t('timeline.title', lang), t('timeline.hint', lang)));
      return;
    }

    root.append(
      el(
        'ol',
        { className: 'timeline', attrs: { 'aria-label': t('timeline.title', lang) } },
        items.map((slot) => {
          const band = bandForAqi(slot.aqi);
          return el(
            'li',
            { className: `tl-item band-${band.id}` },
            el(
              'div',
              { className: 'tl-when' },
              el('h3', { className: 'tl-slot', text: slot.label }),
              el('span', { className: 'tl-range', text: slot.range })
            ),
            el(
              'span',
              { className: `chip band-${band.id} tl-chip` },
              el('span', { className: 'chip-icon', attrs: { 'aria-hidden': 'true' }, text: band.icon }),
              el('span', { text: slot.time })
            ),
            el('p', { className: 'tl-action', text: slot.action }),
            el('p', { className: 'tl-impact', text: slot.impact })
          );
        })
      )
    );
  }

  return { element: root, update };
}
