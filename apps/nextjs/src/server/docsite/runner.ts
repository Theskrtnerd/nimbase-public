import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { env } from "~/env";

/**
 * The external build runner.
 *
 * `astro build` needs a real filesystem and `node_modules`; nothing in the
 * serverless runtime can provide that. So the job projects content here, drops
 * a bundle in S3, and hands off to a GitHub Actions workflow in a dedicated
 * repo that holds the scaffolded Nimbus tree with its dependencies cached. The
 * runner builds, uploads `dist/` back to S3, and calls back.
 *
 * The runner is deliberately dumb: it receives already-fenced content and never
 * talks to the database. It cannot widen what a site contains even if it is
 * compromised — the fence was applied before the bundle was written.
 */

export interface RunnerDispatch {
  buildId: string;
  workspaceId: string;
  /** S3 key of the projected content bundle. */
  inputKey: string;
  /** Nimbus templates tag the site is pinned to. */
  templateVersion: string;
}

export class RunnerUnavailableError extends Error {
  constructor() {
    super(
      "The docs build runner is not configured (DOCS_BUILDER_REPO / DOCS_BUILDER_TOKEN)",
    );
    this.name = "RunnerUnavailableError";
  }
}

export function runnerConfigured(): boolean {
  return Boolean(env.DOCS_BUILDER_REPO && env.DOCS_BUILDER_TOKEN);
}

/**
 * Sign a build id for the completion callback. The runner echoes this back so
 * the callback route can prove the report came from a build we actually
 * started — the runner never holds a database credential, and a forged
 * "succeeded" callback would flip a site's live build.
 */
export function signBuildCallback(buildId: string, secret: string): string {
  return createHmac("sha256", secret).update(buildId).digest("hex");
}

/** Constant-time compare, tolerant of malformed input. */
export function verifyBuildCallback(
  buildId: string,
  signature: string,
  secret: string,
): boolean {
  const expected = signBuildCallback(buildId, secret);
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Fire the workflow. `repository_dispatch` is one POST and needs no runner
 * process of our own; the payload carries only ids and keys, never content.
 */
export async function dispatchToRunner(args: RunnerDispatch): Promise<void> {
  const repo = env.DOCS_BUILDER_REPO;
  const token = env.DOCS_BUILDER_TOKEN;
  const secret = env.DOCS_BUILDER_CALLBACK_SECRET;
  if (!repo || !token || !secret) throw new RunnerUnavailableError();

  const response = await fetch(
    `https://api.github.com/repos/${repo}/dispatches`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        event_type: "docsite-build",
        client_payload: {
          buildId: args.buildId,
          workspaceId: args.workspaceId,
          inputKey: args.inputKey,
          templateVersion: args.templateVersion,
          callbackUrl: `${env.NIMBASE_WEB_URL}/api/docsites/callback`,
          callbackSignature: signBuildCallback(args.buildId, secret),
        },
      }),
    },
  );

  if (!response.ok) {
    // GitHub returns 204 on success; anything else means the build never
    // started, so the caller marks the build failed rather than leaving the
    // site stuck in "building" waiting for a callback that will never arrive.
    throw new Error(
      `Build runner dispatch failed (${response.status}): ${await response
        .text()
        .catch(() => "")}`,
    );
  }
}
