import { VEHICLES, positive, normalizeConfig, calculateTrip, groupHistory, comparison, number, money, distance, duration, routeLabel } from './js/domain.mjs';
import { createStore } from './js/storage.mjs';
import { searchAddresses, routeDistance, currentPosition, reverseGeocode, loadMapLibrary } from './js/services.mjs';
import { createTracker } from './js/gps.mjs';
import { $, node, message, openDialog, closeDialog, initDialogs, addressPicker } from './js/ui.mjs';

const store = createStore({ getItem: key => localStorage.getItem(key), setItem: (key, value) => localStorage.setItem(key, value) }, text => message('storage-notice', text));
let config = store.loadConfig();
let history = store.loadHistory();
let currentTrip = null;
let detailTrip = null;
let pendingAction = null;
let routeController;
let locationController;
let mode = 'distance';
const consumptionMode = () => document.querySelector('[name="consumption"]:checked').value;
const decimal = value => {
  const text = value.trim();
  return /^(?:\d+(?:[.,]\d*)?|[.,]\d+)$/.test(text) ? Number(text.replace(',', '.')) : NaN;
};
const announce = text => { $('announcement').textContent = text; };
const icon = name => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add('icon'); svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(svg.namespaceURI, 'use');
  use.setAttribute('href', `#i-${name}`); svg.append(use); return svg;
};

initDialogs();
// Decorative icons never duplicate the accessible button or link names.
document.querySelectorAll('svg.icon').forEach(svg => svg.setAttribute('aria-hidden', 'true'));

function openSetup(action = null) {
  cancelRoute();
  pendingAction = action;
  $('setup-vehiculo-tipo').value = config?.vehiculoTipo || '';
  $('setup-consumo-ciudad').value = config?.consumoCiudad ?? '';
  $('setup-consumo-ruta').value = config?.consumoRuta ?? '';
  $('setup-precio').value = config?.precio ?? '';
  const currency = config?.moneda || 'ARS';
  if (![...$('setup-moneda').options].some(option => option.value === currency)) $('setup-moneda').add(new Option(currency, currency));
  $('setup-moneda').value = currency;
  $('setup-peso').value = config?.peso ?? '';
  $('setup-form').querySelectorAll('[aria-invalid]').forEach(el => el.removeAttribute('aria-invalid'));
  message('setup-error');
  openDialog('modal-setup');
}
function withConfig(action) { if (config) action(); else openSetup(action); }
$('btn-settings').addEventListener('click', () => openSetup());
$('btn-edit-config').addEventListener('click', () => openSetup());
$('modal-setup').addEventListener('close', () => { pendingAction = null; });
$('setup-vehiculo-tipo').addEventListener('change', event => {
  const preset = VEHICLES[event.target.value];
  if (preset) {
    $('setup-consumo-ciudad').value = preset.ciudad;
    $('setup-consumo-ruta').value = preset.ruta;
    announce('Consumos estimados completados. Podés editarlos.');
  }
});
$('setup-form').addEventListener('submit', event => {
  event.preventDefault();
  let firstInvalid = null;
  for (const id of ['setup-consumo-ciudad', 'setup-consumo-ruta', 'setup-precio', 'setup-peso']) {
    const input = $(id);
    const valid = id === 'setup-peso' && input.value.trim() === '' || positive(decimal(input.value));
    input.setAttribute('aria-invalid', String(!valid));
    if (!valid) firstInvalid ??= input;
  }
  if (firstInvalid) {
    message('setup-error', 'Ingresá valores numéricos mayores a cero. Podés usar coma o punto decimal, sin separadores de miles.');
    if (firstInvalid.id === 'setup-peso') firstInvalid.closest('details').open = true;
    firstInvalid.focus(); return;
  }
  const next = normalizeConfig({
    consumoCiudad: decimal($('setup-consumo-ciudad').value), consumoRuta: decimal($('setup-consumo-ruta').value),
    precio: decimal($('setup-precio').value), moneda: $('setup-moneda').value,
    peso: $('setup-peso').value.trim() ? decimal($('setup-peso').value) : null, vehiculoTipo: $('setup-vehiculo-tipo').value,
  });
  if (!next) { message('setup-error', 'Revisá la configuración y la moneda.'); return; }
  if (!store.saveConfig(next)) { message('setup-error', 'No pudimos guardar. Revisá los permisos de almacenamiento de este navegador.'); return; }
  config = next;
  const action = pendingAction;
  pendingAction = null;
  closeDialog('modal-setup');
  renderVehicle();
  announce('Configuración guardada.');
  // Let native dialog close restore focus before moving it to the new result.
  if (action) setTimeout(action, 0);
});

