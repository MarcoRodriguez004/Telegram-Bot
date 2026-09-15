const LEGAL_HEADERS = {
  "cache-control": "public, max-age=3600",
  "content-security-policy": "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
  "content-type": "text/html; charset=utf-8",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
};

const CONTACT_EMAIL = "marco.rh004@gmail.com";

export function getPrivacyPolicyResponse(): Response {
  return legalPageResponse(`
    <h1>Política de privacidad</h1>
    <p><strong>Personal Assistant Bot</strong> es un asistente personal que puede operar a través de Telegram y WhatsApp.</p>
    <p>Última actualización: 15 de septiembre de 2026.</p>

    <h2>1. Datos que podemos procesar</h2>
    <ul>
      <li>Identificadores de cuenta y chat de Telegram o WhatsApp, necesarios para asociar tus conversaciones con tu cuenta.</li>
      <li>El contenido de los mensajes que envías al asistente.</li>
      <li>La información que solicitas guardar, como tareas, recordatorios, gastos, notas, enlaces y preferencias.</li>
      <li>Referencias técnicas de archivos o imágenes que envías para poder gestionarlos.</li>
    </ul>

    <h2>2. Para qué usamos los datos</h2>
    <p>Usamos estos datos para responder tus mensajes, guardar y recuperar la información que solicites, ejecutar recordatorios y mantener la seguridad y el funcionamiento del servicio.</p>

    <h2>3. Servicios externos</h2>
    <p>El bot utiliza servicios de terceros para funcionar:</p>
    <ul>
      <li><strong>Meta y WhatsApp Cloud API:</strong> entrega y recepción de mensajes de WhatsApp.</li>
      <li><strong>Telegram:</strong> entrega y recepción de mensajes y, cuando corresponde, archivos.</li>
      <li><strong>OpenAI:</strong> generación de respuestas cuando esta función está habilitada.</li>
    </ul>
    <p>Cada servicio puede procesar datos conforme a sus propias políticas de privacidad. No vendemos tus datos ni los usamos para publicidad dirigida.</p>

    <h2>4. Conservación</h2>
    <p>Conservamos los datos guardados mientras sean necesarios para prestar el servicio o hasta que solicites su eliminación. Algunos estados temporales de conversación expiran automáticamente. Los mensajes y archivos que permanezcan en Telegram, WhatsApp u otros servicios externos están sujetos también a las políticas de esos servicios.</p>

    <h2>5. Eliminación de datos</h2>
    <p>Para eliminar los datos asociados a tu cuenta, escribe exactamente:</p>
    <p><code>/borrar_datos CONFIRMAR</code></p>
    <p>El bot elimina los registros asociados de su base de datos, incluidos tareas, recordatorios, gastos, notas, carpetas, preferencias, vehículos y contexto de conversaciones. Esta acción no elimina automáticamente mensajes o archivos que Telegram, WhatsApp u otro proveedor conserve en sus propios sistemas.</p>
    <p>También puedes escribir a <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a> para solicitar ayuda con una eliminación.</p>

    <h2>6. Seguridad</h2>
    <p>El servicio usa conexiones HTTPS, mantiene las credenciales fuera del código público y valida las notificaciones recibidas desde los proveedores. Ningún sistema conectado a Internet puede garantizar seguridad absoluta.</p>

    <h2>7. Cambios y contacto</h2>
    <p>Podemos actualizar esta política cuando cambien las funciones o los servicios utilizados. Para preguntas sobre privacidad, contacta a <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>.</p>
  `);
}

export function getDataDeletionResponse(): Response {
  return legalPageResponse(`
    <h1>Eliminación de datos</h1>
    <p>Esta página explica cómo solicitar la eliminación de los datos guardados por <strong>Personal Assistant Bot</strong>.</p>

    <h2>Cómo solicitarla</h2>
    <p>Desde el chat autorizado del bot, escribe exactamente:</p>
    <p><code>/borrar_datos CONFIRMAR</code></p>
    <p>El bot confirmará la eliminación cuando termine.</p>

    <h2>Qué se elimina</h2>
    <p>Se eliminan los registros asociados a tu cuenta en la base de datos del bot: tareas, recordatorios, gastos, notas, enlaces, carpetas, preferencias, vehículos y estados o historial de conversación guardados.</p>

    <h2>Qué puede permanecer fuera del bot</h2>
    <p>La eliminación del bot no borra automáticamente copias, mensajes o archivos que estén almacenados por Telegram, WhatsApp, OpenAI u otros proveedores. Para esos datos debes usar los controles de privacidad del proveedor correspondiente.</p>

    <h2>Si no puedes acceder al chat</h2>
    <p>Escribe a <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a> indicando que deseas eliminar tus datos. Podremos solicitar información suficiente para verificar la solicitud antes de ejecutarla.</p>
  `);
}

function legalPageResponse(content: string): Response {
  const html = `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Personal Assistant Bot</title>
</head>
<body>
  <main>
    ${content}
  </main>
</body>
</html>`;

  return new Response(html, { headers: LEGAL_HEADERS });
}
