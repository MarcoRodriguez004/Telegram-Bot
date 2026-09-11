# Plan: avisos persistentes de tareas y recordatorios

Este plan es específico para la funcionalidad de avisos persistentes. El archivo `tasks/plan.md` existente se conserva porque contiene trabajo histórico/incompleto de otro alcance.

## Incrementos verticales

1. **Contrato y persistencia**
   - Añadir la migración de preferencias globales y configuración por elemento.
   - Añadir repositorio compartido para intervalos permitidos, activación, desactivación y configuración global.
   - Cubrir validación, aislamiento por usuario y estados por pruebas de integración con SQLite.

2. **Creación y parser**
   - Aceptar fecha/hora opcional en tareas.
   - Mostrar el teclado de intervalo después de crear tareas o recordatorios.
   - Guardar la selección del usuario y calcular el primer aviso.

3. **Configuración y callbacks**
   - Crear `/configuracion` con alcance tareas, recordatorios o ambos.
   - Añadir configuración individual desde el detalle.
   - Cambiar los botones de aviso a `Parar avisos de esta tarea/recordatorio`, `Completar` y `Cancelar`.

4. **Scheduler unificado**
   - Procesar tareas y recordatorios vencidos cada minuto.
   - Usar concesiones condicionales y reintentos seguros ante fallos de Telegram.
   - Desactivar avisos al completar o cancelar.

5. **Verificación y entrega**
   - Ejecutar pruebas enfocadas después de cada incremento.
   - Ejecutar suite completa, typecheck, lint y build.
   - Hacer revisión final de seguridad, migración y cambios fuera de alcance.

## Riesgos controlados

- **Duplicados por cron concurrente:** concesión temporal por aviso y actualización condicional.
- **Avisos de registros ya terminados:** consultas del scheduler filtran estado pendiente y cancelación.
- **Aplicación global inesperada:** la operación solo actualiza pendientes y futuros; conserva el historial.
- **Regresión del flujo actual:** el primer incremento no cambia el parser ni la entrega; cada cambio posterior conserva pruebas previas.

## Hecho cuando

Los criterios de aceptación de `docs/SPEC-PERSISTENT-ALERTS.md` están cubiertos por pruebas y pasan las comprobaciones del repositorio.
