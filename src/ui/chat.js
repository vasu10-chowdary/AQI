import { el, clear } from '../lib/dom.js';
import { t } from '../lib/i18n.js';

/**
 * Follow-up chat. Streaming appends to the last assistant bubble without
 * rebuilding the form, so focus and typed text survive. A separate polite
 * status region announces loading and completion instead of every token.
 */
export function createChatView({ onSend }) {
  const root = el('section', {
    className: 'card section',
    id: 'chat-section',
    attrs: { 'aria-labelledby': 'chat-title' },
  });

  let refs = {};
  let ctx = null;

  function update(state) {
    ctx = state;
    build(state);
  }

  function build(state) {
    const lang = state.lang;
    clear(root);
    refs = {};

    const chat = state.chat || { messages: [], status: 'idle', notice: '' };
    const loading = chat.status === 'loading';
    const ready = Boolean(state.location && state.air);

    root.append(
      el(
        'div',
        { className: 'section-head' },
        el(
          'div',
          {},
          el('h2', { className: 'section-title', id: 'chat-title', text: t('chat.title', lang) }),
          el('p', { className: 'section-hint', text: t('chat.hint', lang) })
        )
      )
    );

    if (!ready) {
      root.append(el('p', { className: 'section-hint', text: t('chat.noPlan', lang) }));
      return;
    }

    const log = el('ol', {
      className: 'chat-log',
      attrs: {
        role: 'log',
        'aria-live': 'off',
        'aria-busy': loading ? 'true' : 'false',
        'aria-label': t('chat.title', lang),
      },
    });

    for (const message of chat.messages) {
      log.append(renderMessage(message, lang));
    }

    if (chat.messages.length === 0) {
      log.append(el('li', { className: 'chat-empty', text: t('chat.hint', lang) }));
    }

    const status = el('p', {
      className: 'chat-status',
      attrs: { role: 'status', 'aria-live': 'polite' },
      // The offline note already sits inside its answer, so the status line only
      // shows the live loading text (completion is announced politely).
      text: loading ? t('chat.thinking', lang) : '',
    });

    const suggestions = el(
      'div',
      { className: 'chat-suggestions' },
      el('span', { className: 'chat-suggestions-label', text: t('chat.suggestions', lang) }),
      [1, 2, 3].map((index) =>
        el('button', {
          type: 'button',
          className: 'chip-btn',
          text: t(`chat.q${index}`, lang),
          disabled: loading,
          onClick: () => onSend(t(`chat.q${index}`, lang)),
        })
      )
    );

    const input = el('input', {
      type: 'text',
      id: 'chat-input',
      attrs: {
        maxlength: '500',
        autocomplete: 'off',
        placeholder: t('chat.placeholder', lang),
        'aria-describedby': 'chat-hint',
      },
    });
    input.disabled = loading;

    const form = el(
      'form',
      {
        className: 'chat-form',
        onSubmit: (event) => {
          event.preventDefault();
          const question = input.value.trim();
          if (!question || loading) return;
          input.value = '';
          onSend(question);
        },
      },
      el('div', { className: 'field' }, el('label', { attrs: { for: 'chat-input' }, text: t('chat.label', lang) }), input),
      el('button', {
        type: 'submit',
        className: 'btn primary',
        text: loading ? t('chat.thinking', lang) : t('chat.send', lang),
        disabled: loading,
      })
    );

    refs = { log, input, status };
    root.append(log, status, suggestions, form, el('p', { className: 'disclaimer', text: t('chat.disclaimer', lang) }));
    scrollToEnd();
  }

  function renderMessage(message, lang) {
    const assistant = message.role === 'assistant';
    return el(
      'li',
      { className: `chat-msg ${assistant ? 'assistant' : 'user'}` },
      el('span', { className: 'chat-who', text: t(assistant ? 'chat.assistant' : 'chat.you', lang) }),
      el('p', {
        className: 'chat-text',
        attrs: { 'data-placeholder': assistant && !message.text ? 'true' : 'false' },
        text: message.text || (assistant ? t('chat.thinking', lang) : ''),
      }),
      message.offline
        ? el('span', { className: 'chat-offline', text: t('chat.fallbackNote', lang) })
        : null
    );
  }

  /** Append a streamed token to the last assistant bubble. */
  function appendToken(token) {
    if (!refs.log) return;
    const bubbles = refs.log.querySelectorAll('.chat-msg.assistant .chat-text');
    const bubble = bubbles[bubbles.length - 1];
    if (!bubble) return;
    if (bubble.dataset.placeholder === 'true') {
      bubble.textContent = '';
      bubble.dataset.placeholder = 'false';
    }
    bubble.textContent += token;
    scrollToEnd();
  }

  function scrollToEnd() {
    if (refs.log) refs.log.scrollTop = refs.log.scrollHeight;
  }

  return { element: root, update, appendToken };
}
