# Work items

- [ ] Task 1: Configuración, contrato `Intent` y parser local.
  - Acceptance: los ejemplos de gasto, recordatorio, enlace y tarea generan intenciones tipadas; entradas inválidas resultan en `unknown`.
  - Verify: `python -m unittest tests.test_intents -v`.
  - Files: `app/config.py`, `app/intents.py`, `tests/test_intents.py`.

- [ ] Task 2: Persistencia SQLite.
  - Acceptance: cada recurso se guarda con parámetros y se puede consultar; recordatorios pendientes sobreviven a una nueva conexión.
  - Verify: `python -m unittest tests.test_database -v`.
  - Files: `app/database.py`, `tests/test_database.py`.

## Checkpoint: Foundation

- [ ] Tasks 1 y 2 pasan sin red.

- [ ] Task 3: Ejecución de intenciones.
  - Acceptance: el servicio persiste exactamente la acción validada y devuelve una confirmación en español.
  - Verify: `python -m unittest discover -s tests -v`.
  - Files: `app/service.py`, `tests/test_service.py`.

- [ ] Task 4: Telegram, autorización y recordatorios.
  - Acceptance: solo el usuario configurado puede ejecutar comandos; los recordatorios vencidos se envían y marcan como enviados.
  - Verify: pruebas de handlers sin red y revisión estática de límites.
  - Files: `app/__main__.py`, `tests/test_handlers.py`.

## Checkpoint: Core

- [ ] La app importa y arranca sin `OPENAI_API_KEY`.

- [ ] Task 5: Clasificador OpenAI opcional.
  - Acceptance: con key usa Structured Outputs; ante error usa parser local sin revelar detalles internos.
  - Verify: test con adaptador falso y `python -m unittest discover -s tests -v`.
  - Files: `app/classifier.py`, `tests/test_classifier.py`.

- [ ] Task 6: Documentación y endurecimiento.
  - Acceptance: `.env.example`, `.gitignore` y README explican instalación, configuración y borrado de datos; ningún secreto está versionado.
  - Verify: prueba completa y `git diff --check`.
  - Files: `README.md`, `.env.example`, `.gitignore`.

## Checkpoint: Complete

- [ ] Todos los tests pasan.
- [ ] El diff no contiene secretos.
