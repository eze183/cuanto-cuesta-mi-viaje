export const VEHICLES = {
  chico: { label: 'Auto chico', ciudad: 7.5, ruta: 5.5 },
  sedan: { label: 'Sedán / compacto', ciudad: 9.5, ruta: 7 },
  suv: { label: 'SUV / crossover', ciudad: 11.5, ruta: 8.5 },
  camioneta: { label: 'Camioneta / pickup', ciudad: 13, ruta: 9.5 },
};

export const positive = value => (typeof value === 'number' || typeof value === 'string' && value.trim() !== '') && Number.isFinite(Number(value)) && Number(value) > 0;
export const validCurrency = value => typeof value === 'string' && /^[A-Z]{3}$/.test(value);
export const number = (value, decimals = 1) => Number(value).toLocaleString('es-AR', { maximumFractionDigits: decimals });
export const money = (value, currency) => `${number(value, 2)} ${currency}`;
export const distance = km => km < 1 ? `${number(km * 1000, 0)} m` : `${number(km, 2)} km`;
export const duration = seconds => {
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
};
export const routeLabel = trip => trip.origen && trip.destino ? `${trip.origen} → ${trip.destino}` : trip.viaGps ? 'Recorrido con GPS' : trip.origen || 'Viaje por distancia';

export function normalizeConfig(value) {
  if (!value || typeof value !== 'object') return null;
  const consumoCiudad = value.consumoCiudad ?? value.consumo;
  const consumoRuta = value.consumoRuta ?? value.consumo;
  const moneda = typeof value.moneda === 'string' ? value.moneda.toUpperCase() : '';
  if (![consumoCiudad, consumoRuta, value.precio].every(positive) || !validCurrency(moneda)) return null;
  return {
    consumoCiudad: Number(consumoCiudad), consumoRuta: Number(consumoRuta), precio: Number(value.precio), moneda,
    vehiculoTipo: Object.hasOwn(VEHICLES, value.vehiculoTipo) ? value.vehiculoTipo : '',
    peso: positive(value.peso) ? Number(value.peso) : null,
  };
}

export function calculateTrip(config, km, mode = 'ciudad', fields = {}) {
  if (!normalizeConfig(config) || !positive(km)) throw new Error('Ingresá una distancia y una configuración válidas.');
  const consumo = mode === 'ruta' ? config.consumoRuta : config.consumoCiudad;
  const litros = Number(km) * consumo / 100;
  const costoTotal = litros * config.precio;
  if (!Number.isFinite(costoTotal) || !positive(costoTotal)) throw new Error('El valor es demasiado grande. Revisá los datos del viaje.');
  return {
    id: globalThis.crypto?.randomUUID?.() ?? `viaje-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    fecha: new Date().toISOString(), distancia: Number(km), litros, costoTotal, moneda: config.moneda,
    consumoModo: mode, consumo, precio: config.precio, peso: config.peso ?? 70,
    origen: fields.origen || null, destino: fields.destino || null, viaGps: Boolean(fields.viaGps),
  };
}

export function normalizeTrip(trip, index = 0) {
  if (!trip || ![trip.distancia, trip.litros, trip.costoTotal].every(positive) || !validCurrency(trip.moneda) || !Number.isFinite(Date.parse(trip.fecha))) return null;
  return {
    ...trip,
    id: typeof trip.id === 'string' && trip.id ? trip.id : `legacy-${trip.fecha}-${index}`,
    distancia: Number(trip.distancia), litros: Number(trip.litros), costoTotal: Number(trip.costoTotal),
    origen: typeof trip.origen === 'string' ? trip.origen : null,
    destino: typeof trip.destino === 'string' ? trip.destino : null,
    viaGps: Boolean(trip.viaGps), consumoModo: trip.consumoModo === 'ruta' ? 'ruta' : 'ciudad',
  };
}

export function groupHistory(history) {
  const groups = new Map();
  for (const trip of [...history].sort((a, b) => Date.parse(b.fecha) - Date.parse(a.fecha))) {
    const date = new Date(trip.fecha);
    const key = `${date.getFullYear()}-${date.getMonth()}`;
    if (!groups.has(key)) groups.set(key, { key, date, totals: new Map(), trips: [] });
    const group = groups.get(key);
    group.totals.set(trip.moneda, (group.totals.get(trip.moneda) || 0) + trip.costoTotal);
    group.trips.push(trip);
  }
  return [...groups.values()];
}

export function comparison(trip) {
  const weight = positive(trip.peso) ? Number(trip.peso) : 70;
  return [
    { label: 'En auto', speed: 60, met: null },
    { label: 'En bicicleta', speed: 16, met: 6.8 },
    { label: 'Trotando', speed: 8, met: 8.3 },
    { label: 'Caminando', speed: 5, met: 3.5 },
  ].map(item => {
    const minutes = Math.max(1, Math.round(trip.distancia / item.speed * 60));
    return { ...item, time: minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h${minutes % 60 ? ` ${minutes % 60} min` : ''}`, calories: item.met ? Math.round(item.met * weight * trip.distancia / item.speed) : null };
  });
}

export function haversineKm(a, b) {
  const rad = value => value * Math.PI / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
}

// Reject inaccurate fixes, stationary drift, stale samples and implausible jumps.
export function gpsSegment(previous, next) {
  if (!Number.isFinite(next.lat) || !Number.isFinite(next.lng) || Math.abs(next.lat) > 90 || Math.abs(next.lng) > 180 || !Number.isFinite(next.accuracy) || next.accuracy > 50 || next.accuracy < 0 || !Number.isFinite(next.time)) return null;
  if (!previous) return 0;
  const seconds = (next.time - previous.time) / 1000;
  const km = haversineKm(previous, next);
  if (seconds <= 0 || km * 1000 < Math.max(10, (previous.accuracy + next.accuracy) / 2) || km / seconds * 3600 > 200) return null;
  return km;
}
