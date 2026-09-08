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

Para una primera publicación manual:

```powershell
npm run deploy
```

La URL será parecida a `https://personal-assistant-bot.<subdominio>.workers.dev`.

## 3. Guardar secretos

Ejecuta cada comando e introduce el valor cuando Wrangler lo solicite:

```powershell
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
npx wrangler secret put TELEGRAM_ALLOWED_USER_ID
```

No pongas estos valores en `wrangler.jsonc`, `vars`, un commit, la URL de Telegram ni el historial del shell. El secret del webhook debe usar únicamente letras, números, `_` o `-`, tal como exige Telegram.

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
4. Envía `/resumen` y confirma que la consulta responde.
5. Verifica en el dashboard de Worker que no haya errores de ejecución.

No pruebes `/borrar_datos CONFIRMAR` en producción salvo que quieras borrar la cuenta real; la cobertura automatizada ya está en `tests/privacy-webhook.test.ts`.

## 6. Workers Builds

En Cloudflare: Workers & Pages → selecciona el Worker → Settings → Builds → Connect. Configura:

| Campo | Valor |
|---|---|
| Repositorio | este repositorio GitHub |
| Rama de producción | `main` |
| Root directory | `/` |
| Build command | `npm run build` |
| Deploy command | `npm run deploy` |
| Rama no productiva | `npx wrangler versions upload` |

El nombre del Worker debe coincidir con `name` en `wrangler.jsonc`. Mantén CI como puerta de calidad; Workers Builds publicará solo después de que el commit llegue a la rama conectada.

## Rollback

El rollback de código se hace publicando un commit anterior desde `main` o revirtiendo el commit problemático y dejando que Workers Builds despliegue de nuevo. Primero comprueba `/health` y `getWebhookInfo`; no borres el Worker ni la base D1 para revertir código.

Las migraciones actuales son acumulativas. Antes de añadir una migración destructiva hay que diseñar una estrategia expand/contract y una copia/exportación; no se debe “rollbackear” producción borrando tablas manualmente.

## Fuentes oficiales

- [Cloudflare D1: crear una base y vincularla al Worker](https://developers.cloudflare.com/d1/get-started/)
- [Cloudflare Workers: secretos](https://developers.cloudflare.com/workers/configuration/secrets/)
- [Cloudflare Workers Builds: configuración](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)
- [Telegram Bot API: `setWebhook`](https://core.telegram.org/bots/api#setwebhook)
