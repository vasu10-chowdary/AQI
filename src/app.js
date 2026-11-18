/**
 * App controller: owns state, wires the views to the data layer and keeps the
 * derived plan/timeline/simulator inputs in sync. Views only render; all
 * network and persistence decisions live here.
 */

import { averagePm25, bandForAqi, bestOutdoorWindow, cpcbAqiFromPm25 } from './lib/aqi.js';
import { fetchAirQuality } from './lib/api.js';
import { buildChatContext, fallbackAnswer, sanitizeChatText, streamChat } from './lib/chat.js';
import { createDemoSample } from './lib/demo.js';
import {
  DEFAULT_MODEL,
  generatePlan,
  isValidApiKey,
  isValidModel,
  refineTimeline,
} from './lib/gemini.js';
import { htmlLangFor, localeFor, LANGUAGES, t } from './lib/i18n.js';
import { DEFAULT_PROFILE, normalizeProfile } from './lib/profile.js';
import { buildRulePlan } from './lib/rules.js';
import { buildTimeline } from './lib/timeline.js';
import { readJson, readText, removeText, writeJson, writeText } from './lib/storage.js';
import { createChartView } from './ui/chart.js';
import { createChatView } from './ui/chat.js';
import { createLocationView } from './ui/location.js';
import { createOverviewView } from './ui/overview.js';
import { createPlanView } from './ui/plan.js';
import { createProfileView } from './ui/profile.js';
import { createSimulatorView } from './ui/simulator.js';
import { createTimelineView } from './ui/timeline.js';

const GEMINI_TIMEOUT_MS = 30000;
const LAST_AIR_TTL_MS = 24 * 60 * 60 * 1000;
const LAST_AIR_KEY = 'lastAir';

