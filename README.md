# Whiteboard-UI

An infinite-canvas whiteboard for brainstorming and presenting, inspired by Microsoft Whiteboard.
It is a static web app: **the server never receives or stores board data.**

## Features

- **Infinite canvas**: pan (Space+drag, middle mouse, hand tool, two-finger touch), zoom (Ctrl+wheel, pinch, `+`/`-`), fit-to-content, dot grid.
- **Ink**: pressure-sensitive pen (via [perfect-freehand](https://github.com/steveruizok/perfect-freehand)), highlighter, object eraser (the pen's eraser end works too).
- **Shape recognition** (pen → *Shapes* toggle, on by default): a hand-drawn circle, ellipse, rectangle/square, triangle, diamond, quad, pentagon/hexagon or straight line snaps to a clean shape **fitted to what you drew**. It keeps the drawing's size, proportions, position and rotation, so a tilted box stays tilted and a wide oval stays wide. Small strokes such as handwriting stay as ink.
- **Text, sticky notes** (auto-fit text), rectangles, ellipses, lines, arrows (Shift = square/circle/45°).
- **Icon library** (`I`): drag or click to insert icons, with the product name added underneath.
  - **Azure**: 644 official Azure Architecture Icons
  - **SAP**: product logos (S/4HANA, S/4HANA Cloud, Ariba, SuccessFactors, Concur, Signavio, LeanIX, Fieldglass, BTP,
    Business Network, Customer Experience, BW/4HANA, ECC…), 128 SAP BTP service icons and SAP's generic diagram icons
  - **Tech logos**: 2,000+ logos (databases, AWS, Google Cloud, DevOps, languages, SaaS…)
- **Laser pointer** (`K`) with fading trail, and full-screen mode (`F`) for presenting.
- Select, move, resize, duplicate, copy/paste (including images from the clipboard), z-order, undo/redo, image drag-and-drop.
- Export the board or the selection as PNG.

## Where data lives

| What | Where |
|---|---|
| Autosave / crash recovery | IndexedDB in the user's browser, written ~0.4 s after every change and when the tab is hidden. Restored on the next visit. |
| Saved boards | A `.whiteboard` file (JSON) on the user's disk. |

No browser extension is needed. On Chromium browsers (Chrome, Edge, Opera) the
[File System Access API](https://developer.mozilla.org/docs/Web/API/File_System_API) lets **Ctrl+S** write back to the
same file, and it is remembered across reloads. Firefox and Safari fall back to download/upload.
Icons and images are embedded in the board file, so a board opens anywhere.

> The File System Access API needs **HTTPS**. Enable a TLS domain in Dokploy.
> Autosave is per browser profile. Clearing site data removes it, so save important boards to a file.

## Development

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check + production build into dist/
```

### Refreshing the icon library

The icon bundles in `public/icons/` are generated and committed. To pull newer upstream icons (for example when Microsoft
publishes a new Azure icon version):

```bash
npm run icons                    # all sets
npm run icons -- azure           # one set
AZURE_ICONS_URL=https://arch-center.azureedge.net/icons/Azure_Public_Service_Icons_V26.zip npm run icons -- azure
```

| Set | Source | Terms |
|---|---|---|
| Azure | [Azure Architecture Icons](https://learn.microsoft.com/azure/architecture/icons/) | Microsoft permits use in architecture diagrams, training materials and documentation. Don't crop, flip, rotate or distort them. |
| SAP | [SAP/btp-solution-diagrams](https://github.com/SAP/btp-solution-diagrams) | Apache-2.0 |
| Tech logos | [gilbarbara/logos](https://github.com/gilbarbara/logos) via `@iconify-json/logos` | CC0-1.0 artwork; logos are trademarks of their owners |

## Deploying with Dokploy

Every push to `main` runs [`.github/workflows/build-deploy.yml`](.github/workflows/build-deploy.yml):

1. **Typecheck and build** with Node 24 (`npm ci && npm run build`).
2. **Build and push** a `linux/arm64` image to `ghcr.io/ikanasinn/whiteboard-ui`, tagged `latest` and the short commit SHA.
3. **Deploy**: point the Dokploy application at that exact `:<sha>` image (`application.saveDockerProvider`), then trigger
   `application.deploy`. To roll back, re-run an older workflow run.

It can also be started by hand from the Actions tab (`workflow_dispatch`).

| Setting (repo → Settings → Secrets and variables → Actions) | Kind | Purpose |
|---|---|---|
| `DOKPLOY_URL` | variable | e.g. `https://dokploy.example.com` |
| `DOKPLOY_APPLICATION_ID` | variable | the Dokploy application to deploy |
| `DOKPLOY_API_KEY` | secret | Dokploy API key |
| `GHCR_USER` + `GHCR_TOKEN` | secrets (optional) | registry credentials for Dokploy. Without them the GHCR package must be **public**. |

In Dokploy, set the application's container port to **80**, add the domain and enable HTTPS (Let's Encrypt).
HTTPS is required for saving straight to files.

The image is `nginx:alpine` serving the static build, with gzip, long-lived caching for hashed assets, a strict
Content-Security-Policy and a `/healthz` endpoint. To test locally:

```bash
docker build -t whiteboard .
docker run --rm -p 8080:80 whiteboard   # http://localhost:8080
```

## Keyboard shortcuts

Press `?` in the app for the full list. The most used ones are `V` select, `P` pen, `M` highlighter, `E` eraser,
`K` laser, `T` text, `N` sticky, `R`/`O`/`L`/`A` shapes, `I` icons, `Ctrl+Z`/`Ctrl+Y` undo/redo and `Ctrl+S` save.
