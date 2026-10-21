# Nicolás (305108): infra AWS + capturas de consola

Responsable de las secciones **1.1, 1.2 y 2.2** del documento, y de pasarle a Santiago las capturas de ECS para la **1.4**.

## Antes de empezar (min 0)

- [ ] Docker Desktop abierto: `docker info`
- [ ] Learner Lab iniciado, bloque de AWS CLI pegado en `~/.aws/credentials`: `aws sts get-caller-identity`
- [ ] Variables:

```bash
export AWS_REGION=us-east-1
export ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
export REPO=scoring-app
export IMAGE=$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/${REPO}:latest   # en zsh siempre ${REPO}
```

> Telemetría: si no tenemos credenciales de Grafana Cloud, se despliega **sin el collector** y con `OTEL_SDK_DISABLED=true`. La letra no pide observabilidad.

## Parte 1.1: ECR + ECS + ALB (min 0–25)

1. Imagen en ECR (build para `linux/amd64`, la Mac es ARM):

```bash
aws ecr create-repository --repository-name $REPO
aws ecr get-login-password | docker login --username AWS --password-stdin $ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com
docker build --platform linux/amd64 -t $IMAGE ./scoring-app
docker push $IMAGE
```

2. Cluster y log group:

```bash
aws ecs create-cluster --cluster-name actividad2
aws logs create-log-group --log-group-name /ecs/scoring-app
```

3. Task definition `scoring-app` (consola o JSON): Fargate, **Linux/X86_64**, **0.25 vCPU / 0.5 GB**, task role y execution role = `LabRole`, contenedor `api`, imagen `$IMAGE`, puerto **3000**, env `PORT=3000`, `OTEL_SDK_DISABLED=true`, logs `awslogs` en `/ecs/scoring-app`.
4. Servicio (consola, como en el manual de ECS): cluster `actividad2` → Create service → Fargate → nombre `scoring-api`, desired **1**.
   - Load balancing: **Application Load Balancer nuevo** `scoring-alb`, listener **80 HTTP**, contenedor `api 3000:3000`.
   - Target group nuevo `scoring-tg`, **health check path `/health`**, dejar los valores por defecto (anotarlos para 1.2).
   - Red: VPC por defecto, subnets públicas, IP pública **habilitada**, security group con **80** abierto (ALB) y **3000** desde el SG del ALB (o abierto para simplificar).
5. Obtener el DNS del ALB (Service → Networking) y probar:

```bash
export ALB=http://<dns-del-alb>
curl -s $ALB/health
curl -s -X POST $ALB/scoring -H 'Content-Type: application/json' \
  -d '{"CI":12345,"Nombre":"pepe","IngresoMensual":60000,"MontoSolicitado":300000,"PlazoMeses":24}'
```

6. **Pasarle `$ALB` a Santiago** en cuanto responda.

**Capturas 1.1:** repositorio ECR con la imagen · servicio ECS RUNNING · target group con target `healthy` · resultado del curl.

## Parte 1.2: condiciones iniciales

**Capturas 1.2:** task definition (CPU, memoria, plataforma, puerto) · health check del target group (path, interval, timeout, thresholds) · respuesta exitosa de `/scoring` con tiempo (`curl -w '%{time_total}\n'`).

## Durante k6 de la Parte 1 (min 25–45): evidencia para la 1.4

Mientras Santiago corre k6, capturar:

- [ ] ECS → servicio → **Events**: mensajes tipo *"task ... failed ELB health checks"* / *"has started 1 tasks"*.
- [ ] ECS → servicio → **Tasks** → tasks detenidas con su *stopped reason*.
- [ ] Target group → **Targets**: estado `unhealthy` / `draining`.
- [ ] ECS → servicio → **Health and metrics**: CPU utilization al ~100 %.

```bash
aws ecs describe-services --cluster actividad2 --services scoring-api --query 'services[0].events[0:10].message'
```

## Parte 2.2: nueva arquitectura (min 45–70)

Esperar a que Felipe tenga el código en `feature/async-scoring` (min ~45).

1. SQS (consola, Standard):
   - `scoring-jobs-dlq` con todo por defecto.
   - `scoring-jobs`: Dead-letter queue **Enabled** → `scoring-jobs-dlq`, **Maximum receives = 3**. Visibility timeout por defecto (30 s).
2. DynamoDB:

```bash
aws dynamodb create-table --table-name Scorings \
  --attribute-definitions AttributeName=id,AttributeType=S \
  --key-schema AttributeName=id,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST
export QUEUE_URL=$(aws sqs get-queue-url --queue-name scoring-jobs --query QueueUrl --output text)
```

3. Nueva imagen (rama de Felipe) y push al mismo repo con tag `v2`:

```bash
git fetch && git checkout feature/async-scoring
export IMAGE2=$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/${REPO}:v2
docker build --platform linux/amd64 -t $IMAGE2 ./scoring-app && docker push $IMAGE2
```

4. Task definitions (misma CPU/memoria que la Parte 1, para comparar en igualdad):
   - **API** (nueva revisión de `scoring-app`): imagen `$IMAGE2`, comando por defecto, env `AWS_REGION`, `QUEUE_URL`, `TABLE_NAME=Scorings`, `OTEL_SDK_DISABLED=true`.
   - **Worker** (familia `scoring-worker`): imagen `$IMAGE2`, **command `node,worker.js`**, sin puertos, mismas env vars, logs en `/ecs/scoring-app` con prefijo `worker`.
5. Actualizar el servicio `scoring-api` a la nueva revisión (mantiene ALB y TG).
6. Crear servicio `scoring-worker` **sin load balancer**, desired **2**.
7. Prueba de punta a punta:

```bash
ID=$(curl -s -X POST $ALB/scoring -H 'Content-Type: application/json' \
  -d '{"CI":12345,"Nombre":"pepe","IngresoMensual":60000,"MontoSolicitado":300000,"PlazoMeses":24}' | jq -r .id)
sleep 10; curl -s $ALB/scoring/$ID
```

**Capturas 2.2:** colas SQS (y la config de la DLQ) · tabla `Scorings` con items · servicios `scoring-api` y `scoring-worker` RUNNING · POST con 202 + GET con `COMPLETADO` · logs del worker procesando · **eventos ECS sin reinicios durante k6 de la Parte 2**.

## Gotchas

- Credenciales del Learner Lab vencen: si aparece `ExpiredToken`, re-pegar.
- La arquitectura de la task definition tiene que coincidir con el build (`linux/amd64` → X86_64).
- Si el worker da `AccessDenied`, revisar que la **task role** sea `LabRole`.
- Si la cola queda llena y nadie la consume: revisar `QUEUE_URL` en la task del worker y sus logs.
