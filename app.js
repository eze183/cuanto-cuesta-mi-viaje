const STORAGE_CONFIG = "auto-viaje.config";
const STORAGE_HISTORY = "auto-viaje.historial";

const els = {
  btnSettings: document.getElementById("btn-settings"),

  configSummaryCard: document.getElementById("config-summary-card"),
  configSummaryText: document.getElementById("config-summary-text"),
  btnEditConfig: document.getElementById("btn-edit-config"),

  tripCard: document.getElementById("trip-card"),
  tripOrigen: document.getElementById("trip-origen"),
  tripDestino: document.getElementById("trip-destino"),
  origenSuggestions: document.getElementById("origen-suggestions"),
  destinoSuggestions: document.getElementById("destino-suggestions"),
  btnUseLocation: document.getElementById("btn-use-location"),
  btnCalcAddress: document.getElementById("btn-calc-address"),
  addressError: document.getElementById("address-error"),
  tripDistancia: document.getElementById("trip-distancia"),
  tripUnidadToggle: document.getElementById("trip-unidad-toggle"),
  tripError: document.getElementById("trip-error"),
  btnCalcular: document.getElementById("btn-calcular"),
  btnOpenGps: document.getElementById("btn-open-gps"),
  consumoSwitch: document.getElementById("consumo-switch"),

  resultCard: document.getElementById("result-card"),
  resultTotal: document.getElementById("result-total"),
  resultSub: document.getElementById("result-sub"),

  historySection: document.getElementById("history-section"),
  historyGroups: document.getElementById("history-groups"),
  historyEmpty: document.getElementById("history-empty"),

  modalSetup: document.getElementById("modal-setup"),
  btnCloseSetup: document.getElementById("btn-close-setup"),
  setupVehiculoTipo: document.getElementById("setup-vehiculo-tipo"),
  setupConsumoCiudad: document.getElementById("setup-consumo-ciudad"),
  setupConsumoRuta: document.getElementById("setup-consumo-ruta"),
  setupPrecio: document.getElementById("setup-precio"),
  setupMoneda: document.getElementById("setup-moneda"),
  setupPeso: document.getElementById("setup-peso"),
  setupError: document.getElementById("setup-error"),
  btnSaveSetup: document.getElementById("btn-save-setup"),

  modalGps: document.getElementById("modal-gps"),
  gpsMap: document.getElementById("gps-map"),
  gpsDistancia: document.getElementById("gps-distancia"),
  gpsTiempo: document.getElementById("gps-tiempo"),
  gpsLitros: document.getElementById("gps-litros"),
  gpsCosto: document.getElementById("gps-costo"),
  gpsError: document.getElementById("gps-error"),
  btnGpsToggle: document.getElementById("btn-gps-toggle"),
  btnGpsCancel: document.getElementById("btn-gps-cancel"),
  gpsFinishPanel: document.getElementById("gps-finish-panel"),
  gpsFinalDistancia: document.getElementById("gps-final-distancia"),
  btnGpsConfirmar: document.getElementById("btn-gps-confirmar"),

  modalDetail: document.getElementById("modal-detail"),
  btnCloseDetail: document.getElementById("btn-close-detail"),
  detailRoute: document.getElementById("detail-route"),
  detailTotal: document.getElementById("detail-total"),
  detailDistancia: document.getElementById("detail-distancia"),
  detailLitros: document.getElementById("detail-litros"),
  comparisonList: document.getElementById("comparison-list"),
  btnDeleteTrip: document.getElementById("btn-delete-trip"),
};

const DEFAULT_PESO_KG = 70;

const VEHICLE_PRESETS = {
  chico: { ciudad: 7.5, ruta: 5.5 },
  sedan: { ciudad: 9.5, ruta: 7 },
  suv: { ciudad: 11.5, ruta: 8.5 },
  camioneta: { ciudad: 13, ruta: 9.5 },
};

const ACTIVITIES = [
  { key: "auto", icon: "🚗", label: "En auto (estimado)", speedKmH: 60, met: null, reference: true },
  { key: "bici", icon: "🚴", label: "En bicicleta", speedKmH: 16, met: 6.8 },
  { key: "trote", icon: "🏃", label: "Trotando", speedKmH: 8, met: 8.3 },
  { key: "caminata", icon: "🚶", label: "Caminando", speedKmH: 5, met: 3.5 },
];

