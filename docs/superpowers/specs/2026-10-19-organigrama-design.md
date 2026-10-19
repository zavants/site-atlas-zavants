# Site Atlas — Diseño v2: organigrama

**Estado:** borrador para aprobación · **Fecha:** 2026-10-19 · **Amplía:** `2026-10-19-site-atlas-design.md` (v1). Todo lo de la v1 sigue vigente salvo lo que este documento cambia de forma explícita.
**Referencia visual e interactiva:** `docs/superpowers/prototypes/organigrama-v11.html`, prototipo desechable validado con el usuario. Para abrirlo se reemplaza `__DATA__` por el JSON de un mapa.

---

## 1. Intención

La v1 muestra el sitio como columnas de bloques. Sirve para ordenar, pero no responde las preguntas que el usuario tiene al revisar una página:

- ¿Esta sección conviene moverla a otra página o mantenerla?
- ¿A dónde apunta esta sección y qué la apunta a ella?
- ¿Qué pasa si muevo la sección A a la página B y la enlazo con X?
- ¿Qué secciones repiten lo mismo?

La v2 convierte el lienzo en un **organigrama**: cada página es un diagrama armado con piezas (sus secciones, como un lego), y **cada enlace es una línea que sale de la pieza exacta que lo contiene**. Muestra lo que una persona no ve recorriendo la página: hilos, destinos rotos y repeticiones.

Todo lo que el usuario cambia en el organigrama es un **plan**. Cualquier IA (Claude, Codex, GPT u otra) puede leerlo e implementarlo. **Ningún cambio se da por hecho hasta que una IA confirma que lo aplicó en el sitio.**

## 2. Objetivos, no objetivos y anti-objetivos

**Objetivos v2**

1. Vista **Diagrama**: páginas como diagramas de piezas con contenido, líneas por enlace y componentes compartidos aparte.
2. Vista **Capturas**: el mismo organigrama con cada pieza mostrada como su captura ampliada.
3. Edición directa:
   - arrastrar piezas en vivo, dentro de una página o a otra;
   - mover diagramas;
   - redirigir flechas imantándolas a un destino;
   - crear y eliminar conectores;
   - crear y eliminar páginas planificadas.
4. Historial: Deshacer, Rehacer y Restablecer.
5. **Plan legible por cualquier IA**, con estados *pendiente* y *aplicado*, que se lee y se confirma por MCP y por terminal.

**No objetivos v2**

- Detección automática de redundancia temática entre secciones (la matriz "tema × sección" de las maquetas). Queda para una versión posterior; el organigrama ya deja ver las repeticiones a simple vista.
- Editar el contenido de las secciones (textos, imágenes).
- Aplicar cambios al sitio. Eso lo hace una IA o una persona en el código.
- Historial de Deshacer persistente entre sesiones del navegador.

**Anti-objetivos**

- **Que Site Atlas escriba cualquier archivo dentro del repositorio del sitio escaneado.** Todo vive en la carpeta de datos de Atlas (`~/.site-atlas` o `SITE_ATLAS_HOME`).
- Que un cambio pase a "aplicado" sin que una IA o persona lo confirme.
- Que mirar el diagrama de una página se vuelva ilegible por hilos de componentes compartidos.
- Que el arrastre se sienta torpe: pieza despegada del cursor, hueco que no la sigue o selección de texto mientras se arrastra.

## 3. Conceptos nuevos

| Concepto | Qué es |
|---|---|
| **Diagrama** | Un nodo del organigrama. Puede ser una página real, una página planificada, un **destino** (ruta que no existe o sitio externo) o un **componente**. |
| **Pieza** | La representación de un bloque (v1) dentro de un diagrama. |
| **Componente compartido** | Un bloque global de la v1 (header, footer) con nombre: "Header 1", "Footer 1"… Las variantes distintas por huella se numeran "Header 2", y así. |
| **Línea** | Un enlace de una pieza hacia otra pieza (ancla) o hacia un diagrama (página o destino). |
| **Edición de enlace** | Cambio del destino de un enlace existente. |
| **Conector nuevo** | Un enlace que no existe en el sitio y que el usuario agrega. |
| **Cambio** | Cada diferencia entre el sitio real y lo planificado. Tiene un id estable y un estado. |
| **Estado de un cambio** | `pendiente` (por defecto, siempre) o `aplicado` (solo tras confirmación). Aparte, se muestra si el último escaneo ya refleja el cambio. |

## 4. Vista Diagrama

