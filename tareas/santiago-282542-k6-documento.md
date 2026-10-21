# Santiago (282542): k6 + análisis + editor del documento

Responsable de las secciones **1.3, 1.4 y 2.3**, y de **armar, exportar y subir el PDF**.

## Min 0: crear el documento compartido

Google Docs (o similar) compartido con los tres, con esta estructura vacía:

```
Actividad 2 – Turno 2 – Scoring crediticio
Integrantes: Felipe 281987 · Santiago 282542 · Nicolás 305108

Parte 1
  1.1 Despliegue en ECR + ECS Fargate + ALB        (Nicolás)
  1.2 Condiciones iniciales                         (Nicolás)
  1.3 Prueba de rendimiento con k6                  (Santiago)
  1.4 Diagnóstico: reinicios y errores 502/503      (Santiago)
Parte 2
  2.1 Rediseño y alternativas                       (Felipe)
  2.2 Nueva arquitectura desplegada                 (Nicolás)
  2.3 Comparación de resultados k6                  (Santiago)
  2.4 Impacto en el frontend                        (Felipe)
  2.5 Diagrama de la arquitectura final             (Felipe)
```

Pasar el link al grupo.

## 1.3: tipo de prueba y script (min 0–25)

**Tipo de prueba: prueba de carga (load test) con rampa hasta el pico esperado.**
Justificación sugerida: la financiera quiere integrar el scoring en el alta de su web y sucursales, o sea muchas solicitudes simultáneas y sostenidas en horario de atención. Una prueba de carga simula ese nivel de uso esperado (sube gradualmente, se mantiene y baja) y permite validar los umbrales de la letra en condiciones realistas. No es un stress test (no buscamos el punto de quiebre a propósito) ni un spike (el problema no es un pico instantáneo sino la carga sostenida).

Guardar como `k6/scoring-load.js` (y pegarlo **como texto** en el documento):

```javascript
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
```

Correr (Nicolás pasa la URL del ALB cerca del min 25):

```bash
k6 run -e BASE_URL=http://<dns-del-alb> k6/scoring-load.js
```

**Captura 1.3:** el resumen completo de k6 (thresholds en rojo/verde, `http_req_duration` con p(95), `http_req_failed`, `http_reqs`).
Anotar: p95, % de errores, cantidad total de requests, requests/s.

## 1.4: diagnóstico (min 25–45)

Usar las capturas de Nicolás (eventos ECS, tasks detenidas, target group, CPU). Puntos a explicar:

1. `calcularScore` (`scoring-app/scoring.js`) es **síncrono y CPU-bound**: 1.500.000 simulaciones × 12 meses ≈ 18 millones de iteraciones con `log`, `sqrt` y `cos` por request, en una task de 0,25 vCPU.
2. Node.js tiene **un solo hilo para el event loop**: mientras calcula un score no atiende nada más. Las requests concurrentes se encolan y el tiempo de respuesta crece con la carga (p95 muy por encima de 2500 ms).
3. **`/health` también queda bloqueado**: el health check del ALB hace timeout, el target pasa a `unhealthy` y **ECS detiene la task y lanza otra** ("failed ELB health checks"). Eso es el "se reinicia solo".
4. Origen de los errores:
   - **502 Bad Gateway**: el ALB tenía conexiones abiertas con la task que ECS detuvo (conexión cortada / respuesta inválida del target).
   - **503 Service Unavailable**: durante el reemplazo no queda ningún target `healthy` en el target group.
5. La memoria no es el problema (mostrar memoria baja vs CPU al 100 %).

## 2.3: comparación (min 70–85)

Correr **el mismo script con la misma carga** contra el nuevo `POST /scoring` (Nicolás confirma cuándo está desplegado). Captura del resumen.

Tabla para el documento:

| Métrica | Parte 1 (síncrono) | Parte 2 (cola + worker) |
|---|---|---|
| P(95) `http_req_duration` | | |
| `http_req_failed` | | |
| Total de requests (`http_reqs`) | | |
| Requests/s | | |
| ¿Cumple umbrales? | | |
| Reinicios de tasks durante la prueba | | (captura de eventos ECS de Nicolás) |

Conclusión a explicar: el endpoint ahora solo valida, encola y responde 202, por lo que el event loop queda libre, el health check responde siempre y no hay reinicios. El cálculo pesado pasa al worker, que procesa la cola a su ritmo y se puede escalar por cantidad de mensajes. Aclarar que el P(95) medido es el de **aceptar** la solicitud; el resultado llega unos segundos después vía `GET /scoring/:id`.

## Min 85–90: cierre

- [ ] Todas las secciones con captura + una línea de qué demuestra.
- [ ] Exportar a PDF y subir a la tarea de Aulas.
