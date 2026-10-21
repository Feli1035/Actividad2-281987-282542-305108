require('./tracing');

const express = require('express');
const crypto = require('crypto');
const winston = require('winston');
const { SendMessageCommand } = require('@aws-sdk/client-sqs');
const { PutCommand, GetCommand } = require('@aws-sdk/lib-dynamodb');
const { validarSolicitud } = require('./scoring');
const { sqs, dynamo, QUEUE_URL, TABLE_NAME } = require('./aws');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

const logger = winston.createLogger({
    level: 'info',
    format: winston.format.json(),
    transports: [new winston.transports.Console()],
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});

// Recibe una solicitud de scoring durante el alta de un préstamo. El cálculo
// lo hace el worker: la API solo valida, guarda la solicitud como PENDIENTE,
// la encola y responde 202 con el id para consultar el resultado.
app.post('/scoring', async (req, res) => {
    const { CI, Nombre, IngresoMensual, MontoSolicitado, PlazoMeses } = req.body ?? {};

    try {
        validarSolicitud({ IngresoMensual, MontoSolicitado, PlazoMeses });
    } catch (error) {
        return res.status(400).json({ error: error.message });
    }

    const id = crypto.randomUUID();

    try {
        await dynamo.send(new PutCommand({
            TableName: TABLE_NAME,
            Item: {
                id,
                estado: 'PENDIENTE',
                CI,
                Nombre,
                IngresoMensual,
                MontoSolicitado,
                PlazoMeses,
                creado: new Date().toISOString(),
            },
        }));

        await sqs.send(new SendMessageCommand({
            QueueUrl: QUEUE_URL,
            MessageBody: JSON.stringify({ id, CI, Nombre, IngresoMensual, MontoSolicitado, PlazoMeses }),
        }));

        logger.info('Scoring encolado', { id, CI, Nombre });

        res.status(202).json({ id, estado: 'PENDIENTE' });
    } catch (error) {
        logger.error('Error encolando scoring', { id, error: error.message });
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Devuelve el estado de una solicitud: PENDIENTE, COMPLETADO o ERROR.
app.get('/scoring/:id', async (req, res) => {
    try {
        const { Item } = await dynamo.send(new GetCommand({
            TableName: TABLE_NAME,
            Key: { id: req.params.id },
        }));

        if (!Item) {
            return res.status(404).json({ error: 'Solicitud no encontrada' });
        }

        const { id, estado, CI, Nombre, score, cuota, probabilidadImpago, aprobado } = Item;
        res.json({ id, estado, CI, Nombre, score, cuota, probabilidadImpago, aprobado });
    } catch (error) {
        logger.error('Error consultando scoring', { id: req.params.id, error: error.message });
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
