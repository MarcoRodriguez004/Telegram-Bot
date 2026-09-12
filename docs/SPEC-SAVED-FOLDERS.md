# Especificación: carpetas y datos personales en guardados

**Estado:** implementada y desplegada en `Dev` y `main`
**Módulo:** `saved-folders`
**Base actual:** guardados en `notes`, adjuntos referenciados por `file_id` de Telegram y migraciones hasta `0011_pending_folder_saves.sql`.

## Objetivo

Organizar notas, enlaces, fotos y documentos guardados en colecciones controladas, sin romper `mis guardados` ni los comandos `/guardado_<id>`. El usuario debe poder escribir, por ejemplo, `Guarda este INE en datos personales`, y después navegar sus imágenes o archivos por carpeta.

El alcance es organización y filtrado en D1. No convierte Telegram en almacenamiento privado, no cifra archivos y no elimina copias que ya existan en el chat.

## Alcance funcional

### Carpetas V1

Las carpetas son creadas y nombradas por cada usuario. No habrá un catálogo fijo de nombres ni carpetas globales compartidas. Cada carpeta pertenece a un solo usuario y puede contener notas, enlaces, fotos y documentos al mismo tiempo.

`Sin carpeta` será una categoría virtual para guardados antiguos o guardados que todavía no tengan carpeta; no será una fila editable de `saved_folders`.

Los nombres se normalizarán para evitar duplicados por mayúsculas, espacios repetidos o diferencias Unicode. La vista conservará el nombre que el usuario eligió. V1 no permite compartir carpetas entre usuarios ni crear carpetas anidadas.

### Guardar y clasificar

- El usuario puede crear una carpeta con `crea la carpeta Trabajo`. También puede indicar una carpeta al guardar usando `Guarda este INE en Documentos personales`; si la carpeta no existe, el bot la crea automáticamente porque el usuario la indicó explícitamente y guarda el elemento en ella.
- Si el nombre indicado no existe pero alcanza una similitud de al menos 70% con una carpeta del mismo usuario, el bot no crea nada automáticamente: muestra el nombre solicitado junto al existente y ofrece `Usar` la existente o `Crear` la nueva. En fotos y documentos la operación queda pendiente durante 15 minutos para no perder el archivo mientras se decide.
- La carpeta es opcional. Si no se indica, el elemento queda en `Sin carpeta`, conservando el comportamiento actual de `Guarda`.
- El nombre de la carpeta debe aparecer explícitamente en el mensaje. No se clasificará automáticamente por palabras como `INE`, `factura` o `trabajo`.
- Una carpeta desconocida solo se crea cuando aparece explícitamente en una instrucción de guardado; las consultas no crean carpetas por una posible errata.
- La misma carpeta puede contener notas, enlaces, fotos y documentos. Para fotos y documentos se conserva el flujo actual: se guarda la referencia de Telegram, no se descarga el archivo.
- La IA, si está habilitada, podrá proponer únicamente un nombre de carpeta acotado por longitud; el Worker vuelve a validarlo y solo la crea cuando forma parte de una instrucción explícita para guardar.

### Navegación

