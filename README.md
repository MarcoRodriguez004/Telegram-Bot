# Personal Assistant Bot

Asistente personal modular para Telegram: tareas, recordatorios, gastos y enlaces desde un único chat.

## Documento principal

Lee [docs/PLAN.md](docs/PLAN.md) para entender qué se construirá, cómo funcionará, las fases, el modelo de datos, la seguridad y el despliegue.

Para publicar el bot en una cuenta real, sigue [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

Las decisiones arquitectónicas están registradas en [ADR-001](docs/decisions/001-cloudflare-workers-d1.md).

## Estado

Ya existen capacidades funcionales en TypeScript para tareas, recordatorios, gastos, notas/enlaces, `/resumen` y `/borrar_datos CONFIRMAR`. El Worker guarda la acción en D1 y confirma la creación; un Cron Trigger revisa cada minuto los recordatorios vencidos y los envía a Telegram. También incluye `/health`, webhook autenticado, allowlist, deduplicación de `update_id`, migración D1 inicial, pruebas Vitest y quality gate local/CI. El prototipo Python se conserva como referencia durante la migración.

El lenguaje natural amplio todavía no está implementado; el parser actual es deliberadamente determinista y conservador.

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

Comandos de calidad:

```powershell
npm run lint
npm run typecheck
npm test
npm run build
npm audit --audit-level=high
```
