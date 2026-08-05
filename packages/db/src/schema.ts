import type { JsonValue } from "@nimbase/connector-sdk";
import { connectorIdSchema } from "@nimbase/connector-sdk";
import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  pgTable,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const Workspace = pgTable(
  "workspace",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    name: t.varchar({ length: 120 }).notNull(),
    slug: t.text().notNull(),
    description: t.text(),
    // Company website collected at onboarding; reused by the Biographer and
    // import suggestions (collect once, reuse everywhere).
    website: t.text(),
    // Lifecycle of the day-zero Biographer draft of company.md.
    brainInitStatus: t
      .text("brain_init_status")
      .notNull()
      .$type<BrainInitStatus>()
      .default("pending"),
    ownerUserId: t.text().notNull(),
    createdAt: t.timestamp().defaultNow().notNull(),
    updatedAt: t
      .timestamp({ mode: "date", withTimezone: true })
      .$onUpdateFn(() => new Date()),
  }),
  (table) => [uniqueIndex("workspace_slug_idx").on(table.slug)],
);

export const CreateWorkspaceSchema = createInsertSchema(Workspace, {
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(280).optional(),
  website: z.url().max(500).optional(),
}).pick({
  name: true,
  description: true,
  website: true,
});

export const UpdateWorkspaceSchema = createInsertSchema(Workspace, {
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(280).optional(),
})
  .pick({ name: true, description: true })
  .extend({ id: z.string().uuid() });

// --- Shared enum validators (text columns validated at the edge) ---
export const sourceKindSchema = z.enum([
  "web",
  "chat_export",
  "highlight",
  "screenshot",
  "voice",
  "video",
  "file",
]);
export type SourceKind = z.infer<typeof sourceKindSchema>;

export const sourceStatusSchema = z.enum([
  "uploading",
  // Binary/file kinds only: the async extract job is turning the original
  // into raw.md (OCR/transcription or a plain decode).
  "extracting",
  "queued",
  // Provider-managed source. The raw evidence is retained, but compilation is
  // deliberately paused until the compiler can preserve changing provider
  // policy across every derived memory.
  "held",
  "compiled",
  "failed",
]);
export type SourceStatus = z.infer<typeof sourceStatusSchema>;

export const brainInitStatusSchema = z.enum(["pending", "done", "failed"]);
export type BrainInitStatus = z.infer<typeof brainInitStatusSchema>;

// --- source.metadata: structured capture metadata, mirrored into raw.md's
// frontmatter by buildRawMd (@acme/runtime). Union of what's known across
// kinds; every field optional since it varies by kind. passthrough() so a
// future kind-specific field doesn't get silently dropped at the edge.
export const sourceMetadataSchema = z
  .object({
    sourceUrl: z.string().optional(),
    domain: z.string().optional(),
    author: z.string().optional(),
    siteName: z.string().optional(),
    publishedAt: z.string().optional(),
    image: z.string().optional(),
    language: z.string().optional(),
    wordCount: z.number().optional(),
    tags: z.array(z.string()).optional(),
    // chat_export
    provider: z.string().optional(),
    messageCount: z.number().optional(),
    captureQuality: z.string().optional(),
    codeBlocks: z.number().optional(),
    links: z.array(z.string()).optional(),
    // extraction provenance (screenshot/voice/non-text file)
    extractionModelId: z.string().optional(),
    // extraction provenance for the non-AI path: which service produced the
    // body and what format it decided the bytes were, e.g. "parser:pdf".
    extractedBy: z.string().optional(),
    // archive provenance, set on a child born from a .zip expansion: the
    // container Source it came from and its path inside the archive. The
    // container's own summary lives in Source.compileReport, not here.
    archiveSourceId: z.string().optional(),
    archivePath: z.string().optional(),
    // carried through from the extension when captured, otherwise omitted
    schemaOrgData: z.unknown().optional(),
    metaTags: z
      .array(
        z.object({
          name: z.string().nullable().optional(),
          property: z.string().nullable().optional(),
          content: z.string().nullable(),
        }),
      )
      .optional(),
    fullHtml: z.string().optional(),
  })
  .passthrough();
export type SourceMetadata = z.infer<typeof sourceMetadataSchema>;

export const wikiNodeKindSchema = z.enum(["folder", "note", "dataset"]);
export type WikiNodeKind = z.infer<typeof wikiNodeKindSchema>;

export const compileJobStatusSchema = z.enum([
  "queued",
  "running",
  "applying",
  "done",
  "failed",
]);
export type CompileJobStatus = z.infer<typeof compileJobStatusSchema>;

export const spendKindSchema = z.enum([
  "compile",
  "embed",
  "artifact",
  "agent",
  "extract",
  "biographer",
]);
export type SpendKind = z.infer<typeof spendKindSchema>;

export const workspaceRoleSchema = z.enum(["owner", "admin", "member"]);
export type WorkspaceRole = z.infer<typeof workspaceRoleSchema>;

export const grantRoleSchema = z.enum(["viewer", "contributor", "manager"]);
export type GrantRole = z.infer<typeof grantRoleSchema>;

export const grantPrincipalTypeSchema = z.enum([
  "user",
  "group",
  "all_members",
  // An agent is a first-class grant principal: principalId = Agent.id. Its read
  // scope is resolved from these rows exactly like a user's (see resolveAgentScopes).
  "agent",
]);
export type GrantPrincipalType = z.infer<typeof grantPrincipalTypeSchema>;

export const inviteStatusSchema = z.enum(["pending", "accepted", "revoked"]);
export type InviteStatus = z.infer<typeof inviteStatusSchema>;

export const userProfileStatusSchema = z.enum(["active", "inactive"]);
export type UserProfileStatus = z.infer<typeof userProfileStatusSchema>;

export const providerAccessVisibilitySchema = z.enum([
  "workspace",
  "restricted",
]);
export type ProviderAccessVisibility = z.infer<
  typeof providerAccessVisibilitySchema
>;

export const providerAccessCompletenessSchema = z.enum(["complete", "partial"]);
export type ProviderAccessCompleteness = z.infer<
  typeof providerAccessCompletenessSchema
>;

