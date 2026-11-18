import { el } from '../lib/dom.js';

/** Consistent empty state used before a city is chosen. */
export function emptyState(title, body) {
  return el(
    'div',
    { className: 'empty-state' },
    el('span', { className: 'empty-state-icon', attrs: { 'aria-hidden': 'true' }, text: '📍' }),
    el('h3', { text: title }),
    body ? el('p', { text: body }) : null
  );
}

/** Announceable loading state. */
export function loadingState(message) {
  return el(
    'div',
    { className: 'loading-state', attrs: { role: 'status' } },
    el('span', { className: 'spinner', attrs: { 'aria-hidden': 'true' } }),
    el('p', { text: message })
  );
}

/** Error state with an explicit retry action. */
export function errorState(message, onRetry, retryLabel) {
  return el(
    'div',
    { className: 'error-state', attrs: { role: 'alert' } },
    el('h3', { text: '⚠️ ' + message }),
    onRetry
      ? el('button', { type: 'button', className: 'btn secondary', onClick: onRetry, text: retryLabel })
      : null
  );
}
