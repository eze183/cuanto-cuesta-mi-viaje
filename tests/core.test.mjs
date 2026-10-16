import test from 'node:test';
import assert from 'node:assert/strict';
import { positive, normalizeConfig, normalizeTrip, calculateTrip, groupHistory, gpsSegment, money, comparison } from '../js/domain.mjs';
import { createStore, CONFIG_KEY, HISTORY_KEY } from '../js/storage.mjs';
import { createTracker } from '../js/gps.mjs';
import { fetchJSON, routeDistance, searchPlaces } from '../js/services.mjs';
const config = { consumoCiudad: 10, consumoRuta: 7, precio: 1000, moneda: 'ARS', peso: 70 };
const memory = () => { const data = new Map(); return { data, getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) }; };

test('city/highway cost keeps cents and config snapshots', () => {
  const city = calculateTrip(config, 100);
  const highway = calculateTrip(config, 100, 'ruta');
  assert.equal(city.costoTotal, 10000); assert.equal(city.litros, 10);
  assert.equal(highway.costoTotal, 7000); assert.equal(highway.litros, 7);
  assert.equal(money(3562.5, 'ARS'), '3.562,5 ARS');
  assert.equal(city.precio, 1000); assert.equal(city.consumo, 10);
  assert.notEqual(city.id, highway.id);
});
test('reject zero, negative, infinity, invalid config and overflow', () => {
  for (const value of [0, -1, NaN, Infinity, '', null, true, [], ' ']) assert.equal(positive(value), false);
  for (const value of [0, -1, Infinity, Number.MAX_VALUE]) assert.throws(() => calculateTrip(config, value));
  assert.throws(() => calculateTrip({ ...config, moneda: '<b>' }, 10));
});
test('legacy single-consumption configuration and old trip ids migrate deterministically', () => {
  const old = normalizeConfig({ consumo: 8, precio: 1500, moneda: 'ars' });
  assert.equal(old.consumoCiudad, 8); assert.equal(old.consumoRuta, 8);
  const trip = calculateTrip(config, 10); delete trip.id;
  assert.equal(normalizeTrip(trip, 3).id, normalizeTrip(trip, 3).id);
});
test('monthly totals keep currencies and years separate', () => {
  const base = calculateTrip(config, 100);
  const groups = groupHistory([
    { ...base, fecha: '2026-05-10T12:00:00Z' },
    { ...base, fecha: '2026-05-11T12:00:00Z', moneda: 'USD', costoTotal: 20 },
    { ...base, fecha: '2025-05-10T12:00:00Z', costoTotal: 500 },
  ]);
  assert.equal(groups.length, 2);
  assert.deepEqual([...groups[0].totals], [['USD', 20], ['ARS', 10000]]);
  assert.equal(groups[1].totals.get('ARS'), 500);
});
test('storage preserves legacy keys and does not mutate data on read', () => {
  const raw = memory(); const store = createStore(raw);
  raw.setItem(CONFIG_KEY, JSON.stringify({ consumo: 8, precio: 1500, moneda: 'ARS' }));
  const oldTrip = calculateTrip(config, 10); delete oldTrip.id;
  const existing = JSON.stringify([oldTrip]); raw.setItem(HISTORY_KEY, existing);
  assert.equal(store.loadConfig().consumoRuta, 8);
  assert.equal(store.loadHistory().length, 1);
  assert.equal(raw.getItem(HISTORY_KEY), existing);
});
test('malformed history is recovered without overwriting original bytes on load', () => {
  const raw = memory(); const notices = []; const store = createStore(raw, text => notices.push(text));
  raw.setItem(HISTORY_KEY, '{broken');
  assert.deepEqual(store.loadHistory(), []); assert.equal(raw.getItem(HISTORY_KEY), '{broken');
  assert.equal(store.saveHistory([calculateTrip(config, 10)]), true);
  assert.ok([...raw.data.entries()].some(([key, value]) => key.startsWith(`${HISTORY_KEY}.recovery.`) && value === '{broken'));
  assert.ok(notices.length);
});
test('partly invalid history is backed up before saving valid new records', () => {
  const raw = memory(); const store = createStore(raw);
  const records = JSON.stringify([calculateTrip(config, 10), { costoTotal: 'bad' }]);
  raw.setItem(HISTORY_KEY, records);
  assert.equal(store.loadHistory().length, 1);
  assert.equal(store.saveHistory(store.loadHistory()), true);
  assert.ok([...raw.data.values()].includes(records));
});
test('blocked storage and full storage report failures without false success', () => {
  const notices = []; const bad = () => { throw new Error('QuotaExceededError'); };
  const store = createStore({ getItem: bad, setItem: bad }, text => notices.push(text));
  assert.equal(store.loadConfig(), null); assert.deepEqual(store.loadHistory(), []);
  assert.equal(store.saveConfig(config), false); assert.equal(store.saveHistory([]), false); assert.ok(notices.length >= 4);
});
const fix = (lat, lng, time, accuracy = 5) => ({ lat, lng, time, accuracy });
test('GPS ignores drift, low accuracy, stale positions and impossible jumps', () => {
  const first = fix(-34.6, -58.4, 1000);
  assert.equal(gpsSegment(null, first), 0);
  assert.equal(gpsSegment(first, fix(-34.600001, -58.4, 2000)), null);
  assert.equal(gpsSegment(first, fix(-34.601, -58.4, 11000, 100)), null);
  assert.equal(gpsSegment(first, fix(-34.601, -58.4, 0)), null);
  assert.equal(gpsSegment(first, fix(-33.6, -58.4, 2000)), null);
  assert.ok(gpsSegment(first, fix(-34.601, -58.4, 11000)) > .1);
});
test('GPS stops watches, freezes time, and ignores callbacks from old sessions', () => {
  const callbacks = []; const cleared = [];
  const geo = { watchPosition(fn) { callbacks.push(fn); return callbacks.length; }, clearWatch(id) { cleared.push(id); } };
  const tracker = createTracker({ onUpdate() {}, onError() {} }, geo);
  const sample = (lat, timestamp) => ({ coords: { latitude: lat, longitude: -58.4, accuracy: 5 }, timestamp });
  tracker.start(); callbacks[0](sample(-34.6, 1000)); callbacks[0](sample(-34.601, 11000));
  assert.ok(tracker.stop().km > .1); assert.deepEqual(cleared, [1]);
  const time = tracker.get().seconds; assert.equal(tracker.get().seconds, time);
  tracker.reset(); tracker.start(); callbacks[0](sample(-30, 20000)); assert.equal(tracker.get().points.length, 0);
  tracker.stop(); assert.deepEqual(cleared, [1, 2]);
});
test('comparison uses the saved weight rather than current configuration', () => {
  const trip = calculateTrip(config, 10); const a = comparison(trip); const b = comparison({ ...trip, peso: 140 });
  assert.equal(b[3].calories, a[3].calories * 2); assert.equal(a[0].calories, null);
});
test('network timeout, cancellation, HTTP errors and malformed responses remain distinct', async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async () => ({ ok: false, status: 429 });
  await assert.rejects(fetchJSON('https://example.test'), /ocupado/);
  globalThis.fetch = async () => ({ ok: true, json: async () => { throw new SyntaxError('invalid json'); } });
  await assert.rejects(fetchJSON('https://example.test'), /datos/);
  globalThis.fetch = async (_, { signal }) => new Promise((resolve, reject) => {
    const abort = () => reject(new DOMException('cancelled', 'AbortError'));
    if (signal.aborted) abort(); else signal.addEventListener('abort', abort);
  });
  await assert.rejects(fetchJSON('https://example.test', { timeout: 5 }), /demasiado/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(fetchJSON('https://example.test', { signal: controller.signal }), { name: 'AbortError' });
});
test('routing validates actual route responses and converts meters to km', async t => {
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original; });
  const point = { lat: -34.6, lng: -58.4 };
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ code: 'Ok', routes: [{ distance: 12400 }] }) });
  assert.equal(await routeDistance(point, point), 12.4);
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ code: 'NoRoute', routes: [] }) });
  await assert.rejects(routeDistance(point, point), /ruta/);
});
test('autocomplete accepts cities, points of interest and exact street addresses; caches and validates results', async t => {
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original; });
  const requests = [];
  const feature = (properties, coordinates = [-56.97, -37.26]) => ({ geometry: { type: 'Point', coordinates }, properties });
  globalThis.fetch = async url => {
    requests.push(url);
    return { ok: true, json: async () => ({ features: [
      feature({ name: 'Villa Gesell', city: 'Villa Gesell', state: 'Buenos Aires', country: 'Argentina', osm_value: 'town' }),
      feature({ street: 'Avenida Corrientes', housenumber: '1234', city: 'Buenos Aires', country: 'Argentina', type: 'house' }),
      feature({ name: 'Obelisco', city: 'Buenos Aires', type: 'other' }),
      feature({ name: 'bad coordinates' }, [200, 999]),
      feature({ name: 'not a number' }, ['-58', '-34']),
      feature({}),
    ] }) };
  };
  assert.deepEqual(await searchPlaces('vi'), []); assert.equal(requests.length, 0);
  const results = await searchPlaces('Villa  Gesell');
  assert.equal(results.length, 3);
  assert.equal(results[0].name, 'Villa Gesell');
  assert.equal(results[0].kind, 'Ciudad / localidad');
  assert.equal(results[0].label, 'Villa Gesell, Buenos Aires, Argentina');
  assert.equal(results[0].lat, -37.26); assert.equal(results[0].lng, -56.97);
  assert.equal(results[1].label, 'Avenida Corrientes 1234, Buenos Aires, Argentina');
  assert.equal(results[1].kind, 'Dirección');
  assert.equal(results[2].kind, 'Lugar');
  assert.ok(requests[0].startsWith('https://photon.komoot.io/api/?'));
  await searchPlaces(' villa gesell '); assert.equal(requests.length, 1);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(searchPlaces('Villa Gesell', controller.signal), { name: 'AbortError' });
  assert.equal(requests.length, 1);
});
test('invalid autocomplete responses fail visibly rather than returning unrelated results', async t => {
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ error: 'bad' }) });
  await assert.rejects(searchPlaces('invalid response query'), /respuesta inválida/);
});