function renderVehicle() {
  $('vehicle-heading').textContent = config ? VEHICLES[config.vehiculoTipo]?.label || 'Tu vehículo' : 'Tu vehículo';
  $('config-summary-text').textContent = config ? `${number(config.consumoCiudad)} ciudad · ${number(config.consumoRuta)} ruta L/100 km · ${money(config.precio, config.moneda)}/L` : 'Configurá el consumo y el precio.';
  $('btn-edit-config').textContent = config ? 'Editar' : 'Configurar';
}

function renderResult({ focus = false } = {}) {
  $('result-empty').hidden = Boolean(currentTrip);
  $('result-card').hidden = !currentTrip;
  if (!currentTrip) return;
  const trip = currentTrip;
  const saved = history.some(item => item.id === trip.id);
  $('result-total').textContent = money(trip.costoTotal, trip.moneda);
  $('result-route').textContent = routeLabel(trip);
  $('result-distance').textContent = distance(trip.distancia);
  $('result-liters').textContent = `${number(trip.litros, 2)} L`;
  $('result-per-km').textContent = money(trip.costoTotal / trip.distancia, trip.moneda);
  $('result-assumptions').textContent = `${trip.consumoModo === 'ruta' ? 'Ruta' : 'Ciudad'} · ${number(trip.consumo)} L/100 km · ${money(trip.precio, trip.moneda)}/L`;
  $('btn-save-trip').replaceChildren(icon('check'), document.createTextNode(saved ? 'Viaje guardado' : 'Guardar viaje'));
  $('btn-save-trip').disabled = saved;
  message('save-status', saved ? 'Ya está en Mis viajes.' : 'Este cálculo todavía no está guardado.');
  if (focus) {
    $('result-total').focus({ preventScroll: true });
    if (matchMedia('(max-width: 760px)').matches) $('result-card').scrollIntoView({ block: 'center', behavior: 'instant' });
    announce(`Costo estimado: ${money(trip.costoTotal, trip.moneda)} para ${distance(trip.distancia)}. Elegí Guardar viaje para agregarlo al historial.`);
  }
}
function estimate(km, fields = {}, errorId = 'trip-error') {
  try {
    currentTrip = calculateTrip(config, km, consumptionMode(), fields);
    message(errorId); renderResult({ focus: true });
  } catch (error) { message(errorId, error.message); }
}
$('distance-form').addEventListener('submit', event => {
  event.preventDefault();
  const value = decimal($('trip-distancia').value);
  const valid = positive(value);
  $('trip-distancia').setAttribute('aria-invalid', String(!valid));
  if (!valid) { message('trip-error', 'Ingresá una distancia mayor a cero, por ejemplo 12,4.'); $('trip-distancia').focus(); return; }
  const km = $('trip-unidad').value === 'm' ? value / 1000 : value;
  message('trip-error');
  withConfig(() => estimate(km));
});
let previousUnit = 'km';
$('trip-unidad').addEventListener('change', event => {
  const value = decimal($('trip-distancia').value);
  const next = event.target.value;
  if (positive(value)) $('trip-distancia').value = String(Number((next === 'm' && previousUnit === 'km' ? value * 1000 : value / 1000).toFixed(6)));
  previousUnit = next;
});
$('trip-distancia').addEventListener('input', () => { message('trip-error'); $('trip-distancia').removeAttribute('aria-invalid'); });

$('btn-save-trip').addEventListener('click', () => {
  if (!currentTrip) return;
  history = store.loadHistory();
  if (history.some(trip => trip.id === currentTrip.id)) { renderResult(); return; }
  const next = [...history, currentTrip];
  if (!store.saveHistory(next)) { message('save-status', 'No se pudo guardar el viaje. Tu cálculo sigue disponible; intentá de nuevo.'); return; }
  history = next; renderHistory(); renderResult(); announce('Viaje guardado en Mis viajes.');
});

