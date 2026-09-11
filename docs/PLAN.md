# Personal Assistant Bot

## Resumen ejecutivo

Construiremos un asistente personal modular en Telegram, versionado desde el primer día y desplegado automáticamente en Cloudflare.

La primera versión resolverá cuatro casos:

| Escribes | El sistema hace |
|---|---|
| `tarea comprar detergente` | Crea una tarea pendiente |
| `recuérdame pagar internet mañana` | Programa un recordatorio |
| `gasto 450 gasolina` | Registra un gasto de $450 MXN |
| `guardar este link https://...` | Guarda una nota con URL |

También habrá `/start`, `/help`, `/resumen` y `/borrar_datos CONFIRMAR`. Los comandos son una red de seguridad; la experiencia principal será escribir de forma natural.

## Qué estamos construyendo

```text
Tú
 │ mensaje
 ▼
Telegram Bot API
 │ webhook HTTPS
 ▼
Cloudflare Worker
 │ autentica, deduplica, interpreta y ejecuta
 ▼
Cloudflare D1
 │ tareas, recordatorios, gastos, notas y auditoría mínima
 ▼
Telegram
 │ confirmación o recordatorio
```

Un Cron Trigger de Cloudflare revisará cada minuto los recordatorios vencidos. Los timestamps se almacenarán en UTC y la zona horaria del usuario será configurable, inicialmente `America/Mexico_City`.

## Decisión arquitectónica

### Sí: un monorepo modular

Un solo Worker y una sola base de datos, separados por módulos internos:

```text
src/
├── index.ts                 # fetch + scheduled handlers
├── config/                  # Env y validación
├── telegram/                # webhook, API y respuestas
├── router/                  # texto → Intent
├── modules/
│   ├── tasks/
│   ├── reminders/
│   ├── expenses/
│   ├── notes/
│   └── privacy/
├── db/                      # repositorios y queries D1
└── shared/                  # tipos, fechas, errores
db/migrations/
docs/decisions/
tests/
```

Esto permite agregar `shopping/`, `calendar/` o `jobs/` sin crear servicios que haya que desplegar, monitorear y asegurar por separado.

### No al inicio: microservicios, n8n o un agente con permisos

Añadirían puntos de fallo y coste antes de conocer el dominio. Un LLM tampoco debe tener acceso directo a D1 ni a Telegram: solo puede proponer una intención validable.

## Cómo procesaremos un mensaje

1. Telegram envía un `Update` a `/telegram/webhook`.
2. El Worker verifica el secret del webhook, que el chat sea privado y que el usuario esté permitido.
3. Se reclama el `update_id`; si ya fue procesado, se responde `200` sin repetir la acción.
4. Se intenta interpretar con reglas deterministas.
5. Si no hay coincidencia, V1 responde con ejemplos; en una fase posterior se puede llamar a un LLM.
6. El resultado se valida contra un `Intent` cerrado.
7. El módulo correspondiente guarda la acción en D1.
8. Se envía una confirmación breve a Telegram.

La autoridad siempre pertenece al código. El intérprete no puede crear tablas, ejecutar SQL, hacer requests arbitrarios ni enviar mensajes por sí mismo.

## Experiencia inicial

### Tareas

`/tarea comprar detergente` crea una tarea pendiente.

`comprar detergente mañana` será una variante natural posterior del parser.

Respuesta:

```text
✅ Tarea creada
Comprar detergente
```

### Gastos

`/gasto 450 gasolina` y `gasté 350 en Costco` registran gastos.

Respuesta:

```text
💰 Gasto registrado
$450 MXN · Gasolina
Fecha: 7 septiembre
```

El importe se guardará como entero en centavos, nunca como `float`.

### Recordatorios

`/recordar pagar internet mañana a las 18:00` crea un recordatorio.

También se aceptan `mañana`, `hoy`, `en 30 minutos` y `en 2 horas`. Las fechas más ambiguas como “el viernes” siguen pendientes.

