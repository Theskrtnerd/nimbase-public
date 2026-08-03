import { z } from "zod";

export const CONNECTOR_PROTOCOL_VERSION = 1 as const;
export const CONNECTOR_MANIFEST_PATH = "/.well-known/nimbase-connector.json";
export const CONNECTOR_PULL_PATH = "/v1/pull";
export const CONNECTOR_SCOPES_PATH = "/v1/scopes";

export type JsonValue =
  | boolean
  | number
  | string
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.boolean(),
    z.number(),
    z.string(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

export const connectorIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(
    /^[a-z0-9](?:[a-z0-9._/-]*[a-z0-9])?$/,
    "connector id must contain lowercase letters, digits, dots, slashes, underscores, or hyphens",
  );

export const connectorScopeKindSchema = z.string().min(1).max(64);

export const connectorManifestSchema = z.object({
  protocolVersion: z.literal(CONNECTOR_PROTOCOL_VERSION),
  id: connectorIdSchema,
  label: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  scopeKind: connectorScopeKindSchema.nullable().default(null),
  supportsScopes: z.boolean().default(false),
});
export type ConnectorManifest = z.infer<typeof connectorManifestSchema>;

export const connectorAccessGrantSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("email"), email: z.email() }),
  z.object({ type: z.literal("domain"), domain: z.string().min(1) }),
  z.object({
    type: z.literal("external_identity"),
    provider: z.string().min(1),
    tenantId: z.string().min(1),
    subject: z.string().min(1),
  }),
]);

export const connectorAccessPolicySchema = z.object({
  visibility: z.enum(["workspace", "restricted"]),
  completeness: z.enum(["complete", "partial"]),
  grants: z.array(connectorAccessGrantSchema).max(10_000),
});
export type ConnectorAccessPolicy = z.infer<typeof connectorAccessPolicySchema>;

export const connectorItemSchema = z.object({
  externalId: z.string().min(1).max(1_000),
  title: z.string().min(1).max(2_000),
  markdown: z.string().max(10_000_000),
  sourceUrl: z.url().optional(),
  updatedAt: z.iso.datetime(),
  contentHash: z.string().min(1).max(256),
  kind: z.enum(["web", "chat_export"]).default("web"),
  metadata: z.record(z.string(), jsonValueSchema).optional(),
  accessPolicy: connectorAccessPolicySchema.optional(),
});
export type ConnectorItem = z.infer<typeof connectorItemSchema>;

export const connectorPullRequestSchema = z.object({
  protocolVersion: z.literal(CONNECTOR_PROTOCOL_VERSION),
  connectionId: z.uuid(),
  cursor: jsonValueSchema.nullable(),
  configuration: z.record(z.string(), jsonValueSchema),
  limit: z.number().int().min(1).max(2_000),
});
export type ConnectorPullRequest = z.infer<typeof connectorPullRequestSchema>;

export const connectorPullResponseSchema = z.object({
  protocolVersion: z.literal(CONNECTOR_PROTOCOL_VERSION),
  items: z.array(connectorItemSchema).max(2_000),
  nextCursor: jsonValueSchema.nullable(),
  hasMore: z.boolean(),
});
export type ConnectorPullResponse = z.infer<typeof connectorPullResponseSchema>;

export const connectorScopeSchema = z.object({
  id: z.string().min(1).max(1_000),
  name: z.string().min(1).max(1_000),
  path: z.string().max(2_000).optional(),
});
export type ConnectorScope = z.infer<typeof connectorScopeSchema>;

export const connectorScopesRequestSchema = z.object({
  protocolVersion: z.literal(CONNECTOR_PROTOCOL_VERSION),
  connectionId: z.uuid(),
  configuration: z.record(z.string(), jsonValueSchema),
});
export type ConnectorScopesRequest = z.infer<
  typeof connectorScopesRequestSchema
>;

export const connectorScopesResponseSchema = z.object({
  protocolVersion: z.literal(CONNECTOR_PROTOCOL_VERSION),
  scopes: z.array(connectorScopeSchema).max(10_000),
});
export type ConnectorScopesResponse = z.infer<
  typeof connectorScopesResponseSchema
>;

export interface ConnectorDefinition {
  manifest: ConnectorManifest;
  authorize?: (request: Request) => boolean | Promise<boolean>;
  pull: (
    request: ConnectorPullRequest,
    signal: AbortSignal,
  ) => ConnectorPullResponse | Promise<ConnectorPullResponse>;
  scopes?: (
    request: ConnectorScopesRequest,
    signal: AbortSignal,
  ) => ConnectorScopesResponse | Promise<ConnectorScopesResponse>;
}

function jsonResponse(value: unknown, status = 200): Response {
  return Response.json(value, { status });
}

async function jsonRequest(request: Request): Promise<unknown> {
  return (await request.json()) as unknown;
}

class InvalidConnectorRequestError extends Error {}

async function parseRequest<T>(
  request: Request,
  schema: z.ZodType<T>,
): Promise<T> {
  try {
    return schema.parse(await jsonRequest(request));
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      throw new InvalidConnectorRequestError();
    }
    throw error;
  }
}

/** Create a Fetch-compatible handler for one connector implementation. */
export function createConnectorHandler(
  definition: ConnectorDefinition,
): (request: Request) => Promise<Response> {
  const manifest = connectorManifestSchema.parse(definition.manifest);
  return async function handleConnectorRequest(request) {
    const { pathname } = new URL(request.url);
    try {
      if (definition.authorize && !(await definition.authorize(request))) {
        return jsonResponse({ error: "unauthorized" }, 401);
      }
      if (pathname === CONNECTOR_MANIFEST_PATH && request.method === "GET") {
        return jsonResponse(manifest);
      }
      if (pathname === CONNECTOR_PULL_PATH && request.method === "POST") {
        const input = await parseRequest(request, connectorPullRequestSchema);
        return jsonResponse(
          connectorPullResponseSchema.parse(
            await definition.pull(input, request.signal),
          ),
        );
      }
      if (pathname === CONNECTOR_SCOPES_PATH && request.method === "POST") {
        if (!definition.scopes) {
          return jsonResponse({ error: "scopes_not_supported" }, 404);
        }
        const input = await parseRequest(request, connectorScopesRequestSchema);
        return jsonResponse(
          connectorScopesResponseSchema.parse(
            await definition.scopes(input, request.signal),
          ),
        );
      }
      return jsonResponse({ error: "not_found" }, 404);
    } catch (error) {
      if (error instanceof InvalidConnectorRequestError) {
        return jsonResponse({ error: "invalid_request" }, 400);
      }
      return jsonResponse({ error: "connector_failed" }, 500);
    }
  };
}
