# Webhook de WhatsApp Cloud API

El Worker expone este endpoint para la integración oficial de WhatsApp Cloud API:

```text
https://personal-assistant-bot.personal-assistant-bot-marco.workers.dev/whatsapp/webhook
```

## Secretos necesarios

Configúralos en Cloudflare, no en `wrangler.jsonc`, el repositorio ni la URL de Meta:

```powershell
npx wrangler secret put WHATSAPP_WEBHOOK_VERIFY_TOKEN
npx wrangler secret put WHATSAPP_APP_SECRET
npx wrangler secret put WHATSAPP_ACCESS_TOKEN
npx wrangler secret put WHATSAPP_PHONE_NUMBER_ID
npx wrangler secret put WHATSAPP_ALLOWED_USER_ID
```

- `WHATSAPP_WEBHOOK_VERIFY_TOKEN`: una frase aleatoria que también se escribirá en el campo **Identificador de verificación** de Meta.
- `WHATSAPP_APP_SECRET`: el secreto de la aplicación que se consulta en Meta Developers → **Configuración de la aplicación** → **Básica** → **Clave secreta de la aplicación**. Nunca se comparte en capturas ni mensajes.
- `WHATSAPP_ACCESS_TOKEN`: token de acceso para llamar a Cloud API. El token que apareció en capturas debe revocarse y sustituirse antes de usar esta integración.
- `WHATSAPP_PHONE_NUMBER_ID`: el **ID interno** del número de empresa, no el número visible con `+52`. Meta lo muestra en WhatsApp Manager y también lo devuelve el endpoint `/{WABA-ID}/phone_numbers`.
- `WHATSAPP_ALLOWED_USER_ID`: el número desde el que escribirás al bot, en formato internacional solo con dígitos, sin `+`, espacios ni guiones. No se autoriza automáticamente al primer remitente.

El usuario dueño se resuelve con `WHATSAPP_OWNER_TELEGRAM_USER_ID`; si no se configura, se reutiliza `TELEGRAM_ADMIN_USER_ID` y después `TELEGRAM_ALLOWED_USER_ID`. Por tanto, el usuario de Telegram debe existir primero en D1.

La versión de Graph API se controla con la variable pública `WHATSAPP_API_VERSION` (actualmente `v26.0` en `wrangler.jsonc`). No pongas tokens, secretos ni números autorizados en `wrangler.jsonc`.

## Configuración en Meta

En el caso de uso **Conectar en WhatsApp → Paso 2. Configuración de producción → Configurar Webhooks**:

1. Pega la URL anterior en **URL de devolución de llamada**.
2. Escribe el mismo valor configurado como `WHATSAPP_WEBHOOK_VERIFY_TOKEN` en **Identificador de verificación**.
3. Pulsa **Verificar y guardar**.

La ruta responde al reto `hub.challenge` de Meta mediante `GET`. Las notificaciones `POST` requieren la firma `X-Hub-Signature-256`, calculada con `WHATSAPP_APP_SECRET`; el contenido del mensaje no se escribe en los logs. Los mensajes entrantes se deduplican por `wamid`, se filtran por el `PHONE_NUMBER_ID` configurado y solo se procesan para el remitente permitido.

En este corte se procesan mensajes de texto y se responden con texto reutilizando el asistente existente. Los botones de Telegram se presentan como texto, y los recordatorios programados siguen entregándose por Telegram hasta implementar un canal de notificaciones WhatsApp con plantillas y acciones equivalentes.

## Prueba manual

1. Rota el token que fue expuesto en las capturas y guarda el nuevo valor con `wrangler secret put`.
2. Configura los cinco secrets anteriores en el entorno que ejecuta el Worker.
3. Aplica la migración D1 y despliega el Worker.
4. Escribe desde el número autorizado al número de empresa: `Hola` o `/help`.
5. Comprueba que llega una respuesta de texto. No uses el botón **Test** de Meta como prueba de conversación: ese botón envía el mensaje de prueba de la cuenta y no representa al remitente autorizado.

Las respuestas dentro de la ventana de atención iniciada por el cliente son la ruta de prueba de este corte. Los mensajes iniciados por la empresa fuera de esa ventana requieren una plantilla aprobada y la configuración de facturación correspondiente.

## Fuentes oficiales

- [Meta: Webhooks de WhatsApp Business Platform](https://www.postman.com/meta/whatsapp-business-platform/folder/lboq68h/webhooks)
- [Meta: colección oficial de WhatsApp Cloud API](https://www.postman.com/meta/whatsapp-business-platform/documentation/wlk6lh4/whatsapp-cloud-api)
