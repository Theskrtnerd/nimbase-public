import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ApiClient } from "./client";
import type { CliConfig } from "./config";
import { EXIT } from "./errors";
import { resolveWorkspaceId, resolveWorkspaceSlug } from "./workspace";

const WORKSPACES = {
  workspaces: [
    {
      id: "00000000-0000-4000-8000-000000000001",
      name: "Airwallex",
      slug: "airwallex",
    },
    {
      id: "00000000-0000-4000-8000-000000000002",
      name: "Acme Corporation",
      slug: "acme",
    },
  ],
};

function client(): ApiClient {
  return {
    request: () => Promise.resolve(WORKSPACES),
  } as unknown as ApiClient;
}

// A stored, unexpired session — resolveWorkspaceId asserts a credential before
// it resolves anything, so every case here needs one.
const SIGNED_IN: CliConfig = {
  sessionToken: "session",
  expiresAt: Date.now() + 60_000,
};

beforeEach(() => {
  delete process.env.NIMBASE_TOKEN;
});
afterEach(() => {
  delete process.env.NIMBASE_TOKEN;
});

describe("workspace slug resolution", () => {
  it("resolves a slug to the internal workspace id", async () => {
    await expect(
      resolveWorkspaceId({
        client: client(),
        config: SIGNED_IN,
        override: "acme",
      }),
    ).resolves.toBe("00000000-0000-4000-8000-000000000002");
  });

  // Regression: a signed-out user asking for a workspace-scoped command used to
  // be told "No workspace selected" and sent to `workspace use`, which cannot
  // succeed until they log in.
  it("reports missing authentication before missing workspace selection", async () => {
    await expect(
      resolveWorkspaceId({ client: client(), config: {} }),
    ).rejects.toMatchObject({
      code: "auth_required",
      exitCode: EXIT.auth,
    });
  });

  it("still reports an unselected workspace once authenticated", async () => {
    await expect(
      resolveWorkspaceId({ client: client(), config: SIGNED_IN }),
    ).rejects.toMatchObject({ code: "usage", exitCode: EXIT.usage });
  });

  it("matches slugs case-insensitively", async () => {
    await expect(resolveWorkspaceSlug(client(), "AIRWALLEX")).resolves.toEqual(
      WORKSPACES.workspaces[0],
    );
  });

  it("does not expose UUIDs or display names as public identifiers", async () => {
    await expect(
      resolveWorkspaceSlug(client(), "00000000-0000-4000-8000-000000000001"),
    ).rejects.toThrow('No workspace with slug "00000000');
    await expect(
      resolveWorkspaceSlug(client(), "Acme Corporation"),
    ).rejects.toThrow('No workspace with slug "Acme Corporation"');
  });
});
