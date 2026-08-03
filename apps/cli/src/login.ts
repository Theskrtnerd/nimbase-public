import { openBrowser } from "./browser";
import { loadConfig, saveConfig } from "./config";
import { CliError } from "./errors";
import { waitForLoopbackCallback } from "./loopback";
import { createPkce } from "./pkce";

export interface LoginUser {
  id: string;
  email: string | null;
  name: string | null;
}

interface TokenResponse {
  token: string;
  expiresAt: number | string;
  user: LoginUser;
}

const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Loopback PKCE login (RFC 8252): spin up a one-shot local server, send the
 * user through `/desktop/authorize`, capture the returned code, and exchange it
 * at `/api/extension/token` for a 30-day session token stored in config.
 */
export async function login(baseUrl: string): Promise<LoginUser> {
  const { verifier, challenge, state } = createPkce();
  const code = await waitForLoopbackCallback({
    state,
    valueParam: "code",
    timeoutMs: LOGIN_TIMEOUT_MS,
    successTitle: "Login complete",
    failureTitle: "Login failed",
    invalidMessage: "Login failed: invalid callback",
    timeoutMessage: "Login timed out",
    exitCode: 4,
    onReady(redirect) {
      const authorizeUrl = new URL("/desktop/authorize", baseUrl);
      authorizeUrl.searchParams.set("challenge", challenge);
      authorizeUrl.searchParams.set("state", state);
      authorizeUrl.searchParams.set("redirect", redirect);
      process.stderr.write(
        `Opening your browser to sign in. If it does not open, visit:\n${authorizeUrl.toString()}\n`,
      );
      openBrowser(authorizeUrl.toString());
    },
  });

  const res = await fetch(new URL("/api/extension/token", baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, codeVerifier: verifier }),
  });
  if (!res.ok) {
    throw new CliError(`Token exchange failed (${res.status})`, 4);
  }
  const data = (await res.json()) as TokenResponse;
  const expiresAt =
    typeof data.expiresAt === "string"
      ? Date.parse(data.expiresAt)
      : data.expiresAt;

  const config = await loadConfig();
  await saveConfig({
    ...config,
    sessionToken: data.token,
    expiresAt,
  });
  return data.user;
}