function renderHistory() {
  $('history-count').textContent = `${history.length} ${history.length === 1 ? 'viaje' : 'viajes'}`;
  $('history-empty').hidden = history.length > 0;
  const fragment = document.createDocumentFragment();
  for (const group of groupHistory(history)) {
    const heading = node('div', 'history-month-header');
    heading.append(node('h3', '', group.date.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })));
    const totals = node('div', 'history-totals');
    totals.setAttribute('aria-label', 'Totales de combustible por moneda');
    for (const [currency, total] of group.totals) totals.append(node('span', '', money(total, currency)));
    heading.append(totals);
    const list = node('ul', 'history-list');
    for (const trip of group.trips) {
      const li = node('li');
      const button = node('button', 'history-item'); button.type = 'button';
      const date = node('time', 'history-date', new Date(trip.fecha).toLocaleDateString('es-AR', { day: '2-digit', month: 'short' })); date.dateTime = trip.fecha;
      const body = node('span', 'history-body');
      body.append(node('span', 'history-route', routeLabel(trip)), node('span', 'history-meta', `${distance(trip.distancia)} · ${trip.consumoModo === 'ruta' ? 'Ruta' : 'Ciudad'}`));
      button.append(date, body, node('span', 'history-cost', money(trip.costoTotal, trip.moneda)), icon('arrow'));
      button.addEventListener('click', () => openDetail(trip));
      li.append(button); list.append(li);
    }
    fragment.append(heading, list);
  }
  $('history-groups').replaceChildren(fragment);
}
function openDetail(trip) {
  detailTrip = trip;
  $('detail-route').textContent = routeLabel(trip);
  $('detail-total').textContent = money(trip.costoTotal, trip.moneda);
  $('detail-distancia').textContent = distance(trip.distancia);
  $('detail-litros').textContent = `${number(trip.litros, 2)} L`;
  $('comparison-list').replaceChildren(...comparison(trip).map(item => {
    const row = node('div', 'comparison-item');
    const data = node('span', 'comparison-data', item.time);
    if (item.calories != null) data.append(node('small', '', `≈ ${number(item.calories, 0)} kcal`));
    row.append(node('span', '', item.label), data); return row;
  }));
  $('btn-delete-trip').hidden = !history.some(item => item.id === trip.id);
  $('btn-delete-trip').textContent = 'Eliminar viaje guardado';
  message('delete-status'); openDialog('modal-detail');
}
$('btn-detail').addEventListener('click', () => { if (currentTrip) openDetail(currentTrip); });
$('btn-delete-trip').addEventListener('click', () => {
  if (!detailTrip || !confirm('¿Querés eliminar este viaje del historial? Esta acción no se puede deshacer.')) return;
  const next = store.loadHistory().filter(trip => trip.id !== detailTrip.id);
  if (!store.saveHistory(next)) { message('delete-status', 'No pudimos eliminar el viaje. Intentá de nuevo.'); return; }
  if (currentTrip?.id === detailTrip.id) currentTrip = null;
  detailTrip = null; history = next;
  closeDialog('modal-detail'); renderHistory(); renderResult(); announce('Viaje eliminado.');
});