**Diagramas**
- **Páginas reales** del escaneo, más las planificadas.
- **Destinos automáticos:** un diagrama por cada ruta interna enlazada que no existe (en `missingPages` o con un enlace roto), con la etiqueta NO EXISTE, y uno por cada origen externo enlazado, con la etiqueta EXTERNO.
- Cada página muestra cuántas piezas tiene. Las páginas planificadas llevan la etiqueta PLANIFICADA y una × para eliminarlas (con confirmación; sus piezas vuelven a su página real).

**Piezas**
- **Cabecera:** número de orden, nombre, contadores (enlaces ↗n, medios ▣n) y alertas ⚠n.
- **Fondo según tipo:** narrativa, visual o conversión.
- **Detalle desplegable con un clic:** miniatura, tipo y alto, títulos, cada enlace con su destino efectivo (marcado "cambiado" si se editó), formularios y alertas.
- **Selector de tipo y etiquetas** de la v1, dentro del detalle.

**Componentes compartidos**
- En el diagrama de una página aparecen como pieza con la etiqueta COMPONENTE y **sin líneas**.
- El selector **Mostrar** ofrece "Páginas" (todos los diagramas de página) y un diagrama propio por componente. En la vista de un componente, el componente queda a la izquierda con sus líneas; las piezas a las que apunta se resaltan y el resto se atenúa. Su título indica qué páginas lo usan.

**Líneas**
- **Salida:** desde el borde derecho de la pieza exacta.
- **Llegada:** al borde más cercano de la pieza o diagrama destino; si el destino está en la misma columna, la línea hace un arco por la derecha.
- **Colores:**

| Color | Significa |
|---|---|
| Azul | A otra sección |
| Rojo | A una página que no existe |
| Gris | A un sitio externo |
| Verde punteado | Enlace editado |
| Violeta punteado | Conector nuevo |

- La casilla **"Mostrar enlaces dentro de la página (#anclas)"** oculta o muestra las líneas entre secciones de una misma página.
- Cada línea termina en un **círculo** arrastrable (§6).

**Funciones de la v1 que se conservan dentro del organigrama:** filtro y edición de etiquetas, interruptor Real / Planificado (en Real no se edita), marcar sección para eliminar (zona "Eliminar" como diagrama especial), huérfanos con Asignar o Descartar, re-escaneo y actualización en vivo por SSE.

## 5. Vista Capturas

- Selector **Vista: Diagrama | Capturas**. Los cambios hechos en una vista se ven en la otra.
- En Capturas, cada pieza muestra su miniatura a todo el ancho del diagrama, con solo el número y el nombre superpuestos arriba a la izquierda. Se ocultan contadores, alertas, etiquetas, detalle y el ＋.
- Los diagramas se ensanchan (página 480 px, destinos 300 px) y se separan horizontalmente ×1,6 respecto de su posición en Diagrama, para no superponerse. La posición guardada es una sola; el factor se aplica al mostrar.
- Al entrar, el zoom se ajusta al ancho del contenido y la vista arranca arriba.
- Arrastre, líneas, conectores e historial funcionan igual que en Diagrama.

## 6. Interacciones

**Lienzo**
- Fondo punteado.
- **Desplazarse:** rueda arriba o abajo; Shift + rueda a los lados; también arrastrando el fondo.
- **Zoom:** Ctrl + rueda, hacia el cursor, de 20 % a 250 %.
- **Barra inferior derecha:** −, porcentaje, +, 100 %, Ajustar (todo el contenido) y Centrar.
- **Barra superior izquierda:** Deshacer (Ctrl+Z), Rehacer (Ctrl+Y o Ctrl+Shift+Z), Restablecer (pide confirmar "¿Estás seguro de deshacer todos los cambios?") y "+ Nueva página".
- **Cambios planificados:** panel contraído por defecto, con el número de cambios en el título.
- No se selecciona texto al arrastrar; el detalle desplegado sí se puede seleccionar.

**Arrastrar piezas** (arrastre propio, no el nativo del navegador ni SortableJS)
- Empieza tras 5 px de movimiento; un clic sin movimiento despliega el detalle.
- La pieza flota **dentro del lienzo, con el zoom aplicado**, pegada al punto donde se tomó.
- Un **hueco** del mismo alto ocupa su lugar y se mueve en vivo. Las demás piezas se deslizan con una animación corta (FLIP, unos 160 ms).
- El índice de destino se calcula con la **posición final de las piezas** (`offsetTop`), no con la animada.
- El diagrama receptor es el que está bajo el cursor (`elementFromPoint`); se marca con borde azul punteado.
- Los componentes no se arrastran entre páginas.

