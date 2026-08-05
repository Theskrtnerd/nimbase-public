import { z } from "zod/v4";

export const resourceSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .max(64);

// Request/response schemas shared by the CLI (apps/cli) and the REST routes it
// calls (apps/nextjs). Keeping them here means one source of truth for the
// wire shapes the CLI parses.

export const sourceRefSchema = z.object({
  id: z.string(),
  kind: z.string(),
  title: z.string().nullable(),
  sourceUrl: z.string().nullable(),
  capturedAt: z.string().nullable(),
});
export type SourceRef = z.infer<typeof sourceRefSchema>;

export const noteResponseSchema = z.object({
  id: z.string(),
  path: z.string(),
  title: z.string(),
  body: z.string(),
  summary: z.string().nullable().optional(),
  updatedAt: z.string().optional(),
  tags: z.array(z.string()).optional(),
  sources: z.array(sourceRefSchema).optional(),
});
export type NoteResponse = z.infer<typeof noteResponseSchema>;

/** Artifact visibility accepted by CLI-facing REST endpoints. */
export const artifactVisibilitySchema = z.enum(["private", "public"]);
export type ArtifactVisibility = z.infer<typeof artifactVisibilitySchema>;

export const artifactCreatedSchema = z.object({
  id: z.string().uuid(),
  slug: resourceSlugSchema,
  status: z.literal("generating"),
  title: z.string(),
  url: z.string(),
  visibility: artifactVisibilitySchema,
});
export type ArtifactCreated = z.infer<typeof artifactCreatedSchema>;

export const artifactStatusSchema = z.object({
  id: z.string().uuid(),
  slug: resourceSlugSchema,
  status: z.string(),
  ready: z.boolean(),
  url: z.string().nullable(),
  visibility: z.string(),
  error: z.string().nullable().optional(),
});
export type ArtifactStatus = z.infer<typeof artifactStatusSchema>;

export const deploymentTypeSchema = z.enum([
  "agent",
  "artifact",
  "docs",
  "mcp",
]);
export type DeploymentType = z.infer<typeof deploymentTypeSchema>;
export type DeploymentRef = `${DeploymentType}:${string}`;

export function formatDeploymentRef(
  type: DeploymentType,
  slug: string,
): DeploymentRef {
  return `${type}:${slug}`;
}

/** One artifact as `GET /api/artifacts` lists it. */
export const artifactSummarySchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  kind: z.string(),
  status: z.string(),
  visibility: z.string(),
  slug: resourceSlugSchema,
  error: z.string().nullable(),
  prompt: z.string().nullable(),
  targetPath: z.string(),
  createdAt: z.string(),
  updatedAt: z.string().nullable(),
});
export type ArtifactSummary = z.infer<typeof artifactSummarySchema>;

export const artifactsResponseSchema = z.object({
  artifacts: z.array(artifactSummarySchema),
  nextCursor: z.string().nullable().optional(),
});

/**
 * Page-size bounds for the cursor-paginated listings (`GET /api/sources`,
 * `GET /api/artifacts`). Shared so the CLI's `--limit` validation and the
 * server's clamp cannot disagree about what it will accept.
 */
export const DEFAULT_PAGE_LIMIT = 100;
export const MAX_PAGE_LIMIT = 500;

/** `GET /api/me` — the signed-in person behind a session credential. */
export const identityResponseSchema = z.object({
  id: z.string(),
  email: z.string().nullable(),
  name: z.string().nullable(),
});
export type IdentityResponse = z.infer<typeof identityResponseSchema>;

export const presignResponseSchema = z.object({
  sourceId: z.string(),
  uploadUrl: z.string(),
});
export type PresignResponse = z.infer<typeof presignResponseSchema>;

export const finalizeResponseSchema = z.object({
  sourceId: z.string(),
  status: z.string(),
});
export type FinalizeResponse = z.infer<typeof finalizeResponseSchema>;

