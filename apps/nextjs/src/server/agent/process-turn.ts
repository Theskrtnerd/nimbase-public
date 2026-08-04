import "server-only";

import { toAiMessages } from "chat/ai";

import type { AgentTurnJobData } from "@acme/cloud";
import type { ConnectionPlatform } from "@acme/db/schema";
import { resolveAgentScopes } from "@acme/api/access";
import { costFor } from "@acme/cloud";
import {
  buildHarnessMounts,
  kbSearchTool,
  resolveHarnessModel,
  runHarnessAgent,
  WikiFileSystem,
} from "@acme/cloud/harness";
import { WikiReadFs } from "@acme/cloud/memory/wiki";
import { and, eq, gte, sql } from "@acme/db";
import { db } from "@acme/db/client";
import {
  Agent,
  AgentConnection,
  AgentTurn,
  DEFAULT_AGENT_DAILY_CAP_CENTS,
  SpendLedger,
} from "@acme/db/schema";

import { decryptConnectionSecret } from "../connection-secret";
import { agentArtifactTools, BARE_LINK_RULE } from "./artifact-tool";
import { createAttachmentSink } from "./attachments";
import { getBotRuntime } from "./bot";
import { postAttachments } from "./post-attachments";
import { parseSlackSecrets } from "./secrets";
import { createTurnStatus, TURN_STATUS, withToolStatus } from "./status";

// Wall-clock cap for harness turns (Pi owns its inner step loop).
const CHAT_HARNESS_TIMEOUT_MS = 120_000;
// Artifact-enabled turns absorb a blocking generation poll on top of KB reads.
const CHAT_HARNESS_ARTIFACT_TIMEOUT_MS = 240_000;
const RATE_WINDOW_MS = 10 * 60_000; // 10 minutes
const RATE_MAX_TURNS = 20; // per connection per window
const FALLBACK = "I don't have anything on that in the wiki.";
const APOLOGY = "Sorry — I hit an error answering that.";

interface TurnOutcome {
  answer: string;
  tokens: number;
  cents: number;
  error: string | null;
}

// Platforms Chat SDK can upload a rendered artifact file to. Opt-in: a platform
// absent here gets no attachment sink and can only answer with a link.
const UPLOAD_CAPABLE_PLATFORMS = new Set<string>(["slack"]);

/**
 * Bind a function to the connection's platform credential.
 *
 * Adapters resolve tokens from an AsyncLocalStorage request context that only
 * exists inside webhook handling. This turn runs in a QStash worker, so it has
 * to establish that context by hand or every outbound call throws.
 *
 * `platform` and `routeKey` are unused while Slack is the only platform. They
 * stay in the signature because this is the seam a second platform branches on,
 * and because a credential scoped to a tenant (a Teams tenantId, a Discord
 * guildId) needs the routeKey to build its installation.
 */
async function withConnection<T>(
  _platform: ConnectionPlatform,
  secretsJson: string,
  _routeKey: string,
  fn: () => Promise<T>,
): Promise<T> {
  const { botToken } = parseSlackSecrets(secretsJson);
  const { slackAdapter } = getBotRuntime();
  return slackAdapter.withBotToken(botToken, fn);
}

