import { normalizeConfig, normalizeTrip } from './domain.mjs';

export const CONFIG_KEY = 'auto-viaje.config';
export const HISTORY_KEY = 'auto-viaje.historial';

// Keep existing keys and legacy records. Never overwrite unreadable data on load.
export function createStore(storage, notify = () => {}) {
  function read(key, fallback) {
    try {
      const raw = storage.getItem(key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch {
      notify('No pudimos leer algunos datos guardados. No los sobrescribimos. Podés seguir calculando.');
      return fallback;
    }
  }
  function write(key, value) {
    try {
      const existing = storage.getItem(key);
      if (existing != null) {
        let valid = false;
        try {
          const parsed = JSON.parse(existing);
          valid = key === CONFIG_KEY ? Boolean(normalizeConfig(parsed)) : Array.isArray(parsed) && parsed.every((item, index) => normalizeTrip(item, index));
        } catch { /* Preserve the original bytes before replacing malformed data. */ }
        if (!valid) {
          const backupKey = `${key}.recovery.${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          storage.setItem(backupKey, existing);
          notify('Conservamos una copia local de los datos dañados antes de guardar los nuevos.');
        }
      }
      storage.setItem(key, JSON.stringify(value)); return true;
    }
    catch { notify('No se pudo guardar en este navegador. Revisá el espacio disponible y los permisos de almacenamiento.'); return false; }
  }
  return {
    loadConfig() {
      const raw = read(CONFIG_KEY, null);
      const config = normalizeConfig(raw);
      if (raw && !config) notify('La configuración guardada no es válida. Volvé a configurar tu vehículo.');
      return config;
    },
    loadHistory() {
      const raw = read(HISTORY_KEY, []);
      if (!Array.isArray(raw)) { notify('El historial guardado no es válido. No modificamos los datos originales.'); return []; }
      const valid = raw.map(normalizeTrip).filter(Boolean);
      if (valid.length !== raw.length) notify('Hay viajes con datos inválidos que no se muestran. Los datos originales siguen guardados.');
      return valid;
    },
    saveConfig: value => write(CONFIG_KEY, value),
    saveHistory: value => write(HISTORY_KEY, value),
  };
}
