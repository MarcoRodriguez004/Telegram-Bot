# Plan de implementación: Personal Assistant Bot

## Dirección

Migrar el prototipo actual a un Worker TypeScript modular con D1, webhook de Telegram y despliegue automático desde GitHub. Se construirá una capacidad vertical a la vez y se mantendrá el producto usable en cada checkpoint.

## Orden de trabajo

### Fase 0 — Base ejecutable

- [ ] Crear `package.json`, `wrangler.jsonc`, `tsconfig.json`, Vitest y configuración de CI.
- [ ] Definir `Env`, tipos compartidos, router HTTP y endpoint `/health`.
- [ ] Crear D1 local, migración inicial y repositorios parametrizados.

Checkpoint: Worker local arranca, `/health` responde y la migración se ejecuta en D1 local.

### Fase 1 — Telegram seguro

- [ ] Implementar `/telegram/webhook` con verificación del secret token.
- [ ] Validar chat privado y `TELEGRAM_ALLOWED_USER_ID`.
- [ ] Persistir `update_id` y hacer procesamiento idempotente.
- [ ] Añadir cliente Telegram mínimo para `sendMessage` y comandos `/start`, `/help`.

Checkpoint: una actualización autorizada recibe respuesta; una no autorizada no cambia D1.

### Fase 2 — Núcleo de productividad

- [ ] Implementar parser por reglas y el contrato `Intent`.
- [ ] Añadir módulo de tareas: crear, listar pendientes, completar.
- [ ] Añadir módulo de recordatorios: crear y listar próximos.
- [ ] Añadir Cron Trigger cada minuto para entregar recordatorios.

Checkpoint: `tarea comprar detergente` y `recuérdame pagar internet mañana` funcionan de punta a punta.

### Fase 3 — Memoria personal

- [ ] Añadir gastos con importe en centavos, moneda, categoría y descripción.
- [ ] Añadir enlaces/notas sin descargarlos.
- [ ] Añadir `/resumen` para hoy, semana y mes.
- [ ] Añadir `/borrar_datos CONFIRMAR`.

Checkpoint: el usuario puede registrar y consultar lo esencial desde Telegram.

### Fase 4 — Lenguaje natural ampliado

- [ ] Ampliar el parser para fechas, cantidades y variantes en español.
- [ ] Añadir adaptador LLM opcional detrás de `IntentRouter`.
- [ ] Validar toda salida del modelo y usar reglas como fallback.
- [ ] Medir errores de interpretación antes de activar el modelo por defecto.

Checkpoint: se entiende lenguaje natural adicional sin romper comandos ni aumentar el radio de permisos.

### Fase 5 — Operación y extensiones

- [ ] Configurar webhook de producción y Workers Builds.
- [ ] Añadir logs estructurados sin texto sensible, métricas básicas y alertas de errores.
- [ ] Preparar módulos independientes para compras, calendario e integraciones futuras.

## Grafo de dependencias

```text
Wrangler + Env + D1
        │
        ├── Telegram webhook + auth + idempotency
        │             │
        │             └── Intent router
        │                    │
        │                    ├── tasks
        │                    ├── reminders + cron
        │                    ├── expenses
        │                    └── notes/links
        │
        └── CI/CD + migrations + observability
```

## Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Telegram reenvía un webhook | `update_id` único en D1 y executor idempotente |
| Cron y webhook compiten | Estados `pending/processing/sent` y reclamación atómica |
| El modelo interpreta mal | Reglas primero, esquema cerrado, confirmación y fallback |
| Recordatorio duplicado | Marcar después de envío exitoso; documentar el límite at-least-once |
| Se filtra un token | Wrangler secrets, `.dev.vars` ignorado, escaneo en CI |
| El Worker crece sin orden | Módulos por capacidad y ADRs para decisiones grandes |

## Resultado esperado de la primera entrega

Un bot desplegado en `*.workers.dev`, accesible solo para una cuenta, capaz de crear tareas, recordatorios y gastos desde texto natural acotado, guardar enlaces, responder `/resumen` y entregar recordatorios sin un servidor permanente.

## Incremento actual: lenguaje natural para recordatorios y gastos

### Objetivo

Permitir frases naturales acotadas para crear recordatorios con hora, registrar gastos con monto, categoría y descripción, y consultar el historial de una categoría sin depender de un LLM.

### Tareas

- [ ] Ampliar el parser de recordatorios para horas de 12/24 horas y próxima ocurrencia.
- [ ] Ampliar el parser de gastos para reconocer verbos naturales, monto en distintas posiciones, categoría y descripción.
- [ ] Añadir una intención y consulta parametrizada para historial de gastos por categoría.
- [ ] Añadir pruebas unitarias y de webhook para los tres flujos.

### Criterios de aceptación

- [ ] `Quiero que me recuerdes a las 2pm tomarme mi medicamento` crea un recordatorio futuro en la zona horaria configurada.
- [ ] `Gasté 450 en carro por compra de radiador` persiste monto, categoría y descripción.
- [ ] `Muéstrame el historial de gastos de carro` devuelve total y detalle únicamente del usuario autorizado y de la categoría solicitada.
- [ ] Un gasto sin monto pide el monto y no inserta un registro incompleto.

