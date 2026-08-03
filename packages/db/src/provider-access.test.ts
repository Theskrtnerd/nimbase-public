import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  canonicalProviderAccessPolicy,
  fingerprintProviderAccessPolicy,
  providerPolicyAccessSql,
  providerResourceAccessSql,
} from "./provider-access";

const dialect = new PgDialect();

describe("provider access policies", () => {
  it("canonicalizes identities before fingerprinting", () => {
    const canonical = canonicalProviderAccessPolicy({
      version: 1,
      provider: " Gmail ",
      tenantId: " ACME.COM ",
      visibility: "restricted",
      completeness: "complete",
      grants: [
        { type: "email", email: "ADA@EXAMPLE.COM" },
        { type: "domain", domain: "@Example.com" },
        { type: "email", email: "ada@example.com" },
      ],
    });

    expect(canonical).toEqual({
      version: 1,
      provider: "gmail",
      tenantId: "ACME.COM",
      visibility: "restricted",
      completeness: "complete",
      grants: [
        { type: "domain", domain: "example.com" },
        { type: "email", email: "ada@example.com" },
      ],
    });
    expect(
      fingerprintProviderAccessPolicy({
        ...canonical,
        grants: [...canonical.grants].reverse(),
      }),
    ).toBe(fingerprintProviderAccessPolicy(canonical));
  });

  it("drops grants from workspace-visible policies", () => {
    expect(
      canonicalProviderAccessPolicy({
        version: 1,
        provider: "slack",
        tenantId: "T1",
        visibility: "workspace",
        completeness: "complete",
        grants: [{ type: "email", email: "ada@example.com" }],
      }).grants,
    ).toEqual([]);
  });

  it("allows only workspace-visible policies without a user profile", () => {
    const strict = dialect.sqlToQuery(
      providerPolicyAccessSql(sql`resource.access_policy_id`, {
        workspaceId: "workspace-1",
        userProfileId: null,
      }),
    );
    expect(strict.sql).toContain("provider_access_policy");
    expect(strict.sql).toContain("policy.visibility = 'workspace'");
    expect(strict.sql).not.toContain("provider_access_grant");

    const nullable = dialect.sqlToQuery(
      providerResourceAccessSql(sql`resource.access_policy_id`, {
        workspaceId: "workspace-1",
        userProfileId: null,
      }),
    );
    expect(nullable.sql).toContain("is null");
    expect(nullable.sql).toContain("policy.visibility = 'workspace'");
  });
});
