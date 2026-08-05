import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  Agent,
  AgentConnection,
  AgentTurn,
  ApiToken,
  Artifact,
  artifactVisibilitySchema,
  CompileJob,
  compileJobStatusSchema,
  connectionPlatformSchema,
  connectionStatusSchema,
  CreateApiTokenSchema,
  CreateSourceSchema,
  ExternalIdentity,
  GroupMcp,
  MemoryGitRef,
  MemoryMutation,
  memoryMutationChangesSchema,
  ProviderAccessObservation,
  ProviderAccessResource,
  providerAccessResourceStateSchema,
  Source,
  sourceKindSchema,
  spendKindSchema,
  SpendLedger,
  UserProfile,
  UserProfileEmail,
  widgetInterfaceConfigSchema,
  WikiChunk,
  WikiNode,
  WikiNodeVersion,
  Workspace,
  WorkspaceMember,
} from "./schema";

describe("schema harness", () => {
  it("exposes the existing workspace table", () => {
    expect(Workspace).toBeDefined();
  });
});

describe("enums", () => {
  it("sourceKindSchema accepts the three MVP kinds", () => {
    expect(sourceKindSchema.parse("web")).toBe("web");
    expect(sourceKindSchema.parse("chat_export")).toBe("chat_export");
    expect(sourceKindSchema.parse("highlight")).toBe("highlight");
  });
  it("sourceKindSchema rejects unknown kinds", () => {
    expect(() => sourceKindSchema.parse("pdf")).toThrow();
  });
  it("artifact visibility is private or public only", () => {
    expect(artifactVisibilitySchema.options).toEqual(["private", "public"]);
    expect(() => artifactVisibilitySchema.parse("password")).toThrow();
  });
});

describe("artifact", () => {
  it("does not store password hashes", () => {
    const columns = getTableConfig(Artifact).columns.map(
      (column) => column.name,
    );
    expect(columns).not.toContain("password_hash");
  });

  it("constrains every artifact visibility column at the database boundary", () => {
    const constraints = [Artifact, Agent, GroupMcp].flatMap((table) =>
      getTableConfig(table).checks.map((check) => check.name),
    );
    expect(constraints).toEqual(
      expect.arrayContaining([
        "artifact_visibility_check",
        "agent_artifact_visibility_check",
        "group_mcp_artifact_visibility_check",
      ]),
    );
  });
});

describe("api_token", () => {
  it("is named api_token with the expected columns", () => {
    const { name, columns } = getTableConfig(ApiToken);
    expect(name).toBe("api_token");
    const cols = columns.map((c) => c.name);
    expect(cols).toEqual(
      expect.arrayContaining([
        "id",
        "workspace_id",
        "token_hash",
        "label",
        "last_used_at",
        "created_at",
      ]),
    );
  });
  it("CreateApiTokenSchema requires a label and omits server fields", () => {
    const parsed = CreateApiTokenSchema.parse({
      workspaceId: "00000000-0000-0000-0000-000000000000",
      tokenHash: "abc",
      label: "My extension",
    });
    expect(parsed.label).toBe("My extension");
    expect("id" in parsed).toBe(false);
  });
});

describe("source", () => {
  it("is named source with the expected columns", () => {
    const { name, columns } = getTableConfig(Source);
    expect(name).toBe("source");
    const cols = columns.map((c) => c.name);
    expect(cols).toEqual(
      expect.arrayContaining([
        "id",
        "workspace_id",
        "kind",
        "source_url",
        "title",
        "s3_key_original",
        "s3_key_raw_md",
        "status",
        "content_hash",
        "idempotency_key",
        "error",
        "metadata",
        "captured_at",
        "created_at",
        "compiled_at",
        "access_policy_id",
        "access_resource_id",
      ]),
    );
  });
  it("CreateSourceSchema validates kind via the enum", () => {
    expect(() =>
      CreateSourceSchema.parse({
        workspaceId: "00000000-0000-0000-0000-000000000000",
        kind: "audio",
        sourceUrl: "https://example.com",
        title: "x",
        s3KeyRaw: "k",
      }),
    ).toThrow();
  });
});

