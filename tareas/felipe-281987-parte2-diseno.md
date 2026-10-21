# Felipe (281987): código de la Parte 2 + diseño

Responsable del código del rediseño (rama **`feature/async-scoring`**) y de las secciones **2.1, 2.4 y 2.5** del documento.
Solo Felipe toca `scoring-app/`. El código debe respetar el **contrato** de [README.md](README.md).

## Idea del rediseño

El cálculo (`calcularScore`) **no se toca ni se reduce**: el área de riesgo no lo permite. Lo que cambia es **dónde** corre:

```
Cliente → ALB → API (valida, guarda PENDIENTE, encola, responde 202)
                     │
                     ▼
               SQS scoring-jobs ──(3 fallos)──► scoring-jobs-dlq
                     │
                     ▼
               Worker(s) ECS (calcularScore → guarda COMPLETADO)
                     │
                     ▼
               DynamoDB Scorings ◄── GET /scoring/:id
```

## Código (min 0–45)

1. Dependencias (el proyecto usa npm):

```bash
cd scoring-app
npm install @aws-sdk/client-sqs @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb
```

2. `scoring.js`: extraer la validación a `validarSolicitud(datos)` (exportada) para que la API devuelva **400** sin calcular. `calcularScore` la sigue usando. **No cambiar `SIMULACIONES`.**
3. `aws.js` (nuevo): clientes compartidos.
   - `SQSClient` y `DynamoDBDocumentClient` con `region: process.env.AWS_REGION`.
   - `endpoint: process.env.AWS_ENDPOINT_URL` solo si está definido (para LocalStack).
   - Exporta `QUEUE_URL` y `TABLE_NAME`.
4. `index.js` (API):
   - `POST /scoring`:
     1. `validarSolicitud` → 400 si falla.
     2. `id = crypto.randomUUID()`.
     3. `PutCommand` con `{ id, estado: 'PENDIENTE', CI, Nombre, IngresoMensual, MontoSolicitado, PlazoMeses, creado }`.
     4. `SendMessageCommand` con el mensaje del contrato.
     5. **202** `{ id, estado: 'PENDIENTE' }`.
   - `GET /scoring/:id`: `GetCommand` → 200 con el item, o **404**.
   - Errores de AWS: 500 y `logger.error` (hoy loguea errores con `logger.info`).
5. `worker.js` (nuevo), mismo patrón que el práctico de SQS:
   - Loop con `ReceiveMessageCommand` (`WaitTimeSeconds: 20`, `MaxNumberOfMessages: 1`, long polling). Un mensaje a la vez porque el trabajo es CPU-bound; se escala con más tasks.
   - **Idempotencia**: si el item ya está `COMPLETADO`, borrar el mensaje y seguir (SQS es *at-least-once*).
   - `calcularScore(...)` → `UpdateCommand` con `estado: 'COMPLETADO'`, `score`, `cuota`, `probabilidadImpago`, `aprobado`, `completado`.
   - **Borrar el mensaje al final** (`DeleteMessageCommand`), nunca al recibirlo.
   - Datos inválidos → `estado: 'ERROR'` y borrar. Otro error → loguear y **no** borrar (reintenta; a los 3 intentos va a la DLQ).
   - `SIGTERM` → terminar el mensaje actual y salir (ECS manda SIGTERM al parar la task).
6. `docker-compose.yml` para probar local:
   - Agregar `localstack/localstack:3.0` con `SERVICES=sqs,dynamodb` y un script en `/etc/localstack/init/ready.d` con `awslocal sqs create-queue --queue-name scoring-jobs` + `awslocal dynamodb create-table ... Scorings`.
   - Servicios `app` y `worker` (misma build, `command: ["node", "worker.js"]`) con `AWS_ENDPOINT_URL=http://localstack:4566`, credenciales `test`/`test`, `QUEUE_URL`, `TABLE_NAME`, `OTEL_SDK_DISABLED=true`.
7. Prueba local: POST → 202, a los segundos GET → `COMPLETADO`. Push a `feature/async-scoring` y **avisar a Nicolás (min ~45)**.

## 2.1: rediseño y alternativas (texto)

- **Elegido: procesamiento asíncrono con cola (SQS) + workers.**
  - La API deja de hacer trabajo pesado: responde en milisegundos, el event loop nunca se bloquea, el health check siempre responde y ECS no reinicia la task.
  - La cola absorbe los picos.
  - Los workers se escalan de forma independiente según la cantidad de mensajes.
  - Un fallo en un cálculo no tumba la API (reintentos + DLQ).
- **Descartadas:**
  - **Bajar `SIMULACIONES`**: prohibido por el área de riesgo.
  - **Escalar vertical (más vCPU)**: cada request sigue bloqueando el event loop; solo corre el límite más lejos y es caro.
  - **Solo auto scaling de la API**: reacciona tarde (minutos) y cada task nueva se sigue bloqueando y reiniciando bajo carga; los health checks fallan igual.
  - **`worker_threads` en la misma API**: evita los reinicios (el event loop queda libre), pero la CPU de la task sigue saturada, las requests esperan y el p95 no cumple; además el cliente sigue esperando la respuesta sincrónica (timeouts del ALB).
  - **Subir el timeout del health check**: oculta el síntoma, no resuelve la saturación.
- Incluir fragmentos clave: POST que encola, loop del worker con idempotencia y borrado al final.

## 2.4: frontend (texto)

- El alta deja de recibir el resultado en la misma respuesta: el `POST /scoring` devuelve un `id` con estado `PENDIENTE`.
- El frontend muestra "Estamos evaluando tu solicitud…" y consulta `GET /scoring/:id` cada 2–3 segundos (polling) hasta `COMPLETADO` o `ERROR`.
  - Alternativas: WebSocket/notificación, o avisar por mail/SMS si demora.
- **Solicitante**: ya no ve errores ni pantallas colgadas; espera unos segundos con feedback y luego ve aprobado/rechazado, score y cuota. Si cierra la pantalla, la solicitud igual se procesa y puede consultarse con el `id`.
- **Sucursal/analista**: puede cargar varias solicitudes seguidas sin esperar cada cálculo.

## 2.5: diagrama

Diagrama de la arquitectura final (draw.io, Excalidraw o Mermaid): Cliente → ALB → servicio ECS `scoring-api` → SQS `scoring-jobs` (+ DLQ) → servicio ECS `scoring-worker` (N tasks) → DynamoDB `Scorings`; `GET /scoring/:id` desde la API a DynamoDB; ECR como origen de la imagen; CloudWatch Logs.

## Min 85–90

Si el docente confirma que hay que entregar el código: `git archive -o actividad2-turno2.zip HEAD`.