### Decisión de seguridad

No se persisten gastos sin monto ni se adivina un valor. El seguimiento conversacional para responder el monto en un mensaje posterior queda como una siguiente migración de D1, porque requiere estado persistente y expiración del borrador.

## Incremento actual: interpretación conversacional asistida por IA

La especificación detallada está en [`docs/SPEC-AI-CONVERSATION.md`](../docs/SPEC-AI-CONVERSATION.md). Este incremento se desarrolla en la rama `feature/ai-conversation`, creada desde `origin/main` después del último deploy estable.

### Orden de trabajo

- [x] Implementar el adaptador de OpenAI Responses API con Structured Outputs y timeout.
- [x] Definir y validar el contrato cerrado `AiIntent`.
- [x] Integrar el fallback de IA después del parser determinista.
- [x] Ejecutar únicamente acciones existentes y mantener el borrado fuera del alcance del modelo.
- [x] Añadir configuración/secrets documentados y fallback cuando la IA esté deshabilitada.
- [x] Añadir pruebas unitarias, pruebas de integración del webhook y mocks de API sin exponer secretos.
- [x] Ejecutar typecheck, lint, build, tests y auditoría antes del PR.

### Dependencias explícitas

- La clave `OPENAI_API_KEY` debe existir solo en el entorno de despliegue.
- `OPENAI_MODEL` debe poder configurarse sin recompilar el Worker.
- La API de OpenAI se usa como intérprete; D1 y los repositorios siguen siendo la fuente de verdad.
- La memoria de varios turnos queda fuera de esta rama y, si se aprueba, tendrá su propia rama y migración.

## Incremento actual: consultas y acciones de tareas/recordatorios con botones

La especificación aprobada está en [`docs/SPEC-TASK-REMINDER-QUERIES.md`](../docs/SPEC-TASK-REMINDER-QUERIES.md). Este incremento se desarrolla en la rama `feature/task-reminder-queries` desde `origin/main`.

### Orden de implementación

1. **Persistencia y consultas:** añadir estados derivados de cancelación, sesiones temporales de edición, consultas por estado y paginación por cursor.
2. **Contrato y UI de Telegram:** validar `callback_query`, enviar teclados inline, responder callbacks y conservar la autorización/idempotencia existente.
3. **Router conversacional:** añadir intenciones de listar tareas/recordatorios y convertir filtros faltantes en selectores inline; mantener los callbacks fuera del LLM.
4. **Acciones y edición:** completar/cancelar desde botones; editar nombre de tarea o nombre+horario de recordatorio con sesión temporal expirable.
5. **Verificación:** pruebas de repositorios, parser, callbacks, autorización, paginación, expiración y webhook; después quality gates y smoke test en producción.

### Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Callback manipulado o de otra cuenta | Validar `from.id`, chat privado, forma del callback y pertenencia del registro antes de mutar D1 |
| Paginación que omite o duplica registros | Cursor por ID/fecha estable y límites distintos explícitos: 10 iniciales, 20 posteriores |
| Edición abandonada | Sesión temporal por usuario con expiración y botón de cancelación |
| Cambio de estado durante el scheduler | Actualizaciones condicionadas por estado y exclusión de cancelados en el reclamo |
| Migración incompatible con CHECK existente | Añadir columnas derivadas (`cancelled_at`) sin reescribir tablas; conservar estados actuales del scheduler |

## Incremento actual: administración de carpetas y verificación de avisos

### Tareas

1. Añadir renombrado, eliminación segura y movimiento de guardados entre carpetas, siempre filtrando por `user_id`.
2. Mostrar las carpetas vacías en un bloque separado (`📂 Carpetas vacías`) sin mezclar contenido ni borrar guardados al eliminar una carpeta; sus elementos pasarán a `Sin carpeta`.
3. Ejecutar smoke tests de producción para avisos persistentes: configuración individual, repetición, detener avisos, completar y cancelar.

### Criterios de aceptación

- [ ] `Renombra la carpeta X a Y` actualiza el nombre y rechaza duplicados normalizados.
- [ ] `Elimina la carpeta X` solicita confirmación y conserva sus guardados en `Sin carpeta`.
- [ ] `Mueve el guardado 123 a Y` cambia únicamente el guardado del usuario autenticado; `Sin carpeta` permite quitar la clasificación.
- [ ] `Mis carpetas` muestra las carpetas sin contenido en un bloque separado y no las presenta como si tuvieran guardados.
- [ ] La operación de un usuario no puede leer ni modificar carpetas o guardados de otro usuario.
- [ ] El smoke test confirma que los avisos están apagados por defecto, se pueden configurar, detener definitivamente y completar/cancelar desde Telegram.

### Decisión de seguridad

Eliminar una carpeta no elimina los guardados: la operación usa `folder_id = NULL` y después borra la carpeta. Esto evita pérdida de datos y conserva la categoría virtual `Sin carpeta`. El movimiento y el renombrado requieren que el origen y el destino pertenezcan al mismo usuario.
