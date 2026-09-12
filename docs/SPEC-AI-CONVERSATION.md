# Especificación: interpretación conversacional asistida por IA

**Estado:** capacidades iniciales y memoria conversacional acotada implementadas
**Ramas:** `feature/ai-conversation` y `feature/conversation-memory`
**Base de la memoria:** `Dev`

## Objetivo

Permitir que el usuario escriba mensajes normales, sin conocer la sintaxis de comandos de Telegram, y que el bot interprete esos mensajes para ejecutar las capacidades que ya existen: tareas, recordatorios, gastos, notas/enlaces, guardados y resúmenes.

La IA no tendrá acceso directo a D1, Telegram ni a herramientas arbitrarias. Solo devolverá una intención estructurada y el Worker decidirá si los datos son válidos y ejecutará la operación mediante los repositorios existentes.

## Capacidad inicial propuesta

| Capacidad | Entrada | Resultado | En esta rama |
|---|---|---|---|
| Crear tarea | “Recuérdame comprar leche” o “anota comprar leche” | Inserta tarea y confirma | Sí |
| Crear recordatorio | “Avísame mañana a las 9 pagar la luz” | Inserta recordatorio o pide el dato faltante | Sí |
| Registrar gasto | “Gasté 450 en carro por el radiador” | Inserta gasto con monto, categoría y descripción | Sí |
| Guardar nota/enlace | Texto o URL con intención de guardar | Guarda el contenido | Sí |
| Consultar | “¿Qué tengo pendiente?”, “mis guardados”, “resumen de esta semana” | Ejecuta la consulta existente | Sí |
| Conversación de ayuda | “¿Qué puedes hacer?” | Respuesta breve con capacidades reales | Sí |
| Consultar imágenes guardadas | “Mis fotos”, “muéstrame las imágenes guardadas” | Lista solo fotos almacenadas | Sí |
| Memoria de varios turnos | “muestramelas” después de “mis fotos”, o responder “450” después de pedir un gasto | Mantener contexto de guardados y un borrador incompleto por usuario/chat durante 15 minutos | Sí, con alcance acotado |
| Acciones destructivas | Borrar datos | Solo flujo determinista con confirmación exacta | No se delega a la IA |

La primera versión no permitirá que el modelo invente consultas, ejecute SQL, descargue enlaces, envíe mensajes a terceros ni realice acciones fuera de este catálogo.

Las frases de seguimiento de guardados, como «muestramelas» o «muestra más» después de «mis fotos», se resuelven usando contexto temporal por usuario y chat. Cuando falta un dato obligatorio para crear una tarea, recordatorio o gasto, el bot guarda solo la solicitud incompleta y el campo faltante durante 15 minutos; la siguiente respuesta se combina, valida y ejecuta mediante el parser existente. No se guarda un historial completo de la conversación.

## Flujo de decisión

1. El webhook autentica al usuario y conserva la idempotencia actual.
2. El parser determinista se ejecuta primero. Esto mantiene compatibilidad con los comandos y evita coste de API cuando una regla es suficiente.
3. Si el parser no reconoce el texto, el adaptador de OpenAI solicita una única intención mediante Responses API y Structured Outputs.
4. El Worker valida el JSON contra un esquema cerrado y contra las reglas de negocio (monto obligatorio, fechas válidas, límites y autorización).
5. Solo después de validar se llama al repositorio existente.
6. Si falta información, el bot pregunta exactamente por el dato faltante; no inserta registros incompletos.
7. Si OpenAI está deshabilitado, falla, supera el timeout o devuelve una intención inválida, el bot conserva el comportamiento actual y ofrece ejemplos de mensajes admitidos.

## Contrato de intención

El adaptador producirá un objeto equivalente a:

```ts
type AiIntent =
  | { action: "create_task"; title: string }
  | { action: "create_reminder"; text: string; dueAt?: string }
  | { action: "create_expense"; amount?: number; currency?: string; category?: string; description?: string }
  | { action: "save_note"; content: string; title?: string }
  | { action: "list_saved"; page?: number }
  | { action: "list_tasks" }
  | { action: "list_reminders" }
  | { action: "summary"; range?: "today" | "week" | "month" }
  | { action: "reply"; message: string }
  | { action: "clarify"; question: string; missing: string[] };
```

El código no confiará en que el modelo respete tipos: validará enums, longitudes, cantidades, fechas y campos obligatorios antes de ejecutar. Los campos que no correspondan a la acción se ignorarán o provocarán rechazo, nunca una operación distinta.

## Configuración y privacidad

- `OPENAI_API_KEY` será un secret de Cloudflare, nunca una variable versionada ni parte del mensaje de Telegram.
- `OPENAI_MODEL` será una variable configurable para poder cambiar coste/capacidad sin modificar el código.
- La IA se podrá desactivar si falta la clave; las funciones deterministas seguirán funcionando.
- El Worker no registrará el texto completo del usuario, la clave, prompts ni respuestas completas del modelo.
- Los mensajes enviados a OpenAI salen de Cloudflare y están sujetos a la cuenta, facturación y política de retención de OpenAI. Esto es distinto de la suscripción o sesión de la aplicación ChatGPT.
- Se establecerá timeout, manejo de errores y límite de tamaño para impedir que una caída de OpenAI bloquee el webhook.

## Pruebas de aceptación

- Un texto natural reconocido por las reglas no llama a OpenAI.
- Un texto no reconocido llama a OpenAI una sola vez y ejecuta solo una intención permitida.
- Una respuesta con JSON inválido, acción desconocida o campos incompatibles no cambia D1.
- Un gasto sin monto solicita el monto y no inserta un gasto.
- Un recordatorio sin fecha/hora suficiente solicita la información faltante o usa únicamente la regla de fecha ya definida; nunca adivina silenciosamente.
- Una tarea, recordatorio o gasto incompleto continúa cuando el usuario responde el dato faltante en el mismo chat y dentro de 15 minutos.
- El borrador no se comparte entre chats, expira y se elimina con `/borrar_datos CONFIRMAR` o `/borrar_bd`.
- Si falta `OPENAI_API_KEY`, el bot responde con ayuda y no falla el webhook.
- Un intento de borrar datos mediante texto natural no omite la confirmación determinista.
- El token no aparece en logs ni respuestas de error.
- Se conservan las pruebas actuales y todas pasan antes de abrir el PR.

## Entrega y ramas

La rama `feature/ai-conversation` implementó el adaptador de interpretación y su integración con el router. La memoria temporal conserva consultas de guardados y un único borrador incompleto de tarea, recordatorio o gasto por usuario durante 15 minutos; no almacena un historial completo y se elimina con los datos del usuario.

El flujo de entrega será: `feature/ai-conversation` → PR a `Dev` → PR de `Dev` a `main`, con los checks de CI obligatorios y sin hacer push directo a ramas protegidas.

## Fuentes técnicas

- [Responses API: crear una respuesta](https://developers.openai.com/api/reference/cli/resources/responses/methods/create)
- [Responses API y Structured Outputs](https://developers.openai.com/api/reference/cli/resources/beta/subresources/responses)
- [Guía oficial de modelos actuales](https://developers.openai.com/api/docs/guides/latest-model)
