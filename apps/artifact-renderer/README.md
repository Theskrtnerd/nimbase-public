# @acme/artifact-renderer

Turns a stored artifact artifact into a PNG or PDF so a chat agent can attach it
to a message. One endpoint, one long-lived Chromium.

Deliberately a separate service rather than a Next.js route: Chromium is ~50MB
of binary that would fight Vercel's function size limit and pay a cold start on
every idle render. Here it stays warm.

## Why it renders HTML instead of fetching a URL

It takes the artifact HTML in the request body and uses `page.setContent`. The
obvious alternative — navigating to `/s/<slug>` — would mean teaching this
service to authenticate past the visibility gate, and it would fail outright for
any artifact that is not public. Rendering the bytes directly sidesteps both.

## Security

The service **executes AI-generated JavaScript**. Two controls matter:

1. **Host allowlist** (`ALLOWED_HOSTS` in `src/render.ts`). Every request the
   page makes is intercepted and aborted unless it targets a CDN the artifact
   builder actually emits. Without this, a generated artifact could fetch internal
   services or the cloud metadata endpoint from inside your perimeter and paint
   the response into an image that then gets posted to a chat channel. If you
   add a CDN to `buildArtifactHtml`, add it here too or the artifact renders blank.
2. **Bearer token** (`RENDERER_TOKEN`). The service refuses to start without
   one. Do not expose it publicly — it should be reachable only from the app.

Chromium runs with `--no-sandbox` because its own sandbox needs privileges we
don't want to grant the container. The container is the isolation boundary, so
run it with no credentials it doesn't need and no network path to internal
services.

## Configuration

| Variable               | Required | Default             | Meaning                                    |
| ---------------------- | -------- | ------------------- | ------------------------------------------ |
| `RENDERER_TOKEN`       | yes      | —                   | Bearer token; the process exits without it |
| `PORT`                 | no       | `8080`              | Listen port                                |
| `CHROMIUM_PATH`        | no       | `/usr/bin/chromium` | Chromium binary                            |
| `RENDERER_CONCURRENCY` | no       | `3`                 | Simultaneous renders before 503            |

The app side needs `ARTIFACT_RENDERER_URL` and `ARTIFACT_RENDERER_TOKEN`. With
either unset, `rendererAvailable()` is false, png/pdf attachments are refused,
and chat falls back to posting the share link — nothing hard-fails.

## API

```
GET  /health   → {"ok":true}   (503 if Chromium is wedged, so the platform restarts us)
POST /render   Authorization: Bearer $RENDERER_TOKEN
     { "html": "<!doctype html>…", "format": "png"|"pdf",
       "width"?: 1200, "height"?: 800, "fullPage"?: true, "scale"?: 2 }
     → image/png | application/pdf
```

PNG capture shrinks the viewport to the content height first, so a short artifact
does not come out letterboxed. `prefers-color-scheme` is pinned to light:
headless Chromium otherwise reports dark and the same artifact would render
differently here than in a browser.

## Local

```bash
# macOS, against installed Chrome
CHROMIUM_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
RENDERER_TOKEN=dev-token-at-least-16-chars \
pnpm -F @acme/artifact-renderer dev
```

## Deploy

```bash
pnpm -F @acme/artifact-renderer build     # tsc → dist/
docker build -t artifact-renderer apps/artifact-renderer
```

Give it ~1GB of memory: Chromium holds the whole page, and
`RENDERER_CONCURRENCY` pages at once. Point the health check at `/health`.
