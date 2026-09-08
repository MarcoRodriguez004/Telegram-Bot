# Personal Assistant Bot

Asistente personal modular para Telegram: tareas, recordatorios, gastos y enlaces desde un único chat.

## Documento principal

Lee [docs/PLAN.md](docs/PLAN.md) para entender qué se construirá, cómo funcionará, las fases, el modelo de datos, la seguridad y el despliegue.

Las decisiones arquitectónicas están registradas en [ADR-001](docs/decisions/001-cloudflare-workers-d1.md).

## Estado

El repositorio tiene un prototipo inicial en Python. La arquitectura objetivo aprobada en el plan es TypeScript + Cloudflare Workers + D1 + webhook de Telegram. La migración aún no se ha ejecutado.

## Siguiente paso

Construir la Fase 0: Worker TypeScript, Wrangler, D1 local, `/health`, Vitest y CI.
