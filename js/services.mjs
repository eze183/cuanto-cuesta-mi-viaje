const cache = new Map();
let geocodingQueue = Promise.resolve();
let lastGeocode = 0;

export async function fetchJSON(url, { signal, timeout = 12000 } = {}) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) controller.abort();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeout);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(response.status === 429 ? 'El servicio está ocupado. Esperá un momento y volvé a intentar.' : 'No pudimos consultar el servicio. Probá de nuevo o ingresá la distancia.');
    try { return await response.json(); }
    catch (error) {
      if (error.name === 'AbortError') throw error;
      throw new Error('El servicio devolvió datos que no pudimos leer. Intentá de nuevo.');
    }
  } catch (error) {
    if (timedOut) throw new Error('La consulta tardó demasiado. Probá de nuevo o ingresá la distancia.');
    if (error.name === 'AbortError') throw error;
    if (error instanceof TypeError) throw new Error('No hay conexión con el servicio. Podés calcular por distancia.');
    throw error;
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}

// Explicit searches only: public Nominatim does not support autocomplete.
// Serialize and cache requests, including reverse lookups.
async function geocodeRequest(url, signal) {
  if (signal?.aborted) throw new DOMException('Cancelado', 'AbortError');
  if (cache.has(url)) return cache.get(url);
  const task = geocodingQueue.catch(() => {}).then(async () => {
    if (signal?.aborted) throw new DOMException('Cancelado', 'AbortError');
    if (cache.has(url)) return cache.get(url);
    const wait = Math.max(0, 1100 - (Date.now() - lastGeocode));
    if (wait) await new Promise(resolve => setTimeout(resolve, wait));
    if (signal?.aborted) throw new DOMException('Cancelado', 'AbortError');
    lastGeocode = Date.now();
    const value = await fetchJSON(url, { signal });
    cache.set(url, value);
    if (cache.size > 100) cache.delete(cache.keys().next().value);
    return value;
  });
  geocodingQueue = task;
  return task;
}

export async function searchAddresses(query, signal) {
  const params = new URLSearchParams({ format: 'json', addressdetails: '1', limit: '5', 'accept-language': 'es', q: query });
  const data = await geocodeRequest(`https://nominatim.openstreetmap.org/search?${params}`, signal);
  if (!Array.isArray(data)) throw new Error('El buscador devolvió una respuesta inválida. Intentá de nuevo.');
  return data.filter(item => item.lat != null && item.lon != null && Number.isFinite(Number(item.lat)) && Number.isFinite(Number(item.lon)) && Math.abs(Number(item.lat)) <= 90 && Math.abs(Number(item.lon)) <= 180 && typeof item.display_name === 'string')
    .map(item => ({ lat: Number(item.lat), lng: Number(item.lon), label: item.display_name }));
}

export async function reverseGeocode(point, signal) {
  const params = new URLSearchParams({ format: 'json', lat: point.lat, lon: point.lng });
  const data = await geocodeRequest(`https://nominatim.openstreetmap.org/reverse?${params}`, signal);
  if (typeof data?.display_name !== 'string') throw new Error('No pudimos obtener la dirección de tu ubicación.');
  return { ...point, label: data.display_name };
}

export async function routeDistance(origin, destination, signal) {
  const coords = `${origin.lng},${origin.lat};${destination.lng},${destination.lat}`;
  const data = await fetchJSON(`https://router.project-osrm.org/route/v1/driving/${coords}?overview=false`, { signal });
  const meters = data.routes?.[0]?.distance;
  if (data.code !== 'Ok' || !Number.isFinite(meters) || meters <= 0) throw new Error('No encontramos una ruta en auto entre esas direcciones.');
  return meters / 1000;
}

export function currentPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error('Este navegador no permite obtener tu ubicación.')); return; }
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      error => reject(new Error(error.code === 1 ? 'Habilitá el permiso de ubicación en tu navegador o ingresá una dirección.' : 'No pudimos obtener tu ubicación. Intentá al aire libre o ingresá una dirección.')),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 },
    );
  });
}

let leafletPromise;
export function loadMapLibrary() {
  if (globalThis.L) return Promise.resolve(globalThis.L);
  if (leafletPromise) return leafletPromise;
  leafletPromise = new Promise((resolve, reject) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet'; css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    document.head.append(css);
    const script = document.createElement('script');
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    const fail = () => { clearTimeout(timer); script.remove(); css.remove(); leafletPromise = null; reject(new Error('El mapa no está disponible. El GPS puede seguir registrando la distancia.')); };
    const timer = setTimeout(fail, 12000);
    script.onload = () => { clearTimeout(timer); if (globalThis.L) resolve(globalThis.L); else fail(); };
    script.onerror = fail;
    document.head.append(script);
  });
  return leafletPromise;
}