export const providerAccessGrantSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("user_profile"), userProfileId: z.uuid() }),
  z.object({ type: z.literal("email"), email: z.email() }),
  z.object({ type: z.literal("domain"), domain: z.string().min(1) }),
  z.object({
    type: z.literal("external_identity"),
    provider: z.string().min(1),
    tenantId: z.string().min(1),
    subject: z.string().min(1),
  }),
]);
export type ProviderAccessGrantDefinition = z.infer<
  typeof providerAccessGrantSchema
>;

export const providerAccessPolicyDefinitionSchema = z.object({
  version: z.literal(1),
  provider: z.string().min(1),
  tenantId: z.string().min(1),
  visibility: providerAccessVisibilitySchema,
  completeness: providerAccessCompletenessSchema,
  grants: z.array(providerAccessGrantSchema),
});
export type ProviderAccessPolicyDefinition = z.infer<
  typeof providerAccessPolicyDefinitionSchema
>;

export const providerAccessGrantTypeSchema = z.enum([
  "user_profile",
  "email",
  "domain",
  "external_identity",
]);
export type ProviderAccessGrantType = z.infer<
  typeof providerAccessGrantTypeSchema
>;

export interface InitialGrant {
  folderId: string | null; // null = workspace root
  role: GrantRole;
}

// --- Group MCP: the fixed KB tool set + auth methods exposed per endpoint ---
export const GROUP_MCP_TOOLS = [
  "search",
  "get_note",
  "list_sources",
  "capture",
  "create_artifact",
] as const;
export const groupMcpToolSchema = z.enum(GROUP_MCP_TOOLS);
export type GroupMcpTool = z.infer<typeof groupMcpToolSchema>;

// Tools that write into the endpoint folder. Exposing any of them is what
// justifies minting the endpoint's principal as contributor rather than
// viewer — artifact authoring is gated on canCapture at the anchor, same as
// capture. Kept beside the vocabulary so the access resolver, the token mint,
// and the admin router cannot drift on what counts as a write.
export const GROUP_MCP_WRITE_TOOLS: readonly GroupMcpTool[] = [
  "capture",
  "create_artifact",
];
export function groupMcpNeedsWriteRole(tools: GroupMcpTool[]): boolean {
  return tools.some((t) => GROUP_MCP_WRITE_TOOLS.includes(t));
}

export const mcpAuthMethodSchema = z.enum(["api_key", "oauth"]);
export type McpAuthMethod = z.infer<typeof mcpAuthMethodSchema>;

// --- api_token: per-workspace bearer tokens for the extension / API ---
export const ApiToken = pgTable("api_token", (t) => ({
  id: t.uuid().notNull().primaryKey().defaultRandom(),
  workspaceId: t
    .uuid("workspace_id")
    .notNull()
    .references(() => Workspace.id, { onDelete: "cascade" }),
  tokenHash: t.text("token_hash").notNull(),
  label: t.varchar({ length: 120 }).notNull(),
  // Token scope: capture/read limited to this subtree (null = root).
  folderId: t
    .uuid("folder_id")
    .references(() => WikiNode.id, { onDelete: "set null" }),
  groupMcpId: t
    .uuid("group_mcp_id")
    .references(() => GroupMcp.id, { onDelete: "cascade" }),
  role: t.text().notNull().$type<GrantRole>().default("contributor"),
  lastUsedAt: t.timestamp("last_used_at", { withTimezone: true }),
  // Null = no expiry. Enforced at verify time; expired tokens stay listed so
  // their owner can see (and delete) them.
  expiresAt: t.timestamp("expires_at", { withTimezone: true }),
  createdAt: t
    .timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
}));

export const CreateApiTokenSchema = createInsertSchema(ApiToken, {
  label: z.string().trim().min(1).max(120),
}).omit({
  id: true,
  lastUsedAt: true,
  createdAt: true,
});

// --- provider access: immutable provider ACL snapshots + normalized grants ---
//
// Policy rows are content-addressed by a canonical fingerprint. Sources with
// the same provider policy share one row; grants stay normalized so access can
// be enforced in SQL before ranking or returning source metadata.
export const ProviderAccessPolicy = pgTable(
  "provider_access_policy",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    workspaceId: t
      .uuid("workspace_id")
      .notNull()
      .references(() => Workspace.id, { onDelete: "cascade" }),
    fingerprint: t.text().notNull(),
    provider: t.text().notNull(),
    tenantId: t.text("tenant_id").notNull(),
    visibility: t.text().notNull().$type<ProviderAccessVisibility>(),
    completeness: t.text().notNull().$type<ProviderAccessCompleteness>(),
    definition: t.jsonb().notNull().$type<ProviderAccessPolicyDefinition>(),
    createdAt: t
      .timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  }),
  (table) => [
    uniqueIndex("provider_access_policy_workspace_fingerprint_idx").on(
      table.workspaceId,
      table.fingerprint,
    ),
    index("provider_access_policy_workspace_visibility_idx").on(
      table.workspaceId,
      table.visibility,
    ),
    check(
      "provider_access_policy_visibility_check",
      sql`${table.visibility} in ('workspace', 'restricted')`,
    ),
    check(
      "provider_access_policy_completeness_check",
      sql`${table.completeness} in ('complete', 'partial')`,
    ),
  ],
);