Si falta una hora, se usa 09:00 en la zona horaria configurada. El valor se guarda en UTC. Si faltan datos esenciales o la hora ya pasó, el bot pregunta o rechaza la entrada en lugar de adivinar.

### Enlaces y notas

`guardar este link para leer luego: https://ejemplo.com` guarda la URL y el contexto. V1 no abrirá ni descargará la página automáticamente.

### Resumen

`/resumen` mostrará tareas pendientes, próximos recordatorios y totales de gastos del período.

### Privacidad y borrado

`/borrar_datos CONFIRMAR` elimina las tareas, recordatorios, gastos, notas y el perfil del usuario en una operación transaccional de D1. La confirmación es sensible a mayúsculas y no se acepta una variante ambigua. `processed_updates` se conserva para que un update antiguo de Telegram no pueda ejecutarse de nuevo y recrear datos.

## Modelo de datos inicial

Todas las tablas tendrán `user_id`, aunque inicialmente exista una sola persona. Eso evita rediseñar todo si el bot se comparte después.

```text
users:              id, telegram_user_id, telegram_chat_id, timezone, currency, created_at
tasks:              id, user_id, title, status, due_at, created_at, completed_at
reminders:          id, user_id, title, remind_at, status, processing_until, sent_at, created_at
expenses:           id, user_id, amount_cents, currency, category, description, occurred_at, created_at
notes:              id, user_id, content, url, created_at
processed_updates:  update_id, telegram_user_id, processed_at
```

Índices iniciales: `reminders(status, remind_at)`, `expenses(user_id, occurred_at)`, `tasks(user_id, status)` y `processed_updates(update_id)`.

## Recordatorios y consistencia

El Cron Trigger corre en UTC. Cada ejecución busca recordatorios vencidos y los reclama con un cambio de estado atómico antes de enviar. Tras el envío exitoso marca `sent_at`.

No prometeremos `exactly once`: Telegram es una API externa y un fallo entre enviar y marcar puede producir un duplicado. Priorizamos no perder un recordatorio y guardaremos estado suficiente para diagnosticar y reintentar los que fallen.

## Seguridad desde el primer commit

- Secret de Telegram validado en header.
- Chat privado y usuario real de Telegram; los grupos y bots se rechazan.
- Aislamiento de datos por `telegram_user_id` para soportar múltiples usuarios.
- Tokens solo en Cloudflare secrets; nunca en Git.
- Mensajes con límite de longitud.
- SQL con bindings, nunca interpolación de texto.
- Sin descarga automática de URLs.
- Errores externos resumidos en Telegram y detalles solo en logs controlados.
- Logs sin texto completo de mensajes, URLs privadas ni tokens.
- Borrado explícito de los datos del usuario.
- El borrado no recrea al usuario y no elimina el registro anti-replay de `processed_updates`.

## Despliegue

### Local

```powershell
npm install
npm run db:migrate:local
npm run dev
npm run lint
npm run typecheck
npm test
npm run build
```

`wrangler dev` ejecutará D1 local para probar el Worker sin tocar producción. El archivo `.dev.vars` contiene secretos locales y no se versiona; `.dev.vars.example` documenta sus nombres.

### Producción

1. Crear el Worker y la base D1 con Wrangler.
2. Aplicar migraciones localmente y luego en remoto.
3. Guardar `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` y `TELEGRAM_ADMIN_USER_ID` como secrets.
4. Conectar el repositorio de GitHub a Workers Builds.
5. Ejecutar `setWebhook` apuntando a `https://<worker>.workers.dev/telegram/webhook` con el secret.
6. Usar `main` como rama de producción; PRs pasan CI antes de merge.

El procedimiento ejecutable, incluyendo smoke test y rollback, está en [docs/DEPLOYMENT.md](DEPLOYMENT.md). El despliegue real no se puede completar desde el repositorio sin acceso a la cuenta de Cloudflare, el `database_id` remoto y el token del bot.

