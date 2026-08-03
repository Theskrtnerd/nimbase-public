import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { env } from "~/env";

// HMAC-signed OAuth state shared by every platform's install flow: CSRF defence
// plus carrying which agent is being deployed and by whom (re-checked on callback).
function stateKey(): string {
  const secret = env.AGENT_CONNECTION_SECRET;
  if (!secret) throw new Error("AGENT_CONNECTION_SECRET is not set");
  return secret;
}

export interface AgentOAuthState {
  agentId: string;
  userId: string;
  redirect?: string;
}

export function signState(payload: AgentOAuthState): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mac = createHmac("sha256", stateKey()).update(body).digest("base64url");
  return `${body}.${mac}`;
}

export function verifyState(state: string): AgentOAuthState | null {
  const [body, mac] = state.split(".");
  if (!body || !mac) return null;
  const expected = createHmac("sha256", stateKey())
    .update(body)
    .digest("base64url");
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(body, "base64url").toString(),
    ) as Partial<AgentOAuthState>;
    if (
      typeof parsed.agentId !== "string" ||
      typeof parsed.userId !== "string" ||
      (parsed.redirect !== undefined && typeof parsed.redirect !== "string")
    ) {
      return null;
    }
    return {
      agentId: parsed.agentId,
      userId: parsed.userId,
      redirect: parsed.redirect,
    };
  } catch {
    return null;
  }
}
