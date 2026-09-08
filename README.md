# Personal Assistant Bot

Asistente personal modular para Telegram: tareas, recordatorios, gastos y enlaces desde un único chat.

## Documento principal

Lee [docs/PLAN.md](docs/PLAN.md) para entender qué se construirá, cómo funcionará, las fases, el modelo de datos, la seguridad y el despliegue.

Las decisiones arquitectónicas están registradas en [ADR-001](docs/decisions/001-cloudflare-workers-d1.md).

## Estado

Ya existe una primera capacidad funcional en TypeScript: el Worker recibe `tarea comprar medicina`, crea la tarea en D1 y confirma la acción. También incluye `/health`, webhook autenticado, allowlist de Telegram, deduplicación de `update_id`, migración D1 inicial, pruebas Vitest y quality gate local/CI. El prototipo Python se conserva como referencia durante la migración.

Los recordatorios, gastos, notas y lenguaje natural todavía no están implementados; el parser actual es deliberadamente determinista y conservador.

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

Debe responder `200` con `{"ok":true,"service":"personal-assistant-bot"}`. La creación de tareas se prueba automáticamente con `npm test`; para probarla desde Telegram necesitaremos desplegar el Worker y registrar el webhook. Completa `.dev.vars` con el token del bot, el secret del webhook y tu `TELEGRAM_ALLOWED_USER_ID` cuando lleguemos a esa fase.

Comandos de calidad:

```powershell
npm run lint
npm run typecheck
npm test
npm run build
npm audit --audit-level=high
```
