import { el } from '../lib/dom.js';
import { t } from '../lib/i18n.js';

/** Public sources behind the constants used by the impact model. */
const SOURCES = [
  { key: 'sim.sourceWho', href: 'https://www.who.int/news-room/fact-sheets/detail/ambient-(outdoor)-air-quality-and-health' },
  { key: 'sim.sourceCpcb', href: 'https://cpcb.nic.in/' },
  { key: 'sim.sourceBerkeley', href: 'https://berkeleyearth.org/air-pollution-overview/' },
  { key: 'sim.sourceNiosh', href: 'https://www.cdc.gov/niosh/npptl/topics/respirators/' },
  { key: 'sim.sourceEpa', href: 'https://www.epa.gov/indoor-air-quality-iaq/air-cleaners-and-air-filters-home' },
  { key: 'sim.sourceOwid', href: 'https://ourworldindata.org/co2-and-greenhouse-gas-emissions' },
];

/** A compact, linked source list for a "How is this calculated?" panel. */
export function sourceList(lang) {
  return el(
    'div',
    { className: 'method-sources' },
    el('h4', { className: 'sources-title', text: t('sim.sources', lang) }),
    el(
      'ul',
      { className: 'source-list' },
      SOURCES.map((source) =>
        el(
          'li',
          {},
          el('a', {
            href: source.href,
            target: '_blank',
            rel: 'noreferrer noopener',
            text: t(source.key, lang),
          })
        )
      )
    )
  );
}
