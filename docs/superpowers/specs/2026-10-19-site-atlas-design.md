# Site Atlas — Diseño v1

**Estado:** borrador para aprobación · **Fecha:** 2026-10-19 · **Repo:** `zavants/site-atlas-zavants` (privado)

---

## 1. Intención

Ver un sitio web **por bloques** en una sola pantalla y organizarlo con las manos. Hoy, para entender la estructura de una página (qué secciones tiene, en qué orden, qué hay dentro de cada una, qué está roto o es provisional), hay que leer el código o dibujarla a mano en draw.io. Site Atlas genera ese mapa solo, a partir del sitio renderizado, y lo muestra en un lienzo donde los bloques se arrastran, se reordenan y se etiquetan.

Sirve para cualquier sitio: el primero es el de SCAP Tech (prototipo Beta 1 del Home), pero la herramienta no depende de él.

Es **compatible con MCP desde el día 1**: cualquier agente (Claude Code, Codex, Antigravity…) puede escanear un sitio, leer el mapa, leer lo que el equipo organizó en el lienzo y modificarlo. El mismo dato alimenta la pantalla y las herramientas MCP.

## 2. Objetivos, no objetivos y anti-objetivos

**Objetivos v1**

1. Escanear un sitio (localhost, staging o producción) y obtener sus páginas divididas en bloques con nombre, tipo, componentes, miniatura y alertas.
2. Lienzo con arrastrar y soltar: reordenar bloques dentro de una página y moverlos entre páginas, incluidas páginas planificadas que aún no existen.
3. Etiquetas como atributo de cada bloque (no como zona de soltar), con barra de filtro.
4. Servidor MCP que expone el mapa, las alertas, las etiquetas y el orden planificado, y permite cambiarlos.

**No objetivos v1** (pueden venir después)

- Aplicar al sitio real lo que se mueve en el lienzo. En v1 el lienzo produce un **orden planificado**; un agente lo lee vía MCP (`atlas_get_plan`) y hace el cambio en el código.
- Leer la estructura desde el código fuente (Astro u otro). v1 trabaja sobre el sitio renderizado.
- URL compartida para el equipo (hospedada, con inicio de sesión) y colaboración multiusuario en línea. v1 es solo local (decidido el 2026-10-19). Para no cerrarle la puerta, el lienzo habla con su servidor solo por la API HTTP + SSE del §6: hospedarlo después implica cambiar almacenamiento y autenticación, no el lienzo.
- Mostrar el lienzo dentro de clientes de IA (MCP Apps).
- Páginas detrás de inicio de sesión.
- Pantalla de comparación entre escaneos (el dato queda guardado para hacerlo después).
- Exportar a Figma, Miro u otros lienzos.

**Anti-objetivos** (si pasa esto, falló aunque funcione)

- Que la herramienta modifique el sitio escaneado.
- Que exija cambiar el sitio escaneado para funcionar (las marcas opcionales del §5.1 ayudan, pero no son requisito).
- Que un re-escaneo borre las etiquetas o el orden que el equipo organizó.
- Que envíe datos del sitio a servicios de terceros.

## 3. Conceptos

| Concepto | Qué es |
|---|---|
| **Sitio** | Un proyecto con nombre (p. ej. `scap-tech`) que agrupa uno o varios **entornos**: orígenes con ruta base (p. ej. `http://localhost:4405/beta-1/`, `https://staging.…/`). La capa del usuario es del sitio, no del entorno: lo organizado sobre localhost se ve al escanear staging o producción. Si `atlas_scan` no recibe `site`, se deriva de host + puerto + primer segmento de ruta. |
| **Escaneo** | Una fotografía del sitio en un momento: páginas, bloques, componentes, alertas, miniaturas. Inmutable; se guardan todos. |
| **Página** | Una URL del sitio. Puede ser **real** (vino del escaneo) o **planificada** (creada en el lienzo o por MCP). |
| **Bloque** | Una sección de primer nivel de una página (header, hero, una sección, footer). |
| **Componente** | Lo que hay dentro de un bloque: títulos, enlaces, botones, formularios, medios (img, video, canvas). Se resume, no se edita. |
| **Tipo de bloque** | `narrativa`, `visual` o `conversión`. Se infiere y el usuario puede corregirlo. |
| **Etiqueta** | Nombre + color definidos por sitio. Un bloque puede tener varias. |
| **Alerta** | Problema detectado en un bloque o página (§5.4). |
| **Capa del usuario** | Lo que el equipo decide encima del escaneo: etiquetas, tipo corregido, orden planificado, páginas planificadas. Vive separada del escaneo para sobrevivir a re-escaneos. |

## 4. Recorrido