function cancelRoute() { routeController?.abort(); routeController = null; $('btn-calc-address').disabled = false; $('btn-calc-address').replaceChildren(document.createTextNode('Calcular recorrido'), icon('arrow')); }
function addressMessage(text, status = false) { message('address-error', status ? '' : text); message('address-status', status ? text : ''); }
const originPicker = addressPicker($('trip-origen'), $('origen-suggestions'), $('search-origin'), searchAddresses, cancelRoute, addressMessage);
const destinationPicker = addressPicker($('trip-destino'), $('destino-suggestions'), $('search-destination'), searchAddresses, cancelRoute, addressMessage);
['trip-origen', 'trip-destino'].forEach(id => $(id).addEventListener('input', () => { cancelRoute(); locationController?.abort(); addressMessage(''); }));
$('btn-use-location').addEventListener('click', async () => {
  locationController?.abort();
  const controller = new AbortController(); locationController = controller;
  $('btn-use-location').disabled = true; addressMessage('Buscando tu ubicación…', true);
  try {
    const point = await currentPosition();
    if (controller.signal.aborted) return;
    const result = await reverseGeocode(point, controller.signal);
    if (mode !== 'address' || controller.signal.aborted) return;
    originPicker.set(result); cancelRoute(); addressMessage('Ubicación seleccionada.', true);
  } catch (error) { if (error.name !== 'AbortError' && !controller.signal.aborted) addressMessage(error.message); }
  finally { if (locationController === controller) { $('btn-use-location').disabled = false; locationController = null; } }
});
$('address-form').addEventListener('submit', event => {
  event.preventDefault();
  const origin = originPicker.get(); const destination = destinationPicker.get();
  if (!origin || !destination) { addressMessage('Buscá y elegí una dirección de origen y una de destino antes de calcular.'); (!origin ? $('trip-origen') : $('trip-destino')).focus(); return; }
  withConfig(async () => {
    cancelRoute(); const controller = new AbortController(); routeController = controller;
    $('btn-calc-address').disabled = true; $('btn-calc-address').textContent = 'Calculando…'; addressMessage('');
    try {
      const km = await routeDistance(origin, destination, controller.signal);
      if (!controller.signal.aborted && mode === 'address') estimate(km, { origen: origin.label, destino: destination.label }, 'address-error');
    } catch (error) { if (error.name !== 'AbortError') addressMessage(error.message); }
    finally { if (routeController === controller) cancelRoute(); }
  });
});
document.querySelectorAll('[name="consumption"]').forEach(input => input.addEventListener('change', cancelRoute));
const tabs = [...document.querySelectorAll('[role="tab"]')];
function selectMode(next, focus = false) {
  mode = next; cancelRoute(); locationController?.abort(); originPicker.cancel(); destinationPicker.cancel(); addressMessage('');
  tabs.forEach(tab => {
    const selected = tab.dataset.mode === mode;
    tab.setAttribute('aria-selected', String(selected)); tab.tabIndex = selected ? 0 : -1;
    $(tab.getAttribute('aria-controls')).hidden = !selected;
    if (selected && focus) tab.focus();
  });
}
tabs.forEach((tab, index) => {
  tab.addEventListener('click', () => selectMode(tab.dataset.mode));
  tab.addEventListener('keydown', event => {
    let target;
    if (event.key === 'ArrowRight') target = (index + 1) % tabs.length;
    if (event.key === 'ArrowLeft') target = (index + tabs.length - 1) % tabs.length;
    if (event.key === 'Home') target = 0;
    if (event.key === 'End') target = tabs.length - 1;
    if (target !== undefined) { event.preventDefault(); selectMode(tabs[target].dataset.mode, true); }
  });
});

