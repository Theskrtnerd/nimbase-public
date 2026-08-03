import { timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";

import { closeBrowser, getBrowser, renderArtifact } from "./render.ts";

const PORT = Number(process.env.PORT ?? 8080);
const TOKEN = process.env.RENDERER_TOKEN;

// Chromium holds the whole page in memory and the caller blocks on the
// response, so unbounded concurrency turns into OOM rather than throughput.
const MAX_CONCURRENT = Number(process.env.RENDERER_CONCURRENCY ?? 3);
// Artifacts are self-contained documents with inlined CSS/JS; a few MB is
// already far past anything the generator produces.
const MAX_BODY_BYTES = 8 * 1024 * 1024;

let inFlight = 0;

const RenderRequest = z.object({
  html: z.string().min(1),
  format: z.enum(["png", "pdf"]),
  width: z.number().int().min(320).max(3000).optional(),
  height: z.number().int().min(200).max(4000).optional(),
  fullPage: z.boolean().optional(),
  scale: z.number().int().min(1).max(3).optional(),
});

function authorized(req: IncomingMessage): boolean {
  if (!TOKEN) return false;
  const header = req.headers.authorization ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice(7) : "";
  const a = Buffer.from(presented);
  const b = Buffer.from(TOKEN);
  // timingSafeEqual throws on length mismatch, so compare that separately.
  return a.length === b.length && timingSafeEqual(a, b);
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > MAX_BODY_BYTES) throw new Error("payload too large");
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

const server = createServer((req, res) => {
  void (async () => {
    if (req.method === "GET" && req.url === "/health") {
      // Report the browser too — a wedged Chromium should fail the check so
      // the platform restarts us rather than serving 500s indefinitely.
      try {
        const b = await getBrowser();
        json(res, b.connected ? 200 : 503, { ok: b.connected });
      } catch {
        json(res, 503, { ok: false });
      }
      return;
    }

    if (req.method !== "POST" || req.url !== "/render") {
      json(res, 404, { error: "not found" });
      return;
    }
    if (!authorized(req)) {
      json(res, 401, { error: "unauthorized" });
      return;
    }
    if (inFlight >= MAX_CONCURRENT) {
      res.setHeader("retry-after", "2");
      json(res, 503, { error: "busy" });
      return;
    }

    inFlight += 1;
    try {
      const parsed = RenderRequest.safeParse(JSON.parse(await readBody(req)));
      if (!parsed.success) {
        json(res, 400, {
          error: "invalid request",
          detail: parsed.error.message,
        });
        return;
      }
      const buf = await renderArtifact(parsed.data);
      res.writeHead(200, {
        "content-type":
          parsed.data.format === "pdf" ? "application/pdf" : "image/png",
        "content-length": buf.length,
      });
      res.end(buf);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[render] failed:", message);
      json(res, 500, { error: "render failed" });
    } finally {
      inFlight -= 1;
    }
  })();
});

if (!TOKEN) {
  console.error(
    "RENDERER_TOKEN is required — refusing to start unauthenticated",
  );
  process.exit(1);
}

server.listen(PORT, () => {
  console.log(`[render] listening on :${PORT}`);
});

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    server.close(() => {
      void closeBrowser().then(() => process.exit(0));
    });
  });
}
