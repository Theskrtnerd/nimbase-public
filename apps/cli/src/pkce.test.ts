import { createHash } from "node:crypto";
import { expect, it } from "vitest";

import { createPkce } from "./pkce";

function base64url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

it("produces a verifier, a matching S256 challenge, and a state", () => {
  const { verifier, challenge, state } = createPkce();
  expect(verifier.length).toBeGreaterThanOrEqual(43);
  expect(state.length).toBeGreaterThan(0);
  expect(challenge).toBe(
    base64url(createHash("sha256").update(verifier).digest()),
  );
});

it("is random across calls", () => {
  expect(createPkce().verifier).not.toBe(createPkce().verifier);
});