1. Un agente llama `atlas_scan({ url })` (o se ejecuta `site-atlas scan <url>` en la terminal).
2. Se abre el lienzo (`atlas_open_canvas` devuelve `http://localhost:4800/s/<siteId>`).
3. El equipo arrastra, reordena, crea páginas planificadas y etiqueta.
4. Un agente consulta `atlas_get_plan` y obtiene las diferencias entre el orden real y el planificado, listas para implementar en el código.
5. Tras cambiar el sitio, se re-escanea; el lienzo muestra el nuevo estado con la capa del usuario conservada.

## 5. Escaneo

### 5.1 Detección de bloques

Se renderiza cada página en Chromium headless a 1440×900 con `prefers-reduced-motion: reduce` emulado. Se recorre la página con scroll hasta el final para disparar contenido diferido y revelados, y se espera a que la red quede inactiva. Los elementos ocultos solo por animaciones de entrada (opacidad 0 con clase de revelado) cuentan como visibles.

Reglas:

1. **Marcas explícitas:** si la página tiene elementos `[data-atlas-block]`, esos son los bloques y no se aplican las demás reglas. `data-atlas-block="Nombre"` fija el nombre. Es opcional y pensado para los sitios propios.
2. **Estructura semántica:** `header` / `[role=banner]` de primer nivel, cada `section` que no esté dentro de otra `section`, y `footer` / `[role=contentinfo]` de primer nivel. Los envoltorios (`div` que solo contienen una `section`, como `.hero-track` en SCAP Beta 1) se atraviesan. Un `nav` dentro del header no es un bloque aparte.
3. **Respaldo, combinado con la regla 2:** los hijos directos visibles de `main` (o de `body` si no hay `main`) con altura ≥ 80 px que no contengan ni sean un bloque de la regla 2 también son bloques. Así una página que mezcla `section` y `div` no pierde contenido.

**Bloques globales:** un bloque cuya huella (§5.5) se repite en dos o más páginas, como el header y el footer, se marca como global. El lienzo lo muestra una sola vez en un carril "Global" en vez de repetirlo en cada columna.

Elementos fijos o superpuestos que no ocupan flujo (p. ej. etiquetas flotantes de prototipo) no son bloques.

### 5.2 Datos de cada bloque

- **Nombre:** `data-atlas-block` → `aria-label` → texto del antetítulo (primer elemento de texto corto antes del título, como `.kicker` o `.eyebrow`) → texto del h1/h2 → `id` → `"<etiqueta HTML> <n>"`.
- **Título:** primer h1/h2 del bloque.
- **Ancla:** `id` del bloque, si tiene.
- **Orden** en la página y **altura** en px.
- **Tipo inferido:** contiene `form` → `conversión`; contiene `canvas`, `video` o un elemento WebGL que ocupe ≥ 30 % del bloque → `visual`; si no → `narrativa`.
- **Componentes (resumen):** títulos (nivel + texto), enlaces (texto, destino, interno/externo/ancla), botones, formularios (cantidad de campos, `action`, método), medios (img con `src`, video, canvas), y un extracto de texto de hasta 200 caracteres.
- **Miniatura:** captura del bloque a 1440 px, guardada como WebP.

### 5.3 Rastreo

- Sigue enlaces del mismo origen desde la URL inicial. Máximo de páginas por defecto: 30 (`maxPages`).
- Filtros opcionales `include` / `exclude` por patrón de ruta.
- En hosts que no sean de desarrollo local respeta `robots.txt` y espera 1 s entre páginas.
- Normaliza URLs (sin fragmento, sin barra final duplicada) para no repetir páginas.

### 5.4 Alertas

| Alerta | Nivel | Regla |
|---|---|---|
| Enlace interno roto | error | Destino del mismo origen que responde 4xx/5xx. |
| Ancla inexistente | error | `href="#x"` o `/ruta#x` sin elemento con ese `id` en la página destino. |
| Formulario sin destino | aviso | `form` sin `action` (o `action` vacío). |
| Imagen provisional | aviso | `src` o `alt` que contiene `placeholder`, `provisional`, `lorem` o `dummy` (sin distinguir mayúsculas). |
| Bloque sin ancla | info | Bloque de contenido (no header/footer) sin `id`: no se puede enlazar. |
| Título faltante o duplicado | aviso | Página sin h1 o con más de un h1; bloque de contenido sin h2 ni nombre accesible. |
| `id` duplicado | aviso | Dos elementos con el mismo `id` en la página. |

Con SCAP Beta 1 esto debe detectar: enlace a `/es/soluciones/brokers` roto, "Para quién" y "Cómo trabajamos" sin ancla, imágenes provisionales en "Gestión tecnológica", formulario de cotización sin destino.

