# Especificación: Personal Assistant Bot

## Objetivo

Crear un asistente personal modular en Telegram. El usuario escribe en un único chat mensajes como:

- `gasto 450 gasolina`
- `recuérdame pagar internet mañana`
- `quiero que me recuerdes a las 2pm tomarme mi medicamento`
- `gasté 450 en carro por compra de radiador`
- `muéstrame el historial de gastos de carro`
- `guardar este link https://ejemplo.com/articulo`
- `tarea comprar medicina`

El backend interpreta el mensaje, ejecuta una acción permitida, guarda el resultado y responde con una confirmación clara.

## Decisión técnica

- TypeScript sobre Cloudflare Workers.
- Cloudflare D1 como SQLite administrado.
- Telegram Bot API mediante webhook HTTPS.
- Cron Trigger de Cloudflare para revisar recordatorios pendientes.
- Un solo repositorio y un solo Worker con módulos internos; no microservicios.
- Parser por reglas en V1; LLM opcional después, detrás del mismo contrato de intención.

## V1

Incluye tareas, recordatorios, gastos, enlaces/notas, `/resumen`, autenticación por usuario de Telegram, deduplicación de actualizaciones, migraciones D1, pruebas con Vitest y despliegue automático desde GitHub mediante Workers Builds.

No incluye grupos, panel web, Google Calendar, Gmail, scraping, búsqueda web, voz, pagos, multiusuario público ni automatizaciones externas.

## Flujo principal

```text
Telegram
   │ POST /telegram/webhook
   ▼
Cloudflare Worker
   ├─ valida secret token y usuario permitido
   ├─ deduplica update_id en D1
   ├─ interpreta texto → Intent tipado
   ├─ ejecuta módulo permitido → D1
   └─ responde por Telegram

Cron Trigger cada minuto
   └─ reclama recordatorios vencidos → Telegram → marca enviados
```

## Contrato interno

La única unión entre clasificación y ejecución es un tipo discriminado:

```ts
type Intent =
  | { action: "create_task"; title: string; dueAt?: string }
  | { action: "create_reminder"; title: string; remindAt: string }
  | { action: "create_expense"; amountCents: number; currency: string; category: string; description?: string }
  | { action: "list_expenses"; category?: string; range: "all" }
  | { action: "save_note"; content: string; url?: string }
  | { action: "list_notes"; beforeId?: number }
  | { action: "get_note"; noteId: number }
  | { action: "summary"; range: "today" | "week" | "month" }
  | { action: "delete_data"; confirmation: true }
  | { action: "unknown"; reason: string };
```

El executor no confía en texto libre: valida el `Intent`, acepta solo acciones conocidas y usa consultas D1 parametrizadas.

## Guardados con archivos

- Fotos y documentos se guardan con `Guarda` o `Guarda <descripción>` en el caption del mismo mensaje. El caption no ejecuta las demás intenciones del parser.
- El webhook valida los metadatos antes de procesarlos. Guarda la referencia `file_id` y tipo original en `notes`, usando la migración aditiva `0002_note_attachments.sql`. Para fotos elige la mayor resolución recibida. Si no hay descripción, usa el nombre del documento como título sin persistirlo por duplicado.
- Sin una instrucción de guardado, el bot explica cómo enviar el archivo. Cada archivo requiere su propio mensaje e instrucción; no hay agrupación de álbumes ni estado conversacional implícito.
- `mis guardados` y `/guardados` listan diez notas/archivos por página, ordenados por ID descendente. `/guardados_<id>` continúa antes de ese ID; las nuevas inserciones no desplazan la paginación.
- `/guardado_<id>`, `/guardado <id>` y `ver guardado <id>` devuelven texto/enlace o el archivo usando `sendPhoto`/`sendDocument`. Todas las consultas se restringen al usuario autenticado.
- El registro conserva hasta 1000 caracteres de descripción. La vista de lista limita cada descripción a 160 caracteres. La base rechaza referencias que carezcan de identificador o tipo.
- Los archivos permanecen en Telegram; no hay descarga, OCR ni extracción de gastos. D1 conserva las referencias hasta que el usuario solicita el borrado. El borrado no elimina mensajes ni copias de Telegram.
- Si Telegram rechaza la recuperación, el bot conserva el registro e indica cómo volver a solicitarlo.

Referencia: [Telegram Bot API, envío por file_id](https://core.telegram.org/bots/api#sending-files).

## Seguridad

- Solo se aceptan mensajes privados del `TELEGRAM_ALLOWED_USER_ID` configurado.
- El webhook verifica `X-Telegram-Bot-Api-Secret-Token`.
- `TELEGRAM_BOT_TOKEN` y el secret del webhook se almacenan como secretos de Wrangler.
- Los mensajes se limitan en tamaño antes de parsearse.
- La salida de un futuro LLM se valida con un esquema antes de ejecutarse.
- Las URLs se guardan; V1 no las descarga ni genera previews, evitando SSRF.
- `update_id` se registra para que Telegram pueda reintentar sin duplicar acciones.
- `/borrar_datos CONFIRMAR` elimina tareas, recordatorios, gastos, notas y el perfil del usuario. Requiere la palabra exacta en mayúsculas y conserva `processed_updates` para evitar replay.

## Pruebas

- Unitarias: parser, fechas en español, cantidades, autenticación, formato de respuestas.
- Integración: webhook con D1 local, deduplicación y Cron Trigger.
- Contrato: cada acción produce un resultado que Telegram puede enviar.
- CI: `npm ci`, lint, typecheck, tests y build antes de desplegar.

## Éxito

1. Un mensaje autorizado crea una sola acción persistente y recibe confirmación.
2. Un mensaje no autorizado no consulta ni modifica información personal.
3. Un recordatorio persiste tras despliegues y se entrega al vencer.
4. La aplicación funciona sin LLM configurado.
5. Cada nueva capacidad se puede añadir como módulo sin convertir `src/index.ts` en un monolito.

## Estado actual

El repositorio contiene el prototipo inicial en Python y una implementación ejecutable en TypeScript. TypeScript ya cubre el Worker, `/health`, webhook autenticado, allowlist, deduplicación, migración D1, parser determinista de tareas, recordatorios, gastos, notas, resumen y borrado explícito, creación idempotente de acciones, Cron Trigger y reintentos de entrega. El lenguaje natural amplio sigue pendiente; el prototipo Python se conserva como referencia temporal.