Workers Builds es preferible a guardar un API token de Cloudflare en GitHub para este proyecto personal. Si luego necesitamos un pipeline especializado, podemos migrar el deploy a GitHub Actions.

## Fases de entrega

### Fase 1 — Core desplegable

Worker, webhook, autenticación, D1, migraciones, `/start`, `/help`, CI y deploy.

### Fase 2 — Productividad

Tareas, recordatorios, Cron Trigger, confirmaciones y reintentos.

### Fase 3 — Memoria personal

Gastos, enlaces/notas, `/resumen` y borrado de datos.

### Fase 4 — Lenguaje natural

Más fechas y variantes de español con reglas; después LLM opcional y medido.

### Fase 5 — Integraciones

Calendario, compras, Gmail u otras capacidades, cada una como módulo con permisos explícitos.

## Qué significa terminado para V1

- El Worker está desplegado y el webhook responde.
- Cualquier usuario real puede usarlo en un chat privado.
- Cada usuario solo puede consultar y modificar sus propios datos.
- Los cuatro casos de la tabla inicial funcionan y tienen pruebas.
- Reiniciar o desplegar no elimina datos ni recordatorios.
- Una actualización repetida no duplica una acción.
- CI bloquea merge si falla typecheck, tests o build.
- CI bloquea merge si falla lint, typecheck, tests, auditoría de dependencias o build.
- No hay secretos en el repositorio.

## Coste y límites actuales

No se aplican límites de mensajes ni de uso de IA en la aplicación. El Worker revisa el tamaño real de D1 cada minuto y, al alcanzar 150 MB, avisa a los usuarios registrados que contacten al programador y envía al administrador un desglose lógico estimado por usuario. Es un umbral de alerta global de la base, no una cuota individual por usuario. La estimación no pretende igualar el tamaño físico: índices, páginas SQLite, migraciones, registros técnicos y espacio libre pueden quedar sin atribuir. La infraestructura puede mantenerse dentro del plan gratuito para un bot personal, pero no debe venderse como un límite permanente. La documentación actual de Cloudflare D1 indica que Workers Free incluye 5 millones de filas leídas por día, 100,000 filas escritas por día y 5 GB de almacenamiento total; el límite de tamaño de una base individual es 500 MB. Los límites se reinician diariamente en UTC. La primera fase no usa LLM, así que no añade coste por inferencia. Si activamos OpenAI después, habrá coste variable y una decisión explícita de privacidad.

## Fuentes verificadas

- [Cloudflare Workers: guía inicial](https://developers.cloudflare.com/workers/get-started/guide/)
- [Cloudflare D1: inicio y bindings](https://developers.cloudflare.com/d1/get-started/)
- [Cloudflare D1: límites](https://developers.cloudflare.com/d1/platform/limits/)
- [Cloudflare D1: precios y cuotas](https://developers.cloudflare.com/d1/platform/pricing/)
- [Cloudflare D1: API de base de datos y `batch()` transaccional](https://developers.cloudflare.com/d1/worker-api/d1-database/)
- [Cloudflare Workers: Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)
- [Cloudflare Workers: CI/CD](https://developers.cloudflare.com/workers/ci-cd/)
- [Cloudflare Workers Builds: configuración](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)
- [Cloudflare Workers: secretos](https://developers.cloudflare.com/workers/configuration/secrets/)
- [Telegram Bot API: webhooks y `secret_token`](https://core.telegram.org/bots/api#setwebhook)

## Próximo paso

La Fase 2 ya cubre tareas y recordatorios: parser determinista, persistencia UTC, Cron Trigger cada minuto, lease de procesamiento, reintento cuando Telegram falla y pruebas locales. La Fase 3 ya registra gastos, guarda enlaces/notas, genera `/resumen` para hoy, semana o mes y permite borrar los datos explícitamente. El siguiente incremento es el despliegue real con Workers Builds y webhook de producción.