export const ProviderAccessGrant = pgTable(
  "provider_access_grant",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    workspaceId: t
      .uuid("workspace_id")
      .notNull()
      .references(() => Workspace.id, { onDelete: "cascade" }),
    policyId: t
      .uuid("policy_id")
      .notNull()
      .references(() => ProviderAccessPolicy.id, { onDelete: "cascade" }),
    principalType: t
      .text("principal_type")
      .notNull()
      .$type<ProviderAccessGrantType>(),
    userProfileId: t.uuid("user_profile_id"),
    email: t.text(),
    domain: t.text(),
    provider: t.text(),
    tenantId: t.text("tenant_id"),
    subject: t.text(),
    createdAt: t
      .timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  }),
  (table) => [
    unique("provider_access_grant_identity_idx")
      .on(
        table.policyId,
        table.principalType,
        table.userProfileId,
        table.email,
        table.domain,
        table.provider,
        table.tenantId,
        table.subject,
      )
      .nullsNotDistinct(),
    index("provider_access_grant_policy_idx").on(table.policyId),
    index("provider_access_grant_profile_idx").on(table.userProfileId),
    index("provider_access_grant_email_idx").on(table.email),
    index("provider_access_grant_external_idx").on(
      table.provider,
      table.tenantId,
      table.subject,
    ),
    check(
      "provider_access_grant_shape_check",
      sql`(
        (${table.principalType} = 'user_profile' AND ${table.userProfileId} IS NOT NULL
          AND ${table.email} IS NULL AND ${table.domain} IS NULL
          AND ${table.provider} IS NULL AND ${table.tenantId} IS NULL AND ${table.subject} IS NULL)
        OR (${table.principalType} = 'email' AND ${table.email} IS NOT NULL
          AND ${table.userProfileId} IS NULL AND ${table.domain} IS NULL
          AND ${table.provider} IS NULL AND ${table.tenantId} IS NULL AND ${table.subject} IS NULL)
        OR (${table.principalType} = 'domain' AND ${table.domain} IS NOT NULL
          AND ${table.userProfileId} IS NULL AND ${table.email} IS NULL
          AND ${table.provider} IS NULL AND ${table.tenantId} IS NULL AND ${table.subject} IS NULL)
        OR (${table.principalType} = 'external_identity'
          AND ${table.provider} IS NOT NULL AND ${table.tenantId} IS NOT NULL AND ${table.subject} IS NOT NULL
          AND ${table.userProfileId} IS NULL AND ${table.email} IS NULL AND ${table.domain} IS NULL)
      )`,
    ),
  ],
);

// --- source: raw captured input + compile job state ---
export const Source = pgTable(
  "source",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    workspaceId: t
      .uuid("workspace_id")
      .notNull()
      .references(() => Workspace.id, { onDelete: "cascade" }),
    kind: t.text().notNull().$type<SourceKind>(),
    sourceUrl: t.text("source_url"),
    title: t.text(),
    // Byte-exact, untouched original — same filename/format as captured.
    // The sole trace-back artifact; never modified after write.
    s3KeyOriginal: t.text("s3_key_original").notNull(),
    // Extracted text + metadata frontmatter, always markdown, the sole input
    // to compile. Null until assembled: synchronously at ingest for text
    // kinds, or by the async extract job for screenshot/voice/file. Pre-
    // migration rows may never get one — process.ts falls back to the
    // original in that case.
    s3KeyRawMd: t.text("s3_key_raw_md"),
    // The real captured filename (extension ClipArtifact.filename, or a CLI
    // --file basename). Null for pre-migration rows.
    originalFilename: t.text("original_filename"),
    // Mime of the original artifact — set for every binary/file kind, null
    // for the plain-text kinds (web/chat_export/highlight).
    mimeType: t.text("mime_type"),
    // original artifact byte size — text length for markdown, presign sizeBytes for binary/file.
    // Nullable; existing rows count as 0. Drives the workspace storage meter.
    sizeBytes: t.bigint("size_bytes", { mode: "number" }),
    status: t.text().notNull().$type<SourceStatus>().default("queued"),
    // sha256 hex of the original bytes/text — integrity check + future dedup.
    contentHash: t.text("content_hash"),
    idempotencyKey: t.text("idempotency_key"),
    error: t.text(),
    metadata: t.jsonb().$type<SourceMetadata>(),
    capturedAt: t.timestamp("captured_at", { withTimezone: true }),
    createdAt: t
      .timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    compiledAt: t.timestamp("compiled_at", { withTimezone: true }),
    // The gardener's final summary of what it changed; partial progress on failure.
    compileReport: t.text("compile_report"),
    // Who captured this source. Clerk user id is the durable identity;
    // capturedByName is a display snapshot resolved at ingest so the read
    // path (the Clerk-agnostic @acme/api package) never has to call Clerk.
    // Both are null for the ApiToken ingest path (no user) and for rows
    // created before this column existed.
    capturedByUserId: t.text("captured_by_user_id"),
    capturedByName: t.text("captured_by_name"),
    // Capture target space (null = root). The gardener fences to this subtree.
    targetFolderId: t
      .uuid("target_folder_id")
      .references(() => WikiNode.id, { onDelete: "set null" }),
    // Scheduled-crawl provenance. Null = a human/manual capture. Set-null on
    // disconnect so crawled memory survives the connection being removed.
    connectionId: t
      .uuid("connection_id")
      .references(() => SourceConnection.id, { onDelete: "set null" }),
    // The external entity id this source mirrors (e.g. a Linear "ENG-42"),
    // null for manual captures. Traceability + the continuity signal the
    // gardener uses to merge re-crawls of the same entity into one note.
    externalId: t.text("external_id"),
    // Null for manual captures and legacy rows. Provider-managed sources must
    // reference the immutable ACL snapshot that governed the external item at
    // capture time.
    accessPolicyId: t
      .uuid("access_policy_id")
      .references(() => ProviderAccessPolicy.id, { onDelete: "restrict" }),
  }),
  (table) => [
    uniqueIndex("source_workspace_idempotency_key_idx").on(
      table.workspaceId,
      table.idempotencyKey,
    ),
    index("source_connection_idx").on(table.connectionId),
    index("source_access_policy_idx").on(table.accessPolicyId),
  ],
);

export const CreateSourceSchema = createInsertSchema(Source, {
  kind: sourceKindSchema,
  sourceUrl: z.string().url().optional(),
  title: z.string().max(512).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
}).omit({
  id: true,
  status: true,
  contentHash: true,
  error: true,
  createdAt: true,
  compiledAt: true,
  accessPolicyId: true,
});