describe("provider access resources", () => {
  it("stores current state separately from append-only observations", () => {
    expect(
      getTableConfig(ProviderAccessResource).columns.map(
        (column) => column.name,
      ),
    ).toEqual(
      expect.arrayContaining([
        "connection_id",
        "provider",
        "kind",
        "external_id",
        "state",
        "current_access_policy_id",
        "last_verified_at",
      ]),
    );
    expect(
      getTableConfig(ProviderAccessObservation).columns.map(
        (column) => column.name,
      ),
    ).toEqual(
      expect.arrayContaining([
        "resource_id",
        "state",
        "access_policy_id",
        "observed_at",
      ]),
    );
  });

  it("constrains lifecycle and policy-state shapes at the database boundary", () => {
    expect(providerAccessResourceStateSchema.options).toEqual([
      "active",
      "inaccessible",
      "deleted",
    ]);
    const checks = [ProviderAccessResource, ProviderAccessObservation].flatMap(
      (table) => getTableConfig(table).checks.map((check) => check.name),
    );
    expect(checks).toEqual(
      expect.arrayContaining([
        "provider_access_resource_state_check",
        "provider_access_resource_policy_state_check",
        "provider_access_observation_state_check",
        "provider_access_observation_policy_state_check",
      ]),
    );
  });
});

describe("wiki_node + wiki_node_version", () => {
  it("wiki_node has tree columns", () => {
    const { name, columns } = getTableConfig(WikiNode);
    expect(name).toBe("wiki_node");
    const cols = columns.map((c) => c.name);
    expect(cols).toEqual(
      expect.arrayContaining([
        "id",
        "workspace_id",
        "path",
        "kind",
        "current_version_id",
        "created_at",
        "updated_at",
      ]),
    );
  });
  it("wiki_node_version references node + source", () => {
    const { name, columns } = getTableConfig(WikiNodeVersion);
    expect(name).toBe("wiki_node_version");
    const cols = columns.map((c) => c.name);
    expect(cols).toEqual(
      expect.arrayContaining([
        "id",
        "node_id",
        "workspace_id",
        "s3_key",
        "summary",
        "source_id",
        "created_at",
      ]),
    );
  });
});

describe("memory mutation journal", () => {
  it("stores durable mutations and their Git projection state separately", () => {
    expect(
      getTableConfig(MemoryMutation).columns.map((column) => column.name),
    ).toEqual(
      expect.arrayContaining([
        "sequence",
        "workspace_id",
        "changes",
        "message",
        "git_commit_sha",
        "projected_at",
        "projection_attempts",
      ]),
    );
    expect(
      getTableConfig(MemoryGitRef).columns.map((column) => column.name),
    ).toEqual(
      expect.arrayContaining([
        "workspace_id",
        "head_sha",
        "entries",
        "revision",
      ]),
    );
  });

  it("validates the internal mutation wire shape", () => {
    const changes = [
      {
        type: "upsert" as const,
        path: "identity/company.md",
        versionId: "00000000-0000-4000-8000-000000000001",
      },
      { type: "move" as const, from: "identity", to: "company" },
      { type: "delete" as const, path: "archive" },
    ];
    expect(memoryMutationChangesSchema.parse(changes)).toEqual(changes);
    expect(() =>
      memoryMutationChangesSchema.parse([{ type: "upsert", path: "" }]),
    ).toThrow();
  });
});

describe("wiki_chunk", () => {
  it("has an embedding vector column of 1536 dimensions", () => {
    const { name, columns } = getTableConfig(WikiChunk);
    expect(name).toBe("wiki_chunk");
    const cols = columns.map((c) => c.name);
    expect(cols).toEqual(
      expect.arrayContaining([
        "id",
        "node_version_id",
        "workspace_id",
        "ord",
        "text",
        "embedding",
      ]),
    );
    const embedding = columns.find((c) => c.name === "embedding");
    expect(embedding?.getSQLType()).toBe("vector(1536)");
  });
});

