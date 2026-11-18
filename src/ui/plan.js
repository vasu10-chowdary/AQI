import { el, clear } from '../lib/dom.js';
import { healthWarnings, PLAN_CATEGORIES, EFFORT_LABELS } from '../lib/rules.js';
import { DEFAULT_MODEL, isValidApiKey, isValidModel } from '../lib/gemini.js';
import { t } from '../lib/i18n.js';
import { emptyState, loadingState } from './shared.js';
import { sourceList } from './sources.js';

const CATEGORY_ICONS = { routine: '🚶', indoors: '🏠', sustainable: '🌱' };
const WARNING_ICONS = { danger: '⛔', warn: '⚠️', info: 'ℹ️' };

/**
 * Plan section: health notices, grouped recommendation cards, the Gemini
 * personalisation controls and the impact-method expander.
 */
export function createPlanView({ onGenerate, onSaveKey, onRemoveKey, onShare }) {
  const root = el('section', {
    className: 'card section',
    id: 'plan-section',
    attrs: { 'aria-labelledby': 'plan-title' },
  });
  let keyPanelOpen = false;
  let keyDetails = null;
  let keyInputRef = null;

  function update(state) {
    const lang = state.lang;
    clear(root);

    const hasAir = state.airStatus === 'ready' && state.air && state.location;
    const items = state.plan?.items ?? [];
    const source = state.plan?.source ?? 'rules';
    const loading = state.plan?.status === 'loading';

    const generateButton = el('button', {
      type: 'button',
      className: 'btn primary',
      disabled: !hasAir || loading,
      text: loading ? t('plan.regenerating', lang) : t('plan.generate', lang),
      onClick: () => {
        if (!state.gemini?.apiKey) {
          keyPanelOpen = true;
          keyDetails?.setAttribute('open', 'true');
          keyInputRef?.focus();
          return;
        }
        onGenerate();
      },
    });
    if (loading) {
      generateButton.prepend(el('span', { className: 'spinner', attrs: { 'aria-hidden': 'true' } }));
    }

    const shareStatus = el('p', {
      className: 'share-status',
      attrs: { role: 'status', 'aria-live': 'polite' },
    });
    const shareButton = el('button', {
      type: 'button',
      className: 'btn secondary',
      text: t('plan.share', lang),
      disabled: !hasAir || items.length === 0,
      onClick: async () => {
        shareStatus.textContent = '';
        const ok = await onShare?.();
        shareStatus.textContent = ok ? t('plan.shareCopied', lang) : t('plan.shareFailed', lang);
      },
    });

    root.append(
      el(
        'div',
        { className: 'section-head' },
        el(
          'div',
          {},
          el('h2', { className: 'section-title', id: 'plan-title', text: t('plan.title', lang) }),
          el('p', {
            className: 'section-hint',
            text: hasAir
              ? source === 'gemini'
                ? t('plan.aiNote', lang)
                : t('plan.rulesNote', lang)
              : t('plan.empty', lang),
          })
        ),
        el('div', { className: 'section-actions' }, shareButton, generateButton)
      )
    );

    // The global live region announces plan updates; keeping a second polite
    // region here would make screen readers say the same sentence twice.
    const status = el('p', { className: 'plan-status' });
    if (hasAir && items.length > 0) {
      status.textContent = loading
        ? t('plan.regenerating', lang)
        : t('plan.updatedStatus', lang, {
            city: state.location.name,
            aqi: state.aqi ?? '—',
          });
    } else if (loading) {
      status.textContent = t('plan.loading', lang);
    }
    root.append(status, shareStatus);

    if (state.plan?.notice) {
      root.append(
        el(
          'div',
          { className: 'plan-notice', attrs: { role: 'alert' } },
          el('span', { text: state.plan.notice }),
          el('button', {
            type: 'button',
            className: 'btn ghost',
            text: t('plan.retry', lang),
            onClick: () => onGenerate(),
          })
        )
      );
    }

    if (hasAir) {
      const warnings = healthWarnings({
        aqi: state.aqi,
        profile: state.profile,
        lang,
      });
      root.append(
        el(
          'div',
          { className: 'warnings' },
          el('h3', { className: 'sr-only', text: t('plan.sensitiveTitle', lang) }),
          warnings.map((warning) =>
            el(
              'p',
              { className: `warning ${warning.level}` },
              el('span', {
                className: 'warning-icon',
                attrs: { 'aria-hidden': 'true' },
                text: WARNING_ICONS[warning.level] || 'ℹ️',
              }),
              el('span', { text: warning.text })
            )
          )
        )
      );
    }

    if (!state.location) {
      root.append(emptyState(t('plan.empty', lang)));
    } else if (state.airStatus === 'loading') {
      root.append(loadingState(t('plan.loading', lang)));
    } else if (state.airStatus === 'error') {
      root.append(el('p', { className: 'section-hint', text: t('air.error', lang) }));
    } else if (items.length === 0) {
      root.append(emptyState(t('plan.empty', lang)));
    } else {
      root.append(
        el(
          'div',
          { className: 'plan-groups' },
          PLAN_CATEGORIES.map((category) => {
            const groupItems = items.filter((item) => item.category === category.id);
            if (groupItems.length === 0) return null;
            return el(
              'div',
              { className: 'plan-group' },
              el(
                'h3',
                { className: 'plan-group-title' },
                el('span', { attrs: { 'aria-hidden': 'true' }, text: CATEGORY_ICONS[category.id] }),
                el('span', { text: t(category.labelKey, lang) })
              ),
              el(
                'ul',
                { className: 'plan-list' },
                groupItems.map((item) => renderCard(item, lang))
              )
            );
          })
        )
      );
    }

    root.append(
      el(
        'details',
        { className: 'method' },
        el('summary', { text: t('plan.how', lang) }),
        el('p', { text: t('plan.method', lang) }),
        sourceList(lang)
      ),
      keyPanel(state),
      el('p', { className: 'disclaimer', text: t('safetyDoctor', lang) })
    );
  }

  function renderCard(item, lang) {
    return el(
      'li',
      {},
      el(
        'div',
        { className: 'plan-card' },
        el('h4', { className: 'plan-action', text: item.action }),
        el('p', { className: 'plan-why', text: item.why_it_helps }),
        el(
          'p',
          { className: 'impact' },
          el('span', { attrs: { 'aria-hidden': 'true' }, text: '📉' }),
          el('span', { text: item.estimated_impact })
        ),
        el(
          'div',
          { className: 'plan-meta' },
          el(
            'span',
            { className: 'effort' },
            el('span', { attrs: { 'aria-hidden': 'true' }, text: '⏱' }),
            `${t('plan.effort', lang)}: ${t(EFFORT_LABELS[item.effort] || EFFORT_LABELS.low, lang)}`
          )
        ),
        el(
          'details',
          {},
          el('summary', { text: t('plan.how', lang) }),
          el(
            'div',
            { className: 'plan-basis' },
            el('p', {}, el('strong', { text: `${t('plan.basis', lang)}: ` }), item.basis || ''),
            el('p', { className: 'fine', text: t('plan.method', lang) })
          )
        )
      )
    );
  }

  function keyPanel(state) {
    const lang = state.lang;
    const hasKey = Boolean(state.gemini?.apiKey);
    const details = el('details', { className: 'key-panel', open: keyPanelOpen });
    keyDetails = details;
    details.addEventListener('toggle', () => {
      keyPanelOpen = details.open;
    });

    const keyInput = el('input', {
      type: 'password',
      id: 'gemini-key',
      attrs: {
        autocomplete: 'off',
        spellcheck: 'false',
        'aria-describedby': 'gemini-key-hint',
        placeholder: hasKey ? '••••••••••••' : 'AIza…',
      },
    });
    keyInputRef = keyInput;

    const modelInput = el('input', {
      type: 'text',
      id: 'gemini-model',
      value: state.gemini?.model || DEFAULT_MODEL,
      attrs: { spellcheck: 'false', autocomplete: 'off' },
    });

    const keyStatus = el('p', {
      className: 'key-status',
      attrs: { role: 'status', 'aria-live': 'polite' },
    });

    const form = el(
      'form',
      { className: 'key-form' },
      el(
        'div',
        { className: 'key-grid' },
        el(
          'div',
          { className: 'field' },
          el('label', { attrs: { for: 'gemini-key' }, text: t('plan.keyLabel', lang) }),
          keyInput
        ),
        el(
          'div',
          { className: 'field' },
          el('label', { attrs: { for: 'gemini-model' }, text: t('plan.model', lang) }),
          modelInput
        )
      ),
      el(
        'div',
        { className: 'key-actions' },
        el('button', { type: 'submit', className: 'btn primary', text: t('plan.keySave', lang) }),
        hasKey
          ? el('button', {
              type: 'button',
              className: 'btn secondary',
              text: t('plan.keyRemove', lang),
              onClick: () => {
                onRemoveKey();
                keyStatus.textContent = '';
              },
            })
          : null
      ),
      keyStatus
    );

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const rawKey = keyInput.value.trim();
      const model = modelInput.value.trim() || DEFAULT_MODEL;

      if (!isValidApiKey(rawKey)) {
        keyStatus.textContent = t('plan.keyInvalid', lang);
        keyInput.focus();
        return;
      }
      if (!isValidModel(model)) {
        keyStatus.textContent = t('plan.keyInvalid', lang);
        modelInput.focus();
        return;
      }

      onSaveKey({ apiKey: rawKey, model });
      keyInput.value = '';
      keyStatus.textContent = t('plan.keySaved', lang);
    });

    details.append(
      el(
        'summary',
        {},
        el('span', { text: t('plan.keyTitle', lang) }),
        hasKey
          ? el('span', {
              className: 'chip',
              attrs: { style: 'margin-left:.5rem' },
              text: '✓',
            })
          : null
      ),
      el('p', { className: 'hint', id: 'gemini-key-hint', text: t('plan.keyHint', lang) }),
      form,
      el('p', { className: 'hint', text: t('plan.modelHint', lang) })
    );

    return details;
  }

  return { element: root, update };
}
