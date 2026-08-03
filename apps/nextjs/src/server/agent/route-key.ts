import "server-only";

import type { ConnectionPlatform } from "@acme/db/schema";

// The tenant id Nimbase routes on (`AgentConnection.routeKey`) is not part of
// Chat SDK's normalized Message — it only survives on the raw platform payload.
// Slack puts it on the event envelope as `team`/`team_id`. It is read
// defensively: an unrecognized shape yields null and the turn is dropped rather
// than mis-routed to another workspace.
//
// A platform added later gets its own arm here (Teams: `tenantId`, Discord:
// `guild_id`). Returning null for an unhandled platform is the safe default —
// fail closed, never guess a tenant.

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function prop(source: unknown, key: string): unknown {
  if (typeof source !== "object" || source === null) return null;
  return (source as Record<string, unknown>)[key];
}

// One reader per platform. Deliberately Partial: `platform` reaches us from a
// `text` column typed by a cast, not a validated value, so rows written by an
// older build (a retired platform) can carry a key this map has never had.
// Modelling that as "missing key" is what makes the miss fail closed below.
const ROUTE_KEY_READERS: Partial<
  Record<ConnectionPlatform, (raw: unknown) => string | null>
> = {
  // `team` is a string on message events and an object on some payloads.
  slack: (raw) =>
    str(prop(raw, "team_id")) ??
    str(prop(raw, "team")) ??
    str(prop(prop(raw, "team"), "id")) ??
    str(prop(prop(raw, "authorizations"), "team_id")),
};

export function routeKeyFor(
  platform: ConnectionPlatform,
  raw: unknown,
): string | null {
  // A miss drops the turn rather than guessing a tenant — mis-routing would
  // deliver one workspace's answer into another's chat.
  return ROUTE_KEY_READERS[platform]?.(raw) ?? null;
}
