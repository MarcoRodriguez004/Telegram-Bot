# ADR-001: Cloudflare Workers + D1 para el asistente personal

## Status

Accepted — 2026-09-07

## Context

El proyecto debe empezar como una herramienta personal, pero permitir añadir tareas, recordatorios, gastos, notas e integraciones sin quedar atrapado en un bot monolítico. El despliegue debe ser automático, barato y no requerir un servidor encendido permanentemente.

## Decision

Usaremos un único Worker TypeScript, Cloudflare D1 y Telegram Bot API mediante webhook. Las capacidades vivirán en módulos dentro del mismo repositorio. Los recordatorios se procesarán con un Cron Trigger y timestamps UTC.

## Alternatives considered

### Python + proceso con long polling

Es una buena opción local y el prototipo inicial se construyó así. Se descarta como arquitectura objetivo porque requiere un proceso vivo y añade una diferencia entre desarrollo y despliegue serverless.

### Render u otro servidor con polling

Es válido y sencillo, pero un proceso que hace polling permanentemente añade operación y puede dormir o reiniciarse en planes gratuitos. El webhook en Workers encaja mejor con el flujo de Telegram.

### n8n

Puede acelerar integraciones, pero no debe ser el núcleo: introduce estado y lógica fuera del repositorio, complica pruebas y hace más difícil controlar autorizaciones. Se podrá añadir más adelante como integración puntual si existe un caso claro.

### Microservicios

No se justifican para un solo usuario. Multiplicar servicios antes de conocer el dominio aumenta latencia, despliegues y superficies de seguridad.

### Base externa desde el inicio

PostgreSQL, Turso o Supabase serían opciones razonables al crecer. D1 cubre la escala inicial y elimina un servicio adicional. La capa de repositorios deja abierta una migración futura.

## Consequences

### Positivas

- Despliegue serverless y webhook HTTPS.
- D1 ofrece SQL, migraciones y binding nativo al Worker.
- Un monorepo mantiene los módulos cercanos y las pruebas simples.
- Cron Trigger cubre recordatorios sin un servidor dedicado.

### Negativas

- D1 no es SQLite local idéntico en todos los detalles operativos; se deben probar migraciones con Wrangler.
- El Cron Trigger corre en UTC y puede tardar unos minutos en propagar cambios.
- El envío a Telegram y la escritura D1 no comparten una transacción; los recordatorios son at-least-once.
- Cloudflare se vuelve una dependencia de plataforma; se mitiga manteniendo lógica de dominio independiente de bindings.

## Revisit when

- Aparecen varios usuarios con necesidades de aislamiento o alta concurrencia.
- Las búsquedas requieren full-text search o analítica compleja.
- La entrega de recordatorios exige garantías más fuertes que at-least-once.
- El coste, los límites o la portabilidad justifican una base externa.
