import "server-only";

import { z } from "zod";

const slackSecretsSchema = z.object({
  botToken: z.string().min(1),
});

export function parseSlackSecrets(serialized: string): { botToken: string } {
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    throw new Error("malformed Slack connection secret");
  }
  return slackSecretsSchema.parse(value);
}
