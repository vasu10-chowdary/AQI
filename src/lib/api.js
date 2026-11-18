/**
 * Open-Meteo client: city search, live air quality and an optional reverse
 * geocode. Responses are validated before they reach the model, and successful
 * air-quality payloads are cached for 10 minutes (memory + sessionStorage).
 */

import { next24Hours } from './aqi.js';

const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const AIR_URL = 'https://air-quality-api.open-meteo.com/v1/air-quality';
const REVERSE_URL = 'https://api.bigdatacloud.net/data/reverse-geocode-client';

export const CACHE_TTL_MS = 10 * 60 * 1000;

export class ApiError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
  }
}

const memoryCache = new Map();

function cacheKey(lat, lon) {
  return `aq:${Number(lat).toFixed(3)}:${Number(lon).toFixed(3)}`;
}

function readCache(key, now) {
  const fromMemory = memoryCache.get(key);
  if (fromMemory && now - fromMemory.fetchedAt < CACHE_TTL_MS) return fromMemory;

  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || now - parsed.fetchedAt >= CACHE_TTL_MS) return null;
    memoryCache.set(key, parsed);
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(key, value) {
  memoryCache.set(key, value);
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage can be full or blocked; the memory cache still works */
  }
}

/** Build the air-quality request URL (exported for tests and transparency). */
export function airQualityUrl(lat, lon) {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    current: 'pm2_5,pm10,us_aqi,carbon_monoxide,nitrogen_dioxide',
    hourly: 'pm2_5,us_aqi',
    timezone: 'auto',
    forecast_days: '2',
  });
  return `${AIR_URL}?${params.toString()}`;
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/**
 * Fetch and normalise live air quality.
 *
 * @param {{lat: number, lon: number}} coords
 * @param {{signal?: AbortSignal, fetchImpl?: typeof fetch, now?: number, cache?: boolean}} [options]
 */
export async function fetchAirQuality(coords, options = {}) {
  const {
    signal,
    fetchImpl = globalThis.fetch,
    now = Date.now(),
    cache = true,
  } = options;
  const lat = Number(coords?.lat);
  const lon = Number(coords?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    throw new ApiError('invalid-coords', 'Invalid coordinates');
  }

  const key = cacheKey(lat, lon);
  if (cache) {
    const cached = readCache(key, now);
    if (cached) return cached;
  }

  let response;
  try {
    response = await fetchImpl(airQualityUrl(lat, lon), { signal, headers: { Accept: 'application/json' } });
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    throw new ApiError('network', 'Network request failed');
  }

  if (!response.ok) {
    throw new ApiError('http', `Air quality request failed with ${response.status}`);
  }

  let data;
  try {
    data = await response.json();
  } catch {
    throw new ApiError('parse', 'Air quality response was not JSON');
  }

  const currentPm25 = toNumber(data?.current?.pm2_5);
  if (currentPm25 === null) {
    throw new ApiError('no-data', 'No PM2.5 reading for this location');
  }

  const hourly = Array.isArray(data?.hourly?.time)
    ? data.hourly.time.map((time, index) => ({
        time,
        pm25: toNumber(data.hourly.pm2_5?.[index]),
        usAqi: toNumber(data.hourly.us_aqi?.[index]),
      }))
    : [];

  const result = {
    current: {
      pm25: currentPm25,
      pm10: toNumber(data?.current?.pm10),
      usAqi: toNumber(data?.current?.us_aqi),
      carbonMonoxide: toNumber(data?.current?.carbon_monoxide),
      nitrogenDioxide: toNumber(data?.current?.nitrogen_dioxide),
      time: typeof data?.current?.time === 'string' ? data.current.time : null,
    },
    hourly: next24Hours(hourly.filter((entry) => entry.pm25 !== null), data?.current?.time),
    timezone: typeof data?.timezone === 'string' ? data.timezone : null,
    fetchedAt: now,
  };

  writeCache(key, result);
  return result;
}

/**
 * Search cities. Indian results are ranked first; anything else is kept as a
 * fallback so travellers can still use the app.
 */
export async function searchCities(query, options = {}) {
  const { signal, fetchImpl = globalThis.fetch } = options;
  const trimmed = String(query ?? '').trim();
  if (trimmed.length < 2) return [];

  const params = new URLSearchParams({
    name: trimmed,
    count: '8',
    language: 'en',
    format: 'json',
  });

  let response;
  try {
    response = await fetchImpl(`${GEOCODE_URL}?${params.toString()}`, { signal });
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    throw new ApiError('network', 'City search failed');
  }
  if (!response.ok) throw new ApiError('http', 'City search failed');

  let data;
  try {
    data = await response.json();
  } catch {
    throw new ApiError('parse', 'City search response was not JSON');
  }

  const results = Array.isArray(data?.results)
    ? data.results
        .filter((item) => Number.isFinite(Number(item?.latitude)) && Number.isFinite(Number(item?.longitude)))
        .map((item) => ({
          id: `${item.id ?? `${item.latitude},${item.longitude}`}`,
          name: String(item.name ?? '').slice(0, 80),
          admin1: String(item.admin1 ?? '').slice(0, 80),
          country: String(item.country ?? '').slice(0, 80),
          countryCode: String(item.country_code ?? ''),
          lat: Number(item.latitude),
          lon: Number(item.longitude),
        }))
    : [];

  return results
    .sort((a, b) => Number(b.countryCode === 'IN') - Number(a.countryCode === 'IN'))
    .slice(0, 6);
}

/**
 * Reverse geocode coordinates for a friendly label. Best effort: on any failure
 * the caller falls back to a coordinate label.
 */
export async function reverseGeocode(coords) {
  const lat = Number(coords?.lat);
  const lon = Number(coords?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);
  try {
    const params = new URLSearchParams({
      latitude: String(lat),
      longitude: String(lon),
      localityLanguage: 'en',
    });
    const response = await fetch(`${REVERSE_URL}?${params.toString()}`, {
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const data = await response.json();
    const name =
      data?.city || data?.locality || data?.principalSubdivision || data?.country || null;
    return name ? String(name).slice(0, 80) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