**Mover diagramas**
- Se arrastran por el título. Al pasar el cursor por el título, y mientras se mueven, el borde se **ilumina** (azul con halo) y el diagrama queda por encima.
- Las páginas nuevas aparecen cerca del centro de la vista, en un hueco libre.

**Flechas y conectores**
- **Redirigir:** se arrastra el círculo final de una línea. Si queda a menos de 70 px de una pieza o diagrama válido, el destino se ilumina y la línea se imanta; al soltar se guarda la edición de enlace.
- **Crear:** se arrastra desde el punto ＋ violeta que aparece al pasar sobre una pieza (en el diagrama de página, todas salvo componentes; en el de un componente, el componente).
- **Eliminar un conector nuevo:** un clic sin arrastre en su círculo, con confirmación.
- Al eliminar una página planificada se eliminan los conectores y ediciones que apuntaban a ella.

**Crear página**
- Diálogo con **Ruta** (se normaliza: `/` inicial, minúsculas, sin `/` final ni dobles) y **Título** (opcional; si falta, se usa la ruta).
- Rechaza rutas vacías o repetidas con un mensaje en el diálogo.

**Historial**
- Cada operación es un paso: mover pieza, mover diagrama, editar o crear enlace, crear o eliminar página y conector, Restablecer.
- Vive en memoria del navegador. Restablecer vuelve al estado de la capa del usuario guardada al abrir el lienzo, no a la v1 sin cambios.

## 7. Datos (capa del usuario, `overlay.json`)

Se agregan campos con `schemaVersion: 2`; la migración desde la v1 los inicializa vacíos.

- `layout`: `{ [diagramId]: { x, y } }`, posición de cada diagrama (en coordenadas de la vista Diagrama).
- `componentNames`: `{ [huella]: "Header 1" }`, editable.
- `linkEdits`: `{ [linkId]: Target }`. `linkId` = `<blockKey>|<href original>|<texto>`, estable entre escaneos; el índice no se usa.
- `addedLinks`: `[{ id, from: blockKey, to: Target, label? }]`.
- `confirmations`: `{ [changeId]: { at, by, note } }`.
- `Target` = `{ block: blockKey } | { page: ruta o URL }`.

La conciliación de la v1 se extiende: las claves de bloque dentro de `linkEdits`, `addedLinks` y como destino también se renombran o quedan huérfanas con las mismas reglas.

## 8. El plan legible por cualquier IA

### 8.1 Cambios

El plan se **deriva** del estado (escaneo + capa del usuario), como `atlas_get_plan` en la v1, ampliado con estos tipos:

| Tipo | Significa |
|---|---|
| `newPage` | Crear una página planificada |
| `move` | Mover una sección a otra página |
| `reorder` | Reordenar secciones dentro de una página |
| `delete` | Eliminar una sección |
| `relink` | Cambiar el destino de un enlace existente |
| `addLink` | Agregar un enlace nuevo en una sección |

Cada cambio tiene:

- `id`: hash estable de su contenido (tipo + claves + destino). Si el usuario modifica ese cambio, cambia el id y el cambio vuelve a pendiente.
- `status`: `pending` | `applied`. Es `applied` solo si `confirmations[id]` existe.
- `observed`: `true` | `false` | `null`. Indica si el último escaneo ya refleja el cambio (por ejemplo, la sección ya está en la página destino). Es solo informativo: **nunca cambia `status`**.
- `summary`: una línea en español, por ejemplo `Mover "Tecnología" de / a /es/soluciones/brokers`.
- `details`: datos exactos para implementar:
  - página y sección de origen (nombre, `blockKey`, título, ancla, extracto de texto);
  - destino (página, posición, sección vecina antes y después);
  - para enlaces: texto del enlace, `href` actual y nuevo `href` sugerido (`/ruta#ancla` si el destino tiene ancla);
  - alertas que el cambio resuelve (por ejemplo, el enlace roto a `/es/soluciones/brokers`).
- `doneWhen`: criterio verificable en lenguaje claro, por ejemplo "La página /es/soluciones/brokers contiene la sección 'Tecnología' y / ya no la contiene."

Un cambio aplicado sigue en el plan mientras exista la diferencia en el estado. Desaparece cuando el escaneo muestra el sitio igual que el plan; su confirmación queda en `confirmations` como historial.