describe("compile_job", () => {
  it("has job lifecycle columns", () => {
    const { name, columns } = getTableConfig(CompileJob);
    expect(name).toBe("compile_job");
    const cols = columns.map((c) => c.name);
    expect(cols).toEqual(
      expect.arrayContaining([
        "id",
        "workspace_id",
        "source_id",
        "status",
        "error",
        "token_usage",
        "started_at",
        "finished_at",
        "created_at",
      ]),
    );
  });
  it("compileJobStatusSchema rejects unknown status", () => {
    expect(() => compileJobStatusSchema.parse("paused")).toThrow();
  });
});

describe("company identity", () => {
  it("stores profiles, verified emails, provider subjects, and membership links", () => {
    expect(
      getTableConfig(UserProfile).columns.map((column) => column.name),
    ).toEqual(
      expect.arrayContaining(["workspace_id", "primary_email", "display_name"]),
    );
    expect(
      getTableConfig(UserProfileEmail).columns.map((column) => column.name),
    ).toEqual(
      expect.arrayContaining(["workspace_id", "user_profile_id", "email"]),
    );
    expect(
      getTableConfig(ExternalIdentity).columns.map((column) => column.name),
    ).toEqual(
      expect.arrayContaining([
        "workspace_id",
        "user_profile_id",
        "provider",
        "tenant_id",
        "subject",
        "email_verified",
      ]),
    );
    expect(
      getTableConfig(WorkspaceMember).columns.map((column) => column.name),
    ).toContain("user_profile_id");
  });

  it("enforces workspace/profile consistency with composite foreign keys", () => {
    expect(
      getTableConfig(UserProfileEmail).foreignKeys.map((foreignKey) =>
        foreignKey.getName(),
      ),
    ).toContain("user_profile_email_workspace_profile_fk");
    expect(
      getTableConfig(ExternalIdentity).foreignKeys.map((foreignKey) =>
        foreignKey.getName(),
      ),
    ).toContain("external_identity_workspace_profile_fk");
    expect(
      getTableConfig(WorkspaceMember).foreignKeys.map((foreignKey) =>
        foreignKey.getName(),
      ),
    ).toContain("workspace_member_workspace_profile_fk");
  });
});

describe("agent interfaces", () => {
  it("models widget and Slack as AgentConnection platforms", () => {
    expect(connectionPlatformSchema.options).toEqual(["slack", "widget"]);
    expect(connectionStatusSchema.parse("paused")).toBe("paused");
    expect(
      getTableConfig(AgentConnection).columns.map((column) => column.name),
    ).toContain("interface_config");
  });

  it("stores anonymous widget accounting on AgentTurn", () => {
    expect(
      getTableConfig(AgentTurn).columns.map((column) => column.name),
    ).toEqual(
      expect.arrayContaining(["connection_id", "channel_key", "ip_hash"]),
    );
  });

  it("validates widget interface configuration at the runtime boundary", () => {
    expect(
      widgetInterfaceConfigSchema.parse({
        greeting: "Hello",
        allowedDomains: ["example.com"],
      }),
    ).toEqual({
      greeting: "Hello",
      allowedDomains: ["example.com"],
      theme: {},
    });
  });
});

describe("spend_ledger", () => {
  it("spend_ledger has cents + kind", () => {
    const { name, columns } = getTableConfig(SpendLedger);
    expect(name).toBe("spend_ledger");
    const cols = columns.map((c) => c.name);
    expect(cols).toEqual(
      expect.arrayContaining([
        "id",
        "workspace_id",
        "kind",
        "cents",
        "job_id",
        "created_at",
      ]),
    );
  });
  it("spendKindSchema accepts compile/embed/artifact", () => {
    expect(spendKindSchema.parse("compile")).toBe("compile");
    expect(spendKindSchema.parse("embed")).toBe("embed");
    expect(spendKindSchema.parse("artifact")).toBe("artifact");
    expect(() => spendKindSchema.parse("widget")).toThrow();
  });
});
