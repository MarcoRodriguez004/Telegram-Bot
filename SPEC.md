# Spec: Bot personal de Telegram

## Objetivo

Construir un bot de Telegram de un solo usuario que convierta mensajes naturales en acciones personales persistentes:

- `gasto 450 gasolina` registra un gasto en MXN.
- `recuérdame pagar internet mañana` crea un recordatorio y lo envía cuando venza.
- `guardar este link https://...` guarda un enlace.
- `tarea comprar medicina` crea una tarea pendiente.

El bot debe aceptar únicamente mensajes del usuario configurado y nunca debe permitir que el modelo ejecute herramientas arbitrarias.

## Alcance del MVP

Incluye long polling de Telegram, SQLite local, zona horaria configurable, recordatorios persistentes, parser local de respaldo y clasificación opcional mediante OpenAI Structured Outputs. No incluye panel web, grupos, pagos, scraping de enlaces, sincronización externa ni despliegue.

## Stack

- Python 3.11+
- `python-telegram-bot[job-queue]` 22.8
- SQLite mediante `sqlite3`
- Pydantic 2 para validar intenciones
- OpenAI SDK opcional para clasificación estructurada

## Comandos

```text
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
Copy-Item .env.example .env
.venv\Scripts\python -m app
```

Pruebas:

```text
python -m unittest discover -s tests -v
```

## Estructura

```text
app/
  __main__.py        Entrada del proceso y handlers de Telegram
  config.py           Configuración validada desde variables de entorno
  database.py         Esquema y operaciones SQLite parametrizadas
  intents.py          Contrato de intención y parser local
  classifier.py       Clasificador OpenAI opcional con fallback local
  service.py          Ejecución de acciones y formato de respuestas
tests/
  test_intents.py     Pruebas unitarias del parser y validaciones
  test_database.py    Pruebas de persistencia aisladas en SQLite temporal
```

## Contrato de intención

La única unión entre clasificación y ejecución es `Intent`:

```python
Intent(
    action="expense | reminder | link | task | unknown",
    amount_cents=45000,
    currency="MXN",
    title="gasolina",
    url=None,
    due_at=None,
)
```

El ejecutor acepta solo las acciones del enum y valida campos obligatorios por acción. Las fechas sin hora usan las 09:00 de `APP_TIMEZONE` del día indicado.

## Privacidad y seguridad

- `TELEGRAM_ALLOWED_USER_ID` es obligatorio; usuarios no autorizados reciben una respuesta genérica o son ignorados.
- Tokens y API keys viven exclusivamente en variables de entorno.
- Los mensajes se limitan a 4,000 caracteres antes de clasificarse.
- La salida del modelo se valida con Pydantic y nunca se interpreta como SQL, código ni comando.
- Las consultas SQLite son parametrizadas.
- El bot no descarga URLs guardadas, evitando SSRF.
- `/borrar_datos CONFIRMAR` permite eliminar los datos del usuario.

## Estrategia de pruebas

- Unitarias para cantidades, fechas, URLs, acciones desconocidas y autorización de configuración.
- Integración con SQLite en memoria para guardar y recuperar cada recurso.
- Sin llamadas de red en la suite; la integración con OpenAI queda detrás de un adaptador inyectable.

## Límites

- Siempre: validar entradas, probar cambios y no registrar secretos ni texto completo de mensajes.
- Pedir aprobación antes: añadir servicios externos o cambiar el modelo de datos de forma incompatible.
- Nunca: ejecutar salida del modelo, aceptar usuarios por defecto, guardar `.env` o registrar tokens.

## Criterios de éxito

1. El proyecto instala y arranca sin OpenAI configurado usando el parser local.
2. Los cuatro ejemplos del objetivo producen y persisten la acción correcta.
3. Un usuario distinto al configurado no puede crear ni consultar datos.
4. Un recordatorio pendiente sobrevive al reinicio y puede programarse de nuevo.
5. Las pruebas unitarias e integración pasan sin red.

## Decisiones abiertas

- Para producción convendrá migrar de long polling a webhook solo si se despliega en una plataforma con HTTPS estable.
- El modelo y su coste quedan configurables mediante `OPENAI_MODEL`; el valor inicial será `gpt-5-mini`.