export const workspaceSummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
});
export type WorkspaceSummary = z.infer<typeof workspaceSummarySchema>;

export const workspaceListResponseSchema = z.object({
  workspaces: z.array(workspaceSummarySchema),
});
export type WorkspaceListResponse = z.infer<typeof workspaceListResponseSchema>;

export const workspaceCreatedSchema = z.object({
  workspace: workspaceSummarySchema.extend({
    description: z.string().nullable(),
    website: z.string().nullable(),
    brainInitStatus: z.string(),
  }),
});
export type WorkspaceCreated = z.infer<typeof workspaceCreatedSchema>;

const workspaceTitleSchema = z.string().trim().min(1).max(120);
const workspaceDescriptionSchema = z.string().trim().min(1).max(280);
const workspaceWebsiteSchema = z
  .url()
  .max(500)
  .refine((website) => /^https:\/\//i.test(website), "website must use https");

/**
 * A website provides the identity baseline. Explicit fields override the
 * corresponding website-derived value; without a website both are required.
 */
export const workspaceCreateRequestSchema = z.union([
  z
    .object({
      website: workspaceWebsiteSchema,
      title: workspaceTitleSchema.optional(),
      description: workspaceDescriptionSchema.optional(),
    })
    .strict(),
  z
    .object({
      title: workspaceTitleSchema,
      description: workspaceDescriptionSchema,
    })
    .strict(),
]);
export type WorkspaceCreateRequest = z.infer<
  typeof workspaceCreateRequestSchema
>;

export const workspaceModelUpdateSchema = z.object({
  workspaceId: z.string().uuid(),
  modelId: z.string().trim().min(1).max(255).nullable(),
});

export const workspaceModelConfigSchema = z.object({
  modelId: z.string(),
  workspaceOverride: z.string().nullable(),
  source: z.enum(["workspace", "global"]),
  availableModels: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
    }),
  ),
});
export type WorkspaceModelConfig = z.infer<typeof workspaceModelConfigSchema>;

// Interfaces an agent can deploy through. Mirrors
// `connectionPlatformSchema` in @acme/db — extend both together.
export const deploymentPlatformSchema = z.enum(["slack", "widget"]);
export type DeploymentPlatform = z.infer<typeof deploymentPlatformSchema>;

const deploymentBaseSchema = z.object({
  workspaceId: z.string().uuid(),
  slug: resourceSlugSchema.optional(),
  name: z.string().trim().min(1).max(120),
  instructions: z.string().max(8000).optional(),
  targetFolderId: z.string().uuid().nullable().optional(),
});

export const widgetInterfaceOptionsSchema = z.object({
  greeting: z.string().trim().max(500).default(""),
  allowedDomains: z
    .array(z.string().trim().min(1).max(255))
    .max(20)
    .default([]),
  accent: z.string().trim().max(32).optional(),
  position: z.enum(["left", "right"]).default("right"),
});
export type WidgetInterfaceOptions = z.infer<
  typeof widgetInterfaceOptionsSchema
>;

export const createDeploymentRequestSchema = z.discriminatedUnion("platform", [
  deploymentBaseSchema.extend({
    platform: z.literal("slack"),
  }),
  deploymentBaseSchema.extend({
    platform: z.literal("widget"),
    widget: widgetInterfaceOptionsSchema,
  }),
]);
export type CreateDeploymentRequest = z.infer<
  typeof createDeploymentRequestSchema
>;

export const deploymentTargetSchema = z.object({
  platform: deploymentPlatformSchema,
  status: z.enum(["active", "paused", "error"]),
  name: z.string().nullable(),
  error: z.string().nullable(),
  embed: z.string().nullable(),
});
export type DeploymentTarget = z.infer<typeof deploymentTargetSchema>;

