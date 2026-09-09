# Trabajo pendiente

- [x] Inicializar Worker TypeScript, Wrangler, Vitest y CI.
- [x] Añadir esquema D1 y repositorios mínimos.
- [x] Implementar webhook seguro de Telegram.
- [x] Añadir deduplicación de `update_id`.
- [x] Implementar parser e `Intent` inicial.
- [x] Implementar módulo de tareas.
- [x] Implementar módulo de recordatorios y Cron Trigger.
- [x] Implementar gastos.
- [x] Implementar enlaces/notas y `/resumen`.
- [x] Implementar borrado de datos.
- [x] Configurar deploy automático por GitHub Actions y webhook de producción.
- [x] Añadir parser ampliado y LLM opcional en `feature/ai-conversation` (ver `docs/SPEC-AI-CONVERSATION.md`).
- [x] Recordatorios naturales con hora (`2pm`, `2:30 pm`, `14:00`).
- [x] Gastos naturales con categoría, descripción e historial por categoría.
- [x] Guardar fotos y documentos con `Guarda` en la descripción.
- [x] Consultar `mis guardados` con paginación y recuperar archivos, notas y enlaces.
- [x] Consultar imágenes guardadas con lenguaje natural.
- [x] Resolver seguimientos como `Muestramelas` y `muestra más` con contexto temporal por chat.
- [x] Desplegar migración de contexto y actualizar Vitest a una versión sin vulnerabilidades auditadas.

## Consultas y acciones con botones

- [x] Añadir migración y repositorios para estados, cancelación, paginación y edición temporal de tareas/recordatorios.
- [x] Validar `callback_query` y añadir teclados inline seguros e idempotentes.
- [x] Extender `Intent`/OpenAI con `list_tasks` y `list_reminders`, incluyendo filtros faltantes.
- [x] Implementar listas: 10 iniciales, páginas de 20, fechas locales y `Consultar más`.
- [x] Implementar menú por registro: completar, editar, cancelar y volver.
- [x] Añadir pruebas de unidad, callbacks, autorización, paginación y webhook.

Checkpoint:

- [x] `tareas` y `recordatorios` preguntan el estado con botones.
- [x] Las listas no muestran IDs y los callbacks solo modifican registros del usuario autorizado.
- [x] `npm test`, lint, typecheck, build y audit pasan antes del despliegue (143 pruebas; audit sin vulnerabilidades).

## Próxima idea: carpetas y datos personales

Propuesta futura, todavía sin implementar:

- [ ] Permitir frases como `guarda este INE en datos personales` al guardar una foto o documento.
- [ ] Separar los guardados por colecciones/categorías, por ejemplo `Datos personales`, `Trabajo`, `Recibos` y `Sin clasificar`.
- [ ] Mostrar `Mis imágenes` y `Mis archivos` como una navegación con botones de carpeta antes de listar elementos.
- [ ] Mantener los archivos sensibles fuera de la lista general salvo que el usuario elija explícitamente la categoría.
- [ ] Diseñar la categoría como una entidad controlada en D1, no como texto libre sin validación, y conservar el borrado completo mediante `/borrar_datos CONFIRMAR`.

La categoría solo organizaría la referencia al archivo guardado; antes de implementarla hay que definir retención, nombres de categorías, renombrado y el comportamiento de documentos sensibles como el INE.
