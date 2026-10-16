# Tu viaje

Calculadora estática de combustible, sin backend ni paso de compilación. Permite estimar por distancia, buscar un recorrido por dirección o registrar distancia con GPS. Calcular no modifica el historial: cada viaje se guarda mediante una acción explícita.

## Desarrollo

Desde la raíz del repositorio, con Python 3:

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

Abrí la aplicación servida en un navegador. Los módulos ES necesitan HTTP; abrir `index.html` como archivo local no es compatible. No hacen falta claves, base de datos ni paquetes de producción.

## Verificación

Pruebas de cálculo, migración, persistencia, monedas, servicios y filtrado GPS con Node 20 o posterior:

```sh
node --test tests/core.test.mjs
```

Pruebas de interacción con Python Playwright y Chromium instalado:

```sh
python3 -m unittest discover -s tests -p '*_test.py' -v
```

La suite de navegador inicia y detiene su propio servidor en un puerto libre. Usa `/usr/bin/chromium` por defecto; se puede indicar otra ruta con `CHROMIUM_PATH`. Si Playwright no está disponible, instalalo en un entorno virtual de desarrollo (`python3 -m venv .venv`, activar el entorno, `python3 -m pip install playwright`) y usá una instalación de Chromium del sistema. No es una dependencia de la aplicación.

Los servicios externos y el GPS se simulan de forma controlada en las pruebas para cubrir errores y cancelaciones. Esto valida la integración de la interfaz, no la disponibilidad real de esos servicios ni la precisión de un dispositivo físico. Las capturas de escritorio y móvil se generan en `/tmp/tu-viaje-desktop.png` y `/tmp/tu-viaje-mobile.png`.

## Organización

- `app.js`: coordinación de formularios, resultados, historial y diálogos.
- `js/domain.mjs`: cálculos, validación, compatibilidad de registros y agrupación por moneda.
- `js/storage.mjs`: lectura y escritura con recuperación de datos locales.
- `js/services.mjs`: solicitudes cancelables, caché, límites de espera y carga diferida del mapa.
- `js/gps.mjs`: seguimiento, limpieza de recursos y filtrado de posiciones.
- `js/ui.mjs`: nodos de texto seguros, diálogos y selector de direcciones con teclado.

## Datos existentes

Se conservan `auto-viaje.config` y `auto-viaje.historial` en `localStorage`, incluyendo configuraciones antiguas con un solo consumo y viajes sin identificador. Los totales mensuales se separan por moneda; no hay conversión de divisas. Los cálculos nuevos incluyen una copia del consumo, precio y peso usados para que su detalle no cambie al editar la configuración.

Los registros inválidos no se muestran ni se modifican al leer. Antes de reemplazar datos dañados al guardar, se conserva el contenido original en una clave local con el prefijo `auto-viaje.config.recovery.` o `auto-viaje.historial.recovery.`. Si no se puede escribir, se informa el fallo y no se muestra una confirmación falsa. Borrar los datos del navegador elimina también las copias locales; no hay sincronización entre dispositivos.

## Mapas y ubicación

- Búsquedas explícitas y geocodificación inversa: `nominatim.openstreetmap.org`.
- Rutas para automóvil: `router.project-osrm.org`.
- Leaflet 1.9.4, cargado al recibir la primera posición GPS: `unpkg.com`.
- Teselas: `a.tile.openstreetmap.org`, `b.tile.openstreetmap.org`, `c.tile.openstreetmap.org`.

La búsqueda se ejecuta con la lupa o Enter; los resultados se eligen con flechas y Enter o con un toque. No se envían consultas mientras se escribe: el servicio público Nominatim no permite autocompletado. Las consultas se serializan, con al menos 1,1 segundos entre inicios y caché de sesión. Para una aplicación con tráfico considerable, usar un proveedor adecuado o una instancia propia; revisar las políticas de [Nominatim](https://operations.osmfoundation.org/policies/nominatim/) y [teselas OSM](https://operations.osmfoundation.org/policies/tiles/).

El navegador envía las direcciones consultadas y, si se solicita ubicación, las coordenadas necesarias a estos proveedores. La ubicación solo se pide después de una acción explícita. El GPS necesita un contexto seguro (HTTPS o loopback para desarrollo), permiso de ubicación y la pantalla abierta. Puede pausarse en segundo plano. La estimación GPS descarta posiciones de precisión superior a 50 m, pequeñas variaciones de posición y saltos incompatibles con un viaje en auto; sigue siendo una estimación y puede subestimar trayectos con señal deficiente.

Si el mapa no carga, el registro de distancia continúa. Si la búsqueda falla, se puede calcular por distancia. Los costos representan solo combustible: no incluyen peajes, estacionamiento ni desgaste del vehículo.
