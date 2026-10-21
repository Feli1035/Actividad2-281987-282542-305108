// Instrumentación OpenTelemetry. Exporta trazas y métricas por OTLP/HTTP
// al collector indicado en OTEL_EXPORTER_OTLP_ENDPOINT (por defecto, un
// sidecar en localhost:4318). Si OTEL_SDK_DISABLED=true no se instrumenta.
const { NodeSDK } = require('@opentelemetry/sdk-node');
const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
const { OTLPMetricExporter } = require('@opentelemetry/exporter-metrics-otlp-http');
const { PeriodicExportingMetricReader } = require('@opentelemetry/sdk-metrics');

if (process.env.OTEL_SDK_DISABLED !== 'true') {
    const sdk = new NodeSDK({
        serviceName: process.env.OTEL_SERVICE_NAME || 'scoring-app',
        traceExporter: new OTLPTraceExporter(),
        metricReader: new PeriodicExportingMetricReader({
            exporter: new OTLPMetricExporter(),
            exportIntervalMillis: 15000,
        }),
        instrumentations: [
            getNodeAutoInstrumentations({
                '@opentelemetry/instrumentation-fs': { enabled: false },
            }),
        ],
    });

    sdk.start();

    process.on('SIGTERM', () => {
        sdk.shutdown().finally(() => process.exit(0));
    });
}
