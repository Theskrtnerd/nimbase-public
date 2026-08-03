import type { Browser, HTTPRequest, Page } from "puppeteer-core";
import puppeteer from "puppeteer-core";

/**
 * Hosts a artifact artifact is allowed to load from.
 *
 * This is the service's main security control, not a performance tweak. The
 * renderer executes AI-generated JavaScript inside our own perimeter, so an
 * unrestricted page could fetch internal services, cloud metadata endpoints
 * (169.254.169.254), or anything else reachable from this container and paint
 * the result into an image we then post into a chat channel. Allowlisting the
 * handful of CDNs `buildArtifactHtml` actually emits turns that whole class of
 * SSRF into a blocked request.
 */
const ALLOWED_HOSTS = new Set([
  "unpkg.com",
  "cdn.tailwindcss.com",
  "fonts.googleapis.com",
  "fonts.gstatic.com",
]);

export interface RenderOptions {
  html: string;
  format: "png" | "pdf";
  /** Viewport width in CSS pixels. */
  width?: number;
  /** Viewport height. Ignored for full-page PNG capture. */
  height?: number;
  /** PNG only: capture the full scroll height rather than the viewport. */
  fullPage?: boolean;
  /** PNG only: 2 renders at retina density. */
  scale?: number;
}

const DEFAULTS = {
  width: 1200,
  height: 800,
  fullPage: true,
  scale: 2,
};

/** Wall-clock ceiling for one page load. CDN fetches dominate. */
const NAV_TIMEOUT_MS = 20_000;

/** Floor for the shrink-to-content pass, so a near-empty artifact still has a frame. */
const MIN_CAPTURE_HEIGHT = 200;

/**
 * A single long-lived browser. Launching Chromium costs ~300ms and ~80MB, so a
 * per-request browser would dominate render latency; pages are cheap and get
 * closed per request. `browser.connected` is re-checked on every acquire
 * because a crashed Chromium otherwise wedges the service until restart.
 */
let browser: Browser | null = null;
let launching: Promise<Browser> | null = null;

async function launch(): Promise<Browser> {
  return puppeteer.launch({
    executablePath: process.env.CHROMIUM_PATH ?? "/usr/bin/chromium",
    headless: true,
    args: [
      // The container is the isolation boundary here; Chromium's own sandbox
      // needs privileges we do not want to grant it.
      "--no-sandbox",
      "--disable-setuid-sandbox",
      // /dev/shm defaults to 64MB in Docker, which Chromium overruns and dies.
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--hide-scrollbars",
    ],
  });
}

export async function getBrowser(): Promise<Browser> {
  if (browser?.connected) return browser;
  // Collapse concurrent misses onto one launch.
  launching ??= launch().then((b) => {
    browser = b;
    launching = null;
    return b;
  });
  return launching;
}

export async function closeBrowser(): Promise<void> {
  const b = browser;
  browser = null;
  await b?.close().catch(() => undefined);
}

function guardRequests(page: Page): void {
  page.on("request", (req: HTTPRequest) => {
    const url = req.url();
    // The document itself is injected via setContent, not fetched.
    if (url === "about:blank" || url.startsWith("data:")) {
      void req.continue();
      return;
    }
    let host: string;
    try {
      host = new URL(url).hostname;
    } catch {
      void req.abort();
      return;
    }
    if (ALLOWED_HOSTS.has(host)) {
      void req.continue();
    } else {
      void req.abort();
    }
  });
}

/**
 * Render a stored artifact artifact to a PNG or PDF.
 *
 * Renders from the HTML itself rather than by navigating to `/s/<slug>`: the
 * share route is visibility-gated, so fetching it would mean teaching this
 * service to authenticate and would fail outright for non-public artifactes.
 * Taking the artifact directly sidesteps both.
 */
export async function renderArtifact(opts: RenderOptions): Promise<Buffer> {
  const width = opts.width ?? DEFAULTS.width;
  const height = opts.height ?? DEFAULTS.height;

  const b = await getBrowser();
  const page = await b.newPage();
  try {
    await page.setRequestInterception(true);
    guardRequests(page);
    await page.setViewport({
      width,
      height,
      deviceScaleFactor: opts.scale ?? DEFAULTS.scale,
    });
    page.setDefaultNavigationTimeout(NAV_TIMEOUT_MS);

    // Headless Chromium otherwise reports dark, so an artifact using
    // `prefers-color-scheme` would render dark here and light in the browser
    // for the same artifact. Pin it: the output is a static image shared into a
    // channel, and it should not depend on the renderer's defaults.
    await page.emulateMediaFeatures([
      { name: "prefers-color-scheme", value: "light" },
    ]);

    await page.setContent(opts.html, {
      waitUntil: "load",
      timeout: NAV_TIMEOUT_MS,
    });
    // `load` fires before the CDN scripts have executed and painted — the
    // artifact pulls React, Tailwind, and recharts at runtime, so capturing at
    // `load` yields a blank page. Waiting for the network to settle is what
    // makes the screenshot show the rendered component. Tolerate a timeout: a
    // page that never idles (an animation polling forever) should still be
    // captured rather than failing the whole render.
    await page
      .waitForNetworkIdle({ idleTime: 500, timeout: NAV_TIMEOUT_MS })
      .catch(() => undefined);

    if (opts.format === "pdf") {
      const pdf = await page.pdf({
        printBackground: true,
        width: `${width}px`,
        // Height omitted so Chromium paginates by content.
        margin: { top: "24px", bottom: "24px", left: "24px", right: "24px" },
      });
      return Buffer.from(pdf);
    }

    const fullPage = opts.fullPage ?? DEFAULTS.fullPage;
    if (fullPage) {
      // `fullPage` captures max(content, viewport), so a short artifact comes out
      // letterboxed with dead space below it — bad in a chat channel, where the
      // image is shown at whatever aspect ratio it has. Shrink the viewport to
      // the content first and capture that instead. Re-measured after the
      // resize because reflow at a new height can change it again (wrapped
      // text, vh units).
      // Measured off <body> alone. `documentElement.scrollHeight` and
      // `.offsetHeight` are both floored at the viewport height, so folding
      // them into a max() means the measurement can never come in under the
      // viewport and the shrink never fires.
      const measure = () =>
        page.evaluate(() => {
          const body = document.body;
          const style = getComputedStyle(body);
          return Math.ceil(
            body.getBoundingClientRect().bottom +
              parseFloat(style.marginBottom || "0"),
          );
        });
      let contentHeight = await measure();
      if (contentHeight > 0 && contentHeight < height) {
        await page.setViewport({
          width,
          height: Math.max(contentHeight, MIN_CAPTURE_HEIGHT),
          deviceScaleFactor: opts.scale ?? DEFAULTS.scale,
        });
        contentHeight = await measure();
      }
    }

    const png = await page.screenshot({ type: "png", fullPage });
    return Buffer.from(png);
  } finally {
    await page.close().catch(() => undefined);
  }
}
