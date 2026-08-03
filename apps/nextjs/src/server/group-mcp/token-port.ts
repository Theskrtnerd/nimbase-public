import "server-only";

import type { TokenPort } from "@acme/api";
import { eq } from "@acme/db";
import { db } from "@acme/db/client";
import { ApiToken } from "@acme/db/schema";

import { mintToken } from "~/server/auth/mint-token";

// Real TokenPort adapter, wired into the dashboard tRPC context
// (`app/api/trpc/[trpc]/route.ts`). Mints through the existing
// `mintToken` seam. Tokens are ordinary folder-scoped credentials.
export const tokensPort: TokenPort = {
  async mint(input) {
    const minted = await mintToken({
      workspaceId: input.workspaceId,
      role: input.role,
      folderId: input.folderId,
      label: input.label,
    });
    if (input.groupMcpId) {
      await db
        .update(ApiToken)
        .set({ groupMcpId: input.groupMcpId })
        .where(eq(ApiToken.id, minted.id));
    }
    return { id: minted.id, token: minted.token };
  },
  async revoke(tokenId) {
    await db.delete(ApiToken).where(eq(ApiToken.id, tokenId));
  },
};