// --- wiki_node: the compiled KB tree (one row per node) ---
export const WikiNode = pgTable(
  "wiki_node",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    workspaceId: t
      .uuid("workspace_id")
      .notNull()
      .references(() => Workspace.id, { onDelete: "cascade" }),
    path: t.text().notNull(),
    kind: t.text().notNull().$type<WikiNodeKind>().default("note"),
    currentVersionId: t.uuid("current_version_id"),
    // Soft delete by the gardener agent; every read path filters this.
    deletedAt: t.timestamp("deleted_at", { withTimezone: true }),
    // User-locked: the gardener must not write/edit/mv/rm a pinned node.
    // No UI sets it yet; enforced in the VFS adapter.
    pinned: t.boolean().notNull().default(false),
    // Restricted boundary: grants from outside this folder do not flow in.
    restricted: t.boolean().notNull().default(false),
    // Derived display title, recomputed from the current version's
    // frontmatter on every write (see compile/title.ts). Required — new
    // notes must declare a title at creation (@acme/runtime/memory/wiki vfs.ts write()); there
    // is no path-derived fallback anywhere in the running app. Folder rows
    // (kind: "folder") get a throwaway value at insert since nothing ever
    // displays it — the column is NOT NULL table-wide.
    title: t.text().notNull(),
    createdAt: t
      .timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: t
      .timestamp("updated_at", { mode: "date", withTimezone: true })
      .$onUpdateFn(() => new Date()),
  }),
  (table) => [
    // One live node per path: permission anchors (grants, restricted flags)
    // key off folder rows, so duplicate live paths must be impossible.
    // Soft-deleted rows are exempt (a recreated path gets a fresh row).
    uniqueIndex("wiki_node_workspace_path_idx")
      .on(table.workspaceId, table.path)
      .where(sql`${table.deletedAt} is null`),
  ],
);

// --- wiki_node_version: append-only version history (LWW) ---
export const WikiNodeVersion = pgTable("wiki_node_version", (t) => ({
  id: t.uuid().notNull().primaryKey().defaultRandom(),
  nodeId: t
    .uuid("node_id")
    .notNull()
    .references(() => WikiNode.id, { onDelete: "cascade" }),
  workspaceId: t
    .uuid("workspace_id")
    .notNull()
    .references(() => Workspace.id, { onDelete: "cascade" }),
  s3Key: t.text("s3_key").notNull(),
  summary: t.text(),
  sourceId: t
    .uuid("source_id")
    .references(() => Source.id, { onDelete: "set null" }),
  createdAt: t
    .timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
}));

// --- wiki_chunk: heading-aware chunks + embeddings for retrieval ---
export const WikiChunk = pgTable("wiki_chunk", (t) => ({
  id: t.uuid().notNull().primaryKey().defaultRandom(),
  nodeVersionId: t
    .uuid("node_version_id")
    .notNull()
    .references(() => WikiNodeVersion.id, { onDelete: "cascade" }),
  workspaceId: t
    .uuid("workspace_id")
    .notNull()
    .references(() => Workspace.id, { onDelete: "cascade" }),
  ord: t.integer().notNull(),
  text: t.text().notNull(),
  embedding: t.vector({ dimensions: 1536 }).notNull(),
}));

// --- wiki_node_tag: derived tag index (source of truth = body frontmatter) ---
// Recomputed from the current version's frontmatter on every write so tags are
// SQL-filterable without parsing S3 bodies at read time. Node-level (keyed by
// nodeId), not versioned. Mirrors the body -> wiki_chunk derived-index pattern.
export const WikiNodeTag = pgTable(
  "wiki_node_tag",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    workspaceId: t
      .uuid("workspace_id")
      .notNull()
      .references(() => Workspace.id, { onDelete: "cascade" }),
    nodeId: t
      .uuid("node_id")
      .notNull()
      .references(() => WikiNode.id, { onDelete: "cascade" }),
    // Normalized: lowercase, trimmed, kebab-case (see compile/tags.ts).
    tag: t.text().notNull(),
    createdAt: t
      .timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  }),
  (table) => [
    uniqueIndex("wiki_node_tag_node_tag_idx").on(table.nodeId, table.tag),
    index("wiki_node_tag_ws_tag_idx").on(table.workspaceId, table.tag),
  ],
);

// --- wiki_node_source: explicit provenance citations ---
// Additive accumulator: a node's cited-source set only grows. writeVersion
// auto-unions the current compile job's sourceId into the node it writes; the
// gardener's cite_sources tool lets it declare additional sources explicitly
// (e.g. before rm'ing a note it merged into another, so that note's
// provenance survives the delete). Complements — does not replace — the
// per-version sourceId history on wiki_node_version.
export const WikiNodeSource = pgTable(
  "wiki_node_source",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    workspaceId: t
      .uuid("workspace_id")
      .notNull()
      .references(() => Workspace.id, { onDelete: "cascade" }),
    nodeId: t
      .uuid("node_id")
      .notNull()
      .references(() => WikiNode.id, { onDelete: "cascade" }),
    sourceId: t
      .uuid("source_id")
      .notNull()
      .references(() => Source.id, { onDelete: "cascade" }),
    createdAt: t
      .timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  }),
  (table) => [
    uniqueIndex("wiki_node_source_node_source_idx").on(
      table.nodeId,
      table.sourceId,
    ),
    index("wiki_node_source_ws_idx").on(table.workspaceId),
  ],
);

// --- compile_job: durable worker job record ---
export interface TokenUsage {
  input: number;
  output: number;
  costCents: number;
}

export const CompileJob = pgTable("compile_job", (t) => ({
  id: t.uuid().notNull().primaryKey().defaultRandom(),
  workspaceId: t
    .uuid("workspace_id")
    .notNull()
    .references(() => Workspace.id, { onDelete: "cascade" }),
  sourceId: t
    .uuid("source_id")
    .notNull()
    .references(() => Source.id, { onDelete: "cascade" }),
  status: t.text().notNull().$type<CompileJobStatus>().default("queued"),
  error: t.text(),
  tokenUsage: t.jsonb("token_usage").$type<TokenUsage>(),
  startedAt: t.timestamp("started_at", { withTimezone: true }),
  finishedAt: t.timestamp("finished_at", { withTimezone: true }),
  createdAt: t
    .timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
}));

// --- artifact: AI-generated interfaces (stable share link; access via visibility) ---
export type ArtifactKind = "freeform" | "fixed";
export type ArtifactStatus = "generating" | "draft" | "failed";
// Access level of an artifact's share link. The slug never changes; this does.
//   private  → "Just me" (only readers of the target folder)
//   public   → anyone with the link
export type ArtifactVisibility = "private" | "public";
export const artifactVisibilitySchema = z.enum([
  "private",
  "public",
]) satisfies z.ZodType<ArtifactVisibility>;

