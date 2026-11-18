/**
 * Storage helpers that never throw (private mode, quota, disabled storage).
 * Keys are namespaced and versioned so a future schema change can be ignored
 * instead of crashing on old data.
 */

const PREFIX = 'uaqa:v1:';

function safeGet(store, key) {
  try {
    return store.getItem(PREFIX + key);
  } catch {
    return null;
  }
}

function safeSet(store, key, value) {
  try {
    store.setItem(PREFIX + key, value);
    return true;
  } catch {
    return false;
  }
}

export function readJson(key, fallback, store = globalThis.localStorage) {
  const raw = safeGet(store, key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function writeJson(key, value, store = globalThis.localStorage) {
  return safeSet(store, key, JSON.stringify(value));
}

export function readText(key, fallback, store = globalThis.localStorage) {
  return safeGet(store, key) ?? fallback;
}

export function writeText(key, value, store = globalThis.localStorage) {
  return safeSet(store, key, String(value));
}

export function removeText(key, store = globalThis.localStorage) {
  try {
    store.removeItem(PREFIX + key);
  } catch {
    /* ignore blocked storage */
  }
}