- `mis carpetas` muestra las carpetas separadas en tres bloques: `Imágenes`, `Archivos` y `Enlaces y notas`. Una carpeta aparece en cada bloque donde tenga elementos; no se duplica ni se divide físicamente.
- `mis imágenes`, `mis archivos` y `mis enlaces` muestran primero el bloque de carpetas correspondiente; después de elegir una carpeta, la selección lista solo ese tipo y esa carpeta. `Sin carpeta` aparece cuando tiene elementos.
- Las listas de imágenes se numeran (`1.-`, `2.-`, etc.) y ofrecen botones compactos en cuadrícula para abrir cada foto; el callback vuelve a validar la propiedad del guardado.
- `mis guardados` y `/guardados` conservan compatibilidad y muestran los elementos sin carpeta y los organizados, pero la navegación por bloques permite elegir una carpeta explícita.
- `Renombra la carpeta X a Y` cambia el nombre si no existe otra carpeta normalizada igual del mismo usuario.
- `Elimina la carpeta X` requiere confirmación; no elimina sus guardados y los pasa a `Sin carpeta`.
- `Mueve el guardado 123 a la carpeta Y` cambia la clasificación del guardado; `Sin carpeta` quita la clasificación.
- `Mis carpetas` muestra las carpetas sin elementos en un bloque separado `Carpetas vacías`; no se mezclan con los bloques de contenido.
- La paginación mantiene el orden actual por `notes.id DESC`, el límite de diez elementos y el comportamiento de continuación sin duplicar elementos.
- Abrir un elemento continúa usando `/guardado_<id>` o `ver guardado <id>`. La consulta siempre incluye el usuario autenticado y la carpeta seleccionada cuando corresponda.
- Los callbacks de carpetas y paginación deben validar usuario, chat, formato, propiedad del elemento y existencia de la carpeta antes de leer o mutar D1.

### Retención y borrado

- V1 no aplica expiración automática. Los metadatos permanecen hasta `/borrar_datos CONFIRMAR`.
- El borrado elimina notas, colecciones, sesiones y contexto del usuario, pero conserva `processed_updates`, igual que hoy.
- El borrado de D1 no elimina mensajes ni archivos almacenados en Telegram. Esta limitación debe mostrarse en la documentación y no debe presentarse como eliminación segura del archivo remoto.

## Modelo de datos propuesto

La migración será aditiva y se llamará `0009_saved_folders.sql`:

```sql
CREATE TABLE saved_folders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (user_id, normalized_name)
);
```

La tabla `notes` añadirá `folder_id` nullable, con índice por usuario, carpeta y fecha. La migración debe:

1. Dejar los guardados existentes con `folder_id = NULL`, que representa `Sin carpeta`.
2. No crear carpetas predeterminadas para usuarios existentes ni nuevos.
3. Mantener las restricciones actuales de `file_kind` y `file_id`.
4. Resolver la pertenencia de la carpeta al usuario en cada consulta y escritura; la FK por sí sola no autoriza una carpeta de otro usuario.

La migración mantiene `folder_id` nullable: `NULL` representa `Sin carpeta` y las filas nuevas solo reciben una carpeta cuando el usuario la selecciona. No se reconstruye `notes`; el cambio es aditivo y se prueba con las migraciones locales completas.

## Contratos y estructura

- `src/router/intent.ts`: añadir crear/listar carpetas y extender `save_note` y `list_notes` con un nombre de carpeta validable.
- `src/router/parser.ts`: reconocer creación de carpetas, el sufijo explícito de carpeta y las consultas por tipo/carpeta.
- `src/modules/notes/repository.ts`: crear, listar y consultar carpetas, además de guardar y consultar notas por carpeta mediante SQL parametrizado.
- `src/modules/notes/media.ts`: reutilizar el parser de captions y guardar la carpeta resuelta.
- `src/telegram/keyboards.ts`: añadir teclados de bloques/carpetas y callbacks con formato validable.
- `src/modules/conversation/repository.ts`: conservar el tipo y la carpeta al paginar una consulta de guardados.
- `src/modules/privacy/repository.ts`: borrar carpetas dentro del mismo flujo de privacidad.
- `tests/`: añadir pruebas de parser, repositorio, callbacks, autorización, paginación, migración y borrado.

Ejemplo de contrato cerrado:

```ts
type Intent =
  | { action: "create_folder"; name: string }
  | { action: "list_folders"; kind?: "all" | "photos" | "documents" | "links" }
  | { action: "save_note"; content: string; url?: string; folderName?: string }
  | { action: "list_notes"; beforeId?: number; kind?: "all" | "photos" | "documents" | "links"; folderName?: string };
```