export const Artifact = pgTable(
  "artifact",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    workspaceId: t
      .uuid("workspace_id")
      .notNull()
      .references(() => Workspace.id, { onDelete: "cascade" }),
    title: t.text().notNull(),
    kind: t.text().notNull().$type<ArtifactKind>(),
    prompt: t.text(),
    // Target space (null = workspace root). The artifact's permission anchor —
    // mirrors Source.targetFolderId.
    targetFolderId: t
      .uuid("target_folder_id")
      .references(() => WikiNode.id, { onDelete: "set null" }),
    s3KeyHtml: t.text("s3_key_html"),
    s3KeySource: t.text("s3_key_source"),
    status: t.text().notNull().$type<ArtifactStatus>().default("draft"),
    // Failure message from the last generation job; null once a job succeeds.
    error: t.text(),
    // Access level of the share link (orthogonal to status). Default "Just me".
    visibility: t
      .text()
      .notNull()
      .$type<ArtifactVisibility>()
      .default("private"),
    // Minted at creation so the link is stable for the artifact's whole life.
    slug: t.text().notNull().unique(),
    expiresAt: t.timestamp("expires_at", { withTimezone: true }),
    createdAt: t
      .timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: t
      .timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  }),
  (table) => [
    check(
      "artifact_visibility_check",
      sql`${table.visibility} in ('private', 'public')`,
    ),
  ],
);

export const CreateArtifactSchema = createInsertSchema(Artifact, {
  prompt: z.string().max(2000).optional(),
  title: z.string().max(200),
}).omit({
  id: true,
  slug: true,
  s3KeyHtml: true,
  s3KeySource: true,
  status: true,
  error: true,
  visibility: true,
  createdAt: true,
  updatedAt: true,
});

// --- spend_ledger: per-workspace cost attribution (risk #5 / CAP.2) ---
export const SpendLedger = pgTable("spend_ledger", (t) => ({
  id: t.uuid().notNull().primaryKey().defaultRandom(),
  workspaceId: t
    .uuid("workspace_id")
    .notNull()
    .references(() => Workspace.id, { onDelete: "cascade" }),
  kind: t.text().notNull().$type<SpendKind>(),
  cents: t.bigint("cents", { mode: "number" }).notNull(),
  jobId: t
    .uuid("job_id")
    .references(() => CompileJob.id, { onDelete: "set null" }),
  createdAt: t
    .timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
}));

// --- ai_config: installation-wide model/provider config (single row) ---
export const aiProviderKindSchema = z.enum(["gateway", "openai-compatible"]);
export type AiProviderKind = z.infer<typeof aiProviderKindSchema>;

// Fixed sentinel id for the singleton row — all reads/writes target it.
export const AI_CONFIG_ID = "00000000-0000-0000-0000-00000000a1c0";

export const AiConfig = pgTable("ai_config", (t) => ({
  id: t.uuid().notNull().primaryKey(),
  providerKind: t
    .text("provider_kind")
    .notNull()
    .$type<AiProviderKind>()
    .default("gateway"),
  baseUrl: t.text("base_url").notNull().default("https://ai-gateway.vercel.sh"),
  chatModel: t.text("chat_model").notNull(),
  normalizeModel: t.text("normalize_model").notNull(),
  embedModel: t.text("embed_model").notNull(),
  updatedAt: t
    .timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
}));

// --- workspace_ai_config: per-workspace override (null column = inherit) ---
// embed is intentionally absent: it is dimension-locked and stays global-only.
export const WorkspaceAiConfig = pgTable("workspace_ai_config", (t) => ({
  id: t.uuid().notNull().primaryKey().defaultRandom(),
  workspaceId: t
    .uuid("workspace_id")
    .notNull()
    .unique()
    .references(() => Workspace.id, { onDelete: "cascade" }),
  chatModel: t.text("chat_model"),
  normalizeModel: t.text("normalize_model"),
  updatedAt: t
    .timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
}));

// --- user_profile: the company-scoped identity behind source-system accounts ---
//
// A profile is stable within one company. Email is the deterministic join
// signal, not the primary key: aliases and provider subjects can change while
// the profile id remains stable.
export const UserProfile = pgTable(
  "user_profile",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    workspaceId: t
      .uuid("workspace_id")
      .notNull()
      .references(() => Workspace.id, { onDelete: "cascade" }),
    primaryEmail: t.text("primary_email"),
    displayName: t.text("display_name"),
    givenName: t.text("given_name"),
    familyName: t.text("family_name"),
    title: t.text(),
    department: t.text(),
    timezone: t.text(),
    status: t.text().notNull().$type<UserProfileStatus>().default("active"),
    createdAt: t
      .timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: t
      .timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  }),
  (table) => [
    uniqueIndex("user_profile_workspace_email_idx").on(
      table.workspaceId,
      table.primaryEmail,
    ),
    uniqueIndex("user_profile_workspace_id_idx").on(
      table.workspaceId,
      table.id,
    ),
    index("user_profile_workspace_status_idx").on(
      table.workspaceId,
      table.status,
    ),
  ],
);

// All verified company-email handles for a profile, including the primary
// address. The workspace-wide unique key prevents one address from resolving
// to two people.
export const UserProfileEmail = pgTable(
  "user_profile_email",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    workspaceId: t
      .uuid("workspace_id")
      .notNull()
      .references(() => Workspace.id, { onDelete: "cascade" }),
    userProfileId: t.uuid("user_profile_id").notNull(),
    email: t.text().notNull(),
    verifiedAt: t
      .timestamp("verified_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    createdAt: t
      .timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  }),
  (table) => [
    uniqueIndex("user_profile_email_workspace_email_idx").on(
      table.workspaceId,
      table.email,
    ),
    index("user_profile_email_profile_idx").on(table.userProfileId),
    foreignKey({
      columns: [table.workspaceId, table.userProfileId],
      foreignColumns: [UserProfile.workspaceId, UserProfile.id],
      name: "user_profile_email_workspace_profile_fk",
    }).onDelete("cascade"),
  ],
);

