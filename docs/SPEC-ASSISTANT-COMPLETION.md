# Especificación: continuidad, guardados, consultas, resumen y CAMe

**Estado:** implementado en `feature/assistant-completion` (pendiente de quality gate y despliegue)
**Rama:** `feature/assistant-completion`
**Alcance:** memoria conversacional, CRUD de guardados, búsqueda, resumen y consulta de contingencia CAMe
**Fuera de alcance:** mensajes de voz, WhatsApp, almacenamiento binario en R2 y carpetas compartidas

## Mapa de capacidades

| Módulo | Responsabilidad | Depende de |
|---|---|---|
| `conversation-memory-v2` | Mantener contexto reciente y resolver referencias en el mismo chat | D1, router, privacidad |
| `saved-crud` | Editar, mover, clasificar y eliminar guardados de cualquier tipo | notas, carpetas, sesiones |
| `search-v2` | Buscar con filtros por tipo, estado, carpeta y fechas | repositorios existentes |
| `summary-v2` | Integrar actividad, próximos eventos, guardados, gastos y CAMe | búsqueda, tareas, recordatorios, CAMe |
| `contingency-v2` | Mostrar afectación, fuentes, vehículos y estado actual de CAMe | parser CAMe/gob.mx |

**Orden:** `conversation-memory-v2` → `saved-crud` → `search-v2` → `summary-v2` → `contingency-v2`.

## Objetivo

El bot debe sentirse continuo y útil para el uso diario: entender seguimientos breves, permitir gestionar cualquier guardado sin depender de comandos internos, encontrar información por lenguaje natural, resumir la situación personal y responder con precisión si una contingencia CAMe está activa y cuándo afecta.

## Decisiones de alcance

- La memoria será acotada: máximo 12 turnos recientes por usuario/chat y expiración de 2 horas. No se almacenará una conversación ilimitada.
- La memoria se usará para referencias como «sí», «esa tarea», «el anterior», «muéstrame más» y para completar flujos pendientes. No inventará datos faltantes.
- El usuario podrá editar texto, enlaces, descripciones y carpeta de cualquier guardado. El archivo binario de una foto o documento no se reemplaza: solo se modifican sus metadatos o se elimina el registro local.
- Todas las consultas y mutaciones seguirán filtradas por `user_id`; los IDs de D1 no serán la única autorización.
- La búsqueda podrá filtrar por `tareas`, `recordatorios`, `gastos`, `guardados`, estado, carpeta y rango de fechas. La primera versión conservará paginación y límites de Telegram.
- El resumen ampliado mantendrá los rangos `hoy`, `semana` y `mes`, y no enviará más de un mensaje largo sin dividirlo.
- CAMe conservará prioridad para restricciones operativas. La respuesta siempre intentará mostrar día de afectación, fecha de publicación, horario si está disponible, vehículos afectados y fuentes consultadas.
- Si las fuentes CAMe/gob.mx no coinciden o una no está disponible, el bot lo explicará claramente; no convertirá una fuente ausente en una falsa confirmación.

## Contratos de usuario

Ejemplos que deben funcionar:

```text
Sí
Muéstrame esa tarea
Abre la anterior
Muéstrame más
Edita el guardado 7
Cambia la descripción del documento 2
Mueve la foto 3 a documentos personales
Busca mis documentos del INE de este mes
¿Qué tengo pendiente esta semana?
¿Me afecta la contingencia a mi vehículo?
¿Qué día aplica la restricción?
```

Los comandos exactos seguirán disponibles y tendrán prioridad cuando exista ambigüedad.

## Criterios de aceptación

### `conversation-memory-v2`

- [x] Un «sí» puede llegar al intérprete con los últimos turnos del mismo chat sin reiniciar el flujo.
- [x] El contexto queda aislado por usuario/chat; la resolución semántica final sigue siendo responsabilidad del router/intérprete.
- [x] El contexto expira, se reemplaza de forma acotada y se elimina con `/borrar_datos CONFIRMAR` y `/borrar_bd`.
- [x] La memoria no bloquea el webhook cuando está vacía o expirada.

### `saved-crud`

- [x] Texto, enlace, foto y documento pueden eliminarse con confirmación y autorización por usuario.
- [x] Texto, enlace y descripción de multimedia pueden editarse en una sesión expirable.
- [x] Mover un guardado a otra carpeta o a `Sin carpeta` conserva el archivo y valida pertenencia.
- [x] Un guardado inexistente o de otro usuario no se modifica.

### `search-v2`

- [x] La búsqueda devuelve resultados de todos los tipos permitidos sin cruzar usuarios.
- [x] Los filtros de tipo, estado, carpeta y fechas se validan antes de consultar D1.
- [x] Los resultados se numeran, muestran un resumen útil y ofrecen continuación cuando aplique.
- [x] La consulta conserva límites y paginación sin cruzar usuarios.

### `summary-v2`

- [x] `/resumen hoy`, `/resumen semana` y `/resumen mes` muestran tareas, recordatorios, gastos y guardados.
- [x] Incluye carpetas, almacenamiento lógico del usuario y desglose de gastos.
- [x] Incluye el último estado CAMe solo como dato informativo; no activa alertas por generar un resumen.
- [x] El resumen de un usuario no contiene datos de otro usuario.

### `contingency-v2`

- [x] `/hoy_no_circula` consulta nuevamente las fuentes aunque el boletín ya se haya visto.
- [x] Una alerta muestra el día de afectación y la fecha de publicación; si falta en el boletín, lo declara explícitamente.
- [x] Se puede consultar si la restricción afecta a alguno de los vehículos registrados.
- [x] Las discrepancias entre CAMe y gob.mx quedan visibles y la fuente de cada dato se conserva.

## Estrategia de pruebas

- Parser: referencias, filtros, rangos, tipos de guardado y frases con errores comunes.
- Repositorio: TTL, límites, propiedad por usuario, paginación, actualización y borrado.
- Webhook: conversaciones de varios turnos, acciones de guardados, búsqueda, resumen y consulta CAMe.
- Regresión: conservar todos los tests actuales de tareas, recordatorios, carpetas, adjuntos, exportación y alertas.
- Quality gate por corte: `npm test`, `npm run lint`, `npm run typecheck` y `npm run build`.

## Límites y seguridad

- **Siempre:** validar `user_id`, `chat_id`, longitudes, enums, fechas y IDs; usar consultas parametrizadas; conservar confirmaciones para borrado.
- **Pedir aprobación antes:** guardar historial ilimitado, cambiar la retención, permitir compartir datos, descargar archivos desde Telegram o añadir dependencias.
- **Nunca:** usar el texto visible de un botón como autorización, mezclar contexto entre usuarios, enviar al LLM secretos o confiar en una fecha CAMe no identificada como confirmada.
