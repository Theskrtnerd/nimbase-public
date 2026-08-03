import { Client } from "@upstash/qstash";
import { z } from "zod/v4";

// Job payloads are declared as schemas here, and the TS types are derived from
// them, so the wire contract has exactly one definition. The QStash worker
// routes parse with these same schemas rather than hand-written mirrors: a
// mirror that omits a field silently strips it (zod drops unknown keys).

export const compileJobSchema = z.object({
  jobId: z.string(),
  workspaceId: z.string(),
  sourceId: z.string(),
});
export type CompileJobData = z.infer<typeof compileJobSchema>;

let qstashClient: Client | null = null;

function qstash(): Client {
  const token = process.env.QSTASH_TOKEN;
  if (!token) throw new Error("QSTASH_TOKEN is not set");
  qstashClient ??= new Client({ token });
  return qstashClient;
}

export async function publishCompile(data: CompileJobData): Promise<void> {
  const base = process.env.NIMBASE_WEB_URL;
  if (!base) throw new Error("NIMBASE_WEB_URL is not set");
  await qstash().publishJSON({
    url: `${base}/api/compile`,
    body: data,
    deduplicationId: data.jobId,
    retries: 3,
    // The gardener does read-modify-write over the whole wiki; two compiles
    // on one workspace must never interleave. neon-http can't hold locks
    // across a job, so serialization lives here at the queue.
    flowControl: { key: `compile-${data.workspaceId}`, parallelism: 1 },
  });
}

export const extractJobSchema = z.object({
  jobId: z.string(),
  workspaceId: z.string(),
  sourceId: z.string(),
});
export type ExtractJobData = z.infer<typeof extractJobSchema>;

export async function publishExtract(data: ExtractJobData): Promise<void> {
  const base = process.env.NIMBASE_WEB_URL;
  if (!base) throw new Error("NIMBASE_WEB_URL is not set");
  // Independent per source (no shared wiki state to serialize on, unlike
  // compile) — no flowControl needed.
  await qstash().publishJSON({
    url: `${base}/api/extract`,
    body: data,
    deduplicationId: data.jobId,
    retries: 3,
  });
}

export const artifactGenerateJobSchema = z.object({
  jobId: z.string(),
  artifactId: z.string(),
  workspaceId: z.string(),
  prompt: z.string().optional(),
  kind: z.enum(["freeform", "fixed"]),
  themeMode: z.enum(["app", "custom"]),
  themeDescription: z.string().optional(),
  // Creator's read scopes, snapshotted at enqueue. Fences the generator's
  // read tools. null = unrestricted (admin). Structurally a PathScope[].
  readScopes: z
    .array(z.object({ prefix: z.string(), exclude: z.array(z.string()) }))
    .nullable()
    .optional(),
});
export type ArtifactGenerateJobData = z.infer<typeof artifactGenerateJobSchema>;

export async function publishArtifactGenerate(
  data: ArtifactGenerateJobData,
): Promise<void> {
  const base = process.env.NIMBASE_WEB_URL;
  if (!base) throw new Error("NIMBASE_WEB_URL is not set");
  // Unlike compile there is no flow control: artifact generations are
  // independent of each other (no shared wiki state to serialize on).
  await qstash().publishJSON({
    url: `${base}/api/artifacts/generate`,
    body: data,
    deduplicationId: data.jobId,
    retries: 3,
  });
}

// A documentation-site build. Deliberately minimal: the fence is NOT in this
// payload. `resolveDocSiteFence` derives it from the site's folder anchor at
// job time, so no enqueue — from any surface, by any caller — can widen what a
// published site contains.
export const docSiteBuildJobSchema = z.object({
  jobId: z.string(),
  buildId: z.string(),
  docSiteId: z.string(),
  workspaceId: z.string(),
});
export type DocSiteBuildJobData = z.infer<typeof docSiteBuildJobSchema>;

export async function publishDocSiteBuild(
  data: DocSiteBuildJobData,
): Promise<void> {
  const base = process.env.NIMBASE_WEB_URL;
  if (!base) throw new Error("NIMBASE_WEB_URL is not set");
  await qstash().publishJSON({
    url: `${base}/api/docsites/generate`,
    body: data,
    deduplicationId: data.jobId,
    // A docs build fans out to an external runner and is expensive; a retry
    // storm would queue duplicate builds behind each other for no benefit.
    retries: 1,
  });
}

