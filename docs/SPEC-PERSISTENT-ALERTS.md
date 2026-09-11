# Especificación: avisos persistentes de tareas y recordatorios

## Objetivo

Permitir que una tarea o un recordatorio pendiente envíe avisos repetidos por Telegram hasta que el usuario complete, cancele o detenga los avisos de ese elemento. La función estará desactivada por defecto y usará los intervalos de 5, 10, 20, 30 o 60 minutos.

## Alcance confirmado

- Aplica a tareas y recordatorios.
- Una tarea puede incluir fecha y hora, por ejemplo: `tarea pagar la luz mañana a las 18:00`.
- Una tarea sin fecha u hora puede empezar a avisar después del intervalo elegido, contado desde su creación.
- Un recordatorio empieza a avisar a la hora programada; los avisos posteriores respetan su intervalo.
- Al crear cualquiera de los dos tipos se ofrece elegir `Sin avisos`, 5, 10, 20, 30 o 60 minutos.
- Desde configuración se puede aplicar el cambio a todas las tareas, todos los recordatorios o ambos. Aplicarlo a todos actualiza los elementos existentes pendientes y el valor predeterminado para elementos nuevos.
- Reactivar un elemento individual conserva su intervalo anterior salvo que el usuario elija otro.
- `Parar avisos de esta tarea` y `Parar avisos de este recordatorio` desactivan definitivamente los avisos de ese elemento, pero lo dejan pendiente.
- `Cancelar` marca el elemento como cancelado y evita futuros avisos; no elimina físicamente el registro.
- Cada aviso incluye botones dinámicos para `Parar avisos de esta tarea/recordatorio`, `Completar` y `Cancelar`.

## Modelo de datos

La migración añadirá:

1. `notification_preferences`, una fila por usuario, con valores predeterminados independientes para tareas y recordatorios (`enabled` e `interval_minutes`). El estado inicial será desactivado.
2. `persistent_notifications`, una fila por elemento (`task` o `reminder`) con `enabled`, `interval_minutes`, `next_notify_at`, una concesión temporal de procesamiento y el último envío. Se conserva la fila desactivada para poder reactivar el elemento con su intervalo anterior.

La tabla de avisos tendrá una restricción de unicidad por tipo e identificador. El scheduler reclamará cada fila mediante una actualización condicional y una concesión temporal; así dos ejecuciones concurrentes no deberían enviar el mismo aviso. Si Telegram falla, la concesión expira y el aviso se puede reintentar.

Completar o cancelar un elemento desactivará su aviso persistente. La eliminación de datos del usuario también eliminará sus preferencias y avisos persistentes.

## Flujo de usuario

- Crear tarea o recordatorio: se crea el elemento y se muestra un teclado para elegir el intervalo.
- Elegir `Sin avisos`: el elemento queda pendiente sin fila activa.
- Elegir intervalo: se guarda la configuración individual y se calcula el próximo aviso. En una tarea programada, el primer aviso es a la fecha de vencimiento; en una tarea sin horario, es creación + intervalo; en un recordatorio, es `remind_at`.
- `/configuracion`: muestra la configuración global y permite seleccionar tareas, recordatorios o ambos; después permite activar un intervalo o desactivar.
- El menú de detalle del elemento permite configurar/reactivar sus avisos sin cambiar el estado de la tarea o recordatorio.

## Reglas del scheduler

- El cron se ejecutará cada minuto; la precisión efectiva será la del cron, no la del intervalo elegido.
- Se procesan primero los elementos pendientes cuyo `next_notify_at` ya venció.
- Después de un envío exitoso, el siguiente aviso se programa con el intervalo guardado. Si el cron estuvo retrasado, se avanza hasta una fecha futura para no enviar una ráfaga de avisos atrasados.
- Un elemento completado o cancelado nunca se envía aunque exista una fila vieja de configuración.
- El texto del aviso identifica claramente si es tarea o recordatorio y siempre adjunta el teclado de acciones.

## Seguridad y consistencia

- Todas las operaciones de configuración reciben `userId` y filtran por propietario.
- Los identificadores de callback se validan y nunca contienen texto libre.
- Un callback de otra cuenta no puede modificar ni configurar un elemento.
- La configuración global no elimina datos; solo cambia preferencias y avisos de elementos pendientes.

## Fuera de alcance de este incremento

- Canales distintos de Telegram.
- Ventanas horarias o silenciar por días de la semana.
- Intervalos menores a 5 minutos o mayores a una hora.
- Repetición automática de tareas/recordatorios después de completarlos.

## Criterios de aceptación

- La creación existente sigue funcionando y los avisos continúan apagados si el usuario no elige un intervalo.
- Se puede crear una tarea con fecha/hora válida y el scheduler la entrega a partir de ese momento.
- Se puede configurar un intervalo individual y verificar el siguiente aviso en una prueba determinista.
- Completar, cancelar o detener avisos impide futuros envíos y conserva el estado correcto.
- `Parar todos` afecta elementos existentes pendientes y elementos nuevos hasta que se vuelva a activar explícitamente.
- El suite completo de Vitest, TypeScript, lint y build pasan.
