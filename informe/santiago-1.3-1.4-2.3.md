# Secciones 1.3, 1.4 y 2.3 (Santiago, 282542)

Borrador para pegar en el documento compartido. Los valores entre corchetes, como `[P95_P1]`, se completan con los resultados reales de k6 y las capturas de Nicolás.

## 1.3 Prueba de rendimiento con k6

Elegimos una prueba de carga (load test) con rampa, porque lo que la financiera nos describe es un escenario de uso normal pero sostenido: el scoring pasa a formar parte del alta de préstamos de la web y de todas las sucursales, así que durante el horario de atención va a recibir muchas solicitudes simultáneas durante un buen rato, no un golpe aislado. La prueba de carga reproduce justamente eso. Sube de forma gradual hasta el nivel de concurrencia esperado, lo mantiene y después baja, y nos permite validar si el servicio cumple los umbrales de la letra en condiciones realistas.

Descartamos las otras opciones por motivos concretos. Una prueba de estrés busca a propósito el punto en que el sistema se rompe, y eso no es lo que nos pide la financiera, que quiere saber si aguanta el uso esperado. Una prueba de pico (spike) mide la reacción ante un salto instantáneo de tráfico, pero el problema reportado aparece con carga sostenida, no con una ráfaga puntual. Una prueba de humo (smoke) con uno o dos usuarios no alcanza para ver ningún efecto de concurrencia.

Fijamos la carga en 10 usuarios virtuales concurrentes: 30 segundos de rampa, 2 minutos sostenidos y 30 segundos de bajada, con una pausa de 1 segundo entre solicitudes de cada usuario. Cada iteración usa una CI distinta, porque el modelo genera los números aleatorios a partir de la CI y no queríamos que la prueba repitiera siempre al mismo solicitante. Los umbrales están escritos en el propio script, así que k6 marca la prueba como fallida si el P(95) de `http_req_duration` supera los 2500 ms o si `http_req_failed` llega al 1 %. Estas condiciones quedan congeladas para repetirlas idénticas en la Parte 2.

Script (`k6/scoring-load.js`):

```javascript
[pegar aquí el contenido de k6/scoring-load.js]
```

Comando: `k6 run -e BASE_URL=http://[DNS_ALB] k6/scoring-load.js`

[Captura: resumen de k6 de la Parte 1, con los thresholds, http_req_duration, http_req_failed y http_reqs visibles]

Resultados de la Parte 1:

| Métrica | Valor |
|---|---|
| P(95) de `http_req_duration` | [P95_P1] |
| Mediana de `http_req_duration` | [MED_P1] |
| `http_req_failed` | [FAILED_P1] |
| Total de solicitudes (`http_reqs`) | [REQS_P1] |
| Solicitudes por segundo | [RPS_P1] |
| ¿Cumple los umbrales? | [SI_NO_P1] |

## 1.4 Diagnóstico: por qué el servicio se reinicia y de dónde salen los 502/503

Los resultados de k6 muestran que el servicio no se degrada de a poco, sino que colapsa. Con apenas 10 usuarios concurrentes, el P(95) llegó a [P95_P1] (el límite es 2500 ms) y fallaron [FAILED_P1] de las solicitudes. Para entender por qué, fuimos primero al código y después a la evidencia de ECS y del target group.

El origen está en `calcularScore`, dentro de `scoring-app/scoring.js`. Para cada solicitud, el modelo corre 1.500.000 simulaciones de 12 meses cada una, lo que suma unos 18 millones de iteraciones con logaritmos, raíces y cosenos. Antes del despliegue medimos el cálculo en una de nuestras computadoras, con un núcleo completo, y tardó entre 0,8 y 0,9 segundos por solicitud. La tarea de ECS tiene asignados [CPU_TAREA] vCPU, así que en AWS cada cálculo tarda varias veces más. No reducimos la cantidad de simulaciones porque el área de riesgo no lo permite, así que ese costo es fijo.

El problema de fondo no es solo que el cálculo sea pesado, sino dónde corre. El handler de `POST /scoring` ejecuta el cálculo de forma síncrona en el hilo principal de Node.js, que tiene un único event loop. Mientras calcula un score, el proceso no puede atender ninguna otra solicitud. Con 10 usuarios concurrentes, las solicitudes forman una fila y cada una espera a que terminen todas las anteriores, así que el tiempo de respuesta crece en proporción a la carga. Eso explica por qué el P(95) se dispara apenas sube la concurrencia.