export const agentTurnJobSchema = z.object({
  jobId: z.string(),
  connectionId: z.string(),
  // Chat SDK thread id — the whole reply address in one opaque string
  // ("slack:C123:1699.99"). Platform-prefixed and treated as opaque here, so a
  // new platform needs no change to this payload. The worker rehydrates it with
  // `bot.thread(threadId)`.
  threadId: z.string(),
  userText: z.string(),
  externalUserId: z.string(),
});
export type AgentTurnJobData = z.infer<typeof agentTurnJobSchema>;

export async function publishAgentTurn(data: AgentTurnJobData): Promise<void> {
  const base = process.env.NIMBASE_WEB_URL;
  if (!base) throw new Error("NIMBASE_WEB_URL is not set");
  await qstash().publishJSON({
    url: `${base}/api/agents/turn`,
    body: data,
    deduplicationId: data.jobId,
    retries: 3,
    // Serialize turns per connection so a channel can't trigger overlapping runs.
    flowControl: { key: `agent-turn-${data.connectionId}`, parallelism: 1 },
  });
}

export const crawlJobSchema = z.object({
  jobId: z.string(),
  runId: z.uuid(),
  connectionId: z.string(),
  workspaceId: z.string(),
});
export type CrawlJobData = z.infer<typeof crawlJobSchema>;

export async function publishCrawl(data: CrawlJobData): Promise<void> {
  const base = process.env.NIMBASE_WEB_URL;
  if (!base) throw new Error("NIMBASE_WEB_URL is not set");
  await qstash().publishJSON({
    url: `${base}/api/crawl`,
    body: data,
    deduplicationId: data.jobId,
    retries: 3,
    // A connector mutates per-connection cursor and run state, so overlapping
    // runs of the same connection must be serialized.
    flowControl: { key: `crawl-${data.connectionId}`, parallelism: 1 },
  });
}

export const brainInitJobSchema = z.object({
  jobId: z.string(),
  workspaceId: z.string(),
  websiteUrl: z.string().nullable().optional(),
  identitySources: z
    .object({
      title: z.enum(["manual", "website"]),
      description: z.enum(["manual", "website"]),
    })
    .optional(),
  // Retained so jobs queued by an older deployment still resolve identity.
  identitySource: z.enum(["manual", "website"]).default("manual"),
});
export type BrainInitJobData = z.infer<typeof brainInitJobSchema>;

export async function publishBrainInit(data: BrainInitJobData): Promise<void> {
  const base = process.env.NIMBASE_WEB_URL;
  if (!base) throw new Error("NIMBASE_WEB_URL is not set");
  // Unlike compile, brain-init jobs are independent of each other (no shared
  // wiki state to serialize on) — no flowControl needed.
  await qstash().publishJSON({
    url: `${base}/api/brain/init`,
    body: data,
    deduplicationId: `brain-init-${data.jobId}`,
    retries: 3,
  });
}

// The scheduler destination path — a single recurring QStash schedule hits this
// route, which fans out per-connection crawl jobs. Kept here so `publishCrawl`
// and `ensureCrawlSchedule` agree on the base URL derivation.
const CRAWL_SCHEDULER_PATH = "/api/crawl/scheduler";

// Idempotently ensure the one master crawl schedule exists (list → create if
// absent). Safe to call at deploy/boot. Returns the scheduleId.
export async function ensureCrawlSchedule(
  cron = "*/15 * * * *",
): Promise<string> {
  const base = process.env.NIMBASE_WEB_URL;
  if (!base) throw new Error("NIMBASE_WEB_URL is not set");
  const destination = `${base}${CRAWL_SCHEDULER_PATH}`;
  const client = qstash();
  const existing = await client.schedules.list();
  const found = existing.find((s) => s.destination === destination);
  if (found) return found.scheduleId;
  const created = await client.schedules.create({ destination, cron });
  return created.scheduleId;
}
