# Actividad 2 – Turno 2: plan de trabajo

Duración: **90 minutos**. Entregable: **un documento PDF con las evidencias de todos los puntos** (capturas, script de k6 y respuestas).

> La letra también menciona "el código fuente modificado (en un archivo .zip)". Confirmar con el docente; si lo piden, Felipe genera el zip al final (5 minutos).

## Reparto

| Integrante | Rol | Archivo |
|---|---|---|
| Nicolás (305108) | Infra AWS + capturas de consola | [nicolas-305108-infra.md](nicolas-305108-infra.md) |
| Santiago (282542) | k6 + análisis + editor del documento | [santiago-282542-k6-documento.md](santiago-282542-k6-documento.md) |
| Felipe (281987) | Código de la Parte 2 + diseño | [felipe-281987-parte2-diseno.md](felipe-281987-parte2-diseno.md) |

## Documento de evidencias (estructura)

| Sección | Evidencia | Responsable |
|---|---|---|
| 1.1 Despliegue | Imagen en ECR, servicio ECS RUNNING, target group con targets `healthy`, request OK por el DNS del ALB | Nicolás |
| 1.2 Condiciones iniciales | Task definition (CPU, memoria, plataforma, puerto), health check del TG, respuesta exitosa de `/scoring` | Nicolás |
| 1.3 Prueba k6 | Tipo de prueba + justificación, script pegado como texto, captura del resumen (p95, `http_req_failed`, cantidad de requests) | Santiago |
| 1.4 Diagnóstico | Eventos ECS ("failed ELB health checks"), TG `unhealthy`/`draining`, CPU al 100 %, explicación | Santiago (capturas de Nicolás) |
| 2.1 Rediseño | Solución elegida, alternativas descartadas, fragmentos clave del código | Felipe |
| 2.2 Nueva arquitectura | SQS + DLQ, tabla DynamoDB, servicios API y worker, item en DynamoDB, POST → GET de punta a punta, eventos sin reinicios | Nicolás |
| 2.3 Comparación | Captura k6 Parte 2 + tabla comparativa (p95, errores, requests) + conclusión | Santiago |
| 2.4 Frontend | Cómo cambia el alta para la financiera y para el solicitante | Felipe |
| 2.5 Diagrama | Arquitectura final | Felipe |

## Contrato de la Parte 2 (acordado en el minuto 0, no se cambia)

- `POST /scoring` → **202** `{ "id": "<uuid>", "estado": "PENDIENTE" }` (400 si los datos son inválidos).
- `GET /scoring/:id` → **200** `{ id, estado, CI, Nombre, score, cuota, probabilidadImpago, aprobado }` o **404**.
  - `estado`: `PENDIENTE` | `COMPLETADO` | `ERROR`.
- Cola SQS **`scoring-jobs`** (Standard) con DLQ **`scoring-jobs-dlq`**, Maximum receives = **3**.
- Mensaje: `{ id, CI, Nombre, IngresoMensual, MontoSolicitado, PlazoMeses }`.
- Tabla DynamoDB **`Scorings`**, partition key **`id`** (String), `PAY_PER_REQUEST`.
- Variables de entorno: `AWS_REGION=us-east-1`, `QUEUE_URL`, `TABLE_NAME=Scorings`.
- **Una sola imagen** `scoring-app` con dos comandos: `node index.js` (API) y `node worker.js` (worker).

## Cronograma

| Minuto | Nicolás | Santiago | Felipe |
|---|---|---|---|
| 0–25 | Parte 1 en AWS (ECR, ECS, ALB). Capturas 1.1 y 1.2 | Crea el documento compartido + script k6 + texto 1.3 | API async + `worker.js` + prueba local |
| 25–45 | Captura eventos ECS / TG / CPU durante k6 | Corre k6 Parte 1 + redacta 1.4 | Termina código, push a `feature/async-scoring` + texto 2.1 |
| 45–70 | SQS, DLQ, DynamoDB, despliegue API + worker. Capturas 2.2 | Pega capturas en el documento | Texto 2.4 + diagrama 2.5 |
| 70–85 | Prueba de punta a punta + captura sin reinicios | Corre k6 Parte 2 + redacta 2.3 | Revisa el documento completo |
| 85–90 | — | Exporta el PDF y lo sube a Aulas | (zip si lo piden) |

**Puntos de sincronización:** min 25 (Parte 1 desplegada → Santiago lanza k6), min 45 (código Parte 2 en la rama → Nicolás despliega), min 75 (k6 Parte 2 listo → cierre del PDF).

## Cuenta AWS compartida

Los tres usamos **la misma cuenta del Learner Lab** (mismas credenciales).

- El dueño del lab hace **Start Lab** y comparte el bloque de AWS Details → AWS CLI **por mensaje privado**. Cada uno lo pega en su `~/.aws/credentials` (debe empezar con `[default]`).
- **NUNCA subir las credenciales al repo** (ni en `.env`, ni en capturas, ni en el documento). Recortar `aws_access_key_id`, `aws_secret_access_key` y `aws_session_token` de cualquier captura.
- El dueño **no reinicia el lab ni hace End Lab** durante la actividad: rota las credenciales de todos y apaga los recursos.
- Si aparece `ExpiredToken` / `InvalidClientTokenId`: el dueño vuelve a compartir el bloque y todos lo re-pegan.
- **Solo Nicolás crea o modifica recursos** (ECR, ECS, ALB, SQS, DynamoDB) para no pisar nombres ni servicios. Los demás pueden mirar en la consola, sin crear ni borrar nada.
- Santiago **no necesita credenciales** para k6 (pega contra el DNS público del ALB). Felipe tampoco para la prueba local (LocalStack con `test`/`test`).
- Nombres fijos de recursos: cluster `actividad2`, repo ECR `scoring-app`, servicios `scoring-api` y `scoring-worker`, ALB `scoring-alb`, TG `scoring-tg`, colas `scoring-jobs` y `scoring-jobs-dlq`, tabla `Scorings`.

## Reglas

- Un solo documento compartido; cada uno pega en su sección.
- Cada captura con título y **una línea que diga qué demuestra**.
- Las condiciones de carga de k6 se fijan una vez y **se repiten idénticas** en la Parte 2.
- Ramas: `feature/async-scoring` (Felipe). Solo Felipe toca `scoring-app/`.
- Región `us-east-1`, rol `LabRole` para todo (Learner Lab).
