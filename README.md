# Actividad 2 – Turno 2: Scoring crediticio

La letra completa de la actividad y la entrega están en la tarea de Aulas.

## Estructura

| Carpeta | Contenido |
|---|---|
| `scoring-app/` | API Express (`index.js`) y worker (`worker.js`) en la misma imagen, instrumentados con OpenTelemetry (trazas y métricas por OTLP a `localhost:4318`) |
| `localstack/` | Script que crea la cola `scoring-jobs`, su DLQ y la tabla `Scorings` en LocalStack |
| `collector/` | Imagen del OpenTelemetry Collector para correr como sidecar; reenvía trazas y métricas a Grafana Cloud |

## Probar localmente

Levanta la API, el worker y LocalStack (SQS + DynamoDB, con la cola, la DLQ y la tabla ya creadas):

```bash
docker compose up --build
```

```bash
curl --location 'http://localhost:3000/scoring' \
--header 'Content-Type: application/json' \
--data '{
  "CI": 12345,
  "Nombre": "pepe",
  "IngresoMensual": 60000,
  "MontoSolicitado": 300000,
  "PlazoMeses": 24
}'
# → 202 { "id": "...", "estado": "PENDIENTE" }

curl http://localhost:3000/scoring/<id>
# → 200 { "estado": "COMPLETADO", "score": ..., ... } a los pocos segundos
```

Para mandar telemetría a Grafana Cloud: `cp .env.example .env`, completarlo y levantar con `docker compose --profile otel up --build`.

## Imágenes para ECR

```bash
docker build --platform linux/amd64 -t scoring-app ./scoring-app
docker build --platform linux/amd64 -t scoring-app-collector ./collector
```

## Variables del collector

El contenedor del collector necesita `GRAFANA_OTLP_ENDPOINT`, `GRAFANA_INSTANCE_ID` y `GRAFANA_API_TOKEN` (ver `.env.example`). La app envía la telemetría a `OTEL_EXPORTER_OTLP_ENDPOINT` (por defecto `http://localhost:4318`, el sidecar dentro de la misma tarea).
