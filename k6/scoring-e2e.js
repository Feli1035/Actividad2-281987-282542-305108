import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate } from 'k6/metrics';

// Prueba complementaria de la Parte 2: mide el tiempo de punta a punta
// (POST /scoring hasta que GET /scoring/:id devuelve COMPLETADO).
// Misma carga que scoring-load.js para poder comparar.
export const options = {
  stages: [
    { duration: '30s', target: 10 },
    { duration: '2m', target: 10 },
    { duration: '30s', target: 0 },
  ],
};

const BASE_URL = __ENV.BASE_URL;
const POLL_INTERVAL = 2;   // segundos entre consultas, como haría el frontend
const MAX_ESPERA = 120;    // segundos antes de abandonar la consulta

const tiempoPuntaAPunta = new Trend('scoring_punta_a_punta', true);
const completados = new Rate('scoring_completado');

export default function () {
  const payload = JSON.stringify({
    CI: 20000000 + __VU * 10000 + __ITER,
    Nombre: 'pepe',
    IngresoMensual: 60000,
    MontoSolicitado: 300000,
    PlazoMeses: 24,
  });

  const inicio = Date.now();
  const res = http.post(`${BASE_URL}/scoring`, payload, {
    headers: { 'Content-Type': 'application/json' },
  });
  if (!check(res, { 'POST 202': (r) => r.status === 202 })) {
    completados.add(false);
    sleep(1);
    return;
  }

  const id = res.json('id');
  let estado = 'PENDIENTE';
  while (estado === 'PENDIENTE' && (Date.now() - inicio) / 1000 < MAX_ESPERA) {
    sleep(POLL_INTERVAL);
    const consulta = http.get(`${BASE_URL}/scoring/${id}`, { tags: { name: 'GET /scoring/:id' } });
    if (consulta.status === 200) estado = consulta.json('estado');
  }

  completados.add(estado === 'COMPLETADO');
  if (estado === 'COMPLETADO') tiempoPuntaAPunta.add(Date.now() - inicio);

  sleep(1);
}