export const deploymentSummarySchema = z.object({
  slug: z.string(),
  name: z.string(),
  enabled: z.boolean(),
  targetPath: z.string(),
  targets: z.array(deploymentTargetSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type DeploymentSummary = z.infer<typeof deploymentSummarySchema>;

export const deploymentDetailSchema = deploymentSummarySchema.extend({
  instructions: z.string(),
  targetFolderId: z.string().uuid().nullable(),
});
export type DeploymentDetail = z.infer<typeof deploymentDetailSchema>;

export const deploymentsResponseSchema = z.object({
  deployments: z.array(deploymentSummarySchema),
});
export type DeploymentsResponse = z.infer<typeof deploymentsResponseSchema>;

export const deploymentCreatedSchema = z.object({
  agentId: z.string().uuid(),
  deployment: deploymentDetailSchema,
});
export type DeploymentCreated = z.infer<typeof deploymentCreatedSchema>;

export const groupMcpToolSchema = z.enum([
  "search",
  "get_note",
  "list_sources",
  "capture",
  "create_artifact",
]);
export type GroupMcpTool = z.infer<typeof groupMcpToolSchema>;

export const groupMcpSummarySchema = z.object({
  slug: resourceSlugSchema,
  name: z.string(),
  instructions: z.string(),
  folderPath: z.string(),
  enabled: z.boolean(),
  tools: z.array(groupMcpToolSchema),
  authMethods: z.array(z.literal("oauth")),
  url: z.string(),
});
export type GroupMcpSummary = z.infer<typeof groupMcpSummarySchema>;

export const groupMcpsResponseSchema = z.object({
  deployments: z.array(groupMcpSummarySchema),
});

export const createGroupMcpRequestSchema = z.object({
  workspaceId: z.string().uuid(),
  slug: resourceSlugSchema.optional(),
  name: z.string().trim().min(1).max(120),
  instructions: z.string().trim().max(4000).default(""),
  folderPath: z.string().trim().min(1).max(512).optional(),
  tools: z.array(groupMcpToolSchema).min(1),
});
export type CreateGroupMcpRequest = z.infer<typeof createGroupMcpRequestSchema>;

export const docSiteVisibilitySchema = z.enum(["private", "public"]);

export const docSiteSummarySchema = z.object({
  slug: resourceSlugSchema,
  name: z.string(),
  folderPath: z.string(),
  visibility: docSiteVisibilitySchema,
  status: z.enum(["draft", "building", "live", "failed"]),
  url: z.string(),
  templateVersion: z.string(),
  lastBuiltAt: z.string().nullable(),
  error: z.string().nullable(),
});
export type DocSiteSummary = z.infer<typeof docSiteSummarySchema>;

export const docSitesResponseSchema = z.object({
  deployments: z.array(docSiteSummarySchema),
});

export const createDocSiteRequestSchema = z.object({
  workspaceId: z.string().uuid(),
  slug: resourceSlugSchema.optional(),
  name: z.string().trim().min(1).max(120),
  folderPath: z.string().trim().min(1).max(512).optional(),
  description: z.string().trim().max(500).optional(),
  instructions: z.string().trim().max(4000).optional(),
  visibility: docSiteVisibilitySchema.default("private"),
});
export type CreateDocSiteRequest = z.infer<typeof createDocSiteRequestSchema>;

export const publishDocSiteRequestSchema = z.object({
  workspaceId: z.string().uuid(),
});

export const docSiteBuildSchema = z.object({
  buildId: z.string(),
  status: z.enum(["queued", "projecting", "building", "succeeded", "failed"]),
  pageCount: z.number(),
  log: z.string().nullable(),
  error: z.string().nullable(),
  finishedAt: z.string().nullable(),
});
export type DocSiteBuildStatus = z.infer<typeof docSiteBuildSchema>;

export const billingPlanSchema = z.enum(["free", "pro", "enterprise"]);
export const workspaceEditionSchema = z.enum([
  "community",
  ...billingPlanSchema.options,
]);

export const setPlanRequestSchema = z.object({
  workspaceId: z.string().uuid(),
  plan: billingPlanSchema,
});

export const workspacePlanSetResponseSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("override"),
    plan: billingPlanSchema,
    status: z.string().nullable(),
    warning: z.string().nullable(),
  }),
  z.object({
    action: z.literal("checkout"),
    plan: z.literal("pro"),
    url: z.url(),
  }),
  z.object({
    action: z.literal("portal"),
    plan: billingPlanSchema,
    url: z.url(),
  }),
  z.object({
    action: z.literal("contact"),
    plan: billingPlanSchema,
    reason: z.enum(["enterprise_sales", "enterprise_support"]),
    url: z.string().startsWith("mailto:"),
  }),
  z.object({
    action: z.literal("unchanged"),
    plan: billingPlanSchema,
  }),
]);
export type WorkspacePlanSetResponse = z.infer<
  typeof workspacePlanSetResponseSchema
