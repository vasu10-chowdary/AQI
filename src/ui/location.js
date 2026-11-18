import { el, clear } from '../lib/dom.js';
import { reverseGeocode, searchCities } from '../lib/api.js';
import { t } from '../lib/i18n.js';

const QUICK_CITIES = [
  { name: 'Delhi', admin1: 'Delhi', lat: 28.6139, lon: 77.209 },
  { name: 'Mumbai', admin1: 'Maharashtra', lat: 19.076, lon: 72.8777 },
  { name: 'Bengaluru', admin1: 'Karnataka', lat: 12.9716, lon: 77.5946 },
  { name: 'Kolkata', admin1: 'West Bengal', lat: 22.5726, lon: 88.3639 },
  { name: 'Chennai', admin1: 'Tamil Nadu', lat: 13.0827, lon: 80.2707 },
  { name: 'Kanpur', admin1: 'Uttar Pradesh', lat: 26.4499, lon: 80.3319 },
];

/**
 * City search + "use my location". Implements the ARIA combobox pattern with
 * arrow-key navigation, Escape to close and Enter to select.
 */
export function createLocationView({ onSelect, onSample, onExitSample }) {
  const root = el('section', {
    className: 'card section',
    id: 'location-section',
    attrs: { 'aria-labelledby': 'location-title' },
  });

  let debounceTimer = null;
  let searchController = null;
  let results = [];
  let activeIndex = -1;
  let nodes = {};
  let lang = 'en';

  function update(state) {
    lang = state.lang;
    build(state);
  }

  function build(state) {
    clear(root);
    results = [];
    activeIndex = -1;

    const current = state.location;

    const status = el('p', {
      className: 'location-status',
      attrs: { role: 'status', 'aria-live': 'polite' },
    });

    const input = el('input', {
      type: 'search',
      id: 'city-input',
      value: current ? current.name : '',
      attrs: {
        role: 'combobox',
        'aria-autocomplete': 'list',
        'aria-expanded': 'false',
        'aria-controls': 'city-list',
        'aria-describedby': 'city-input-hint',
        placeholder: t('loc.placeholder', lang),
        autocomplete: 'off',
        spellcheck: 'false',
        enterkeyhint: 'search',
      },
    });

    const list = el('ul', {
      className: 'suggestions',
      id: 'city-list',
      attrs: { role: 'listbox', 'aria-label': t('loc.listLabel', lang) },
      hidden: true,
    });

    const form = el(
      'form',
      { className: 'search-form', attrs: { role: 'search' } },
      el(
        'div',
        { className: 'field' },
        el('label', { attrs: { for: 'city-input' }, text: t('loc.label', lang) }),
        el('div', { className: 'combobox' }, input),
        el('p', {
          className: 'hint',
          id: 'city-input-hint',
          text: t('loc.hint', lang),
        })
      ),
      el('button', { type: 'submit', className: 'btn primary', text: t('loc.search', lang) }),
      el('button', {
        type: 'button',
        className: 'btn secondary',
        text: t('loc.geo', lang),
        onClick: useMyLocation,
      })
    );

    form.querySelector('.combobox')?.append(list);

    const quick = el(
      'div',
      { className: 'quick-picks' },
      el('span', { className: 'quick-picks-label', text: t('loc.quick', lang) }),
      QUICK_CITIES.map((city) =>
        el('button', {
          type: 'button',
          className: 'quick-pick',
          text: city.name,
          onClick: () => choose(city),
        })
      )
    );

    const demoControls = el(
      'div',
      { className: 'demo-controls' },
      el('button', {
        type: 'button',
        className: 'btn secondary',
        text: t(state.demo ? 'demo.live' : 'demo.load', lang),
        onClick: () => (state.demo ? onExitSample?.() : onSample?.()),
      }),
      state.demo ? el('p', { className: 'demo-note', text: t('demo.notice', lang) }) : null
    );

    root.append(
      el(
        'div',
        { className: 'section-head' },
        el(
          'div',
          {},
          el('h2', { className: 'section-title', id: 'location-title', text: t('loc.title', lang) }),
          current
            ? el(
                'p',
                { className: 'location-current' },
                el('span', { text: t('loc.current', lang) }),
                el('strong', {
                  text: `${current.name}${current.admin1 ? ', ' + current.admin1 : ''}`,
                })
              )
            : el('p', { className: 'section-hint', text: t('loc.hint', lang) })
        )
      ),
      form,
      status,
      quick,
      demoControls
    );

    nodes = { input, list, status, form };

    input.addEventListener('input', onInput);
    input.addEventListener('keydown', onKeyDown);
    form.addEventListener('submit', onSubmit);
  }

  function setStatus(message) {
    if (!nodes.status) return;
    nodes.status.textContent = message || '';
  }

  function closeList() {
    if (!nodes.list) return;
    nodes.list.hidden = true;
    nodes.input?.setAttribute('aria-expanded', 'false');
    nodes.input?.removeAttribute('aria-activedescendant');
    activeIndex = -1;
  }

  function renderResults() {
    const { list, input } = nodes;
    if (!list || !input) return;
    clear(list);

    if (results.length === 0) {
      closeList();
      return;
    }

    results.forEach((city, index) => {
      const option = el(
        'li',
        {
          id: `city-option-${index}`,
          attrs: { role: 'option', 'aria-selected': String(index === activeIndex) },
        },
        el('span', { text: city.name }),
        el('span', {
          className: 'suggestion-region',
          text: [city.admin1, city.country].filter(Boolean).join(', '),
        })
      );
      option.addEventListener('mousedown', (event) => {
        event.preventDefault();
        choose(city);
      });
      list.append(option);
    });

    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    if (activeIndex >= 0) {
      input.setAttribute('aria-activedescendant', `city-option-${activeIndex}`);
    } else {
      input.removeAttribute('aria-activedescendant');
    }
  }

  function onInput(event) {
    const query = event.target.value;
    window.clearTimeout(debounceTimer);
    searchController?.abort();

    if (query.trim().length < 2) {
      results = [];
      renderResults();
      setStatus('');
      return;
    }

    setStatus(t('loc.searching', lang));
    debounceTimer = window.setTimeout(async () => {
      const controller = new AbortController();
      searchController = controller;
      try {
        const found = await searchCities(query, { signal: controller.signal });
        if (controller.signal.aborted) return;
        results = found;
        activeIndex = found.length ? 0 : -1;
        setStatus(found.length ? '' : t('loc.noResults', lang));
        renderResults();
      } catch (error) {
        if (error?.name === 'AbortError') return;
        setStatus(t('loc.error', lang));
      }
    }, 300);
  }

  function onKeyDown(event) {
    if (event.key === 'ArrowDown') {
      if (results.length === 0) return;
      event.preventDefault();
      activeIndex = (activeIndex + 1) % results.length;
      renderResults();
    } else if (event.key === 'ArrowUp') {
      if (results.length === 0) return;
      event.preventDefault();
      activeIndex = (activeIndex - 1 + results.length) % results.length;
      renderResults();
    } else if (event.key === 'Enter') {
      if (!nodes.list.hidden && results.length > 0) {
        event.preventDefault();
        choose(results[activeIndex >= 0 ? activeIndex : 0]);
      }
    } else if (event.key === 'Escape') {
      closeList();
    }
  }

  function onSubmit(event) {
    event.preventDefault();
    const query = nodes.input?.value.trim() ?? '';
    if (results.length > 0 && (!query || query.length >= 2)) {
      choose(results[0]);
      return;
    }
    if (query.length < 2) {
      setStatus(t('loc.noResults', lang));
      return;
    }
    searchCities(query)
      .then((found) => {
        if (found.length > 0) choose(found[0]);
        else setStatus(t('loc.noResults', lang));
      })
      .catch(() => setStatus(t('loc.error', lang)));
  }

  function choose(city) {
    searchController?.abort();
    results = [];
    closeList();
    setStatus('');
    if (nodes.input) nodes.input.value = city.name;
    onSelect({
      name: city.name,
      admin1: city.admin1 || '',
      lat: city.lat,
      lon: city.lon,
    });
  }

  function useMyLocation() {
    if (!('geolocation' in navigator)) {
      setStatus(t('loc.geoError', lang));
      return;
    }
    setStatus(t('loc.locating', lang));
    const button = nodes.form?.querySelector('.btn.secondary');
    if (button) button.disabled = true;

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const coords = {
          lat: position.coords.latitude,
          lon: position.coords.longitude,
        };
        const name =
          (await reverseGeocode(coords)) ||
          `${coords.lat.toFixed(2)}°, ${coords.lon.toFixed(2)}°`;
        if (button) button.disabled = false;
        choose({ name, admin1: '', lat: coords.lat, lon: coords.lon });
      },
      (error) => {
        if (button) button.disabled = false;
        setStatus(error?.code === 1 ? t('loc.geoDenied', lang) : t('loc.geoError', lang));
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 }
    );
  }

  return { element: root, update };
}