// Run one inbound turn: cap-check, answer from the agent's fenced KB (using the
// platform thread for context), post the reply through Chat SDK, and append to
// the turn log. Caps reuse the turn log + spend ledger. Over a cap, the turn is
// silently dropped.
export async function processAgentTurn(data: AgentTurnJobData): Promise<void> {
  const [conn] = await db
    .select()
    .from(AgentConnection)
    .where(eq(AgentConnection.id, data.connectionId))
    .limit(1);
  if (!conn?.secretsEncrypted || conn.status !== "active") return;

  const [agent] = await db
    .select()
    .from(Agent)
    .where(eq(Agent.id, conn.agentId))
    .limit(1);
  if (!agent?.enabled) return;

  // Rate limit: turns logged for this connection in the recent window.
  const [recent] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(AgentTurn)
    .where(
      and(
        eq(AgentTurn.connectionId, conn.id),
        gte(AgentTurn.createdAt, new Date(Date.now() - RATE_WINDOW_MS)),
      ),
    );
  if ((recent?.n ?? 0) >= RATE_MAX_TURNS) return;

  // Daily spend cap: cents logged against this agent since local midnight.
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const [spent] = await db
    .select({
      cents: sql<number>`coalesce(sum(${AgentTurn.costCents}), 0)::int`,
    })
    .from(AgentTurn)
    .where(
      and(eq(AgentTurn.agentId, agent.id), gte(AgentTurn.createdAt, dayStart)),
    );
  if (
    (spent?.cents ?? 0) >=
    (agent.dailyCostCapCents ?? DEFAULT_AGENT_DAILY_CAP_CENTS)
  ) {
    return;
  }

  const secretsJson = decryptConnectionSecret(conn.secretsEncrypted);
  const scopes = await resolveAgentScopes(agent.id, agent.workspaceId);

  // The agent's only write capability, off unless a manager turned it on. It is
  // built here because artifact authoring must never reach an anonymous web
  // visitor. The generator is fenced to `scopes`, so an artifact can never read
  // more of the wiki than the agent itself.
  // Gated on declared file-upload support rather than assumed: a platform that
  // can't take bytes must get no sink, because withholding it is what collapses
  // `output` back to `link` — the tool sees no sink and never renders.
  const attachments = UPLOAD_CAPABLE_PLATFORMS.has(conn.platform)
    ? createAttachmentSink()
    : undefined;

  const artifactTools = agent.artifactEnabled
    ? agentArtifactTools({
        workspaceId: agent.workspaceId,
        targetFolderId: agent.targetFolderId,
        readScopes: scopes,
        visibility: agent.artifactVisibility,
        attachments,
      })
    : {};
  const artifactInstructions = agent.artifactEnabled
    ? `When the user asks for an analysis, report, dashboard, or anything better shown than told, build it with create_artifact and reply with the link it returns. Gather the facts from the wiki first and put them in the artifact prompt. For a plain question, just answer — don't build a page. ${BARE_LINK_RULE}`
    : null;
  // An artifact call can block while it builds; the default ceiling
  // would cut the turn off mid-tool.
  const harnessTimeoutMs = agent.artifactEnabled
    ? CHAT_HARNESS_ARTIFACT_TIMEOUT_MS
    : CHAT_HARNESS_TIMEOUT_MS;

  // The outcome is returned out of the credential-bound callback rather than
  // assigned to variables around it: mutating a closure defeats TypeScript's
  // narrowing, which then can't see that `error` is ever set.
  const outcome = await withConnection(
    conn.platform,
    secretsJson,
    conn.routeKey,
    async (): Promise<TurnOutcome> => {
      const { bot } = getBotRuntime();
      const thread = bot.thread(data.threadId);
      const status = createTurnStatus(thread);
      // Re-asserted here (the webhook already raised it) so a retried job or a
      // dev inline run still shows something.
      status.show(TURN_STATUS.thinking);

      // Thread-aware: prefer the platform conversation for context, fall back
      // to the single inbound message.
      const history = await thread.adapter
        .fetchMessages(thread.id, { limit: 20 })
        .then((r) => toAiMessages(r.messages))
        .catch(() => []);
      const messages = history.length
        ? history
        : [{ role: "user" as const, content: data.userText }];

      try {
        // Pi-harness runner: read-only wiki mounted at /wiki, thread history
        // flattened into the single prompt (Pi takes one prompt per fresh
        // session; the platform thread is re-fetched every turn anyway).
        const wikiFs = WikiFileSystem.readOnly(
          new WikiReadFs(agent.workspaceId, scopes),
        );
        await wikiFs.prime();
        const mounts = buildHarnessMounts(wikiFs);
        const model = await resolveHarnessModel(agent.workspaceId);
        const kbTools = {
          ...kbSearchTool({
            workspaceId: agent.workspaceId,
            scopes,
          }),
          ...artifactTools,
        };
        const transcript = messages
          .map((m) => {
            const body =
              typeof m.content === "string"
                ? m.content
                : JSON.stringify(m.content);
            return `${m.role === "user" ? "User" : "Assistant"}: ${body}`;
          })
          .join("\n\n");
        const run = await runHarnessAgent({
          agent: "chat",
          fs: mounts.fs,
          model,
          // Only the host-executed tools report status; the harness's built-in
          // file ops run inside Pi's opaque loop, so those steps read as
          // "Thinking…".
          tools: withToolStatus(kbTools, status),
          instructionsExtra: [
            agent.instructions.trim() || null,
            ...(artifactInstructions ? [artifactInstructions] : []),
          ],
          prompt: `<conversation>\n${transcript}\n</conversation>\n\nReply to the last user message.`,
          timeoutMs: harnessTimeoutMs,
          trace: {
            name: "agent-turn",
            workspaceId: agent.workspaceId,
            metadata: { agentId: agent.id, connectionId: conn.id },
          },
        });
        const answer = run.text.trim() || FALLBACK;
        await thread.post(answer);
        await postAttachments(thread, attachments);
        return {
          answer,
          tokens: run.usage.inputTokens + run.usage.outputTokens,
          cents: costFor(model.modelId, run.usage),
          error: null,
        };
      } catch (err) {
        await thread.post(APOLOGY).catch(() => undefined);
        return {
          answer: APOLOGY,
          tokens: 0,
          cents: 0,
          error: err instanceof Error ? err.message : String(err),
        };
      } finally {
        // Slack auto-clears the status when a message lands, but only for the
        // status it knows about — a `show` still in flight from the last tool
        // can re-set it right after the answer posts, leaving "Putting it
        // together…" stuck under a finished reply. Closing the handle here
        // drains those and takes the indicator down explicitly.
        await status.clear();
      }
    },
  );

  await db.insert(AgentTurn).values({
    agentId: agent.id,
    connectionId: conn.id,
    workspaceId: agent.workspaceId,
    channelKey: data.threadId,
    question: data.userText,
    answer: outcome.error ? null : outcome.answer,
    tokens: outcome.tokens,
    costCents: outcome.cents,
    error: outcome.error,
  });
  if (outcome.cents > 0) {
    await db.insert(SpendLedger).values({
      workspaceId: agent.workspaceId,
      kind: "agent",
      cents: outcome.cents,
    });
  }
}
