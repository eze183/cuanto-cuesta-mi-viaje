"""Browser regressions. External APIs are controlled fixtures, not live-service checks."""
import functools
import json
import os
from pathlib import Path
import threading
import unittest
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
CONFIG = {'consumoCiudad': 10, 'consumoRuta': 7, 'precio': 1000, 'moneda': 'ARS', 'peso': 70}

class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_):
        pass

class BrowserTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(QuietHandler, directory=str(ROOT)))
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base = f'http://127.0.0.1:{cls.server.server_port}'
        cls.playwright = sync_playwright().start()
        cls.browser = cls.playwright.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH', '/usr/bin/chromium'), headless=True, args=['--no-sandbox'])

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def setUp(self):
        self.context = self.browser.new_context(viewport={'width': 390, 'height': 844})
        self.page = self.context.new_page()
        self.errors = []
        self.page.on('pageerror', lambda error: self.errors.append(str(error)))

    def tearDown(self):
        self.context.close()
        self.assertEqual(self.errors, [], 'Uncaught browser exceptions')

    def load(self, config=CONFIG, history=None):
        if config is not None:
            self.page.add_init_script('if (!localStorage.getItem("auto-viaje.config")) localStorage.setItem("auto-viaje.config", ' + json.dumps(json.dumps(config)) + ');')
        if history is not None:
            self.page.add_init_script('localStorage.setItem("auto-viaje.historial", ' + json.dumps(json.dumps(history)) + ');')
        self.page.goto(self.base, wait_until='networkidle')

    def calculate(self, value='100'):
        self.page.locator('#trip-distancia').fill(value)
        self.page.locator('#btn-calcular').click()
        expect(self.page.locator('#result-card')).to_be_visible()

    def history(self):
        return self.page.evaluate('JSON.parse(localStorage.getItem("auto-viaje.historial") || "[]")')

    def test_setup_is_optional_until_calculation_and_accepts_decimal_comma(self):
        self.load(config=None)
        expect(self.page.locator('#modal-setup')).not_to_be_visible()
        self.page.locator('#trip-distancia').fill('12,4')
        self.page.locator('#btn-calcular').click()
        expect(self.page.locator('#modal-setup')).to_be_visible()
        self.page.locator('#btn-save-setup').click()
        expect(self.page.locator('#setup-error')).to_be_visible()
        self.page.locator('#setup-vehiculo-tipo').select_option('sedan')
        expect(self.page.locator('#setup-consumo-ciudad')).to_have_value('9.5')
        self.page.locator('#setup-consumo-ciudad').fill('10,0')
        self.page.locator('#setup-precio').fill('1000')
        expect(self.page.locator('#setup-moneda')).to_have_value('ARS')
        self.page.locator('#btn-save-setup').click()
        expect(self.page.locator('#result-total')).to_have_text('1.240 ARS')
        self.assertEqual(self.history(), [])
        self.assertEqual(self.page.evaluate('document.compatMode'), 'CSS1Compat')
        self.assertEqual(self.page.locator('html').get_attribute('lang'), 'es-AR')

    def test_calculating_does_not_save_and_saving_is_idempotent(self):
        self.load()
        self.calculate()
        expect(self.page.locator('#result-total')).to_have_text('10.000 ARS')
        self.assertEqual(self.history(), [])
        self.page.locator('#btn-save-trip').click()
        expect(self.page.locator('#btn-save-trip')).to_be_disabled()
        self.assertEqual(len(self.history()), 1)
        self.page.reload(wait_until='networkidle')
        expect(self.page.locator('.history-item')).to_have_count(1)
        expect(self.page.locator('#result-card')).not_to_be_visible()
        self.assertEqual(len(self.history()), 1)

    def test_highway_meter_conversion_and_invalid_inputs(self):
        self.load()
        self.page.locator('#btn-calcular').click()
        expect(self.page.locator('#trip-error')).to_be_visible()
        for value in ['0', '-10', 'Infinity', '1.000,50']:
            self.page.locator('#trip-distancia').fill(value)
            self.page.locator('#btn-calcular').click()
            expect(self.page.locator('#trip-error')).to_be_visible()
        self.page.locator('[name="consumption"][value="ruta"]').check()
        self.page.locator('#trip-distancia').fill('100')
        self.page.locator('#trip-unidad').select_option('m')
        expect(self.page.locator('#trip-distancia')).to_have_value('100000')
        self.page.locator('#btn-calcular').click()
        expect(self.page.locator('#result-total')).to_have_text('7.000 ARS')
        expect(self.page.locator('#result-distance')).to_have_text('100 km')
        expect(self.page.locator('#result-per-km')).to_have_text('70 ARS')

    def test_currencies_stay_separate_and_legacy_config_loads(self):
        trip = {'fecha': '2026-05-15T12:00:00Z', 'distancia': 100, 'litros': 10, 'costoTotal': 10000, 'moneda': 'ARS'}
        self.load(config={'consumo': 10, 'precio': 1000, 'moneda': 'USD'}, history=[trip, {**trip, 'moneda': 'USD', 'costoTotal': 20}])
        expect(self.page.locator('.history-totals')).to_contain_text('10.000 ARS')
        expect(self.page.locator('.history-totals')).to_contain_text('20 USD')
        expect(self.page.locator('.history-totals')).not_to_contain_text('10.020')
        self.calculate()
        expect(self.page.locator('#result-total')).to_have_text('10.000 USD')

    def test_delete_clears_selected_result_and_allows_cancel(self):
        self.load()
        self.calculate()
        self.page.locator('#btn-save-trip').click()
        self.page.locator('#btn-detail').click()
        self.page.once('dialog', lambda dialog: dialog.dismiss())
        self.page.locator('#btn-delete-trip').click()
        self.assertEqual(len(self.history()), 1)
        self.page.once('dialog', lambda dialog: dialog.accept())
        self.page.locator('#btn-delete-trip').click()
        expect(self.page.locator('#modal-detail')).not_to_be_visible()
        expect(self.page.locator('#result-card')).not_to_be_visible()
        expect(self.page.locator('#result-empty')).to_be_visible()
        expect(self.page.locator('.history-item')).to_have_count(0)
        self.assertEqual(self.history(), [])

    def test_untrusted_history_remains_literal_text(self):
        payload = '<img src=x onerror="window.injected=true">'
        trip = {'id': 'old', 'fecha': '2026-05-15T12:00:00Z', 'distancia': 1, 'litros': 1, 'costoTotal': 10, 'moneda': 'ARS', 'origen': payload, 'destino': 'Destino'}
        self.load(history=[trip])
        expect(self.page.locator('.history-route')).to_contain_text(payload)
        expect(self.page.locator('#history-groups img')).to_have_count(0)
        self.page.locator('.history-item').click()
        expect(self.page.locator('#detail-route')).to_contain_text(payload)
        self.assertFalse(self.page.evaluate('Boolean(window.injected)'))

    def test_native_dialog_focus_escape_and_keyboard_tabs(self):
        self.load()
        self.page.locator('#btn-settings').click()
        for _ in range(20):
            self.page.keyboard.press('Tab')
            self.assertTrue(self.page.evaluate('document.activeElement.closest("#modal-setup") !== null'))
        self.page.keyboard.press('Escape')
        expect(self.page.locator('#btn-settings')).to_be_focused()
        self.page.locator('#tab-distance').focus()
        self.page.keyboard.press('ArrowRight')
        expect(self.page.locator('#tab-address')).to_be_focused()
        expect(self.page.locator('#panel-distance')).not_to_be_visible()
        expect(self.page.locator('#panel-address')).to_be_visible()
        self.page.keyboard.press('End')
        expect(self.page.locator('#tab-gps')).to_be_focused()
        self.page.keyboard.press('Home')
        expect(self.page.locator('#tab-distance')).to_be_focused()

    def fixture_search(self, route):
        origin = 'Origen' in route.request.url
        route.fulfill(json={'type': 'FeatureCollection', 'features': [{'type': 'Feature', 'geometry': {'type': 'Point', 'coordinates': [-58.4, -34.60 if origin else -34.61]}, 'properties': {'name': 'Origen' if origin else 'Destino', 'city': 'Buenos Aires'}}]})

    def select_address(self, selector, value):
        self.page.locator(selector).fill(value)
        expect(self.page.locator(selector)).to_have_attribute('aria-expanded', 'true')
        self.page.locator(selector).press('ArrowDown')
        self.page.locator(selector).press('Enter')
        expect(self.page.locator(selector)).to_have_attribute('aria-expanded', 'false')

    def test_address_keyboard_search_routing_and_network_failure(self):
        self.page.route('https://photon.komoot.io/**', self.fixture_search)
        self.page.route('https://router.project-osrm.org/**', lambda route: route.fulfill(json={'code': 'Ok', 'routes': [{'distance': 12400}]}))
        self.load()
        self.page.locator('#tab-address').click()
        self.page.locator('#btn-calc-address').click()
        expect(self.page.locator('#address-error')).to_contain_text('ciudades')
        self.select_address('#trip-origen', 'Origen')
        self.select_address('#trip-destino', 'Destino')
        self.page.locator('#btn-calc-address').click()
        expect(self.page.locator('#result-total')).to_have_text('1.240 ARS')
        self.assertEqual(self.history(), [])
        self.page.unroute('https://router.project-osrm.org/**')
        self.page.route('https://router.project-osrm.org/**', lambda route: route.abort())
        self.page.locator('#btn-calc-address').click()
        expect(self.page.locator('#address-error')).to_contain_text('distancia')
        expect(self.page.locator('#btn-calc-address')).to_be_enabled()

    def city_response(self, name, state='Buenos Aires', coordinates=None):
        return {'type': 'Feature', 'geometry': {'type': 'Point', 'coordinates': coordinates or [-56.97, -37.26]},
                'properties': {'name': name, 'city': name, 'state': state, 'country': 'Argentina', 'osm_value': 'town'}}

    def test_city_suggestions_appear_while_typing_and_support_touch_selection(self):
        self.context.close()
        self.context = self.browser.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
        self.page = self.context.new_page()
        self.page.on('pageerror', lambda error: self.errors.append(str(error)))
        searches = []
        routes = []
        def search(route):
            searches.append(route.request.url)
            route.fulfill(json={'features': [self.city_response('Villa Gesell')]})
        def driving(route):
            routes.append(route.request.url)
            route.fulfill(json={'code': 'Ok', 'routes': [{'distance': 386000}]})
        self.page.route('https://photon.komoot.io/**', search)
        self.page.route('https://router.project-osrm.org/**', driving)
        self.load()
        self.page.locator('#tab-address').tap()
        self.page.locator('#trip-destino').fill('vi')
        self.page.wait_for_timeout(550)
        self.assertEqual(searches, [])
        self.page.locator('#trip-destino').fill('')
        self.page.locator('#trip-destino').press_sequentially('villa gesell', delay=25)
        expect(self.page.locator('#destino-suggestions')).to_be_visible()
        expect(self.page.locator('#destino-suggestions .place-name')).to_have_text('Villa Gesell')
        expect(self.page.locator('#destino-suggestions .place-context')).to_contain_text('Ciudad / localidad')
        self.assertEqual(len(searches), 1)
        self.page.screenshot(path='/tmp/tu-viaje-autocomplete.png', full_page=True, animations='disabled')
        self.page.locator('#destino-suggestions [role="option"]').tap()
        expect(self.page.locator('#trip-destino')).to_have_value('Villa Gesell, Buenos Aires, Argentina')
        self.assertEqual(routes, [])

    def test_calculate_resolves_typed_city_names_without_forcing_a_street_or_selection(self):
        searches = []
        routes = []
        def search(route):
            query = parse_qs(urlparse(route.request.url).query)['q'][0].lower()
            searches.append(query)
            if query == 'buenos aires':
                features = [self.city_response('Buenos Aires', coordinates=[-58.3816, -34.6037])]
            else:
                features = [self.city_response('Villa Gesell'), self.city_response('Hospital de Villa Gesell')]
            route.fulfill(json={'features': features})
        def driving(route):
            routes.append(route.request.url)
            route.fulfill(json={'code': 'Ok', 'routes': [{'distance': 386000}]})
        self.page.route('https://photon.komoot.io/**', search)
        self.page.route('https://router.project-osrm.org/**', driving)
        self.load()
        self.page.locator('#tab-address').click()
        self.page.locator('#trip-origen').fill('Buenos Aires')
        self.page.locator('#trip-destino').fill('villa gesell')
        self.page.locator('#btn-calc-address').click()
        expect(self.page.locator('#result-distance')).to_have_text('386 km')
        expect(self.page.locator('#result-route')).to_contain_text('Villa Gesell')
        self.page.wait_for_timeout(550)
        self.assertEqual(searches, ['buenos aires', 'villa gesell'])
        self.assertEqual(len(routes), 1)
        self.assertIn('-58.3816,-34.6037;-56.97,-37.26', routes[0])
        self.assertEqual(self.history(), [])

    def test_ambiguous_city_requires_choice_and_keeps_province_visible(self):
        routes = []
        def search(route):
            query = parse_qs(urlparse(route.request.url).query)['q'][0].lower()
            features = [self.city_response('Buenos Aires')] if query == 'buenos aires' else [
                self.city_response('San Martín', 'Buenos Aires'), self.city_response('San Martín', 'Mendoza', [-68.46, -33.08])]
            route.fulfill(json={'features': features})
        self.page.route('https://photon.komoot.io/**', search)
        self.page.route('https://router.project-osrm.org/**', lambda route: (routes.append(route.request.url), route.fulfill(json={'code': 'Ok', 'routes': [{'distance': 900000}]})))
        self.load()
        self.page.locator('#tab-address').click()
        self.page.locator('#trip-origen').fill('Buenos Aires')
        self.page.locator('#trip-destino').fill('San Martin')
        self.page.locator('#btn-calc-address').click()
        expect(self.page.locator('#destino-suggestions')).to_be_visible()
        expect(self.page.locator('#address-status')).to_contain_text('varias coincidencias')
        expect(self.page.locator('#destino-suggestions')).to_contain_text('Mendoza')
        self.assertEqual(routes, [])
        self.page.locator('#destino-suggestions [role="option"]').nth(1).click()
        self.page.locator('#btn-calc-address').click()
        expect(self.page.locator('#result-distance')).to_have_text('900 km')
        self.assertIn('-68.46,-33.08', routes[0])

    def test_shortened_query_escape_and_blur_do_not_reopen_autocomplete(self):
        self.page.route('https://photon.komoot.io/**', lambda route: route.fulfill(json={'features': [self.city_response('Villa Gesell')]}))
        self.load()
        self.page.locator('#tab-address').click()
        self.page.locator('#trip-destino').fill('Villa')
        expect(self.page.locator('#destino-suggestions')).to_be_visible()
        self.page.locator('#trip-destino').press('Escape')
        expect(self.page.locator('#destino-suggestions')).not_to_be_visible()
        self.page.locator('#trip-destino').fill('vi')
        self.page.wait_for_timeout(550)
        expect(self.page.locator('#destino-suggestions')).not_to_be_visible()
        self.page.locator('#trip-destino').fill('Villa Gesell')
        self.page.locator('#trip-origen').focus()
        self.page.wait_for_timeout(550)
        expect(self.page.locator('#destino-suggestions')).not_to_be_visible()
        expect(self.page.locator('#trip-origen')).to_be_focused()

    def test_cancelled_search_cannot_show_stale_results(self):
        pending = []
        self.page.route('https://photon.komoot.io/**', lambda route: pending.append(route))
        self.load()
        self.page.locator('#tab-address').click()
        self.page.locator('#trip-origen').fill('Origen')
        self.page.locator('#search-origin').click()
        self.page.wait_for_function('document.getElementById("trip-origen").getAttribute("aria-busy") === "true"')
        self.page.locator('#trip-origen').fill('')
        if pending:
            pending[0].fulfill(json={'features': [{'geometry': {'type': 'Point', 'coordinates': [-58.4, -34.6]}, 'properties': {'name': 'Old result'}}]})
        expect(self.page.locator('#origen-suggestions')).not_to_be_visible()
        expect(self.page.locator('#search-origin')).to_be_enabled()
        expect(self.page.locator('#trip-origen')).to_have_value('')

    def test_storage_corruption_and_write_failure_are_visible(self):
        self.page.add_init_script('localStorage.setItem("auto-viaje.historial", "{bad");')
        self.load()
        expect(self.page.locator('#storage-notice')).to_be_visible()
        self.calculate()
        self.page.locator('#btn-save-trip').click()
        self.assertEqual(len(self.history()), 1)
        self.assertTrue(self.page.evaluate('Object.keys(localStorage).some(k => k.startsWith("auto-viaje.historial.recovery."))'))
        self.page.evaluate('() => { Storage.prototype.setItem = () => { throw new DOMException("Full", "QuotaExceededError"); }; }')
        self.calculate('200')
        self.page.locator('#btn-save-trip').click()
        expect(self.page.locator('#save-status')).to_contain_text('No se pudo guardar')
        expect(self.page.locator('#btn-save-trip')).to_be_enabled()
        self.assertEqual(len(self.history()), 1)

    def test_search_results_are_safe_and_arrow_up_selects_last_option(self):
        payload = '<img src=x onerror="window.injected=true">'
        self.page.route('https://photon.komoot.io/**', lambda route: route.fulfill(json={'features': [
            {'geometry': {'type': 'Point', 'coordinates': [-58.4, -34.6]}, 'properties': {'name': 'First result'}},
            {'geometry': {'type': 'Point', 'coordinates': [-58.41, -34.61]}, 'properties': {'name': payload}},
        ]}))
        self.load()
        self.page.locator('#tab-address').click()
        self.page.locator('#trip-origen').fill('Origen')
        self.page.locator('#trip-origen').press('Enter')
        expect(self.page.locator('#trip-origen')).to_have_attribute('aria-expanded', 'true')
        expect(self.page.locator('#origen-suggestions img')).to_have_count(0)
        self.page.locator('#trip-origen').press('ArrowUp')
        expect(self.page.locator('[role="option"][aria-selected="true"]')).to_have_attribute('aria-label', payload)
        self.page.locator('#trip-origen').press('Enter')
        expect(self.page.locator('#trip-origen')).to_have_value(payload)
        self.assertFalse(self.page.evaluate('Boolean(window.injected)'))

    def test_cancelled_route_does_not_replace_result_after_mode_switch(self):
        pending = []
        self.page.route('https://photon.komoot.io/**', self.fixture_search)
        self.page.route('https://router.project-osrm.org/**', lambda route: pending.append(route))
        self.load()
        self.calculate()
        self.page.locator('#tab-address').click()
        self.select_address('#trip-origen', 'Origen')
        self.select_address('#trip-destino', 'Destino')
        self.page.locator('#btn-calc-address').click()
        expect(self.page.locator('#btn-calc-address')).to_be_disabled()
        self.page.locator('#tab-distance').click()
        if pending:
            pending[0].fulfill(json={'code': 'Ok', 'routes': [{'distance': 123} ]})
        expect(self.page.locator('#result-total')).to_have_text('10.000 ARS')
        expect(self.page.locator('#btn-calc-address')).to_be_enabled()

    def test_gps_works_when_map_is_unavailable_and_stops_on_close(self):
        self.page.add_init_script('''
            window.gpsCleared = [];
            Object.defineProperty(navigator, 'geolocation', {value: {
              watchPosition(ok, error) { window.gpsSuccess = ok; window.gpsError = error; return 42; },
              clearWatch(id) { window.gpsCleared.push(id); }
            }});
        ''')
        self.page.route('https://unpkg.com/**', lambda route: route.abort())
        self.load()
        self.page.locator('#tab-gps').click()
        self.page.locator('#btn-open-gps').click()
        self.page.locator('#btn-gps-toggle').click()
        self.page.evaluate('window.gpsSuccess({coords:{latitude:-34.6,longitude:-58.4,accuracy:5},timestamp:1000})')
        expect(self.page.locator('#map-status')).to_contain_text('no está disponible')
        self.page.evaluate('window.gpsSuccess({coords:{latitude:-34.601,longitude:-58.4,accuracy:5},timestamp:11000})')
        expect(self.page.locator('#gps-distancia')).not_to_have_text('0 m')
        self.page.locator('#btn-gps-toggle').click()
        self.assertIn(42, self.page.evaluate('window.gpsCleared'))
        self.page.locator('#btn-gps-confirmar').click()
        expect(self.page.locator('#result-route')).to_have_text('Recorrido con GPS')
        self.assertEqual(self.history(), [])
        self.page.locator('#btn-save-trip').click()
        self.assertEqual(len(self.history()), 1)

    def test_layout_has_no_horizontal_overflow_and_result_is_visible(self):
        self.load()
        for width in [320, 390, 768, 1440]:
            self.page.set_viewport_size({'width': width, 'height': 900})
            self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), f'Overflow at {width}px')
            self.calculate()
            self.assertTrue(self.page.locator('#result-total').is_visible())
            if width <= 760:
                expect(self.page.locator('#result-total')).to_be_in_viewport()
        self.page.set_viewport_size({'width': 1440, 'height': 1000})
        left = self.page.locator('#trip-card').bounding_box()
        right = self.page.locator('.summary-column').bounding_box()
        self.assertGreater(right['x'], left['x'] + left['width'])
        self.page.evaluate('window.scrollTo(0, 0)')
        self.page.screenshot(path='/tmp/tu-viaje-desktop.png', full_page=True, animations='disabled')
        self.page.set_viewport_size({'width': 390, 'height': 844})
        self.page.screenshot(path='/tmp/tu-viaje-mobile.png', full_page=True, animations='disabled')

if __name__ == '__main__':
    unittest.main(verbosity=2)