### 5.5 Identidad de bloques entre escaneos

Cada bloque tiene una clave estable `blockKey`:

1. `<ruta>#<ancla>` si tiene `id`;
2. si no, `<ruta>~<slug del nombre>`;
3. si el slug se repite en la página, se le agrega `-2`, `-3` en orden.

Cada bloque guarda además una **huella**: hash de su título normalizado + primeros 200 caracteres de texto + secuencia de etiquetas HTML de sus hijos directos.

La capa del usuario referencia `blockKey`. Al re-escanear, la conciliación sigue este orden:

1. Misma `blockKey` → es el mismo bloque.
2. Mismo `id` en otra página (el bloque se movió, como pedía el plan) → es el mismo bloque; su clave se actualiza en la capa del usuario.
3. Huella idéntica, o similitud ≥ 0,8 entre extractos de texto, en cualquier página → es el mismo bloque (cubre cambios de título o de página sin `id`).
4. Lo que no concilia queda como **huérfano**, con la mejor sugerencia de coincidencia si la hay, y el lienzo lo muestra aparte para reasignarlo o descartarlo con un clic. Nunca se borra solo.

## 6. Datos y almacenamiento

Carpeta de trabajo: `~/.site-atlas/` (cambiable con la variable `SITE_ATLAS_HOME`).

```
~/.site-atlas/sites/<siteId>/
├── site.json            ← origen, nombre, fecha de creación
├── scans/<ISO-fecha>.json  ← escaneos inmutables
├── shots/<scanId>/<hash>.webp
└── overlay.json         ← capa del usuario
```

`overlay.json` contiene: `rev` (número de revisión), `tags` (id, nombre, color), `blockTags` (`blockKey` → ids de etiqueta), `kindOverrides`, `plannedPages` (ruta, título), `plannedOrder` (ruta de página → lista ordenada de `blockKey`, que puede incluir bloques de otras páginas) y `orphans`.

**Semántica del orden planificado:**

- Una página sin orden planificado hereda el orden real. El orden planificado se crea la primera vez que se toca la página.
- Mover un bloque a otra página lo **saca** de la de origen; no se copia. Los bloques globales no se mueven entre páginas.
- `plannedDeletions`: lista de `blockKey` marcados para eliminar (zona "Eliminar" del lienzo). Se pueden restaurar.
- Si un re-escaneo trae un bloque nuevo en una página con orden planificado, se inserta justo después de su vecino anterior en el orden real (o al principio si no tiene) y se marca como "nuevo".
- Cuando el sitio real ya coincide con el plan, el orden planificado se conserva y `atlas_get_plan` no reporta diferencias para esa página. No se limpia solo.
- `atlas_get_plan` reporta cuatro tipos de diferencia: reordenar, mover a otra página, eliminar, página nueva.

Escrituras: atómicas (archivo temporal + renombrar), con control optimista por `rev`. Una escritura con `rev` desactualizado se rechaza y el cliente recarga. El lienzo recibe por SSE los cambios que hacen los agentes vía MCP y viceversa.

Los esquemas de `scan` y `overlay` se definen con Zod y llevan `schemaVersion`.

## 7. Lienzo

- Columnas por página: primero las reales, en el orden del rastreo; después las planificadas. Botón "+ Página planificada".
- Tarjeta de bloque: número de orden, miniatura, nombre, insignia de tipo, etiquetas, icono de alerta si tiene.
- Arrastrar para reordenar dentro de una página o mover a otra. Mover crea o actualiza el orden planificado; no toca el escaneo.
- Etiquetas: botón "+" en la tarjeta abre la lista para marcar/desmarcar; barra superior para filtrar (atenúa lo que no coincide) y crear, renombrar o borrar etiquetas.
- Interruptor **Real / Planificado**: en Planificado, los bloques que cambiaron de lugar llevan una marca.
- Clic en tarjeta: panel lateral con miniatura grande, componentes, alertas y tipo editable.
- Carril "Global" arriba con los bloques compartidos entre páginas.
- Zona "Eliminar": soltar un bloque ahí lo marca para eliminar (aparece tachado en su página y se puede restaurar).
- Zona de huérfanos visible solo si hay alguno.
- Botón "Re-escanear".
- Funciona en escritorio; en móvil basta con que se vea, no que se arrastre bien.

Referencia visual: las maquetas del 2026-10-19 eran columnas por página con tarjetas compactas, superficies planas, bordes finos, etiquetas como píldoras de color dentro de la tarjeta y filtro de etiquetas en una barra horizontal sobre el lienzo. Esta sección es suficiente; no hay archivos de maqueta aparte.

