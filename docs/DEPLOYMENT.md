# Despliegue de producción

Este documento convierte el Worker local en un bot de Telegram operativo. No contiene tokens ni valores de cuenta; esos datos deben introducirse de forma interactiva en Wrangler o en Cloudflare.

## Estado previo

Antes de crear recursos en Cloudflare, ejecuta:

```powershell
npm ci
npm run lint
npm run typecheck
npm test
npm run build
```

El build local solo valida el bundle (`--dry-run`); no publica el Worker.

## 1. Crear y vincular D1

Inicia sesión una vez en Wrangler:

```powershell
npx wrangler login
npx wrangler d1 create personal-assistant-bot
```

Copia el `database_id` que devuelve Wrangler en `wrangler.jsonc`, sustituyendo `REPLACE_WITH_D1_DATABASE_ID`. No cambies el binding `PERSONAL_ASSISTANT_DB`: el código lo recibe con ese nombre.

Aplica la migración en la base remota:

```powershell
npm run db:migrate:remote
```

No uses `--local` en este paso: las migraciones locales y remotas son bases distintas.

## 2. Publicar el Worker

Para una publicación manual, aplica las migraciones pendientes antes de publicar el código:

```powershell
npm run db:migrate:remote
npm run deploy
```

La URL será parecida a `https://personal-assistant-bot.<subdominio>.workers.dev`.

## 3. Guardar secretos

Ejecuta cada comando e introduce el valor cuando Wrangler lo solicite:

```powershell
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
npx wrangler secret put TELEGRAM_ALLOWED_USER_ID
npx wrangler secret put OPENAI_API_KEY
```

No pongas los secretos en `wrangler.jsonc`, `vars`, un commit, la URL de Telegram ni el historial del shell. `OPENAI_MODEL` es una variable pública de configuración (`gpt-5.6-luna` por defecto); `OPENAI_API_KEY` debe permanecer como secret. El secret del webhook debe usar únicamente letras, números, `_` o `-`, tal como exige Telegram.

## 4. Registrar el webhook

Usa el mismo valor para `TELEGRAM_WEBHOOK_SECRET` al registrarlo. Este ejemplo pide los valores en la terminal para no escribirlos en el comando:

```powershell
$botToken = Read-Host "TELEGRAM_BOT_TOKEN"
$webhookSecret = Read-Host "TELEGRAM_WEBHOOK_SECRET"
$workerUrl = Read-Host "URL pública del Worker"
$body = @{
  url = "$workerUrl/telegram/webhook"
  secret_token = $webhookSecret
  allowed_updates = @("message")
} | ConvertTo-Json

Invoke-RestMethod `
  -Uri "https://api.telegram.org/bot$botToken/setWebhook" `
  -Method Post `
  -ContentType "application/json" `
  -Body $body
```

Comprueba el resultado sin imprimir el token:

```powershell
$botToken = Read-Host "TELEGRAM_BOT_TOKEN"
Invoke-RestMethod "https://api.telegram.org/bot$botToken/getWebhookInfo" | ConvertTo-Json -Depth 5
```

Debe mostrar la URL del Worker. Si `last_error_message` aparece, corrige el problema antes de probar comandos desde Telegram.

## 5. Smoke test

1. Abre `https://<worker>.workers.dev/health` y confirma `{"ok":true,...}`.
2. En el chat privado autorizado envía `/start`.
3. Envía `/tarea prueba de producción` y confirma que recibes una respuesta.
4. Envía `por favor anota comprar medicina` y confirma que la interpretación natural crea una tarea.
5. Envía `/resumen` y confirma que la consulta responde.
6. Verifica en el dashboard de Worker que no haya errores de ejecución ni respuestas fallidas de OpenAI.

No pruebes `/borrar_datos CONFIRMAR` en producción salvo que quieras borrar la cuenta real; la cobertura automatizada ya está en `tests/privacy-webhook.test.ts`.

## 6. Despliegue automático con GitHub Actions

Este repositorio ya incluye un job de GitHub Actions que despliega automáticamente solo cuando un push a `main` pasa todos los controles de calidad. La rama `Dev` ejecuta CI, pero no publica producción.

En GitHub, abre `Settings → Environments`, crea el entorno `production` y añade estos secretos al entorno:

| Secreto | Valor |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Token API de Cloudflare con la plantilla `Edit Cloudflare Workers` y permiso adicional `Account → D1 → Edit`, limitado a esta cuenta |
| `CLOUDFLARE_ACCOUNT_ID` | ID de la cuenta de Cloudflare |

No copies aquí `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` ni `TELEGRAM_ALLOWED_USER_ID`: esos secretos ya viven en Cloudflare y no son necesarios para construir el Worker.
Tampoco copies `OPENAI_API_KEY` en GitHub: el workflow publica el Worker y Cloudflare conserva el secret.

El workflow usa esta secuencia:

1. En cada pull request y push a `main` o `Dev`: `npm ci`, lint, typecheck, tests, `npm audit --audit-level=high` y `npm run build`.
2. Solo en un push a `main` que supera `quality`: `cloudflare/wrangler-action@v4` aplica las migraciones de D1 con `d1 migrations apply PERSONAL_ASSISTANT_DB --remote` y después ejecuta `deploy`. Si falla la migración, no publica el Worker.
3. Después del despliegue: comprueba `GET /health` en `https://personal-assistant-bot.personal-assistant-bot-marco.workers.dev`.

El nombre del Worker debe coincidir con `name` en `wrangler.jsonc`. Se recomienda proteger `main` para que los cambios entren mediante pull request con el check `CI / quality` aprobado.

Cloudflare también ofrece Workers Builds como alternativa nativa para GitHub, pero no debe activarse simultáneamente con este workflow porque produciría dos sistemas de despliegue para el mismo Worker.

### Versión con fotos y documentos

`0002_note_attachments.sql` añade dos columnas opcionales a `notes`, una restricción de coherencia y un índice. Conserva las notas existentes. Antes de integrar esta versión en `main`, comprueba que el token de GitHub tenga `D1 → Edit`; no basta con permiso para desplegar Workers. No es necesario cambiar el webhook, porque sigue recibiendo actualizaciones `message`.

Prueba desde la cuenta autorizada: envía una foto con `Guarda recibo de prueba`, escribe `mis guardados` y toca el comando `/guardado_<id>` devuelto. Repite con un PDF. Los archivos enviados antes de esta versión deben enviarse nuevamente.

## Rollback

El rollback de código se hace publicando un commit anterior desde `main` o revirtiendo el commit problemático y dejando que GitHub Actions despliegue de nuevo. Primero comprueba `/health` y `getWebhookInfo`; no borres el Worker ni la base D1 para revertir código. Las columnas opcionales de `0002_note_attachments.sql` pueden permanecer al volver al código anterior: no las elimines, pues contienen las referencias guardadas.

Las migraciones actuales son acumulativas. Antes de añadir una migración destructiva hay que diseñar una estrategia expand/contract y una copia/exportación; no se debe “rollbackear” producción borrando tablas manualmente.

## Fuentes oficiales

- [Cloudflare D1: crear una base y vincularla al Worker](https://developers.cloudflare.com/d1/get-started/)
- [Cloudflare Workers: secretos](https://developers.cloudflare.com/workers/configuration/secrets/)
- [Cloudflare Workers con GitHub Actions](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/)
- [Wrangler Action oficial](https://github.com/cloudflare/wrangler-action)
- [Cloudflare Workers Builds: configuración](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)
- [Telegram Bot API: `setWebhook`](https://core.telegram.org/bots/api#setwebhook)