let currentTrip = null;
let currentDetailTrip = null;
let consumoModo = "ciudad";

function getConsumo(config) {
  if (config.consumoCiudad != null && config.consumoRuta != null) {
    return consumoModo === "ruta" ? config.consumoRuta : config.consumoCiudad;
  }
  return config.consumo;
}
let userLocation = null;
let userLocationRequested = false;

function ensureUserLocation() {
  if (userLocationRequested || !navigator.geolocation) return;
  userLocationRequested = true;
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      userLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    },
    () => {},
    { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 }
  );
}

function getConfig() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_CONFIG));
  } catch {
    return null;
  }
}

function saveConfig(config) {
  localStorage.setItem(STORAGE_CONFIG, JSON.stringify(config));
}

function makeId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function getHistory() {
  let history;
  try {
    history = JSON.parse(localStorage.getItem(STORAGE_HISTORY)) || [];
  } catch {
    history = [];
  }

  let mutated = false;
  history.forEach((trip) => {
    if (!trip.id) {
      trip.id = makeId();
      mutated = true;
    }
  });
  if (mutated) saveHistory(history);

  return history;
}

function saveHistory(history) {
  localStorage.setItem(STORAGE_HISTORY, JSON.stringify(history));
}

function isValidNumber(value, { allowZero = true } = {}) {
  if (value === "" || value === null || value === undefined) return false;
  const n = Number(value);
  if (Number.isNaN(n)) return false;
  if (n < 0) return false;
  if (!allowZero && n === 0) return false;
  return true;
}

function formatMoney(amount, currency) {
  const rounded = Math.round(amount);
  const formatted = rounded.toLocaleString("es-AR");
  return `${formatted} ${currency}`;
}

function formatNumber(n, decimals = 1) {
  return Number(n).toLocaleString("es-AR", {
    maximumFractionDigits: decimals,
  });
}

function formatDistance(km) {
  if (km < 1) {
    return `${Math.round(km * 1000)} m`;
  }
  return `${formatNumber(km, km < 10 ? 2 : 1)} km`;
}

async function geocodeAddress(address) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(
    address
  )}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error("No pudimos buscar esa dirección.");
  const data = await res.json();
  if (!data.length) throw new Error(`No encontramos la dirección: "${address}".`);
  return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
}

async function reverseGeocode(lat, lng) {
  const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error("No pudimos obtener tu dirección actual.");
  const data = await res.json();
  if (!data || !data.display_name) throw new Error("No pudimos obtener tu dirección actual.");
  const a = data.address || {};
  const road = a.road || a.pedestrian || a.footway || "";
  if (road) return a.house_number ? `${road} ${a.house_number}` : road;
  return data.display_name.split(",").slice(0, 2).join(",").trim();
}

async function searchAddressSuggestions(query) {
  let url = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=5&accept-language=es&q=${encodeURIComponent(
    query
  )}`;
  if (userLocation) {
    const d = 0.35;
    const left = userLocation.lng - d;
    const right = userLocation.lng + d;
    const top = userLocation.lat + d;
    const bottom = userLocation.lat - d;
    url += `&viewbox=${left},${top},${right},${bottom}&bounded=0`;
  }
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) return [];
  return res.json();
}

function formatSuggestionLabel(item) {
  const a = item.address || {};
  const main = a.road ? (a.house_number ? `${a.road} ${a.house_number}` : a.road) : item.display_name.split(",")[0];
  const city = a.city || a.town || a.village || a.suburb || "";
  const state = a.state || "";
  return [main, city, state].filter(Boolean).join(", ");
}

function setupAddressAutocomplete(input, suggestionsEl) {
  let debounceTimer = null;
  let requestToken = 0;

  function hideSuggestions() {
    suggestionsEl.classList.add("hidden");
    suggestionsEl.innerHTML = "";
  }

  input.addEventListener("focus", ensureUserLocation);

  input.addEventListener("input", () => {
    const query = input.value.trim();
    clearTimeout(debounceTimer);

    if (query.length < 3) {
      hideSuggestions();
      return;
    }

    const myToken = ++requestToken;
    debounceTimer = setTimeout(async () => {
      const results = await searchAddressSuggestions(query);
      if (myToken !== requestToken) return;

      if (!results.length) {
        hideSuggestions();
        return;
      }

      suggestionsEl.innerHTML = results
        .map((item, i) => `<button type="button" class="address-suggestion-item" data-index="${i}">${formatSuggestionLabel(item)}</button>`)
        .join("");
      suggestionsEl.classList.remove("hidden");

      suggestionsEl.querySelectorAll(".address-suggestion-item").forEach((btn, i) => {
        btn.addEventListener("mousedown", (e) => {
          e.preventDefault();
          input.value = formatSuggestionLabel(results[i]);
          hideSuggestions();
        });
      });
    }, 400);
  });

  input.addEventListener("blur", () => {
    setTimeout(hideSuggestions, 150);
  });
}

async function routeDistanceKm(origin, destination) {
  const url = `https://router.project-osrm.org/route/v1/driving/${origin.lng},${origin.lat};${destination.lng},${destination.lat}?overview=false`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("No pudimos calcular la ruta entre esas direcciones.");
  const data = await res.json();
  if (!data.routes || !data.routes.length) {
    throw new Error("No pudimos calcular la ruta entre esas direcciones.");
  }
  return data.routes[0].distance / 1000;
}