>;

export const cliConnectionProviderSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-z0-9](?:[a-z0-9._/-]*[a-z0-9])?$/);
export type CliConnectionProvider = z.infer<typeof cliConnectionProviderSchema>;

export const connectionProviderInfoSchema = z.object({
  provider: cliConnectionProviderSchema,
  label: z.string(),
  configured: z.boolean(),
  scopeKind: z.string().min(1).max(64).nullable(),
});
export type ConnectionProviderInfo = z.infer<
  typeof connectionProviderInfoSchema
>;

export const connectionSummarySchema = z.object({
  id: z.string().uuid(),
  provider: cliConnectionProviderSchema,
  displayName: z.string().nullable(),
  status: z.string(),
  targetFolderId: z.string().uuid().nullable(),
  folderPath: z.string().nullable(),
  config: z.record(z.string(), z.unknown()).nullable(),
  intervalSeconds: z.number().int(),
  lastRunAt: z.string().nullable(),
  lastSuccessAt: z.string().nullable(),
  lastError: z.string().nullable(),
  consecutiveFailures: z.number().int(),
  nextRunAt: z.string().nullable(),
  createdAt: z.string(),
});
export type ConnectionSummary = z.infer<typeof connectionSummarySchema>;

export const connectionsResponseSchema = z.object({
  providers: z.array(connectionProviderInfoSchema),
  connections: z.array(connectionSummarySchema),
});
export type ConnectionsResponse = z.infer<typeof connectionsResponseSchema>;

export const connectionScopeSchema = z.object({
  id: z.string(),
  name: z.string(),
  path: z.string().optional(),
  isMember: z.boolean().optional(),
  selected: z.boolean(),
});
export type ConnectionScope = z.infer<typeof connectionScopeSchema>;

export const connectionScopesResponseSchema = z.object({
  connectionId: z.string().uuid(),
  provider: cliConnectionProviderSchema,
  scopeKind: z.string().min(1).max(64).nullable(),
  scopes: z.array(connectionScopeSchema),
});
export type ConnectionScopesResponse = z.infer<
  typeof connectionScopesResponseSchema
>;

export const connectorRegistrationResponseSchema = z.object({
  connectionId: z.string().uuid(),
  provider: cliConnectionProviderSchema,
  label: z.string(),
  scopeKind: z.string().nullable(),
  supportsScopes: z.boolean(),
});
export type ConnectorRegistrationResponse = z.infer<
  typeof connectorRegistrationResponseSchema
>;

export const syncRequestedSchema = z.object({
  runId: z.string().uuid(),
  connectionId: z.string().uuid(),
});
export type SyncRequested = z.infer<typeof syncRequestedSchema>;

export const crawlRunSchema = z.object({
  id: z.string().uuid(),
  connectionId: z.string().uuid(),
  status: z.enum(["running", "done", "failed"]),
  itemsSeen: z.number().int(),
  itemsIngested: z.number().int(),
  itemsSkipped: z.number().int(),
  error: z.string().nullable(),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
});
export type CrawlRun = z.infer<typeof crawlRunSchema>;