// Stable provider binding. Resolution always checks this key before email so
// renamed addresses do not split a person into multiple profiles.
export const ExternalIdentity = pgTable(
  "external_identity",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    workspaceId: t
      .uuid("workspace_id")
      .notNull()
      .references(() => Workspace.id, { onDelete: "cascade" }),
    userProfileId: t.uuid("user_profile_id").notNull(),
    provider: t.text().notNull(),
    tenantId: t.text("tenant_id").notNull(),
    subject: t.text().notNull(),
    email: t.text(),
    emailVerified: t.boolean("email_verified").notNull().default(false),
    createdAt: t
      .timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: t
      .timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  }),
  (table) => [
    uniqueIndex("external_identity_provider_subject_idx").on(
      table.workspaceId,
      table.provider,
      table.tenantId,
      table.subject,
    ),
    index("external_identity_profile_idx").on(table.userProfileId),
    foreignKey({
      columns: [table.workspaceId, table.userProfileId],
      foreignColumns: [UserProfile.workspaceId, UserProfile.id],
      name: "external_identity_workspace_profile_fk",
    }).onDelete("cascade"),
  ],
);

// --- workspace_member: an authenticated account's membership in a workspace ---
export const WorkspaceMember = pgTable(
  "workspace_member",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    workspaceId: t
      .uuid("workspace_id")
      .notNull()
      .references(() => Workspace.id, { onDelete: "cascade" }),
    userId: t.text("user_id").notNull(),
    userProfileId: t.uuid("user_profile_id").notNull(),
    role: t.text().notNull().$type<WorkspaceRole>().default("member"),
    // Display snapshots (Source.capturedByName pattern) so @acme/api never calls Clerk.
    name: t.text(),
    email: t.text(),
    createdAt: t
      .timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  }),
  (table) => [
    uniqueIndex("workspace_member_workspace_user_idx").on(
      table.workspaceId,
      table.userId,
    ),
    // Workspace listing filters by user alone ("my workspaces").
    index("workspace_member_user_idx").on(table.userId),
    foreignKey({
      columns: [table.workspaceId, table.userProfileId],
      foreignColumns: [UserProfile.workspaceId, UserProfile.id],
      name: "workspace_member_workspace_profile_fk",
    }).onDelete("restrict"),
  ],
);

// --- workspace_invite: pending email invites; accepted on next sign-in ---
export const WorkspaceInvite = pgTable(
  "workspace_invite",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    workspaceId: t
      .uuid("workspace_id")
      .notNull()
      .references(() => Workspace.id, { onDelete: "cascade" }),
    email: t.text().notNull(), // stored lowercased
    role: t
      .text()
      .notNull()
      .$type<Exclude<WorkspaceRole, "owner">>()
      .default("member"),
    initialGrants: t.jsonb("initial_grants").$type<InitialGrant[]>(),
    invitedByUserId: t.text("invited_by_user_id").notNull(),
    clerkInvitationId: t.text("clerk_invitation_id"),
    status: t.text().notNull().$type<InviteStatus>().default("pending"),
    acceptedAt: t.timestamp("accepted_at", { withTimezone: true }),
    createdAt: t
      .timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  }),
  (table) => [
    uniqueIndex("workspace_invite_pending_idx")
      .on(table.workspaceId, table.email)
      .where(sql`${table.status} = 'pending'`),
  ],
);

// --- workspace_group: named principal sets (sales, leadership, ...) ---
export const WorkspaceGroup = pgTable(
  "workspace_group",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    workspaceId: t
      .uuid("workspace_id")
      .notNull()
      .references(() => Workspace.id, { onDelete: "cascade" }),
    name: t.varchar({ length: 80 }).notNull(),
    createdAt: t
      .timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  }),
  (table) => [
    uniqueIndex("workspace_group_name_idx").on(table.workspaceId, table.name),
  ],
);

// --- workspace_group_member: user membership in a named principal set ---
export const WorkspaceGroupMember = pgTable(
  "workspace_group_member",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    groupId: t
      .uuid("group_id")
      .notNull()
      .references(() => WorkspaceGroup.id, { onDelete: "cascade" }),
    userId: t.text("user_id").notNull(),
    createdAt: t
      .timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  }),
  (table) => [
    uniqueIndex("workspace_group_member_idx").on(table.groupId, table.userId),
  ],
);

// --- access_grant: additive subtree grant. folderId null = workspace root.
// Node-keyed (not path-keyed) so gardener mv/rename never invalidates grants.
export const AccessGrant = pgTable(
  "access_grant",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    workspaceId: t
      .uuid("workspace_id")
      .notNull()
      .references(() => Workspace.id, { onDelete: "cascade" }),
    principalType: t
      .text("principal_type")
      .notNull()
      .$type<GrantPrincipalType>(),
    // userId | groupId | null (all_members). NULL is a real key value here:
    // the NULLS NOT DISTINCT constraint treats all_members rows as duplicates.
    principalId: t.text("principal_id"),
    folderId: t
      .uuid("folder_id")
      .references(() => WikiNode.id, { onDelete: "cascade" }),
    role: t.text().notNull().$type<GrantRole>(),
    // null for system-created grants (backfill, default open grant).
    createdByUserId: t.text("created_by_user_id"),
    createdAt: t
      .timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  }),
  (table) => [
    // uniqueIndex() has no nullsNotDistinct() in drizzle 0.44 — unique constraint form required.
    unique("access_grant_principal_folder_idx")
      .on(
        table.workspaceId,
        table.principalType,
        table.principalId,
        table.folderId,
      )
      .nullsNotDistinct(),
  ],
);

// --- agents: KB-backed personas deployable through external interfaces ---
// Widget is the built-in Community interface. The "slack" member stays in the
// shared wire/schema contract so the Apache CLI can also target Nimbase Cloud;
// Community does not ship the first-party Slack OAuth/webhook adapter. This is
// unrelated to the out-of-process inbound connector protocol below.
export const connectionPlatformSchema = z.enum(["slack", "widget"]);
export type ConnectionPlatform = z.infer<typeof connectionPlatformSchema>;
export const connectionStatusSchema = z.enum([
  "active",
  "paused",
  "revoked",
  "error",
]);
export type ConnectionStatus = z.infer<typeof connectionStatusSchema>;

// The ocean blue — DESIGN.md §3 `--brand-blue-600` / `--primary`. Interface
// configuration lives beside AgentConnection because the agent's persona and
// memory capability are independent of how a visitor reaches it.
export const WIDGET_DEFAULT_ACCENT = "#0C5AA0";

export const widgetThemeSchema = z.object({
  accent: z.string().max(32).optional(),
  position: z.enum(["left", "right"]).optional(),
});
export type WidgetTheme = z.infer<typeof widgetThemeSchema>;