## 8. Servidor MCP

Transporte `stdio`. Herramientas:

| Herramienta | Entrada | Devuelve |
|---|---|---|
| `atlas_scan` | `url`, `maxPages?`, `include?`, `exclude?` | `siteId`, `scanId`, páginas, bloques y alertas contados |
| `atlas_list_sites` | — | sitios con último escaneo |
| `atlas_get_map` | `site`, `page?` | páginas con bloques (capa del usuario aplicada), forma compacta |
| `atlas_get_block` | `site`, `blockKey`, `withImage?` | detalle, componentes, alertas; miniatura como imagen MCP si `withImage` |
| `atlas_list_issues` | `site`, `level?` | alertas con página y bloque |
| `atlas_tags` | `site`, `action` (`create`/`rename`/`delete`), datos | etiquetas actualizadas |
| `atlas_set_block_tags` | `site`, `blockKey`, `tags[]` | bloque actualizado |
| `atlas_move_block` | `site`, `blockKey`, `toPage`, `index` | orden planificado actualizado |
| `atlas_add_planned_page` | `site`, `path`, `title` | página creada |
| `atlas_get_plan` | `site` | diferencias real vs. planificado por página, en lenguaje claro y en JSON |
| `atlas_open_canvas` | `site` | URL local del lienzo (arranca el servidor si no está) |

Las respuestas de MCP marcan como contenido no confiable el texto que viene del sitio escaneado (títulos, extractos), para que los agentes lo traten como dato y no como instrucciones.

## 9. Restricciones

- Todo local. El servidor del lienzo escucha solo en `127.0.0.1`.
- No se ejecuta código del sitio escaneado fuera del navegador headless.
- Sin telemetría.
- Escaneo de una página típica (como SCAP Beta 1) en menos de 30 s.

## 10. Decisiones de cómo se construye (propuestas por Claude, a confirmar)

- **Node 24 LTS + TypeScript estricto + pnpm**: mismo stack que el equipo usa en SCAP.
- **`@modelcontextprotocol/sdk`** para el servidor MCP.
- **Playwright (Chromium)** para renderizar y capturar.
- **Lienzo en Vue 3 + Vite** con **SortableJS** (`vue-draggable-plus`) para arrastrar: el equipo ya trabaja con Vue/Nuxt en el CRM.
- **Hono** como servidor HTTP local del lienzo (API + SSE + archivos estáticos).
- **Vitest** para pruebas unitarias del extractor con HTML de prueba; una prueba de integración que escanea una página de muestra servida en local.
- Un solo paquete con dos entradas: `site-atlas` (CLI: `scan`, `canvas`, `mcp`) y el servidor MCP (`site-atlas mcp`). Se instala en Claude Code con `claude mcp add site-atlas -- node <ruta>/dist/cli.js mcp`. Sin publicar en npm en v1.
- Licencia: privada, sin licencia abierta por ahora.

## 11. Criterio de éxito de v1

1. `atlas_scan` sobre `http://localhost:4405/beta-1/index.html` (SCAP Tech; el archivo está en `SCAP Broker/SCAP Technology/Prototipos/hero/beta-1/index.html`) devuelve 15 bloques, en este orden y con estos nombres: Header (o el nombre que dé la cadena del §5.2), Tecnología financiera (hero), Integraciones, La plataforma, Tecnología, Gestión tecnológica, Productos, Soluciones, Tecnología para brokers, Para quién, Cómo trabajamos, Nosotros, Tecnología de vanguardia. Control absoluto. (pieza de impacto, por su `aria-label`), Solicite una propuesta (cierre) y Footer. También devuelve las alertas del §5.4. Los nombres salen del antetítulo de cada sección; esa es la prueba de que la cadena funciona. No se exige el nombre exacto de header y footer.
2. En el lienzo se reordena el Home, se mueve un bloque a una página planificada y se etiqueta; tras re-escanear, nada de eso se pierde.
3. Desde Claude Code, `atlas_get_plan` describe esos cambios de forma que un agente pueda implementarlos.
4. Escanear `https://stripe.com` y `https://vercel.com` (las referencias visuales de SCAP) produce mapas razonables sin configuración. "Razonable" significa que cada sección visible a simple vista es un bloque, sin bloques vacíos ni fragmentos menores a 80 px, y con nombres legibles en al menos el 80 % de los bloques.

## 12. Lo que queda al constructor

- Estructura interna de carpetas y módulos.
- Diseño visual fino del lienzo, siguiendo las maquetas.
- Paleta de colores de etiquetas.
- Formato exacto del texto de `atlas_get_plan`.
- Cómo se nombran los `siteId` cuando hay colisión.
