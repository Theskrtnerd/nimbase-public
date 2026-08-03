import type { ZodType } from "zod/v4";

import type { Credential } from "./credentials";
import type { CliErrorCode } from "./errors";
import { CliError, EXIT } from "./errors";

export interface RequestOptions<T> {
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  schema?: ZodType<T>;
  /**
   * Human wording for this route's 404, e.g. "Note not found". Without it the
   * server's raw `not_found` code reached the user verbatim.
   */
  notFound?: string;
}

/**
 * Server error codes that have a better human wording than the code itself.
 * Anything not listed falls back to the server's message, which is the right
 * default for routes that already return prose.
 */
const SERVER_MESSAGES: Record<string, string> = {
  unauthorized: "Not authenticated. Run `nimbase auth login`.",
  // Deliberately names the remedy: the most common cause is a stored default
  // workspace the credential can no longer reach, and the old blanket 401
  // message ("run auth login") sent people down a path that never fixed it.
  forbidden:
    "Access denied — your credential cannot access that workspace or folder. Check `nimbase workspace list`, then `nimbase workspace use <slug>`.",
  workspace_required:
    "No workspace specified. Run `nimbase workspace use <slug>` or pass --workspace <slug>.",
  invalid_id: "That id is not valid.",
  invalid_request: "The server rejected the request as invalid.",
  checkout_failed: "Stripe Checkout could not be started. Try again shortly.",
  portal_failed:
    "Stripe Billing Portal could not be started. Try again shortly.",
  not_found: "Not found.",
};

function classify(
  status: number,
  serverCode: string | null,
): { exitCode: number; code: CliErrorCode } {
  if (status === 401) return { exitCode: EXIT.auth, code: "auth_required" };
  if (status === 403) return { exitCode: EXIT.auth, code: "forbidden" };
  if (status === 404) return { exitCode: EXIT.notFound, code: "not_found" };
  if (status === 402) return { exitCode: EXIT.runtime, code: "limit_reached" };
  if (status === 409) return { exitCode: EXIT.runtime, code: "conflict" };
  if (status === 400) {
    return {
      exitCode: EXIT.usage,
      code: serverCode === "invalid_id" ? "usage" : "invalid_request",
    };
  }
  if (status >= 500) return { exitCode: EXIT.runtime, code: "server_error" };
  return { exitCode: EXIT.runtime, code: "runtime" };
}

/** Thin JSON-over-HTTP client for Nimbase's REST API. */
export class ApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly credential: Credential,
  ) {}

  async request<T = unknown>(
    method: string,
    path: string,
    opts: RequestOptions<T> = {},
  ): Promise<T> {
    const url = new URL(path, this.baseUrl);
    for (const [k, v] of Object.entries(opts.query ?? {})) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }

    const headers: Record<string, string> = {};
    if (this.credential.token) {
      headers.Authorization = `Bearer ${this.credential.token}`;
    }
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";

    const res = await fetch(url, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });

    const text = await res.text();
    // Not every response body is JSON: a framework 404, a proxy's HTML error
    // page, or a route replying in plain text would otherwise blow up inside
    // JSON.parse and surface as "Unexpected token 'o'" instead of the actual
    // failure. Parse defensively and fall back to the raw body as the message.
    let data: unknown = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = null;
      }
    }

    if (!res.ok) {
      const serverCode =
        data && typeof data === "object" && "error" in data
          ? String((data as { error: unknown }).error)
          : null;
      const { exitCode, code } = classify(res.status, serverCode);
      // A 404's wording is the caller's to supply — only it knows whether the
      // missing thing is a note, a capture, or an artifact.
      const message =
        (res.status === 404 ? opts.notFound : undefined) ??
        (serverCode ? SERVER_MESSAGES[serverCode] : undefined) ??
        serverCode ??
        summarize(text) ??
        `Request failed (${res.status})`;
      throw new CliError(message, exitCode, { code, httpStatus: res.status });
    }

    if (data === null && text) {
      // 2xx with an unparseable body — the caller expects JSON, so failing
      // here beats handing a zod error to the user.
      throw new CliError(
        `Unexpected non-JSON response (${res.status}) from ${path}`,
        1,
      );
    }

    return opts.schema ? opts.schema.parse(data) : (data as T);
  }
}

/** One readable line from an error body — an HTML page must not fill the terminal. */
function summarize(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const firstLine = trimmed.split("\n")[0] ?? trimmed;
  return firstLine.length > 200 ? `${firstLine.slice(0, 200)}…` : firstLine;
}
