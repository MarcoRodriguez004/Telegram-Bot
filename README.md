# Personal Assistant Bot

Asistente personal modular para Telegram: tareas, recordatorios, gastos y enlaces desde un único chat.

## Documento principal

Lee [docs/PLAN.md](docs/PLAN.md) para entender qué se construirá, cómo funcionará, las fases, el modelo de datos, la seguridad y el despliegue.

Para publicar el bot en una cuenta real, sigue [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

Las decisiones arquitectónicas están registradas en [ADR-001](docs/decisions/001-cloudflare-workers-d1.md).

## Estado

Ya existen capacidades funcionales en TypeScript para tareas, recordatorios, gastos, notas/enlaces, `/resumen` y `/borrar_datos CONFIRMAR`. El Worker guarda la acción en D1 y confirma la creación; un Cron Trigger revisa cada minuto los recordatorios vencidos y los envía a Telegram. También incluye `/health`, webhook autenticado, allowlist, deduplicación de `update_id`, migración D1 inicial, pruebas Vitest y quality gate local/CI. El prototipo Python se conserva como referencia durante la migración.

El parser actual es deliberadamente determinista y conservador, pero ya acepta frases naturales acotadas para recordatorios con hora, gastos con categoría/descripción e historial de gastos. No inventa un monto cuando falta.

Cuando se configura `OPENAI_API_KEY`, los mensajes que el parser no reconoce pasan por un intérprete opcional de OpenAI Responses API con Structured Outputs. La IA solo devuelve una intención cerrada; el Worker valida los campos y ejecuta los repositorios existentes. Si la clave falta o la API falla, las reglas deterministas siguen funcionando. La memoria persistente de varios turnos todavía no está habilitada.

Ejemplos desde Telegram:

```text
Quiero que me recuerdes a las 2pm tomarme mi medicamento
Gasté 450 en carro por compra de radiador
Muéstrame el historial de gastos de carro
```

Los gastos requieren un monto para conservar totales correctos. La conversación de dos pasos para pedir el monto y completarlo queda como una mejora posterior.

## Fotos, documentos y mis guardados

Envía una foto o documento **por separado**, con la descripción `Guarda` o `Guarda recibo de luz`. El bot confirma el guardado y muestra un comando como `/guardado_123` para recibir el archivo de vuelta.

Escribe `mis guardados` o `/guardados` para ver fotos, documentos, notas y enlaces, incluidos los que ya habías guardado. También puedes escribir `mis fotos` o `muéstrame las imágenes guardadas` para listar solo imágenes. La lista muestra diez elementos, del más reciente al más antiguo; toca `/guardados_123` al final para ver más. Para abrir uno, toca su comando `/guardado_123` o escribe `ver guardado 123`.

Una foto/documento sin `Guarda` en la descripción recibe instrucciones y no se guarda. Los álbumes no se guardan como conjunto: envía cada archivo por separado con su descripción. Las fotos enviadas antes de implementar esta función deben enviarse nuevamente.

El bot conserva en D1 la descripción y el identificador del archivo en Telegram; no descarga los archivos, no lee el recibo mediante OCR y no crea gastos automáticamente. La recuperación depende de Telegram y del mismo bot. Para preservar la calidad original de una imagen, envíala como documento. `/borrar_datos CONFIRMAR` elimina estos registros de D1, pero no borra los mensajes o archivos que siguen en el chat de Telegram.

Antes de publicar esta versión hay que aplicar `0002_note_attachments.sql`. El pipeline ejecuta las migraciones remotas antes del despliegue; su token requiere el permiso D1 de edición. Consulta [el procedimiento de despliegue](docs/DEPLOYMENT.md).

## Probarlo localmente

Requisitos: Node.js 22 LTS recomendado y npm.

```powershell
npm install
Copy-Item .dev.vars.example .dev.vars
npm run db:migrate:local
npm run dev
```

En otra terminal, verifica el Worker:

```powershell
Invoke-WebRequest http://127.0.0.1:8787/health
```

Debe responder `200` con `{"ok":true,"service":"personal-assistant-bot"}`. Las pruebas de tareas, recordatorios, gastos, notas y resumen se ejecutan con `npm test`; el Cron local se puede invocar manualmente con:

```powershell
Invoke-WebRequest 'http://127.0.0.1:8787/cdn-cgi/local/scheduled?format=json'
```

El borrado de datos requiere escribir exactamente `/borrar_datos CONFIRMAR`. Elimina tareas, recordatorios, gastos, notas y el perfil del usuario; conserva `processed_updates`, que es el registro técnico anti-replay.

Para probarlo desde Telegram necesitaremos desplegar el Worker y registrar el webhook. Completa `.dev.vars` con el token del bot, el secret del webhook y tu `TELEGRAM_ALLOWED_USER_ID` cuando lleguemos a esa fase.

Para habilitar la interpretación conversacional local, añade también `OPENAI_API_KEY` y `OPENAI_MODEL="gpt-5.6-luna"` a `.dev.vars`. En producción configura la clave con `npx wrangler secret put OPENAI_API_KEY`; nunca la versiones.

Comandos de calidad:

```powershell
npm run lint
npm run typecheck
npm test
npm run build
npm audit --audit-level=high
```