### 8.2 Cómo lo leen las IAs (sin escribir en el repo del sitio)

**MCP**
- `atlas_get_plan { site, status? }` devuelve el texto en Markdown más el JSON con los campos del §8.1.
- **Nueva:** `atlas_confirm_change { site, changeId, note }` marca el cambio como aplicado. Exige `note`: qué se hizo y dónde (archivo, commit). Devuelve el plan actualizado.
- **Nueva:** `atlas_reopen_change { site, changeId, note }` vuelve un cambio a pendiente.

**Las IAs también proponen cambios** (decidido por el usuario). Además de las herramientas de la v1 (`atlas_move_block`, `atlas_add_planned_page`, etiquetas), el MCP agrega:
- `atlas_relink { site, blockKey, linkText, linkHref, to }`: redirige un enlace existente.
- `atlas_add_link { site, blockKey, to, label? }`: agrega un conector.
- `atlas_remove_link { site, linkId }`: quita un conector agregado o una edición de enlace.
- `atlas_remove_planned_page { site, path }`: elimina una página planificada; sus piezas vuelven a su página real.
- `atlas_mark_deleted { site, blockKey }` y `atlas_restore { site, blockKey }`.

Son las mismas operaciones que usa el lienzo, por la misma capa de servicio y con el mismo bloqueo. Los agentes no envían `rev`; validan el destino y responden con error legible si no existe. Todo cambio propuesto por una IA queda **pendiente**, igual que los del usuario. Cada edición guarda quién la hizo (`by`: `lienzo` o el nombre del cliente MCP o de la terminal), y el panel de cambios lo muestra.

**Terminal**, para IAs sin MCP pero con acceso a la terminal:
- `site-atlas plan <site> [--json] [--status pending|applied]` imprime el plan en stdout.
- `site-atlas confirm <site> <changeId> --note "<texto>"`.
- `site-atlas reopen <site> <changeId> --note "<texto>"`.
- Equivalentes para proponer: `site-atlas move`, `site-atlas page add|remove`, `site-atlas relink`, `site-atlas link add|remove`, `site-atlas delete|restore`, con las mismas entradas que el MCP.

**Formato del texto (Markdown):**
1. un encabezado con el sitio y el escaneo;
2. un párrafo fijo de **instrucciones para la IA**: implementar en el código del sitio, verificar, y solo entonces confirmar con `atlas_confirm_change` o `site-atlas confirm`; nunca confirmar sin haber aplicado el cambio;
3. la lista de cambios, cada uno con id, estado, resumen, detalles y criterio de hecho.

**Esquema JSON documentado** en `docs/plan-schema.md` del repo de Site Atlas (no del sitio), con un ejemplo completo. El JSON lleva `schemaVersion`.

**El texto del sitio** dentro del plan (nombres, títulos, extractos) va marcado como contenido no confiable, como en la v1.

### 8.3 En el lienzo

El panel "Cambios planificados" lista cada cambio con su estado. Los aplicados llevan una marca y quién los confirmó; los observados en el sitio llevan un indicador. El usuario no confirma desde el lienzo; solo ve el estado.

## 9. Restricciones

- Igual que la v1: todo local, servidor en `127.0.0.1`, sin telemetría, sin `v-html`.
- **Ninguna escritura fuera de la carpeta de datos de Atlas.** Esto se prueba (§10).
- Rendimiento del arrastre: hasta 60 piezas por página y 20 diagramas visibles sin tirones perceptibles. Las líneas se redibujan como máximo una vez por cuadro (`requestAnimationFrame`).
- Cada mutación pasa por la capa de servicio de la v1, con su bloqueo y control de `rev`.

## 10. Criterio de éxito

1. Con SCAP Beta 1, el organigrama muestra el Home con 15 piezas.
   - **Pestaña Páginas:** 4 líneas propias (2 del Hero, 1 a `/es/soluciones/brokers` en rojo, 1 a scapbroker.com en gris) y los destinos NO EXISTE y EXTERNO.
   - **Pestaña Header 1:** sus 7 líneas.
2. Las interacciones del §6 se comportan como en el prototipo v11. En particular, arrastrar "La plataforma" hasta entre "Soluciones" y "Tecnología para brokers" avanza el hueco una posición por vez, sin oscilar, y la deja exactamente ahí, con zoom distinto de 100 %.
3. Tras mover una sección, redirigir un enlace y agregar un conector:
   - `atlas_get_plan` y `site-atlas plan` devuelven esos cambios como `pending`, con `details` y `doneWhen`;
   - `atlas_confirm_change` los pasa a `applied`;
   - un re-escaneo no los vuelve pendientes ni los confirma solo.
