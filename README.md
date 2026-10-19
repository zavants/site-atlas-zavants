# Site Atlas

Mapa semántico de sitios web. Escanea un sitio, lo divide en **bloques** (header, hero, secciones, footer…) y lo muestra en un **lienzo** donde los bloques se arrastran, se reordenan, se mueven entre páginas y se etiquetan. Todo se expone también por **MCP**, así que cualquier agente (Claude Code, Codex, Antigravity…) puede escanear, leer el mapa, leer lo que el equipo organizó y modificarlo.

- El lienzo **no modifica el sitio**: arma un *orden planificado*. Un agente lo lee con `atlas_get_plan` y hace el cambio en el código.
- Todo es local: el lienzo escucha solo en `127.0.0.1`. No hay telemetría.

Diseño: [`docs/superpowers/specs/2026-10-19-site-atlas-design.md`](docs/superpowers/specs/2026-10-19-site-atlas-design.md).

## Requisitos

- Node 24 o superior
- pnpm (`npm i -g pnpm` o `corepack enable pnpm`)

```bash
pnpm install
pnpm exec playwright install chromium
pnpm build
```

## Uso por terminal

```bash
node dist/cli.js scan http://localhost:4321/            # escanea (máx. 30 páginas)
node dist/cli.js scan https://ejemplo.com --max-pages 5 --exclude "/blog/**"
node dist/cli.js canvas                                  # abre el lienzo en http://127.0.0.1:4800
```

En desarrollo también sirve `pnpm atlas <comando>` (sin compilar).

## Uso por MCP

```bash
claude mcp add site-atlas -- node C:/ruta/a/site-atlas-zavants/dist/cli.js mcp
```

| Herramienta | Para qué |
|---|---|
| `atlas_scan` | Escanear un sitio y conciliar lo ya organizado |
| `atlas_list_sites` | Ver los sitios escaneados |
| `atlas_get_map` | Mapa por páginas y bloques, con etiquetas y orden planificado |
| `atlas_get_block` | Detalle de un bloque (componentes, alertas, miniatura) |
| `atlas_list_issues` | Alertas: enlaces rotos, anclas inexistentes, formularios sin destino, imágenes provisionales… |
| `atlas_tags` / `atlas_set_block_tags` | Crear, renombrar, borrar y asignar etiquetas |
| `atlas_move_block` / `atlas_add_planned_page` | Reorganizar el orden planificado |
| `atlas_get_plan` | Diferencias entre el sitio real y el plan, listas para implementar |
| `atlas_open_canvas` | URL del lienzo |

El texto que viene del sitio escaneado se marca como contenido no confiable para que los agentes lo traten como datos.

## Marcas opcionales

Site Atlas detecta los bloques solo (`header`, `section` de primer nivel, `footer` y bloques visibles de `main`). En un sitio propio se puede fijar la división exacta:

```html
<section data-atlas-block="Hero">…</section>
```

## Datos

Se guardan en `~/.site-atlas/` (o en `SITE_ATLAS_HOME`):

```
sites/<sitio>/site.json
sites/<sitio>/scans/<fecha>.json      escaneos inmutables
sites/<sitio>/shots/<escaneo>/*.webp  miniaturas
sites/<sitio>/overlay.json            etiquetas, orden planificado, eliminaciones
```

Re-escanear nunca borra lo organizado: los bloques que cambian de título o de página se reconocen por ancla, huella o similitud de texto, y lo que no se reconoce queda como *huérfano* para reasignarlo.

## Pruebas

```bash
pnpm test
ATLAS_BETA1_URL=http://localhost:4405/beta-1/index.html pnpm test tests/acceptance.test.ts
```

## Probado con

| Sitio | Resultado |
|---|---|
| SCAP Tech Beta 1 (localhost) | 15 bloques con los nombres esperados; alertas: enlace roto a `/es/soluciones/brokers`, 4 bloques sin ancla, imágenes provisionales, formulario sin destino |
| stripe.com (1 página) | 10 bloques, 8 con nombre legible; 26 s |
| vercel.com (1 página) | 6 bloques, todos con nombre legible |

## Licencia

Código abierto bajo licencia [MIT](LICENSE). Puedes usarlo, modificarlo y redistribuirlo libremente.
