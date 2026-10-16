import { gpsSegment } from './domain.mjs';

export function createTracker({ onUpdate, onError }, geolocation = navigator.geolocation) {
  let watchId = null;
  let timer = null;
  let active = false;
  let points = [];
  let km = 0;
  let started = 0;
  let elapsed = 0;
  let generation = 0;
  const snapshot = () => ({ km, points: [...points], seconds: active ? (Date.now() - started) / 1000 : elapsed, active });
  const stop = () => {
    if (active) elapsed = (Date.now() - started) / 1000;
    active = false;
    generation++;
    if (watchId !== null) geolocation?.clearWatch(watchId);
    watchId = null;
    clearInterval(timer); timer = null;
    return snapshot();
  };
  return {
    get: snapshot,
    stop,
    reset() { stop(); points = []; km = 0; started = 0; elapsed = 0; },
    start() {
      if (active) return;
      if (!geolocation) { onError('Este navegador no permite usar GPS. Podés ingresar la distancia.'); return; }
      points = []; km = 0; elapsed = 0; started = Date.now(); active = true;
      const session = ++generation;
      const update = () => onUpdate(snapshot());
      timer = setInterval(update, 1000);
      update();
      watchId = geolocation.watchPosition(pos => {
        if (!active || session !== generation) return;
        const next = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy, time: pos.timestamp };
        const segment = gpsSegment(points.at(-1), next);
        if (segment === null) {
          if (next.accuracy > 50) onError('La señal tiene poca precisión. Esperando una posición más confiable…');
          return;
        }
        km += segment; points.push(next); onError(''); update();
      }, error => {
        if (!active || session !== generation) return;
        if (error.code === 1) { stop(); update(); onError('Habilitá el permiso de ubicación para iniciar el recorrido.'); }
        else onError('Se perdió la señal de GPS. Podés finalizar con la distancia registrada.');
      }, { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 });
    },
  };
}