/** Coerce a place name into printable, bounded text. */
function cleanPlace(value, fallback) {
  const text = String(value ?? '')
    .replace(/[\u0000-\u001f\u007f<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return text || fallback;
}

/** Coerce a stored/selected location into a safe shape. */
function normalizeLocation(input) {
  if (!input || typeof input !== 'object') return null;
  const lat = Number(input.lat);
  const lon = Number(input.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return {
    // Place names come from an API and are later injected into prompts, so
    // strip control characters and angle brackets before they are stored.
    name: cleanPlace(input.name, 'My location'),
    admin1: cleanPlace(input.admin1, ''),
    lat,
    lon,
  };
}

/** Local time label for a saved timestamp. */
function savedAtLabel(timestamp, lang) {
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

export function init() {
  const storedProfile = normalizeProfile(readJson('profile', DEFAULT_PROFILE));

  const state = {
    lang: storedProfile.language,
    theme: readText('theme', ''),
    location: normalizeLocation(readJson('location', null)),
    air: null,
    airStatus: 'idle',
    airError: '',
    staleAt: null,
    demo: false,
    aqi: null,
    avg24: null,
    bestWindow: null,
    timeline: [],
    profile: storedProfile,
    profileRevision: 0,
    plan: { status: 'idle', items: [], source: 'rules', notice: '' },
    chat: { messages: [], status: 'idle', notice: '' },
    gemini: {
      // A key typed into the app wins; a build-time VITE_GEMINI_API_KEY is a
      // local-demo convenience and is bundled, so it is never used in public
      // deployments (see README).
      apiKey:
        readText('geminiKey', '', globalThis.sessionStorage) ||
        (isValidApiKey(import.meta.env.VITE_GEMINI_API_KEY)
          ? import.meta.env.VITE_GEMINI_API_KEY.trim()
          : ''),
      model: readText('geminiModel', DEFAULT_MODEL),
    },
    simScenario: null,
  };

  let airController = null;
  let planToken = 0;

  const liveRegion = document.getElementById('live-region');

  function announce(message) {
    if (!liveRegion || !message) return;
    liveRegion.textContent = '';
    window.setTimeout(() => {
      liveRegion.textContent = message;
    }, 40);
  }

  /* ----------------------------- views ----------------------------- */

  const locationView = createLocationView({
    onSelect: selectLocation,
    onSample: loadDemo,
    onExitSample: exitDemo,
  });
  const overviewView = createOverviewView({ onRetry: () => loadAir() });
  const profileView = createProfileView({ onSave: saveProfile, onClear: clearData });
  const planView = createPlanView({
    onGenerate: () => regeneratePlan(),
    onSaveKey: saveKey,
    onRemoveKey: removeKey,
    onShare: sharePlan,
  });
  const timelineView = createTimelineView();
  const chartView = createChartView();
  const simulatorView = createSimulatorView({ onScenarioChange: rememberScenario });
  const chatView = createChatView({ onSend: sendChat });

  document.getElementById('location-root').append(locationView.element);
  document.getElementById('overview-root').append(overviewView.element);
  document.getElementById('profile-root').append(profileView.element);
  document.getElementById('plan-root').append(planView.element);
  document.getElementById('timeline-root').append(timelineView.element);
  document.getElementById('chart-root').append(chartView.element);
  document.getElementById('simulator-root').append(simulatorView.element);
  document.getElementById('chat-root').append(chatView.element);

  /* --------------------------- language/theme --------------------------- */

  function populateLanguageSelect() {
    const select = document.getElementById('lang-select');
    if (!select) return;
    select.replaceChildren();
    for (const language of LANGUAGES) {
      const option = document.createElement('option');
      option.value = language.id;
      option.textContent = language.label;
      select.append(option);
    }
    select.value = state.lang;
  }

  function applyStaticTranslations() {
    document.documentElement.lang = htmlLangFor(state.lang);
    document.querySelectorAll('[data-i18n]').forEach((node) => {
      node.textContent = t(node.getAttribute('data-i18n'), state.lang);
    });
    updateThemeButton();
  }

  function applyTheme(theme) {
    state.theme = theme === 'dark' ? 'dark' : 'light';
    document.documentElement.dataset.theme = state.theme;
    writeText('theme', state.theme);
    updateThemeButton();
  }

  function updateThemeButton() {
    const button = document.getElementById('theme-toggle');
    const label = document.getElementById('theme-label');
    const icon = button?.querySelector('.icon-btn-icon');
    if (!button || !label) return;
    const isDark = state.theme === 'dark';
    button.setAttribute('aria-pressed', String(isDark));
    label.textContent = t(isDark ? 'theme.toLight' : 'theme.toDark', state.lang);
    if (icon) icon.textContent = isDark ? '☀' : '☾';
  }

  function setLanguage(lang) {
    if (!LANGUAGES.some((entry) => entry.id === lang)) return;
    state.lang = lang;
    state.profile = { ...state.profile, language: lang };
    writeJson('profile', state.profile);

    const select = document.getElementById('lang-select');
    if (select) select.value = lang;

    applyStaticTranslations();
    locationView.update(state);
    profileView.update(state);
    refreshDataViews();
    if (state.airStatus === 'ready') regeneratePlan();
  }

  /* ------------------------------ air flow ------------------------------ */

  function updateDerived() {
    if (!state.air) {
      state.aqi = null;
      state.avg24 = null;
      state.bestWindow = null;
      state.timeline = [];
      return;
    }
    state.aqi = cpcbAqiFromPm25(state.air.current.pm25);
    state.avg24 = averagePm25(state.air.hourly) ?? state.air.current.pm25;
    state.bestWindow = bestOutdoorWindow(state.air.hourly);
  }

  function refreshDataViews() {
    overviewView.update(state);
    timelineView.update(state);
    chartView.update(state);
    simulatorView.update(state);
    planView.update(state);
    if (state.chat.status !== 'loading') chatView.update(state);
  }

  function cacheAir(air, location) {
    writeJson(LAST_AIR_KEY, {
      air,
      lat: location.lat,
      lon: location.lon,
      savedAt: Date.now(),
    });
  }

  function readCachedAir(location) {
    const cached = readJson(LAST_AIR_KEY, null);
    if (!cached?.air || !Number.isFinite(cached.savedAt)) return null;
    if (Date.now() - cached.savedAt > LAST_AIR_TTL_MS) return null;
    if (Math.abs(cached.lat - location.lat) > 0.05) return null;
    if (Math.abs(cached.lon - location.lon) > 0.05) return null;
    return cached;
  }

  async function loadAir() {
    if (!state.location || state.demo) return;
    airController?.abort();
    airController = new AbortController();
    const controller = airController;

    state.airStatus = 'loading';
    state.airError = '';
    state.staleAt = null;
    state.air = null;
    state.simScenario = null;
    state.timeline = [];
    state.plan = { status: 'idle', items: [], source: 'rules', notice: '' };
    updateDerived();
    refreshDataViews();

    try {
      const air = await fetchAirQuality(state.location, { signal: controller.signal });
      if (controller.signal.aborted) return;
      state.air = air;
      state.airStatus = 'ready';
      state.staleAt = null;
      updateDerived();
      cacheAir(air, state.location);
      refreshDataViews();
      await regeneratePlan();
    } catch (error) {
      if (error?.name === 'AbortError') return;

      const cached = readCachedAir(state.location);
      if (cached) {
        state.air = cached.air;
        state.airStatus = 'ready';
        state.staleAt = cached.savedAt;
        updateDerived();
        refreshDataViews();
        await regeneratePlan();
        announce(t('air.stale', state.lang, { time: savedAtLabel(cached.savedAt, state.lang) }));
        return;
      }

      state.airStatus = 'error';
      state.airError = '';
      refreshDataViews();
      announce(t('air.error', state.lang));
    }
  }

  function selectLocation(location) {
    const normalized = normalizeLocation(location);
    if (!normalized) return;
    state.demo = false;
    state.staleAt = null;
    state.location = normalized;
    writeJson('location', normalized);
    locationView.update(state);
    loadAir();
  }

  /* ------------------------------ demo mode ------------------------------ */

  function loadDemo() {
    airController?.abort();
    const sample = createDemoSample();

    state.demo = true;
    state.staleAt = null;
    state.location = sample.location;
    state.air = sample.air;
    state.airStatus = 'ready';
    state.plan = { status: 'idle', items: [], source: 'rules', notice: '' };
    state.chat = { messages: [], status: 'idle', notice: '' };
    state.timeline = [];
    state.simScenario = null;

    updateDerived();
    locationView.update(state);
    refreshDataViews();
    regeneratePlan();
    announce(t('demo.badge', state.lang));
  }

  function exitDemo() {
    airController?.abort();
    state.demo = false;
    state.staleAt = null;
    state.air = null;
    state.airStatus = 'idle';
    state.plan = { status: 'idle', items: [], source: 'rules', notice: '' };
    state.chat = { messages: [], status: 'idle', notice: '' };
    state.timeline = [];
    state.location = normalizeLocation(readJson('location', null));
    updateDerived();
    locationView.update(state);
    refreshDataViews();
    if (state.location) {
      loadAir();
    } else {
      announce(t('demo.live', state.lang));
    }
  }

  /* ------------------------------- plan ------------------------------- */

  function buildPlanContext() {
    const location = state.location;
    const air = state.air;
    return {
      conditions: {
        city: [location.name, location.admin1].filter(Boolean).join(', '),
        localTime: air?.current?.time || '',
        aqi: state.aqi ?? 0,
        bandLabel: t(`band.${bandForAqi(state.aqi).id}`, 'en'),
        pm25: air?.current?.pm25 ?? 0,
        avg24: state.avg24 ?? air?.current?.pm25 ?? 0,
        bestWindow: state.bestWindow,
      },
      profile: state.profile,
      lang: state.lang,
    };
  }

  function rebuildTimeline(lang = state.lang) {
    state.timeline = buildTimeline({
      aqi: state.aqi ?? 0,
      pm25: state.avg24 ?? state.air?.current?.pm25 ?? 0,
      hourly: state.air?.hourly || [],
      profile: state.profile,
      bestWindow: state.bestWindow,
      lang,
    });
  }

  async function regeneratePlan() {
    if (!state.location || state.airStatus !== 'ready' || !state.air) {
      state.plan = { status: 'idle', items: [], source: 'rules', notice: '' };
      state.timeline = [];
      planView.update(state);
      timelineView.update(state);
      return;
    }

    const token = ++planToken;
    const lang = state.lang;
    const baseItems = buildRulePlan({
      aqi: state.aqi ?? 0,
      pm25: state.avg24 ?? state.air.current.pm25,
      profile: state.profile,
      bestWindow: state.bestWindow,
      lang,
    });

    rebuildTimeline(lang);

    const useAi = isValidApiKey(state.gemini.apiKey || '');
    state.plan = {
      status: useAi ? 'loading' : 'ready',
      items: baseItems,
      source: 'rules',
      notice: '',
    };
    planView.update(state);
    timelineView.update(state);
    announce(
      t('plan.updatedStatus', lang, {
        city: state.location.name,
        aqi: state.aqi ?? '—',
      })
    );

    if (!useAi) return;

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);

    try {
      const items = await generatePlan({
        apiKey: state.gemini.apiKey,
        model: state.gemini.model,
        context: buildPlanContext(),
        signal: controller.signal,
      });
      if (token !== planToken) return;
      state.plan = { status: 'ready', items, source: 'gemini', notice: '' };

      // Gemini may reword the deterministic schedule; the rule-based copy stays
      // if this optional call fails.
      try {
        const refined = await refineTimeline({
          apiKey: state.gemini.apiKey,
          model: state.gemini.model,
          context: buildPlanContext(),
          timeline: state.timeline,
          signal: controller.signal,
        });
        if (token === planToken) state.timeline = refined;
      } catch {
        /* keep the deterministic timeline */
      }
    } catch (error) {
      if (token !== planToken) return;
      state.plan = {
        status: 'ready',
        items: baseItems,
        source: 'rules',
        notice: `${t('plan.aiError', lang)} ${t('plan.fallback', lang)}`,
      };
    } finally {
      window.clearTimeout(timeout);
    }

    if (token === planToken) {
      planView.update(state);
      timelineView.update(state);
    }
  }

  /* ------------------------------- chat ------------------------------- */

  function buildChatConditions() {
    return {
      city: [state.location?.name, state.location?.admin1].filter(Boolean).join(', '),
      aqi: state.aqi ?? 0,
      pm25: state.air?.current?.pm25 ?? 0,
      avg24: state.avg24 ?? state.air?.current?.pm25 ?? 0,
      bestWindow: state.bestWindow,
    };
  }

  function offlineAnswer(question) {
    const { text } = fallbackAnswer({
      question,
      conditions: buildChatConditions(),
      profile: state.profile,
      plan: state.plan.items,
      lang: state.lang,
    });
    const last = state.chat.messages.at(-1);
    if (last) {
      last.text = text;
      last.streaming = false;
      last.offline = true;
    }
    state.chat.status = 'idle';
    state.chat.notice = t('chat.fallbackNote', state.lang);
    chatView.update(state);
    announce(t('chat.ready', state.lang));
  }

  async function sendChat(rawQuestion) {
    const question = sanitizeChatText(rawQuestion);
    if (!question || state.chat.status === 'loading' || !state.air || !state.location) return;

    const history = state.chat.messages
      .filter((message) => message.text)
      .map((message) => ({ role: message.role, text: message.text }));

    state.chat.messages.push({ role: 'user', text: question });
    state.chat.messages.push({ role: 'assistant', text: '', streaming: true });
    state.chat.status = 'loading';
    state.chat.notice = '';
    chatView.update(state);
    announce(t('chat.thinking', state.lang));

    if (!isValidApiKey(state.gemini.apiKey || '')) {
      offlineAnswer(question);
      return;
    }

    try {
      const answer = await streamChat({
        apiKey: state.gemini.apiKey,
        model: state.gemini.model,
        context: buildChatContext({
          conditions: buildChatConditions(),
          profile: state.profile,
          plan: state.plan.items,
          lang: state.lang,
        }),
        history,
        onToken: (token) => chatView.appendToken(token),
      });
      const last = state.chat.messages.at(-1);
      if (last) {
        last.text = answer;
        last.streaming = false;
        last.offline = false;
      }
      state.chat.status = 'idle';
      state.chat.notice = '';
      chatView.update(state);
      announce(t('chat.ready', state.lang));
    } catch (error) {
      if (error?.name === 'AbortError') return;
      offlineAnswer(question);
    }
  }

  /* --------------------------- profile & key --------------------------- */

  function saveProfile(profile) {
    state.profile = normalizeProfile({ ...profile, language: state.lang });
    state.profileRevision += 1;
    writeJson('profile', state.profile);
    simulatorView.update(state);
    regeneratePlan();
    announce(t('profile.saved', state.lang));
  }

  function saveKey({ apiKey, model }) {
    if (!isValidApiKey(apiKey) || !isValidModel(model)) return;
    state.gemini = { apiKey, model };
    writeText('geminiKey', apiKey, globalThis.sessionStorage);
    writeText('geminiModel', model);
    announce(t('plan.keySaved', state.lang));
    regeneratePlan();
  }

  function removeKey() {
    state.gemini = { apiKey: '', model: state.gemini.model || DEFAULT_MODEL };
    removeText('geminiKey', globalThis.sessionStorage);
    regeneratePlan();
  }

  function clearData() {
    if (!window.confirm(t('profile.clearConfirm', state.lang))) return;

    for (const key of ['profile', 'location', 'geminiModel', 'theme']) {
      removeText(key);
    }
    removeText(LAST_AIR_KEY);
    removeText('geminiKey', globalThis.sessionStorage);

    airController?.abort();
    state.demo = false;
    state.location = null;
    state.air = null;
    state.airStatus = 'idle';
    state.staleAt = null;
    state.plan = { status: 'idle', items: [], source: 'rules', notice: '' };
    state.chat = { messages: [], status: 'idle', notice: '' };
    state.timeline = [];
    state.simScenario = null;
    state.profile = normalizeProfile(DEFAULT_PROFILE);
    state.lang = state.profile.language;
    state.gemini = { apiKey: '', model: DEFAULT_MODEL };
    updateDerived();

    populateLanguageSelect();
    applyTheme(prefersDark ? 'dark' : 'light');
    applyStaticTranslations();
    locationView.update(state);
    profileView.update(state);
    refreshDataViews();
    announce(t('profile.cleared', state.lang));
  }

  function rememberScenario(scenario) {
    state.simScenario = { ...(state.simScenario || {}), ...scenario };
  }

  /* ------------------------------- share ------------------------------- */

  async function sharePlan() {
    const items = state.plan?.items ?? [];
    if (items.length === 0) return false;

    const lang = state.lang;
    const title = t('plan.shareTitle', lang);
    const text = [
      title,
      `${state.location?.name ?? ''}${state.location?.admin1 ? ', ' + state.location.admin1 : ''} · AQI ${
        state.aqi ?? '—'
      } · PM2.5 ${Math.round(state.air?.current?.pm25 ?? 0)} µg/m³`,
      '',
      ...items.slice(0, 4).map((item) => `• ${item.action} — ${item.estimated_impact}`),
      '',
      state.demo ? t('demo.notice', lang) : '',
      window.location.href,
    ]
      .filter(Boolean)
      .join('\n');

    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      // A share sheet can stay open indefinitely (or never appear on desktop),
      // so bound it and fall back to the clipboard instead of hanging.
      const outcome = await Promise.race([
        navigator
          .share({ title, text })
          .then(() => 'shared')
          .catch((error) => (error?.name === 'AbortError' ? 'cancelled' : 'failed')),
        new Promise((resolve) => window.setTimeout(() => resolve('timeout'), 2500)),
      ]);
      if (outcome === 'shared') return true;
      if (outcome === 'cancelled') return false;
    }

    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      /* clipboard permission can be denied; fall back to a selection copy */
    }

    try {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.top = '-1000px';
      document.body.append(area);
      area.select();
      const copied = document.execCommand('copy');
      area.remove();
      return copied;
    } catch {
      return false;
    }
  }

  /* -------------------------------- boot -------------------------------- */

  const prefersDark =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches;

  populateLanguageSelect();
  applyTheme(['light', 'dark'].includes(state.theme) ? state.theme : prefersDark ? 'dark' : 'light');
  applyStaticTranslations();

  const languageSelect = document.getElementById('lang-select');
  languageSelect?.addEventListener('change', (event) => setLanguage(event.target.value));

  document.getElementById('theme-toggle')?.addEventListener('click', () => {
    applyTheme(state.theme === 'dark' ? 'light' : 'dark');
  });

  locationView.update(state);
  profileView.update(state);
  refreshDataViews();

  if (state.location) {
    loadAir();
  }
}
