require('./tracing');

const express = require('express');
const crypto = require('crypto');
const winston = require('winston');
const { calcularScore } = require('./scoring');

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

// Calcula el score crediticio de un solicitante durante el alta de un préstamo.
// La financiera muestra la aprobación (o el rechazo) en la misma pantalla del alta.
app.post('/scoring', (req, res) => {
    try {
        const { CI, Nombre, IngresoMensual, MontoSolicitado, PlazoMeses } = req.body;

        const resultado = calcularScore({ CI, IngresoMensual, MontoSolicitado, PlazoMeses });

        logger.info('Scoring calculado', { CI, Nombre });

        res.json({ id: crypto.randomUUID(), CI, Nombre, ...resultado });
    } catch (error) {
        logger.info('Error calculando scoring', { error: error.message });
        if (error.message === 'Datos de solicitud inválidos') {
            res.status(400).json({ error: error.message });
        } else {
            res.status(500).json({ error: 'Internal server error' });
        }
    }
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
