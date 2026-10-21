# Comandos de evidencia (solo lectura)

Comandos que no crean ni modifican nada, para juntar los datos de las secciones 1.2, 1.4 y 2.3 mientras corre k6. Los recursos usan los nombres fijos del plan.

```bash
export AWS_REGION=us-east-1
```

## Condiciones iniciales (1.2)

```bash
# CPU, memoria y revisión de la task definition que usa el servicio
TD=$(aws ecs describe-services --cluster actividad2 --services scoring-api --query 'services[0].taskDefinition' --output text)
aws ecs describe-task-definition --task-definition $TD \
  --query 'taskDefinition.{cpu:cpu,memory:memory,arch:runtimePlatform.cpuArchitecture,image:containerDefinitions[0].image}'

# Configuración del health check del target group
TG=$(aws elbv2 describe-target-groups --names scoring-tg --query 'TargetGroups[0].TargetGroupArn' --output text)
aws elbv2 describe-target-groups --target-group-arns $TG \
  --query 'TargetGroups[0].{path:HealthCheckPath,interval:HealthCheckIntervalSeconds,timeout:HealthCheckTimeoutSeconds,healthy:HealthyThresholdCount,unhealthy:UnhealthyThresholdCount}'
```

## Durante k6 (1.4 y 2.3)

```bash
# Estado de los targets, cada 5 segundos
while true; do date +%T; aws elbv2 describe-target-health --target-group-arn $TG \
  --query 'TargetHealthDescriptions[].[Target.Id,TargetHealth.State,TargetHealth.Reason]' --output text; sleep 5; done

# Últimos eventos del servicio (reemplazos por health check)
aws ecs describe-services --cluster actividad2 --services scoring-api \
  --query 'services[0].events[0:10].[createdAt,message]' --output text

# Tareas detenidas y su motivo
aws ecs list-tasks --cluster actividad2 --service-name scoring-api --desired-status STOPPED --query 'taskArns' --output text \
  | xargs -n 100 aws ecs describe-tasks --cluster actividad2 --query 'tasks[].[stoppedAt,stoppedReason]' --output text --tasks
```

## Después de k6

```bash
# CPU y memoria del servicio en los últimos 15 minutos (máximo por minuto)
for M in CPUUtilization MemoryUtilization; do echo $M; aws cloudwatch get-metric-statistics \
  --namespace AWS/ECS --metric-name $M \
  --dimensions Name=ClusterName,Value=actividad2 Name=ServiceName,Value=scoring-api \
  --start-time $(date -u -v-15M +%Y-%m-%dT%H:%M:%SZ) --end-time $(date -u +%Y-%m-%dT%H:%M:%SZ) \
  --period 60 --statistics Maximum --query 'sort_by(Datapoints,&Timestamp)[].[Timestamp,Maximum]' --output text; done

# Códigos HTTP devueltos por el ALB y por los targets en los últimos 15 minutos
LB=$(aws elbv2 describe-load-balancers --names scoring-alb --query 'LoadBalancers[0].LoadBalancerArn' --output text | sed 's#.*:loadbalancer/##')
for M in HTTPCode_ELB_502_Count HTTPCode_ELB_503_Count HTTPCode_ELB_504_Count HTTPCode_Target_2XX_Count; do echo -n "$M: "; aws cloudwatch get-metric-statistics \
  --namespace AWS/ApplicationELB --metric-name $M --dimensions Name=LoadBalancer,Value=$LB \
  --start-time $(date -u -v-15M +%Y-%m-%dT%H:%M:%SZ) --end-time $(date -u +%Y-%m-%dT%H:%M:%SZ) \
  --period 900 --statistics Sum --query 'Datapoints[0].Sum' --output text; done

# Parte 2: mensajes pendientes en la cola
aws sqs get-queue-attributes --queue-url $(aws sqs get-queue-url --queue-name scoring-jobs --query QueueUrl --output text) \
  --attribute-names ApproximateNumberOfMessages ApproximateNumberOfMessagesNotVisible
```