4. Una prueba recorre un flujo completo (escanear, planificar y confirmar) y comprueba que el árbol de archivos del sitio escaneado no cambió.
5. Un agente sin MCP, solo con terminal, puede leer el plan e implementar un cambio guiado únicamente por `site-atlas plan`. Se verifica con Codex u otro agente sobre una copia de SCAP Beta 1.

## 10b. Reglas precisas (decididas por Claude tras la revisión)

**Historial (Deshacer, Rehacer y Restablecer)**
- Cada paso guarda una foto solo de los campos de plan de la capa: `plannedOrder`, `plannedPages`, `plannedDeletions`, `layout`, `linkEdits`, `addedLinks`.
- Deshacer o Rehacer envía una operación `replacePlanFields` con el `rev` actual. Nunca toca `confirmations`, `tags`, `blockTags`, `kindOverrides`, `componentNames` ni huérfanos.
- Si llega un aviso SSE de que otro cliente escribió (una IA, otra pestaña, un re-escaneo), el lienzo recarga el mapa, **vacía el historial** y muestra "El mapa cambió desde otro lugar; el historial se reinició". Restablecer usa la foto tomada en ese momento.

**Identidad de los cambios** (el id no incluye posiciones exactas)

| Tipo | Contenido del id |
|---|---|
| `newPage` | ruta |
| `move` | `blockKey` + página destino. La posición va en `details`, no en el id. |
| `reorder` | un cambio **por sección desplazada** (fuera de la subsecuencia creciente más larga): `blockKey` + página + clave de la sección que queda inmediatamente antes (o "inicio") |
| `delete` | `blockKey` |
| `relink` | `linkId` + identidad del destino (`blockKey` o ruta/URL). Si la sección destino se mueve, el id no cambia; el `href` sugerido sí se actualiza. |
| `addLink` | `blockKey` origen + identidad del destino |

**Enlaces tras re-escanear**
- **`relink`:** está *observado* si la sección de origen tiene algún enlace cuyo destino resuelto coincide con el destino planificado (misma página y, si el destino es una sección, su ancla). El texto no importa. Cuando se observa, la conciliación **retira** la edición de `linkEdits`: el cambio desaparece del plan y su confirmación queda como historial. Si no se observa y el `linkId` ya no existe, la edición pasa a huérfanos, como un bloque.
- **`addLink`:** misma regla, por destino resuelto desde el bloque de origen.

**Componentes compartidos**
- Todo `header`, `footer`, `[role=banner]` y `[role=contentinfo]` de primer nivel es componente **aunque aparezca en una sola página**. Además, los bloques globales de la v1 (huella repetida en dos o más páginas) también son componentes. Las piezas de la v1 con `global: true` se mantienen.
- **Identidad:** `componentId` = `c:` + huella del primer escaneo en que apareció. En escaneos siguientes se concilia con las reglas de §5.5 de la v1 (huella igual o similitud ≥ 0,8), así que `componentNames` sobrevive a cambios de texto.
- Las ediciones y conectores de un componente se guardan bajo su `componentId` y **valen para todas las páginas que lo usan**. El plan lo dice explícitamente: "Header 1 (usado en: /, /otra)".

## 11. Decisiones de cómo se construye (propuestas por Claude, a confirmar)

- El organigrama reemplaza al tablero de columnas como vista del lienzo y conserva sus funciones (§4).
- Arrastre propio en vez de SortableJS / `vue-draggable-plus`: es la única forma que respetó el zoom en el prototipo. La dependencia se quita.
- Líneas en un único SVG superpuesto, en coordenadas del lienzo sin zoom.
- `linkId` por href + texto, no por índice, para que sobreviva a re-escaneos.
- Ids de cambio derivados del contenido, sin registro de eventos: Deshacer, Rehacer y Restablecer siguen siendo simples, y la confirmación se ata al cambio exacto.

## 12. Lo que queda al constructor

- Distribución automática inicial de los diagramas cuando no hay `layout` guardado.
- Paleta exacta y detalles visuales finos (guía: el prototipo v11).
- Formato exacto del Markdown del plan, respetando el orden del §8.2.
- Cómo se muestran muchas páginas (más de 20): agrupación o minimapa, si hace falta.
