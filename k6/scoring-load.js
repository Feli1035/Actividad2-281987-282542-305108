import http from 'k6/http';
import { check, sleep } from 'k6';

// Mismas condiciones de carga en la Parte 1 y en la Parte 2: NO modificar.
export const options = {
  stages: [
    { duration: '30s', target: 10 }, // rampa hasta 10 usuarios concurrentes
    { duration: '2m', target: 10 },  // carga sostenida
    { duration: '30s', target: 0 },  // bajada
  ],
  thresholds: {
    http_req_duration: ['p(95)<2500'], // P(95) menor a 2500 ms
    http_req_failed: ['rate<0.01'],    // menos del 1 % de solicitudes fallidas
  },
};

const BASE_URL = __ENV.BASE_URL;

export default function () {
  const payload = JSON.stringify({
    CI: 10000000 + __VU * 10000 + __ITER, // un solicitante distinto por iteración
    Nombre: 'pepe',
    IngresoMensual: 60000,
    MontoSolicitado: 300000,
    PlazoMeses: 24,
  });

  const res = http.post(`${BASE_URL}/scoring`, payload, {
    headers: { 'Content-Type': 'application/json' },
  });

  check(res, {
    'respuesta exitosa (200 o 202)': (r) => r.status === 200 || r.status === 202,
  });

  sleep(1);
}
