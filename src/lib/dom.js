/**
 * Minimal DOM helpers. Everything inserted into the document goes through
 * textContent or attribute setters, so untrusted model/user text can never
 * become markup.
 */

/**
 * Create an element.
 *
 * @param {string} tag
 * @param {Record<string, unknown>} [props] className, text, dataset, attrs,
 *   value, checked, disabled, on<Event> handlers, or any attribute.
 * @param {...(Node|string|number|false|null|undefined|Array<unknown>)} children
 * @returns {HTMLElement}
 */
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);

  for (const [key, value] of Object.entries(props || {})) {
    if (value === undefined || value === null || value === false) continue;

    if (key === 'className') node.className = String(value);
    else if (key === 'text') node.textContent = String(value);
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key === 'attrs') {
      for (const [name, attrValue] of Object.entries(value)) {
        if (attrValue === undefined || attrValue === null || attrValue === false) continue;
        node.setAttribute(name, String(attrValue));
      }
    } else if (key === 'value') node.value = String(value);
    else if (key === 'checked' || key === 'disabled' || key === 'selected') node[key] = Boolean(value);
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else node.setAttribute(key, String(value));
  }

  append(node, children);
  return node;
}

/**
 * Append a nested list of nodes/strings, skipping empty values.
 * @param {Node} parent
 * @param {unknown[]} children
 */
export function append(parent, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false || child === '') continue;
    if (child instanceof Node) parent.appendChild(child);
    else parent.appendChild(document.createTextNode(String(child)));
  }
  return parent;
}

/** Remove every child of a node. */
export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

/** Replace a node's children with new content in one shot. */
export function replace(node, ...children) {
  clear(node);
  append(node, children);
  return node;
}

/** Format a number for display without trailing noise. */
export function num(value, digits = 0) {
  if (!Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}
