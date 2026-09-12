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

## Carpetas y datos personales

Especificación: [`docs/SPEC-SAVED-FOLDERS.md`](../docs/SPEC-SAVED-FOLDERS.md). Implementado en `743ed00`.

- [x] Crear carpetas dinámicas por usuario, sin catálogo fijo ni carpetas compartidas.
- [x] Guardar notas, enlaces, fotos y documentos dentro de una carpeta existente.
- [x] Mostrar `mis carpetas` en bloques de imágenes, archivos y enlaces/notas.
- [x] Mostrar `mis imágenes`, `mis archivos` y `mis enlaces` con selección de carpeta y botones.
- [x] Numerar las listas de imágenes y añadir botones compactos en cuadrícula para abrir cada foto.
- [x] Mantener `Sin carpeta` como categoría virtual para elementos antiguos o no clasificados.
- [x] Validar propiedad de usuario en consultas, callbacks, guardado y paginación.
- [x] Eliminar carpetas junto con los datos mediante `/borrar_datos CONFIRMAR`.
- [x] Añadir `/borrar_bd` para el administrador con tres confirmaciones exactas antes de vaciar todos los datos de la base.
- [x] Aplicar y probar localmente las migraciones de carpetas, confirmaciones globales y memoria conversacional hasta `0013_conversation_drafts.sql`.

Decisiones pendientes para otro día:

- [x] Añadir renombrado, eliminación y movimiento de elementos entre carpetas.
- [x] Decidir si las carpetas vacías deben mostrarse en un bloque adicional.
- [x] Crear automáticamente una carpeta inexistente cuando el usuario la indica explícitamente al guardar; las consultas no crean carpetas.
- [x] Pedir confirmación si el nombre solicitado coincide en 70% o más con una carpeta existente, incluyendo guardados multimedia pendientes.

## Incremento actual: administración de carpetas y smoke test de avisos

- [x] Implementar renombrado de carpetas con validación de duplicados por usuario.
- [x] Implementar eliminación confirmada conservando los guardados en `Sin carpeta`.
- [x] Implementar movimiento de guardados entre carpetas, incluyendo `Sin carpeta`.
- [x] Mostrar carpetas vacías en un bloque separado.
- [x] Ejecutar smoke test de producción para avisos persistentes individuales y acciones de detener/completar/cancelar; verificado manualmente en Telegram.

## Memoria conversacional y cierre de backlog

- [x] Continuar tareas, recordatorios y gastos cuando falta un dato y el usuario responde en el mismo chat.
- [x] Expirar los borradores conversacionales a los 15 minutos, aislarlos por usuario/chat y eliminarlos con los comandos de borrado.
- [x] Contabilizar los borradores en la estimación lógica de almacenamiento.
- [x] Verificar con prueba automatizada que los guardados sin carpeta aparecen en `Sin carpeta`.
- [x] Actualizar la especificación de memoria y el estado del plan para no reportar como pendiente lo ya implementado.