export const widgetInterfaceConfigSchema = z.object({
  greeting: z.string().max(500).default(""),
  allowedDomains: z.array(z.string().min(1).max(255)).max(20).default([]),
  theme: widgetThemeSchema.default({}),
});
export type WidgetInterfaceConfig = z.infer<typeof widgetInterfaceConfigSchema>;

export const DEFAULT_AGENT_DAILY_CAP_CENTS = 500;

export const Agent = pgTable(
  "agent",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    workspaceId: t
      .uuid("workspace_id")
      .notNull()
      .references(() => Workspace.id, { onDelete: "cascade" }),
    // Stable public CLI identifier. Names remain editable without changing it.
    slug: t.text().notNull(),
    name: t.text().notNull(),
    // Persona / system prompt the agent answers with.
    instructions: t.text().notNull().default(""),
    // Anchor (null = workspace root): the agent's default-grant home and the
    // permission gate for create/deploy. NOT a read fence — capability is the
    // agent's own AccessGrant rows (see resolveAgentScopes).
    targetFolderId: t
      .uuid("target_folder_id")
      .references(() => WikiNode.id, { onDelete: "set null" }),
    // null → resolveModels(workspaceId).chat.
    modelOverride: t.text("model_override"),
    // null → DEFAULT_AGENT_DAILY_CAP_CENTS.
    dailyCostCapCents: t.bigint("daily_cost_cap_cents", { mode: "number" }),
    enabled: t.boolean().notNull().default(true),
    // Artifact authoring, off by default. When on, the agent gets a create_artifact
    // tool anchored at targetFolderId and fenced to its own read scopes.
    artifactEnabled: t.boolean("artifact_enabled").notNull().default(false),
    // Visibility the agent mints its artifacts with. "public" makes the /s/<slug>
    // link openable by anyone who has it — which is the point on a chat platform,
    // where most readers have no Nimbase session — so it is an explicit opt-in by
    // a manager on the anchor, never a default.
    artifactVisibility: t
      .text("artifact_visibility")
      .$type<ArtifactVisibility>()
      .notNull()
      .default("private"),
    createdByUserId: t.text("created_by_user_id"),
    createdAt: t
      .timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: t
      .timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  }),
  (table) => [
    uniqueIndex("agent_workspace_slug_idx").on(table.workspaceId, table.slug),
    check(
      "agent_artifact_visibility_check",
      sql`${table.artifactVisibility} in ('private', 'public')`,
    ),
  ],
);

export const CreateAgentSchema = createInsertSchema(Agent, {
  name: z.string().min(1).max(120),
  instructions: z.string().max(8000).optional(),
}).omit({
  id: true,
  enabled: true,
  createdByUserId: true,
  createdAt: true,
  updatedAt: true,
});

// An Agent bound to one external platform install. "Deploy" = create a row.
export const AgentConnection = pgTable(
  "agent_connection",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    agentId: t
      .uuid("agent_id")
      .notNull()
      .references(() => Agent.id, { onDelete: "cascade" }),
    workspaceId: t
      .uuid("workspace_id")
      .notNull()
      .references(() => Workspace.id, { onDelete: "cascade" }),
    platform: t.text().notNull().$type<ConnectionPlatform>(),
    // Resolves an inbound webhook to this row (Slack team_id, GH installation_id…).
    routeKey: t.text("route_key").notNull(),
    // Display-only: team/repo name, icon, etc.
    externalMeta: t.jsonb("external_meta").$type<Record<string, string>>(),
    // Adapter-specific public configuration. Widget stores its greeting,
    // frame-ancestor allowlist, and visual theme here; Slack needs no config.
    interfaceConfig: t.jsonb("interface_config").$type<WidgetInterfaceConfig>(),
    // AES-256-GCM sealed credentials (e.g. Slack bot token); see encryptSecret.
    secretsEncrypted: t.text("secrets_encrypted"),
    status: t.text().notNull().$type<ConnectionStatus>().default("active"),
    error: t.text(),
    // The deployer — the exposure authority (capability stays with the agent).
    createdByUserId: t.text("created_by_user_id"),
    createdAt: t
      .timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: t
      .timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  }),
  // v1: one agent per platform install. Channel-level routing is future work.
  (table) => [
    unique("agent_connection_route_idx").on(table.platform, table.routeKey),
  ],
);

// Append-only turn log: observability surface + the rate-limit counter.
export const AgentTurn = pgTable(
  "agent_turn",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    agentId: t
      .uuid("agent_id")
      .notNull()
      .references(() => Agent.id, { onDelete: "cascade" }),
    // null = in-app test chat (no external connection).
    connectionId: t
      .uuid("connection_id")
      .references(() => AgentConnection.id, { onDelete: "set null" }),
    workspaceId: t
      .uuid("workspace_id")
      .notNull()
      .references(() => Workspace.id, { onDelete: "cascade" }),
    channelKey: t.text("channel_key"),
    // SHA-256 of an anonymous web visitor's IP. Null for authenticated/chat
    // interfaces; used only by the widget adapter's abuse gates.
    ipHash: t.text("ip_hash"),
    question: t.text().notNull(),
    answer: t.text(),
    tokens: t.bigint({ mode: "number" }).notNull().default(0),
    costCents: t.bigint("cost_cents", { mode: "number" }).notNull().default(0),
    error: t.text(),
    createdAt: t
      .timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  }),
  (table) => [
    index("agent_turn_conn_created_idx").on(
      table.connectionId,
      table.createdAt,
    ),
    index("agent_turn_agent_created_idx").on(table.agentId, table.createdAt),
    index("agent_turn_session_idx").on(table.connectionId, table.channelKey),
    index("agent_turn_ip_created_idx").on(table.ipHash, table.createdAt),
  ],
);

// --- source_connection: an out-of-process connector that crawls into the KB ---
// The shared runtime owns scheduling and ingestion while provider knowledge
// stays behind the versioned connector protocol. Every connection inherits
// `targetFolderId`, so the ordinary target-folder grant fence still applies.
export const sourceConnectionProviderSchema = connectorIdSchema;
export type SourceConnectionProvider = z.infer<
  typeof sourceConnectionProviderSchema
>;

export const sourceConnectionAuthKindSchema = z.enum(["connector_http"]);
export type SourceConnectionAuthKind = z.infer<
  typeof sourceConnectionAuthKindSchema