function openModal(modal) {
  modal.classList.remove("hidden");
}

function closeModal(modal) {
  modal.classList.add("hidden");
}

function haversineKm(a, b) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function formatTiempo(seconds) {
  const m = Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0");
  const s = Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0");
  return `${m}:${s}`;
}

function formatDuration(hours) {
  const totalMinutes = Math.round(hours * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} h`;
  return `${h} h ${m} min`;
}

function renderComparison(distanciaKm) {
  const config = getConfig();
  const peso = config && config.peso ? config.peso : DEFAULT_PESO_KG;

  const items = ACTIVITIES.map((activity) => {
    const hours = distanciaKm / activity.speedKmH;
    const calorias = activity.met ? Math.round(activity.met * peso * hours) : null;
    return { ...activity, hours, calorias };
  });

  const maxHours = Math.max(...items.map((i) => i.hours));

  els.comparisonList.innerHTML = items
    .map((item, i) => {
      const widthPct = Math.max(6, Math.round((item.hours / maxHours) * 100));
      return `
        <div class="comparison-item${item.reference ? " is-reference" : ""}" style="animation-delay:${i * 0.12}s">
          <div class="comparison-row">
            <span class="comparison-icon">${item.icon}</span>
            <span class="comparison-label">${item.label}</span>
            <span class="comparison-time">${formatDuration(item.hours)}</span>
          </div>
          <div class="comparison-bar-track">
            <div class="comparison-bar-fill" data-width="${widthPct}" style="transition-delay:${0.25 + i * 0.12}s"></div>
          </div>
          ${item.calorias ? `<span class="comparison-calories">≈ ${formatNumber(item.calorias, 0)} kcal</span>` : ""}
        </div>
      `;
    })
    .join("");

  els.comparisonList.querySelectorAll(".comparison-bar-fill").forEach((el) => {
    void el.offsetWidth;
    el.style.width = `${el.dataset.width}%`;
  });
}

function routeLabel(trip) {
  if (trip.origen && trip.destino) return `${trip.origen} → ${trip.destino}`;
  if (trip.origen && trip.viaGps) return `${trip.origen} → 📍 GPS`;
  if (trip.viaGps) return "Recorrido GPS";
  return "Viaje";
}

function openDetailModal(trip) {
  currentDetailTrip = trip;
  els.detailRoute.textContent = routeLabel(trip);
  els.detailTotal.textContent = formatMoney(trip.costoTotal, trip.moneda);
  els.detailDistancia.textContent = `📏 ${formatDistance(trip.distancia)}`;
  els.detailLitros.textContent = `⛽ ${formatNumber(trip.litros, 1)} L`;
  renderComparison(trip.distancia);
  openModal(els.modalDetail);
}

function showResultCard(trip) {
  els.resultTotal.textContent = formatMoney(trip.costoTotal, trip.moneda);
  els.resultSub.textContent = `${formatDistance(trip.distancia)} · ${formatNumber(trip.litros, 2)} L`;
  els.resultCard.classList.remove("hidden");
}

function finalizeTrip(distanciaKm, { origen, destino, viaGps } = {}) {
  const config = getConfig();
  const litros = (distanciaKm / 100) * getConsumo(config);
  const costoTotal = litros * config.precio;

  const trip = {
    id: makeId(),
    fecha: new Date().toISOString(),
    distancia: distanciaKm,
    litros,
    costoTotal,
    moneda: config.moneda,
    origen: origen || null,
    destino: destino || null,
    viaGps: Boolean(viaGps),
    consumoModo,
  };

  const history = getHistory();
  history.push(trip);
  saveHistory(history);

  currentTrip = trip;
  showResultCard(trip);
  renderHistoryGroups();
}

function renderConfigSummary() {
  const config = getConfig();
  if (!config) return;
  const consumoText =
    config.consumoCiudad != null && config.consumoRuta != null
      ? `🏙️ ${config.consumoCiudad} · 🛣️ ${config.consumoRuta} L/100km`
      : `${config.consumo} L/100km`;
  els.configSummaryText.textContent = `${consumoText} · $${formatNumber(config.precio, 2)}/L (${config.moneda})`;
}

function groupHistoryByMonth(history) {
  const sorted = history.slice().sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
  const now = new Date();
  const groups = [];

  sorted.forEach((trip) => {
    const d = new Date(trip.fecha);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    let group = groups.find((g) => g.key === key);
    if (!group) {
      let label = d.toLocaleDateString("es-AR", { month: "long" });
      label = label.charAt(0).toUpperCase() + label.slice(1);
      if (d.getFullYear() !== now.getFullYear()) label += ` ${d.getFullYear()}`;
      group = { key, label, total: 0, trips: [] };
      groups.push(group);
    }
    group.total += trip.costoTotal;
    group.trips.push(trip);
  });

  return groups;
}

function renderHistoryGroups() {
  const history = getHistory();
  const config = getConfig();
  const currency = config ? config.moneda : "ARS";

  els.historySection.classList.remove("hidden");

  if (history.length === 0) {
    els.historyGroups.innerHTML = "";
    els.historyEmpty.classList.remove("hidden");
    return;
  }
  els.historyEmpty.classList.add("hidden");

  const groups = groupHistoryByMonth(history);

  els.historyGroups.innerHTML = groups
    .map(
      (group, gi) => `
        <div class="history-month-header">
          <span class="history-month-icon">📅</span>
          <span class="history-month-name">${group.label}</span>
          <span class="history-month-total"><strong>${formatMoney(group.total, currency)}</strong> gastados</span>
        </div>
        <ul class="history-list">
          ${group.trips
            .map((trip, ti) => {
              const d = new Date(trip.fecha);
              const day = d.getDate().toString().padStart(2, "0");
              const mon = d.toLocaleDateString("es-AR", { month: "short" }).replace(".", "");
              const routeText = routeLabel(trip);
              return `
                <li>
                  <button class="history-item" type="button" data-group="${gi}" data-index="${ti}">
                    <span class="h-date-badge">
                      <span class="h-date-day">${day}</span>
                      <span class="h-date-mon">${mon}</span>
                    </span>
                    <span class="h-body">
                      <span class="h-route">${routeText}</span>
                      <span class="h-distancia">${formatDistance(trip.distancia)}</span>
                    </span>
                    <span class="h-cost">${formatMoney(trip.costoTotal, trip.moneda)}</span>
                  </button>
                </li>
              `;
            })
            .join("")}
        </ul>
      `
    )
    .join("");

  els.historyGroups.querySelectorAll(".history-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      const gi = Number(btn.dataset.group);
      const ti = Number(btn.dataset.index);
      openDetailModal(groups[gi].trips[ti]);
    });
  });
}

function refreshMain() {
  renderConfigSummary();
  renderHistoryGroups();
}

function resetTripForm() {
  els.tripOrigen.value = "";
  els.tripDestino.value = "";
  els.tripDistancia.value = "";
  els.tripUnidadToggle.dataset.unidad = "km";
  els.tripUnidadToggle.textContent = "km";
  els.addressError.classList.add("hidden");
  els.tripError.classList.add("hidden");
}

els.resultCard.addEventListener("click", () => {
  if (currentTrip) openDetailModal(currentTrip);
});

els.btnCloseDetail.addEventListener("click", () => closeModal(els.modalDetail));

els.btnDeleteTrip.addEventListener("click", () => {
  if (!currentDetailTrip) return;
  const confirmed = window.confirm("¿Seguro que querés eliminar este viaje del historial?");
  if (!confirmed) return;

  const history = getHistory().filter((t) => t.id !== currentDetailTrip.id);
  saveHistory(history);
  currentDetailTrip = null;
  closeModal(els.modalDetail);
  refreshMain();
});

setupAddressAutocomplete(els.tripOrigen, els.origenSuggestions);
setupAddressAutocomplete(els.tripDestino, els.destinoSuggestions);

// --- Configuración del vehículo ---

function openSetupModal({ onboarding = false } = {}) {
  const config = getConfig();
  const consumoCiudad = config && config.consumoCiudad != null ? config.consumoCiudad : config ? config.consumo : "";
  const consumoRuta = config && config.consumoRuta != null ? config.consumoRuta : config ? config.consumo : "";
  els.setupVehiculoTipo.value = (config && config.vehiculoTipo) || "";
  els.setupConsumoCiudad.value = consumoCiudad;
  els.setupConsumoRuta.value = consumoRuta;
  els.setupPrecio.value = config ? config.precio : "";
  els.setupMoneda.value = config ? config.moneda : "";
  els.setupPeso.value = config && config.peso ? config.peso : "";
  els.setupError.classList.add("hidden");
  els.btnCloseSetup.classList.toggle("hidden", onboarding);
  openModal(els.modalSetup);
}

els.btnSettings.addEventListener("click", () => openSetupModal());
els.btnEditConfig.addEventListener("click", () => openSetupModal());
els.btnCloseSetup.addEventListener("click", () => closeModal(els.modalSetup));

els.setupVehiculoTipo.addEventListener("change", () => {
  const preset = VEHICLE_PRESETS[els.setupVehiculoTipo.value];
  if (!preset) return;
  els.setupConsumoCiudad.value = preset.ciudad;
  els.setupConsumoRuta.value = preset.ruta;
});

els.btnSaveSetup.addEventListener("click", () => {
  const consumoCiudad = els.setupConsumoCiudad.value.trim();
  const consumoRuta = els.setupConsumoRuta.value.trim();
  const precio = els.setupPrecio.value.trim();
  const moneda = els.setupMoneda.value.trim() || "ARS";
  const pesoRaw = els.setupPeso.value.trim();

  if (
    !isValidNumber(consumoCiudad, { allowZero: false }) ||
    !isValidNumber(consumoRuta, { allowZero: false }) ||
    !isValidNumber(precio, { allowZero: false })
  ) {
    els.setupError.textContent =
      "Ingresá valores numéricos mayores a cero para consumo (ciudad y ruta) y precio.";
    els.setupError.classList.remove("hidden");
    return;
  }

  if (pesoRaw !== "" && !isValidNumber(pesoRaw, { allowZero: false })) {
    els.setupError.textContent = "El peso debe ser un valor numérico mayor a cero.";
    els.setupError.classList.remove("hidden");
    return;
  }

  saveConfig({
    consumoCiudad: Number(consumoCiudad),
    consumoRuta: Number(consumoRuta),
    vehiculoTipo: els.setupVehiculoTipo.value || null,
    precio: Number(precio),
    moneda: moneda.toUpperCase(),
    peso: pesoRaw === "" ? null : Number(pesoRaw),
  });

  els.setupError.classList.add("hidden");
  closeModal(els.modalSetup);
  els.configSummaryCard.classList.remove("hidden");
  els.tripCard.classList.remove("hidden");
  refreshMain();
});

els.consumoSwitch.addEventListener("click", (e) => {
  const btn = e.target.closest(".consumo-switch-btn");
  if (!btn) return;
  consumoModo = btn.dataset.modo;
  els.consumoSwitch.querySelectorAll(".consumo-switch-btn").forEach((b) => {
    b.classList.toggle("active", b === btn);
  });
});

// --- Formulario de viaje ---

els.btnCalcular.addEventListener("click", () => {
  const distancia = els.tripDistancia.value.trim();

  if (!isValidNumber(distancia, { allowZero: false })) {
    els.tripError.textContent = "Ingresá una distancia numérica mayor a cero.";
    els.tripError.classList.remove("hidden");
    return;
  }

  els.tripError.classList.add("hidden");
  const unidad = els.tripUnidadToggle.dataset.unidad;
  const distanciaKm = unidad === "m" ? Number(distancia) / 1000 : Number(distancia);
  const origen = els.tripOrigen.value.trim();
  const destino = els.tripDestino.value.trim();
  finalizeTrip(distanciaKm, { origen, destino });
  resetTripForm();
});

els.tripUnidadToggle.addEventListener("click", () => {
  const current = els.tripUnidadToggle.dataset.unidad;
  const next = current === "km" ? "m" : "km";
  const value = els.tripDistancia.value.trim();

  if (value !== "" && !Number.isNaN(Number(value))) {
    const num = Number(value);
    els.tripDistancia.value = next === "m" ? Math.round(num * 1000) : Number((num / 1000).toFixed(3));
  }

  els.tripUnidadToggle.dataset.unidad = next;
  els.tripUnidadToggle.textContent = next;
});

els.btnCalcAddress.addEventListener("click", async () => {
  const origen = els.tripOrigen.value.trim();
  const destino = els.tripDestino.value.trim();
  els.addressError.classList.add("hidden");

  if (!origen || !destino) {
    els.addressError.textContent = "Ingresá dirección de partida y de destino.";
    els.addressError.classList.remove("hidden");
    return;
  }

  els.btnCalcAddress.disabled = true;
  els.btnCalcAddress.textContent = "Calculando…";

  try {
    const [origenCoords, destinoCoords] = await Promise.all([
      geocodeAddress(origen),
      geocodeAddress(destino),
    ]);
    const distanciaKm = await routeDistanceKm(origenCoords, destinoCoords);

    const useMeters = distanciaKm < 1;
    els.tripUnidadToggle.dataset.unidad = useMeters ? "m" : "km";
    els.tripUnidadToggle.textContent = useMeters ? "m" : "km";
    els.tripDistancia.value = useMeters ? Math.round(distanciaKm * 1000) : Number(distanciaKm.toFixed(2));
  } catch (err) {
    els.addressError.textContent =
      err.message || "No pudimos calcular la distancia. Verificá las direcciones e intentá de nuevo.";
    els.addressError.classList.remove("hidden");
  } finally {
    els.btnCalcAddress.disabled = false;
    els.btnCalcAddress.textContent = "🧭 Calcular distancia por dirección";
  }
});

els.btnUseLocation.addEventListener("click", () => {
  els.addressError.classList.add("hidden");

  if (!navigator.geolocation) {
    els.addressError.textContent = "Este dispositivo no permite obtener tu ubicación.";
    els.addressError.classList.remove("hidden");
    return;
  }

  els.btnUseLocation.disabled = true;
  els.btnUseLocation.textContent = "Ubicando…";

  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      userLocationRequested = true;
      userLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      try {
        els.tripOrigen.value = await reverseGeocode(pos.coords.latitude, pos.coords.longitude);
      } catch (err) {
        els.addressError.textContent = err.message;
        els.addressError.classList.remove("hidden");
      } finally {
        els.btnUseLocation.disabled = false;
        els.btnUseLocation.textContent = "📍 Usar mi ubicación";
      }
    },
    () => {
      els.addressError.textContent =
        "No pudimos acceder a tu ubicación. Revisá los permisos del navegador.";
      els.addressError.classList.remove("hidden");
      els.btnUseLocation.disabled = false;
      els.btnUseLocation.textContent = "📍 Usar mi ubicación";
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
});

// --- Registro de recorrido con GPS ---

let gpsMap = null;
let gpsPolyline = null;
let gpsMarker = null;
let gpsWatchId = null;
let gpsTimerId = null;
let gpsPoints = [];
let gpsDistanciaKm = 0;
let gpsStartTime = null;
let gpsTracking = false;
let gpsOrigenSnapshot = "";

function ensureGpsMap(center) {
  if (gpsMap) return;
  gpsMap = L.map(els.gpsMap).setView([center.lat, center.lng], 16);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap contributors",
    maxZoom: 19,
  }).addTo(gpsMap);
  gpsPolyline = L.polyline([], { color: "#2f8fef", weight: 4 }).addTo(gpsMap);
  gpsMarker = L.circleMarker([center.lat, center.lng], {
    radius: 7,
    color: "#2f8fef",
    fillColor: "#2f8fef",
    fillOpacity: 1,
  }).addTo(gpsMap);
}

function resetGpsState() {
  gpsPoints = [];
  gpsDistanciaKm = 0;
  gpsStartTime = null;
  gpsTracking = false;
  if (gpsPolyline) gpsPolyline.setLatLngs([]);
  els.gpsDistancia.textContent = "0 m";
  els.gpsTiempo.textContent = "00:00";
  els.gpsLitros.textContent = "0,0 L";
  els.gpsCosto.textContent = "-";
  els.gpsError.classList.add("hidden");
  els.gpsFinishPanel.classList.add("hidden");
  els.btnGpsToggle.textContent = "Iniciar recorrido";
  els.btnGpsToggle.classList.remove("btn-danger");
  els.btnGpsToggle.disabled = false;
}

function stopGpsWatch() {
  if (gpsWatchId !== null) {
    navigator.geolocation.clearWatch(gpsWatchId);
    gpsWatchId = null;
  }
  if (gpsTimerId !== null) {
    clearInterval(gpsTimerId);
    gpsTimerId = null;
  }
}

function openGpsModal() {
  resetGpsState();
  gpsOrigenSnapshot = els.tripOrigen.value.trim();
  openModal(els.modalGps);

  if (!navigator.geolocation) {
    els.gpsError.textContent = "Este dispositivo no permite obtener tu ubicación.";
    els.gpsError.classList.remove("hidden");
    els.btnGpsToggle.disabled = true;
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      ensureGpsMap({ lat: pos.coords.latitude, lng: pos.coords.longitude });
    },
    () => {
      els.gpsError.textContent =
        "No pudimos acceder a tu ubicación. Revisá los permisos de GPS del navegador.";
      els.gpsError.classList.remove("hidden");
    },
    { enableHighAccuracy: true }
  );
}

function startGpsTracking() {
  gpsTracking = true;
  gpsStartTime = Date.now();
  gpsPoints = [];
  gpsDistanciaKm = 0;
  els.btnGpsToggle.textContent = "Finalizar recorrido";
  els.btnGpsToggle.classList.add("btn-danger");
  els.gpsFinishPanel.classList.add("hidden");
  els.gpsError.classList.add("hidden");

  gpsTimerId = setInterval(() => {
    const elapsed = (Date.now() - gpsStartTime) / 1000;
    els.gpsTiempo.textContent = formatTiempo(elapsed);
  }, 1000);

  gpsWatchId = navigator.geolocation.watchPosition(
    (pos) => {
      const point = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      ensureGpsMap(point);

      if (gpsPoints.length > 0) {
        gpsDistanciaKm += haversineKm(gpsPoints[gpsPoints.length - 1], point);
      }
      gpsPoints.push(point);

      els.gpsDistancia.textContent = formatDistance(gpsDistanciaKm);

      const config = getConfig();
      const litros = (gpsDistanciaKm / 100) * getConsumo(config);
      const costo = litros * config.precio;
      els.gpsLitros.textContent = `${formatNumber(litros, 2)} L`;
      els.gpsCosto.textContent = formatMoney(costo, config.moneda);

      gpsPolyline.setLatLngs(gpsPoints.map((p) => [p.lat, p.lng]));
      gpsMarker.setLatLng([point.lat, point.lng]);
      gpsMap.panTo([point.lat, point.lng]);
    },
    () => {
      els.gpsError.textContent =
        "Se perdió la señal de GPS. Podés finalizar el recorrido con lo registrado hasta ahora.";
      els.gpsError.classList.remove("hidden");
    },
    { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 }
  );
}

function finishGpsTracking() {
  gpsTracking = false;
  stopGpsWatch();
  els.btnGpsToggle.disabled = true;
  els.gpsFinalDistancia.textContent = formatDistance(gpsDistanciaKm);
  els.gpsFinishPanel.classList.remove("hidden");
}

els.btnOpenGps.addEventListener("click", openGpsModal);

els.btnGpsCancel.addEventListener("click", () => {
  stopGpsWatch();
  closeModal(els.modalGps);
});

els.btnGpsToggle.addEventListener("click", () => {
  if (!gpsTracking) {
    startGpsTracking();
  } else {
    finishGpsTracking();
  }
});

els.btnGpsConfirmar.addEventListener("click", () => {
  if (gpsDistanciaKm <= 0) {
    els.gpsError.textContent = "No se registró distancia. Intentá iniciar el recorrido de nuevo.";
    els.gpsError.classList.remove("hidden");
    return;
  }

  els.gpsError.classList.add("hidden");
  finalizeTrip(gpsDistanciaKm, { origen: gpsOrigenSnapshot, viaGps: true });
  resetTripForm();
  stopGpsWatch();
  closeModal(els.modalGps);
});

function init() {
  const config = getConfig();
  if (!config) {
    openSetupModal({ onboarding: true });
  } else {
    els.configSummaryCard.classList.remove("hidden");
    els.tripCard.classList.remove("hidden");
    refreshMain();
  }
}

init();
