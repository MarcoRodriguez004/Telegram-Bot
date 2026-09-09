# Especificación: consultas y acciones de tareas y recordatorios

**Estado:** borrador para revisión
**Rama:** `feature/task-reminder-queries`

## Objetivo

Permitir que el usuario consulte tareas y recordatorios desde Telegram sin escribir comandos ni identificadores. Las listas deben usar botones inline con etiquetas humanas; los callbacks conservarán el identificador interno de forma opaca y el Worker validará que el registro pertenezca al usuario autenticado.

La memoria conversacional de varios turnos queda fuera de este incremento.

## Requisitos acordados

1. Un mensaje ambiguo como «mis tareas» pregunta el estado mediante botones: `Completadas`, `Pendientes`, `Canceladas` y `Todas`.
2. La primera página muestra las 10 más recientes y la fecha local.
3. Un botón `Consultar más` muestra las siguientes 20; debe poder repetirse mientras existan resultados.
4. Las listas no muestran IDs internos.
5. Para completar una tarea, el usuario pulsa un botón cuyo texto contiene el nombre de la tarea.
6. Las tareas/recordatorios se muestran como botones para seleccionar el registro que se desea editar.
7. La selección debe producir acciones posteriores sin exigir que el usuario vuelva a escribir el título completo.

## Alcance técnico

- Añadir consultas paginadas y operaciones de estado en los repositorios de tareas y recordatorios.
- Añadir estados persistentes para cancelación, con migración D1 compatible con datos existentes.
- Extender el contrato `Intent` y el esquema de OpenAI con consultas y acciones seguras.
- Parsear y validar `callback_query` de Telegram; responder al callback y editar o enviar el mensaje correspondiente.
- Codificar callbacks opacos, limitados y autorizados por usuario; nunca confiar en el texto visible del botón.
- Mantener una sola intención por mensaje y dejar la memoria de varios turnos para otra rama.

## Decisiones por defecto propuestas

- Tareas: ordenar por `created_at DESC`, mostrar 10 inicialmente y 20 por página posterior.
- Recordatorios: ordenar por `remind_at ASC` para próximos y por fecha descendente para históricos.
- Fechas: mostrar en `America/Mexico_City` con formato `YYYY-MM-DD HH:mm`.
- Consultas de lectura no requieren confirmación; cambios de estado sí se ejecutan únicamente desde un callback validado.
- Nunca mostrar el ID de D1 al usuario.

## Open Questions

1. Para recordatorios, las cuatro opciones deben llamarse `Pendientes`, `Enviados`, `Cancelados` y `Todos`, o se desea otro conjunto de estados?
2. Al pulsar una tarea/recordatorio, ¿el menú debe ofrecer `Completar`, `Editar`, `Cancelar` y `Volver`, o se necesita otra acción?
3. ¿Editar tarea permite cambiar solo el nombre, o también fecha límite? ¿Editar recordatorio permite cambiar nombre y fecha/hora?
4. ¿La cancelación debe conservar el registro como `cancelled` (recomendado) o eliminarlo?

## Criterios de aceptación

- `Mis tareas` no ejecuta una consulta sin estado: presenta el selector de estado inline.
- La primera consulta devuelve como máximo 10 registros y botones con nombre/fecha, sin ID visible.
- `Consultar más` devuelve bloques de 20 y desaparece cuando no quedan registros.
- Un callback de una cuenta distinta, un registro inexistente o un callback expirado no modifica D1.
- Completar/cancelar/editar afecta únicamente al registro seleccionado y responde con confirmación clara.
- Las consultas y acciones por texto natural usan el mismo contrato validado que los botones.
- Pruebas unitarias cubren paginación, autorización, estados, callbacks inválidos y formato de fechas; pruebas de webhook cubren el flujo completo.

## Fuera de alcance

- Memoria conversacional de varios turnos y borradores pendientes.
- Acciones sobre varios registros en una sola frase.
- Mostrar o pedir IDs internos.
- Cambiar la configuración de OpenAI o el modelo.