>;

export const sourceConnectionStatusSchema = z.enum([
  "active",
  "paused",
  "error",
  "revoked",
]);
export type SourceConnectionStatus = z.infer<
  typeof sourceConnectionStatusSchema
>;

// Connector configuration is deliberately open-ended. The core recognizes
// only its shared limits and scope selection; each connector owns the rest.
export const sourceConnectionConfigSchema = z
  .object({
    maxItemsPerRun: z.number().int().positive().max(2000).optional(),
    scopeIds: z.array(z.string().min(1)).max(10_000).optional(),
  })
  .passthrough();
export type SourceConnectionConfig = z.infer<
  typeof sourceConnectionConfigSchema
>;

// Incremental cursor is opaque to the core and interpreted only by its
// connector. JSON keeps it durable and transport-safe.
export type CrawlCursor = JsonValue | null;

export const SourceConnection = pgTable(
  "source_connection",
  (t) => ({
    id: t.uuid().primaryKey().defaultRandom(),
    workspaceId: t
      .uuid("workspace_id")
      .notNull()
      .references(() => Workspace.id, { onDelete: "cascade" }),
    provider: t.text().notNull().$type<SourceConnectionProvider>(),
    displayName: t.text("display_name"),
    authKind: t
      .text("auth_kind")
      .notNull()
      .$type<SourceConnectionAuthKind>()
      .default("connector_http"),
    // Base URL of the out-of-process connector protocol implementation.
    connectorUrl: t.text("connector_url").notNull(),
    // Connector-defined instance key — deduplicated with workspace/provider.
    routeKey: t.text("route_key").notNull(),
    // AES-256-GCM sealed connector bearer credential (secrets.ts).
    secretsEncrypted: t.text("secrets_encrypted"),
    tokenExpiresAt: t.timestamp("token_expires_at", { withTimezone: true }),
    // Permission anchor: crawled Sources inherit this folder (null = root).
    targetFolderId: t
      .uuid("target_folder_id")
      .references(() => WikiNode.id, { onDelete: "set null" }),
    config: t.jsonb().$type<SourceConnectionConfig>(),
    status: t
      .text()
      .notNull()
      .$type<SourceConnectionStatus>()
      .default("active"),
    intervalSeconds: t.integer("interval_seconds").notNull().default(86400), // daily
    cursor: t.jsonb().$type<CrawlCursor>(),
    nextRunAt: t.timestamp("next_run_at", { withTimezone: true }),
    lastRunAt: t.timestamp("last_run_at", { withTimezone: true }),
    lastSuccessAt: t.timestamp("last_success_at", { withTimezone: true }),
    lastError: t.text("last_error"),
    consecutiveFailures: t.integer("consecutive_failures").notNull().default(0),
    createdByUserId: t.text("created_by_user_id"),
    createdAt: t
      .timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: t
      .timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  }),
  (table) => [
    unique("source_connection_route_idx").on(
      table.workspaceId,
      table.provider,
      table.routeKey,
    ),
    // The scheduler's hot query: due active connections.
    index("source_connection_due_idx").on(table.status, table.nextRunAt),
  ],
);

export const CreateSourceConnectionSchema = createInsertSchema(
  SourceConnection,
  {
    provider: sourceConnectionProviderSchema,
    config: sourceConnectionConfigSchema,
  },
).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  cursor: true,
  lastRunAt: true,
  lastSuccessAt: true,
  lastError: true,
  consecutiveFailures: true,
});

// --- crawl_run: one row per scheduled crawl of a connection (observability) ---
export const crawlRunStatusSchema = z.enum(["running", "done", "failed"]);
export type CrawlRunStatus = z.infer<typeof crawlRunStatusSchema>;

export const CrawlRun = pgTable(
  "crawl_run",
  (t) => ({
    id: t.uuid().primaryKey().defaultRandom(),
    connectionId: t
      .uuid("connection_id")
      .notNull()
      .references(() => SourceConnection.id, { onDelete: "cascade" }),
    workspaceId: t
      .uuid("workspace_id")
      .notNull()
      .references(() => Workspace.id, { onDelete: "cascade" }),
    status: t.text().notNull().$type<CrawlRunStatus>().default("running"),
    itemsSeen: t.integer("items_seen").notNull().default(0),
    itemsIngested: t.integer("items_ingested").notNull().default(0),
    itemsSkipped: t.integer("items_skipped").notNull().default(0),
    error: t.text(),
    startedAt: t
      .timestamp("started_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    finishedAt: t.timestamp("finished_at", { withTimezone: true }),
  }),
  (table) => [
    index("crawl_run_connection_started_idx").on(
      table.connectionId,
      table.startedAt,
    ),
  ],
);

// --- group_mcp: a governed MCP endpoint fenced to one memory folder ---
export const GroupMcp = pgTable(
  "group_mcp",
  (t) => ({
    id: t.uuid().primaryKey().defaultRandom(),
    workspaceId: t
      .uuid("workspace_id")
      .notNull()
      .references(() => Workspace.id, { onDelete: "cascade" }),
    folderId: t
      .uuid("folder_id")
      .references(() => WikiNode.id, { onDelete: "restrict" }),
    slug: t.text().notNull(),
    name: t.text().notNull(),
    instructions: t.text().notNull().default(""),
    enabled: t.boolean().notNull().default(true),
    tools: t
      .text()
      .array()
      .notNull()
      .default(sql`'{search,get_note,list_sources}'::text[]`)
      .$type<GroupMcpTool[]>(),
    authMethods: t
      .text("auth_methods")
      .array()
      .notNull()
      .default(sql`'{oauth}'::text[]`)
      .$type<McpAuthMethod[]>(),
    artifactVisibility: t
      .text("artifact_visibility")
      .notNull()
      .$type<ArtifactVisibility>()
      .default("private"),
    createdAt: t
      .timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: t
      .timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  }),
  (table) => [
    uniqueIndex("group_mcp_workspace_slug_idx").on(
      table.workspaceId,
      table.slug,
    ),
    index("group_mcp_workspace_idx").on(table.workspaceId),
    check(
      "group_mcp_artifact_visibility_check",
      sql`${table.artifactVisibility} in ('private', 'public')`,
    ),
  ],
);
