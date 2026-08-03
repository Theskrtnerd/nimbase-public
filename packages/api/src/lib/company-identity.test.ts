import { describe, expect, it } from "vitest";

import {
  normalizeCompanyEmail,
  normalizeCompanyIdentity,
} from "./company-identity";

describe("normalizeCompanyEmail", () => {
  it("normalizes the exact company-email join key", () => {
    expect(normalizeCompanyEmail("  Employee.Name@Company.COM ")).toBe(
      "employee.name@company.com",
    );
  });

  it("does not invent a key for missing addresses", () => {
    expect(normalizeCompanyEmail(null)).toBeNull();
    expect(normalizeCompanyEmail("   ")).toBeNull();
  });
});

describe("normalizeCompanyIdentity", () => {
  it("normalizes namespaces but preserves the opaque provider subject", () => {
    expect(
      normalizeCompanyIdentity({
        provider: " Slack ",
        tenantId: " ACME ",
        subject: " UAbC123 ",
        verifiedEmail: " ADA@EXAMPLE.COM ",
        displayName: " Ada Lovelace ",
      }),
    ).toEqual({
      provider: "slack",
      tenantId: "acme",
      subject: "UAbC123",
      verifiedEmail: "ada@example.com",
      displayName: "Ada Lovelace",
    });
  });

  it("rejects an identity without an opaque provider key", () => {
    expect(() =>
      normalizeCompanyIdentity({
        provider: "slack",
        tenantId: "acme",
        subject: " ",
      }),
    ).toThrow("Identity subject is required");
  });
});
