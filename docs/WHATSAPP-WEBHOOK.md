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
```

- `WHATSAPP_WEBHOOK_VERIFY_TOKEN`: una frase aleatoria que también se escribirá en el campo **Identificador de verificación** de Meta.
- `WHATSAPP_APP_SECRET`: el secreto de la aplicación que se consulta en Meta Developers → **Configuración de la aplicación** → **Básica** → **Clave secreta de la aplicación**. Nunca se comparte en capturas ni mensajes.

## Configuración en Meta

En el caso de uso **Conectar en WhatsApp → Paso 2. Configuración de producción → Configurar Webhooks**:

1. Pega la URL anterior en **URL de devolución de llamada**.
2. Escribe el mismo valor configurado como `WHATSAPP_WEBHOOK_VERIFY_TOKEN` en **Identificador de verificación**.
3. Pulsa **Verificar y guardar**.

La ruta responde al reto `hub.challenge` de Meta mediante `GET`. Las notificaciones `POST` requieren la firma `X-Hub-Signature-256`, calculada con `WHATSAPP_APP_SECRET`; el contenido del mensaje no se escribe en los logs.

Esta primera entrega confirma y recibe notificaciones de Meta. El procesamiento conversacional y el envío de respuestas por WhatsApp se añadirán en un incremento posterior, después de validar que la suscripción funciona.

## Fuentes oficiales

- [Meta: Webhooks de WhatsApp Business Platform](https://www.postman.com/meta/whatsapp-business-platform/folder/lboq68h/webhooks)
- [Meta: colección oficial de WhatsApp Cloud API](https://www.postman.com/meta/whatsapp-business-platform/documentation/wlk6lh4/whatsapp-cloud-api)
