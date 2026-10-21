require('./tracing');

const winston = require('winston');
const { ReceiveMessageCommand, DeleteMessageCommand } = require('@aws-sdk/client-sqs');
const { GetCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { calcularScore } = require('./scoring');
const { sqs, dynamo, QUEUE_URL, TABLE_NAME } = require('./aws');

const logger = winston.createLogger({
    level: 'info',
    format: winston.format.json(),
    transports: [new winston.transports.Console()],
});

// ECS manda SIGTERM al parar la task: se termina el mensaje en curso y se sale.
// El long polling se cancela para no esperar hasta 20 s sin trabajo.
let detener = false;
const polling = new AbortController();
process.on('SIGTERM', () => {
    logger.info('SIGTERM recibido, terminando');
    detener = true;
    polling.abort();
});

async function borrarMensaje(mensaje) {
    await sqs.send(new DeleteMessageCommand({
        QueueUrl: QUEUE_URL,
        ReceiptHandle: mensaje.ReceiptHandle,
    }));
}

async function guardarResultado(id, campos) {
    const nombres = Object.keys(campos);
    await dynamo.send(new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { id },
        UpdateExpression: 'SET ' + nombres.map((n) => `#${n} = :${n}`).join(', '),
        ExpressionAttributeNames: Object.fromEntries(nombres.map((n) => [`#${n}`, n])),
        ExpressionAttributeValues: Object.fromEntries(nombres.map((n) => [`:${n}`, campos[n]])),
    }));
}

async function procesar(mensaje) {
    const solicitud = JSON.parse(mensaje.Body);
    const { id, CI, Nombre } = solicitud;

    // SQS entrega cada mensaje al menos una vez: si ya se calculó, solo se borra.
    const { Item } = await dynamo.send(new GetCommand({ TableName: TABLE_NAME, Key: { id } }));
    if (Item?.estado === 'COMPLETADO') {
        logger.info('Scoring ya completado, se descarta el duplicado', { id });
        return borrarMensaje(mensaje);
    }

    let resultado;
    try {
        resultado = calcularScore(solicitud);
    } catch (error) {
        // Datos inválidos: reintentar no cambia el resultado.
        logger.error('Solicitud inválida', { id, error: error.message });
        await guardarResultado(id, { estado: 'ERROR', error: error.message, completado: new Date().toISOString() });
        return borrarMensaje(mensaje);
    }

    await guardarResultado(id, { estado: 'COMPLETADO', ...resultado, completado: new Date().toISOString() });
    await borrarMensaje(mensaje);
    logger.info('Scoring calculado', { id, CI, Nombre, score: resultado.score });
}

async function main() {
    logger.info('Worker escuchando', { queue: QUEUE_URL });

    while (!detener) {
        let mensajes;
        try {
            ({ Messages: mensajes = [] } = await sqs.send(new ReceiveMessageCommand({
                QueueUrl: QUEUE_URL,
                MaxNumberOfMessages: 1, // el cálculo es CPU-bound: uno a la vez, se escala con más tasks
                WaitTimeSeconds: 20,
            }), { abortSignal: polling.signal }));
        } catch (error) {
            if (detener) break;
            logger.error('Error recibiendo mensajes', { error: error.message });
            await new Promise((r) => setTimeout(r, 5000));
            continue;
        }

        for (const mensaje of mensajes) {
            try {
                await procesar(mensaje);
            } catch (error) {
                // No se borra: vuelve a la cola al vencer el visibility timeout
                // y a los 3 intentos pasa a la DLQ.
                logger.error('Error procesando mensaje', { messageId: mensaje.MessageId, error: error.message });
            }
        }
    }

    logger.info('Worker detenido');
    process.exit(0);
}

main();
