# Actividad 2 – Turno 2: Scoring crediticio

La letra completa de la actividad y la entrega están en la tarea de Aulas.

## Estructura

| Carpeta | Contenido |
|---|---|
| `scoring-app/` | API Express con su Dockerfile, instrumentada con OpenTelemetry (trazas y métricas por OTLP a `localhost:4318`) |
| `collector/` | Imagen del OpenTelemetry Collector para correr como sidecar; reenvía trazas y métricas a Grafana Cloud |

## Probar localmente

```bash
cp .env.example .env   # completar con los datos de su stack de Grafana Cloud
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
```

## Imágenes para ECR

```bash
docker build --platform linux/amd64 -t scoring-app ./scoring-app
docker build --platform linux/amd64 -t scoring-app-collector ./collector
```

## Variables del collector

El contenedor del collector necesita `GRAFANA_OTLP_ENDPOINT`, `GRAFANA_INSTANCE_ID` y `GRAFANA_API_TOKEN` (ver `.env.example`). La app envía la telemetría a `OTEL_EXPORTER_OTLP_ENDPOINT` (por defecto `http://localhost:4318`, el sidecar dentro de la misma tarea).