export const workspaceStatusSchema = z.object({
  workspace: z.object({
    id: z.string().uuid(),
    name: z.string(),
    slug: z.string(),
    brainInitStatus: z.string(),
  }),
  plan: z.object({
    id: workspaceEditionSchema,
    status: z.string().nullable(),
  }),
  memory: z.object({ compiled: z.number().int() }),
  captures: z.object({
    total: z.number().int(),
    byStatus: z.record(z.string(), z.number().int()),
  }),
  connections: z.object({
    total: z.number().int(),
    byStatus: z.record(z.string(), z.number().int()),
    incomplete: z.array(
      z.object({
        id: z.string().uuid(),
        provider: z.string(),
        displayName: z.string().nullable(),
      }),
    ),
    unhealthy: z.array(
      z.object({
        id: z.string().uuid(),
        provider: z.string(),
        displayName: z.string().nullable(),
        status: z.string(),
        lastError: z.string().nullable(),
        consecutiveFailures: z.number().int(),
      }),
    ),
  }),
});
export type WorkspaceStatus = z.infer<typeof workspaceStatusSchema>;

/**
 * One captured item as `GET /api/sources` lists it — the exact column set
 * `listSourcesForAccess` selects. `GET /api/sources/:id` returns this plus the
 * four detail-only fields below, so detail extends summary rather than
 * restating it.
 */
export const sourceSummarySchema = z.object({
  id: z.string().uuid(),
  kind: z.string(),
  sourceUrl: z.string().nullable(),
  title: z.string().nullable(),
  originalFilename: z.string().nullable(),
  status: z.string(),
  error: z.string().nullable(),
  capturedAt: z.string().nullable(),
  createdAt: z.string(),
  compiledAt: z.string().nullable(),
  capturedByName: z.string().nullable(),
  targetPath: z.string(),
});
export type SourceSummary = z.infer<typeof sourceSummarySchema>;

export const sourcesResponseSchema = z.object({
  sources: z.array(sourceSummarySchema),
  /**
   * Opaque keyset cursor for the next page, or null on the last page. Optional
   * so a client can still parse a response from an older deployment.
   */
  nextCursor: z.string().nullable().optional(),
});

export const sourceDetailSchema = sourceSummarySchema.extend({
  compileReport: z.unknown().nullable(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
  connectionId: z.string().uuid().nullable(),
  externalId: z.string().nullable(),
});
export type SourceDetail = z.infer<typeof sourceDetailSchema>;

export const connectionDetailSchema = z.object({
  connection: connectionSummarySchema,
  runs: z.array(crawlRunSchema),
});
export type ConnectionDetail = z.infer<typeof connectionDetailSchema>;

export const tokenRoleSchema = z.enum(["viewer", "contributor"]);
export type TokenRole = z.infer<typeof tokenRoleSchema>;

export const mintTokenRequestSchema = z.object({
  workspaceId: z.string().uuid(),
  role: tokenRoleSchema,
  targetFolderId: z.string().uuid().nullable().optional(),
  label: z.string().trim().min(1).max(120),
  expiresAt: z.iso.datetime().optional(),
});
export type MintTokenRequest = z.infer<typeof mintTokenRequestSchema>;

export const mintTokenResponseSchema = z.object({
  id: z.string(),
  token: z.string(),
  role: tokenRoleSchema,
  label: z.string(),
});
export type MintTokenResponse = z.infer<typeof mintTokenResponseSchema>;

export const tokenSummarySchema = z.object({
  id: z.string(),
  label: z.string(),
  role: z.string(),
  folderId: z.string().nullable(),
  lastUsedAt: z.string().nullable(),
  // Optional so a published CLI keeps working against servers predating
  // token expiry.
  expiresAt: z.string().nullable().optional(),
  createdAt: z.string(),
});
export type TokenSummary = z.infer<typeof tokenSummarySchema>;