let gpsConfig;
let gpsMode;
let map;
let polyline;
let marker;
let mapLoading = false;
let mapFailed = false;
let gpsGeneration = 0;
let gpsConverted = false;
let gpsFinished = false;
async function updateMap(points) {
  if (!points.length || mapLoading || mapFailed || !$('modal-gps').open) return;
  const generation = gpsGeneration;
  mapLoading = true;
  try {
    const L = await loadMapLibrary();
    if (generation !== gpsGeneration || !$('modal-gps').open) return;
    const last = points.at(-1); const center = [last.lat, last.lng];
    if (!map) {
      $('gps-map').replaceChildren();
      map = L.map('gps-map').setView(center, 16);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap contributors', maxZoom: 19 })
        .on('tileerror', () => message('map-status', 'No pudimos cargar algunas partes del mapa. El registro GPS continúa.')).addTo(map);
      polyline = L.polyline([], { color: '#5b7e30', weight: 4 }).addTo(map);
      marker = L.circleMarker(center, { radius: 6, color: '#315a18', fillColor: '#c5f277', fillOpacity: 1 }).addTo(map);
    }
    map.invalidateSize(); polyline.setLatLngs(points.map(point => [point.lat, point.lng])); marker.setLatLng(center); map.panTo(center);
  } catch (error) { if (generation === gpsGeneration) { mapFailed = true; message('map-status', error.message); } }
  finally { mapLoading = false; }
}
function updateGps(snapshot) {
  $('gps-distancia').textContent = distance(snapshot.km);
  $('gps-tiempo').textContent = duration(snapshot.seconds);
  const liters = snapshot.km / 100 * (gpsMode === 'ruta' ? gpsConfig.consumoRuta : gpsConfig.consumoCiudad);
  $('gps-litros').textContent = `${number(liters, 2)} L`;
  $('gps-costo').textContent = money(liters * gpsConfig.precio, gpsConfig.moneda);
  $('btn-gps-toggle').textContent = snapshot.active ? 'Finalizar recorrido' : 'Iniciar recorrido';
  $('btn-gps-toggle').disabled = gpsFinished;
  updateMap(snapshot.points);
}
const tracker = createTracker({ onUpdate: updateGps, onError: text => message('gps-error', text) });
$('btn-open-gps').addEventListener('click', () => withConfig(() => {
  tracker.reset(); gpsGeneration++; mapFailed = false; gpsConverted = false; gpsFinished = false;
  gpsConfig = { ...config }; gpsMode = consumptionMode();
  if (polyline) polyline.setLatLngs([]);
  $('gps-finish-panel').hidden = true; message('gps-error'); message('map-status'); updateGps(tracker.get()); openDialog('modal-gps');
}));
$('btn-gps-toggle').addEventListener('click', () => {
  message('gps-error');
  if (tracker.get().active) {
    const snapshot = tracker.stop(); gpsFinished = true; updateGps(snapshot);
    $('gps-finish-panel').hidden = false;
    $('gps-final-distancia').textContent = `Recorrido finalizado: ${distance(snapshot.km)}.`;
    $('btn-gps-confirmar').disabled = snapshot.km <= 0;
    if (!snapshot.km) { message('gps-error', 'No se registró distancia suficiente. Cerrá e iniciá un nuevo recorrido.'); }
  } else { tracker.start(); }
});
$('btn-gps-confirmar').addEventListener('click', () => {
  const snapshot = tracker.get();
  if (!positive(snapshot.km)) return;
  try {
    currentTrip = calculateTrip(gpsConfig, snapshot.km, gpsMode, { viaGps: true });
    gpsConverted = true; closeDialog('modal-gps');
    setTimeout(() => renderResult({ focus: true }), 0);
  } catch (error) { message('gps-error', error.message); }
});
$('modal-gps').beforeClose = () => gpsConverted || (!tracker.get().active && !tracker.get().km) || confirm('¿Querés descartar este recorrido GPS y cerrar?');
$('modal-gps').addEventListener('close', () => { tracker.stop(); gpsGeneration++; });
window.addEventListener('pagehide', () => { tracker.stop(); cancelRoute(); locationController?.abort(); });
window.addEventListener('pageshow', event => {
  if (event.persisted) {
    currentTrip = null; renderResult();
    if ($('modal-gps').open) {
      gpsFinished = true; updateGps(tracker.get()); $('gps-finish-panel').hidden = false;
      $('gps-final-distancia').textContent = `Recorrido pausado: ${distance(tracker.get().km)}.`;
      $('btn-gps-confirmar').disabled = tracker.get().km <= 0;
      message('gps-error', 'El navegador pausó el GPS. Podés usar la distancia registrada o iniciar un nuevo recorrido.');
    }
  }
});
window.addEventListener('storage', event => {
  if (event.key === 'auto-viaje.historial' || event.key === null) {
    const wasSaved = currentTrip && history.some(trip => trip.id === currentTrip.id);
    history = store.loadHistory();
    if (wasSaved && !history.some(trip => trip.id === currentTrip.id)) currentTrip = null;
    if ($('modal-detail').open && detailTrip && !history.some(trip => trip.id === detailTrip.id) && $('btn-delete-trip').hidden === false) closeDialog('modal-detail');
    renderHistory(); renderResult();
  }
  if (event.key === 'auto-viaje.config' || event.key === null) { cancelRoute(); config = store.loadConfig(); renderVehicle(); }
});
renderVehicle(); renderHistory(); renderResult();