Lo que convierte la lentitud en reinicios es el health check. El endpoint `/health` corre en ese mismo event loop, así que mientras hay cálculos en curso tampoco responde. El target group está configurado para revisar `/health` cada [INTERVALO_HC] segundos con un timeout de [TIMEOUT_HC] segundos, y marca el target como `unhealthy` después de [UNHEALTHY_THRESHOLD] fallos seguidos. Cuando eso pasa, ECS asume que la tarea está rota, la detiene y lanza otra. Lo vemos en los eventos del servicio, con mensajes del tipo "[MENSAJE_EVENTO_ECS]", y en las tareas detenidas, cuyo motivo de parada es "[STOPPED_REASON]". Eso es exactamente el "se reinicia solo" que reporta la financiera: la aplicación no se cae por un error propio, sino que ECS la mata porque no contesta a tiempo.

[Captura: eventos del servicio ECS con "failed ELB health checks" y el reemplazo de la tarea]

[Captura: target group con el target en estado unhealthy o draining]

[Captura: tareas detenidas con su stopped reason]

Los errores 502 y 503 salen de ese ciclo. Un 503 Service Unavailable lo devuelve el propio ALB cuando el target group se queda sin ningún target sano: con una sola tarea, mientras está `unhealthy` o mientras se levanta su reemplazo, no hay a quién mandarle el tráfico. Un 502 Bad Gateway aparece cuando ECS detiene una tarea que todavía tenía solicitudes en curso: el ALB tenía la conexión abierta, el contenedor se cierra y la respuesta nunca llega completa. Si alguna solicitud queda en la fila más de 60 segundos, que es el idle timeout por defecto del ALB, también puede aparecer un 504. En nuestra corrida vimos [DETALLE_CODIGOS_HTTP].

Para descartar otras causas miramos la memoria. Mientras la CPU de la tarea se mantuvo cerca del [CPU_PICO] %, la memoria quedó en torno al [MEM_PICO] %. No es un problema de memoria ni de dependencias externas, porque la aplicación no llama a ninguna base de datos ni servicio. Es un problema de CPU en el hilo principal.

[Captura: métricas de CPU y memoria del servicio ECS durante la prueba]

En resumen, el cuello de botella es el cálculo de Monte Carlo ejecutado de forma síncrona dentro de la solicitud HTTP. Bloquea el event loop, encola las solicitudes, hace fallar el health check y desencadena los reinicios que producen los 502 y 503.

## 2.3 Comparación de resultados

Volvimos a correr el mismo script, sin tocar una línea, contra el `POST /scoring` de la versión con cola y workers, con la misma CPU y memoria por tarea que en la Parte 1 para que la comparación fuera justa.

[Captura: resumen de k6 de la Parte 2]

| Métrica | Parte 1 (síncrono) | Parte 2 (cola y workers) |
|---|---|---|
| P(95) de `http_req_duration` | [P95_P1] | [P95_P2] |
| `http_req_failed` | [FAILED_P1] | [FAILED_P2] |
| Total de solicitudes (`http_reqs`) | [REQS_P1] | [REQS_P2] |
| Solicitudes por segundo | [RPS_P1] | [RPS_P2] |
| ¿Cumple los umbrales? | [SI_NO_P1] | [SI_NO_P2] |
| Reinicios de tareas durante la prueba | [REINICIOS_P1] | [REINICIOS_P2] |

[Captura: eventos del servicio ECS durante la prueba de la Parte 2, sin reinicios]

El P(95) bajó de [P95_P1] a [P95_P2] y la tasa de errores pasó de [FAILED_P1] a [FAILED_P2], así que ahora sí cumplimos los dos umbrales. Además procesamos [REQS_P2] solicitudes contra [REQS_P1] en el mismo tiempo, porque los usuarios virtuales ya no pasan la mayor parte de la prueba esperando en la fila. La mejora no viene de que el cálculo sea más rápido, porque es exactamente el mismo, sino de que la API ya no lo ejecuta: valida los datos, guarda la solicitud como `PENDIENTE`, la manda a la cola y responde 202 en milisegundos. El event loop queda libre, `/health` contesta siempre y ECS no vuelve a reiniciar la tarea durante la prueba.

Hay un matiz que queremos dejar explícito para no sobrevender el resultado. El P(95) de la Parte 2 mide cuánto tarda el sistema en aceptar la solicitud, no cuánto tarda en tener el score listo. El cálculo sigue llevando el mismo tiempo, ahora en los workers, y el resultado aparece unos segundos después al consultar `GET /scoring/:id`. Al terminar la prueba quedaron [MENSAJES_EN_COLA] mensajes pendientes en `scoring-jobs`, que los workers procesaron en [TIEMPO_VACIAR_COLA]. Si la carga real fuera mayor que lo que los workers pueden procesar, la cola crecería y la espera del solicitante también, aunque la API no fallaría. Ese es el punto donde, como siguiente paso, escalaríamos los workers según la cantidad de mensajes en la cola.
