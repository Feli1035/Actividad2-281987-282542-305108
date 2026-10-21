// Modelo de scoring: simula muchos escenarios económicos (Monte Carlo) para
// estimar la probabilidad de que el solicitante no pueda pagar las cuotas.
// El área de riesgo exige esta cantidad de simulaciones; no se puede reducir.
const SIMULACIONES = parseInt(process.env.SIMULACIONES || '1500000', 10);

// Generador pseudoaleatorio determinístico a partir de la CI (mulberry32),
// para que el mismo solicitante obtenga siempre el mismo score.
function rng(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// Valida la solicitud sin calcular el score, para que la API pueda rechazarla
// con 400 antes de encolarla.
function validarSolicitud({ IngresoMensual, MontoSolicitado, PlazoMeses }) {
    const ingreso = Number(IngresoMensual);
    const monto = Number(MontoSolicitado);
    const plazo = Number(PlazoMeses);
    if (!(ingreso > 0 && monto > 0 && plazo > 0)) {
        throw new Error('Datos de solicitud inválidos');
    }
    return { ingreso, monto, plazo };
}

function calcularScore({ CI, IngresoMensual, MontoSolicitado, PlazoMeses }) {
    const { ingreso, monto, plazo } = validarSolicitud({ IngresoMensual, MontoSolicitado, PlazoMeses });

    const tasaMensual = 0.035;
    const cuota = (monto * tasaMensual) / (1 - Math.pow(1 + tasaMensual, -plazo));
    const random = rng(Number(CI) || 1);

    let impagos = 0;
    for (let i = 0; i < SIMULACIONES; i++) {
        let ingresoSimulado = ingreso;
        for (let mes = 0; mes < 12; mes++) {
            const shock = Math.sqrt(-2 * Math.log(random() || 1e-9)) * Math.cos(2 * Math.PI * random());
            ingresoSimulado *= 1 + shock * 0.04;
        }
        if (cuota > ingresoSimulado * 0.4) impagos++;
    }

    const probabilidadImpago = impagos / SIMULACIONES;
    const score = Math.round(1000 * (1 - probabilidadImpago));

    return {
        score,
        cuota: Math.round(cuota),
        probabilidadImpago: Number(probabilidadImpago.toFixed(4)),
        aprobado: score >= 650,
    };
}

module.exports = { calcularScore, validarSolicitud };
