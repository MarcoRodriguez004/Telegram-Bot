# Implementation Plan: Bot personal de Telegram

## Overview

MVP local, privado y orientado a un solo usuario. Telegram recibe el mensaje, un clasificador produce una intención estructurada, el servicio valida y persiste la acción en SQLite, y JobQueue entrega los recordatorios pendientes.

## Architecture Decisions

- Python + `python-telegram-bot`: reduce la infraestructura para un bot personal y permite long polling y JobQueue.
- SQLite: suficiente para un usuario, persistente y sin servidor adicional.
- OpenAI opcional: mejora la comprensión del lenguaje natural, pero el parser local mantiene un camino funcional sin API key.
- Contrato `Intent` cerrado: el modelo solo selecciona una acción y datos; el backend conserva toda la autoridad.
- Long polling para el MVP: no exige dominio ni certificado. Webhook queda como evolución de despliegue.

## Task List

### Phase 1: Foundation

- [ ] Task 1: Definir configuración, contrato de intención y parser local.
- [ ] Task 2: Persistir gastos, recordatorios, enlaces y tareas en SQLite.

### Checkpoint: Foundation

- [ ] Las pruebas unitarias y de SQLite pasan.
- [ ] Los cuatro mensajes de ejemplo se convierten en intenciones válidas.

### Phase 2: Core Features

- [ ] Task 3: Ejecutar intenciones y formatear respuestas.
- [ ] Task 4: Conectar Telegram, autorización de usuario y recordatorios programados.

### Checkpoint: Core Features

- [ ] La aplicación arranca sin OpenAI.
- [ ] Un mensaje autorizado crea un registro y un mensaje no autorizado no cambia la base.
- [ ] Los recordatorios pendientes se reprograman al reiniciar.

### Phase 3: AI and Polish

- [ ] Task 5: Añadir clasificador OpenAI estructurado con fallback local.
- [ ] Task 6: Añadir documentación de instalación, `.env.example`, borrado de datos y endurecimiento final.

### Checkpoint: Complete

- [ ] Suite completa pasa sin red.
- [ ] No hay secretos en el repositorio.
- [ ] README permite configurar y ejecutar el bot.

## Dependency Graph

```text
config + Intent + parser local
          │
          ├── SQLite repository
          │        │
          │        └── action service
          │                 │
          └── OpenAI classifier ── Telegram handlers + JobQueue
```

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| El modelo devuelve datos inválidos | Alto | Structured Outputs + Pydantic + fallback local |
| Mensajes duplicados de Telegram | Medio | Persistir `update_id` procesado antes de ejecutar |
| Recordatorio perdido tras reinicio | Alto | Persistir `due_at` y reprogramar pendientes al arrancar |
| Usuario ajeno accede al bot | Alto | Comparar `from_user.id` contra variable obligatoria |
| URL maliciosa | Medio | Guardar texto/URL; no hacer fetch en el MVP |

## Open Questions

- Configurar el modelo OpenAI, la moneda y zona horaria mediante `.env` permite cambiar estas decisiones sin alterar el código.