Se conservarán los patrones existentes: uniones discriminadas para `Intent`, nombres en inglés en código, mensajes al usuario en español, funciones pequeñas y consultas D1 con `bind()`.

## Comandos de verificación

```powershell
npm run db:migrate:local
npm test
npm run lint
npm run typecheck
npm run build
```

No se ejecutará una migración remota hasta que la migración local, las pruebas de privacidad y el smoke test del flujo de Telegram pasen.

## Estrategia de pruebas

- Parser: creación de carpetas, nombres con espacios, carpeta ausente, extracción correcta del título y rechazo de entradas ambiguas.
- Repositorio: creación de carpetas por usuario, deduplicación normalizada, filtros por usuario/tipo/carpeta, orden y paginación.
- Webhook: guardar una foto, documento, nota o enlace en una carpeta, mostrar bloques y recuperar el elemento correcto.
- Seguridad: otro usuario no puede listar, abrir ni mutar carpetas o elementos mediante comandos o callbacks.
- Similitud: una coincidencia de carpeta de 70% o más solicita una decisión y no mezcla operaciones entre usuarios o chats.
- Privacidad: `/borrar_datos CONFIRMAR` elimina notas y carpetas, conserva `processed_updates` y permite crear carpetas nuevas después.
- Regresión: mantener todos los casos actuales de `mis guardados`, `/guardado_<id>`, imágenes, documentos, enlaces y contexto temporal.

## Límites

- **Siempre:** normalizar y limitar nombres; filtrar cada consulta por `user_id`; usar SQL parametrizado; mantener `file_id` sin descargarlo; probar localmente antes de producción.
- **Pedir aprobación antes:** cambiar retención; permitir carpetas anidadas, compartir carpetas o renombrado automático; implementar borrado de mensajes de Telegram; reconstruir tablas en producción; añadir dependencias o cambiar CI.
- **Nunca:** usar nombres de carpeta como autorización; permitir acceso cruzado; confiar en un nombre enviado por el cliente o por la IA sin validación; prometer cifrado o borrado remoto.

## Criterios de aceptación

- [x] Un guardado sin carpeta sigue funcionando y queda en `Sin carpeta`.
- [x] `Guarda este INE en Documentos personales` crea la carpeta si no existe y guarda el elemento en ella.
- [x] Un nombre de carpeta con similitud de 70% o más muestra comparación y permite reutilizar o crear; fotos y documentos conservan la operación pendiente mientras se decide.
- [x] Un usuario puede crear y listar carpetas con nombres arbitrarios dentro de los límites.
- [x] `mis carpetas` muestra bloques de imágenes, archivos y enlaces/notas.
- [x] `mis imágenes`, `mis archivos` y `mis enlaces` muestran carpetas antes de listar elementos.
- [x] La selección de una carpeta muestra únicamente los elementos de ese tipo y usuario.
- [x] La paginación por carpeta no repite ni pierde elementos cuando llegan guardados nuevos.
- [x] Se pueden renombrar y eliminar carpetas; eliminar conserva los guardados en `Sin carpeta`.
- [x] Se pueden mover guardados entre carpetas o a `Sin carpeta` con autorización por usuario.
- [x] Las carpetas vacías aparecen en un bloque separado.
- [x] Las consultas y callbacks no permiten acceso cruzado entre usuarios.
- [x] El borrado de datos elimina las colecciones y sus guardados de D1, pero conserva el anti-replay.
- [x] Pasan tests, lint, typecheck, build y auditoría de dependencias sin degradar los quality gates existentes.

## Decisiones aprobadas

1. Las carpetas son definidas por cada usuario y pueden contener cualquier tipo de guardado.
2. La lista de carpetas se presenta en bloques de imágenes, archivos y enlaces/notas.
3. `Sin carpeta` es una categoría virtual para elementos no clasificados.
4. No se aplica retención automática; los datos permanecen hasta el borrado explícito.
