# Despliegue en AWS (Learner Lab, us-east-1)

Comandos usados para desplegar. Ejecutar desde la raíz del repo con AWS CLI v2 y las credenciales del Learner Lab en `~/.aws/credentials`. **No commitear credenciales.**

## Variables

```bash
export AWS_REGION=us-east-1
export ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
export IMAGE=$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/scoring-app:latest
```

## Parte 1: API síncrona detrás de un ALB

### 1. Imagen en ECR

```bash
aws ecr create-repository --repository-name scoring-app
aws ecr get-login-password | docker login --username AWS --password-stdin $ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com
docker build --platform linux/amd64 -t "${IMAGE}" ./scoring-app   # Mac ARM -> imagen x86_64
docker push "${IMAGE}"
```

### 2. Cluster y logs

```bash
aws ecs create-cluster --cluster-name actividad2
aws logs create-log-group --log-group-name /ecs/scoring-app
```

### 3. Red: security groups, ALB y target group

```bash
VPC_ID=$(aws ec2 describe-vpcs --filters Name=is-default,Values=true --query 'Vpcs[0].VpcId' --output text)
SUBNETS=$(aws ec2 describe-subnets --filters Name=vpc-id,Values=$VPC_ID Name=default-for-az,Values=true --query 'Subnets[].SubnetId' --output text)

ALB_SG=$(aws ec2 create-security-group --group-name scoring-alb-sg --description "ALB scoring - HTTP 80" --vpc-id $VPC_ID --query GroupId --output text)
aws ec2 authorize-security-group-ingress --group-id $ALB_SG --protocol tcp --port 80 --cidr 0.0.0.0/0

TASK_SG=$(aws ec2 create-security-group --group-name scoring-task-sg --description "Tasks scoring - 3000 desde el ALB" --vpc-id $VPC_ID --query GroupId --output text)
aws ec2 authorize-security-group-ingress --group-id $TASK_SG --protocol tcp --port 3000 --source-group $ALB_SG

# En zsh hay que usar ${=SUBNETS} para que separe la lista en argumentos.
ALB_ARN=$(aws elbv2 create-load-balancer --name scoring-alb --type application --scheme internet-facing \
  --subnets ${=SUBNETS} --security-groups $ALB_SG --query 'LoadBalancers[0].LoadBalancerArn' --output text)

TG_ARN=$(aws elbv2 create-target-group --name scoring-tg --protocol HTTP --port 3000 --vpc-id $VPC_ID \
  --target-type ip --health-check-path /health --query 'TargetGroups[0].TargetGroupArn' --output text)

aws elbv2 create-listener --load-balancer-arn $ALB_ARN --protocol HTTP --port 80 \
  --default-actions Type=forward,TargetGroupArn=$TG_ARN
```

Health check del target group (valores por defecto): path `/health`, intervalo 30 s, timeout 5 s, healthy threshold 5, unhealthy threshold 2.

### 4. Task definition y servicio

Task definition: [`ecs/scoring-api-taskdef.json`](ecs/scoring-api-taskdef.json). Fargate, Linux/X86_64, **0,25 vCPU / 0,5 GB**, `LabRole` como execution y task role, telemetría desactivada (`OTEL_SDK_DISABLED=true`).

```bash
sed "s/ACCOUNT_ID/$ACCOUNT_ID/g" infra/ecs/scoring-api-taskdef.json > /tmp/taskdef-api.json
aws ecs register-task-definition --cli-input-json file:///tmp/taskdef-api.json

SUBNETS_CSV=$(echo $SUBNETS | tr '\t' ',')
aws ecs create-service --cluster actividad2 --service-name scoring-api --task-definition scoring-app:1 \
  --desired-count 1 --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[$SUBNETS_CSV],securityGroups=[$TASK_SG],assignPublicIp=ENABLED}" \
  --load-balancers "targetGroupArn=$TG_ARN,containerName=api,containerPort=3000"
aws ecs wait services-stable --cluster actividad2 --services scoring-api
```

### 5. Prueba

```bash
ALB=http://$(aws elbv2 describe-load-balancers --names scoring-alb --query 'LoadBalancers[0].DNSName' --output text)
curl -s $ALB/health
curl -s -w '\n%{http_code} %{time_total}s\n' -X POST $ALB/scoring -H 'Content-Type: application/json' \
  -d '{"CI":12345,"Nombre":"pepe","IngresoMensual":60000,"MontoSolicitado":300000,"PlazoMeses":24}'
```

### 6. Evidencia durante la prueba de carga

```bash
aws ecs describe-services --cluster actividad2 --services scoring-api --query 'services[0].events[0:15].[createdAt,message]' --output table
aws ecs list-tasks --cluster actividad2 --desired-status STOPPED --query taskArns
aws elbv2 describe-target-health --target-group-arn $TG_ARN --query 'TargetHealthDescriptions[].[Target.Id,TargetHealth.State,TargetHealth.Reason]' --output table
```
