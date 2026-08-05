import { beforeEach, describe, expect, it, vi } from "vitest";

import { processArtifactGenerateJob } from "./generate";

const mocks = vi.hoisted(() => ({
  generateText: vi.fn(),
  traceGeneration: vi.fn((_trace: unknown, generate: () => unknown) =>
    generate(),
  ),
  buildArtifactHtml: vi.fn(),
  hasUnsafeScript: vi.fn(),
  putObject: vi.fn(),
  runHarnessAgent: vi.fn(),
  readOutput: vi.fn(),
  prime: vi.fn(),
  updateSet: vi.fn(),
  insertValues: vi.fn(),
}));

vi.mock("ai", () => ({
  generateText: mocks.generateText,
}));
vi.mock("@acme/db", () => ({ and: vi.fn(), eq: vi.fn() }));
vi.mock("@acme/db/schema", () => ({ Artifact: {}, SpendLedger: {} }));
vi.mock("@acme/db/client", () => ({
  db: {
    update: vi.fn(() => ({ set: mocks.updateSet })),
    insert: vi.fn(() => ({ values: mocks.insertValues })),
  },
}));
vi.mock("@acme/runtime/artifact-build", () => ({
  buildArtifactHtml: mocks.buildArtifactHtml,
}));
vi.mock("@acme/runtime/ai", () => ({
  traceGeneration: mocks.traceGeneration,
  resolveModels: () =>
    Promise.resolve({
      chat: {
        id: "anthropic/claude-sonnet-4.6",
        model: "anthropic/claude-sonnet-4.6",
      },
    }),
  // Faithful to the registry's sonnet pricing (300/1500 cents per MTok); exact
  // math is covered by packages/runtime/src/ai/cost.test.ts.
  costFor: (_id: string, u: { inputTokens: number; outputTokens: number }) =>
    Math.round((u.inputTokens * 300 + u.outputTokens * 1500) / 1_000_000),
}));
vi.mock("@acme/runtime/s3", () => ({
  s3KeyFor: {
    artifactHtml: (w: string, id: string) =>
      `workspaces/${w}/artifactes/${id}.html`,
    artifactSource: (w: string, id: string) =>
      `workspaces/${w}/artifactes/${id}.tsx`,
  },
  putObject: mocks.putObject,
  getObjectText: vi.fn(),
}));
vi.mock("@acme/runtime/memory/wiki", () => ({
  WikiReadFs: class {},
}));
vi.mock("@acme/runtime/harness", () => ({
  runHarnessAgent: mocks.runHarnessAgent,
  buildHarnessMounts: () => ({ fs: {}, readOutput: mocks.readOutput }),
  kbSearchTool: () => ({ search: {} }),
  resolveHarnessModel: () =>
    Promise.resolve({ modelId: "anthropic/claude-sonnet-4.6", pi: {} }),
  WikiFileSystem: { readOnly: () => ({ prime: mocks.prime }) },
}));
vi.mock("~/server/share/artifact-prompts", () => ({
  ARTIFACT_FIXED_SYSTEM: "fixed-system",
  ARTIFACT_FREEFORM_SYSTEM: "freeform-system",
  ARTIFACT_KB_GUIDANCE: "kb-guidance",
  themeInstruction: () => "theme-instruction",
}));
vi.mock("~/server/share/sanitize", () => ({
  hasUnsafeScript: mocks.hasUnsafeScript,
  stripCodeFence: (s: string) => s,
}));

const base = {
  jobId: "job-1",
  artifactId: "artifact-1",
  workspaceId: "ws-1",
  prompt: "make a dashboard",
  themeMode: "app" as const,
  readScopes: null,
};

const genReply = (text: string) => ({
  text,
  totalUsage: { inputTokens: 1000, outputTokens: 2000 },
});

describe("processArtifactGenerateJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateSet.mockReturnValue({ where: vi.fn().mockResolvedValue([]) });
    mocks.insertValues.mockResolvedValue([]);
    mocks.putObject.mockResolvedValue(undefined);
    mocks.runHarnessAgent.mockResolvedValue({
      text: "fallback text",
      usage: { inputTokens: 1000, outputTokens: 2000 },
    });
  });

  it("freeform success: uploads html, marks draft, records spend", async () => {
    mocks.readOutput.mockResolvedValue("<html>ok</html>");
    mocks.hasUnsafeScript.mockReturnValue(false);

    await processArtifactGenerateJob({ ...base, kind: "freeform" });

    expect(mocks.putObject).toHaveBeenCalledWith(
      "workspaces/ws-1/artifactes/artifact-1.html",
      expect.stringContaining("<html>"),
      "text/html",
    );
    expect(mocks.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "draft",
        error: null,
        s3KeyHtml: "workspaces/ws-1/artifactes/artifact-1.html",
      }),
    );
    // (1000 * 300 + 2000 * 1500) / 1_000_000 = 3.3 → 3 cents
    expect(mocks.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "artifact",
        cents: 3,
        workspaceId: "ws-1",
      }),
    );
  });

  it("freeform: injects the mermaid loader only when a diagram is present", async () => {
    mocks.readOutput.mockResolvedValue(
      `<html><head></head><body><pre class="mermaid">graph TD; A-->B;</pre></body></html>`,
    );
    mocks.hasUnsafeScript.mockReturnValue(false);

    await processArtifactGenerateJob({ ...base, kind: "freeform" });

    expect(mocks.putObject).toHaveBeenCalledWith(
      "workspaces/ws-1/artifactes/artifact-1.html",
      expect.stringContaining(
        "https://nimbase-artifact-runtime.invalid/api/artifact-runtime/mermaid",
      ),
      "text/html",
    );
  });

  it("freeform: leaves a diagram-free document without the mermaid loader", async () => {
    mocks.readOutput.mockResolvedValue(
      "<html><head></head><body>plain</body></html>",
    );
    mocks.hasUnsafeScript.mockReturnValue(false);

    await processArtifactGenerateJob({ ...base, kind: "freeform" });

    expect(mocks.putObject).toHaveBeenCalledWith(
      "workspaces/ws-1/artifactes/artifact-1.html",
      expect.not.stringContaining("/* mermaid */"),
      "text/html",
    );
  });

  // The sanitizer runs on raw model output, before injection — so a model that
  // tries to write its own script tag is still rejected.
  it("freeform with unsafe script: marks failed and rethrows", async () => {
    mocks.readOutput.mockResolvedValue("<html>bad</html>");
    mocks.generateText.mockResolvedValue(genReply("<html>bad</html>"));
    mocks.hasUnsafeScript.mockReturnValue(true);

    await expect(
      processArtifactGenerateJob({ ...base, kind: "freeform" }),
    ).rejects.toThrow("unsafe_output");

    expect(mocks.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
        error: expect.stringContaining("unsafe_output") as unknown,
      }),
    );
    expect(mocks.insertValues).not.toHaveBeenCalled();
  });

  it("empty model output: marks failed and rethrows", async () => {
    mocks.readOutput.mockResolvedValue(null);
    mocks.runHarnessAgent.mockResolvedValue({
      text: "   ",
      usage: { inputTokens: 1, outputTokens: 1 },
    });

    await expect(
      processArtifactGenerateJob({ ...base, kind: "fixed" }),
    ).rejects.toThrow("empty_output");

    expect(mocks.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed" }),
    );
    expect(mocks.putObject).not.toHaveBeenCalled();
  });

  it("fixed transpile failure: marks failed and rethrows after exhausting repairs", async () => {
    mocks.readOutput.mockResolvedValue("export default x");
    mocks.generateText.mockResolvedValue(genReply("export default x"));
    mocks.buildArtifactHtml.mockImplementation(() => {
      throw new Error("Unexpected token");
    });

    await expect(
      processArtifactGenerateJob({ ...base, kind: "fixed" }),
    ).rejects.toThrow("transpile_failed");

    expect(mocks.runHarnessAgent).toHaveBeenCalledTimes(1);
    expect(mocks.generateText).toHaveBeenCalledTimes(2);
    expect(mocks.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed" }),
    );
    expect(mocks.putObject).not.toHaveBeenCalled();
  });

  it("fixed transpile failure: repairs from the build error and succeeds", async () => {
    mocks.readOutput.mockResolvedValue("export default broken");
    mocks.generateText.mockResolvedValueOnce(genReply("export default fixed"));
    mocks.buildArtifactHtml
      .mockImplementationOnce(() => {
        throw new Error("Unexpected token (455:12)");
      })
      .mockReturnValueOnce("<!doctype html>repaired");

    await processArtifactGenerateJob({ ...base, kind: "fixed" });

    // The repair turn is tool-free and must show the model both the compiler
    // error and the source it indexes into.
    const repairCall = mocks.generateText.mock.calls[0]?.[0] as {
      prompt: string;
      tools?: unknown;
    };
    expect(repairCall.prompt).toContain("Unexpected token (455:12)");
    expect(repairCall.prompt).toContain("export default broken");
    expect(repairCall.tools).toBeUndefined();

    expect(mocks.putObject).toHaveBeenCalledWith(
      "workspaces/ws-1/artifactes/artifact-1.html",
      "<!doctype html>repaired",
      "text/html",
    );
    // The repaired source is what gets stored, not the broken first attempt.
    expect(mocks.putObject).toHaveBeenCalledWith(
      "workspaces/ws-1/artifactes/artifact-1.tsx",
      "export default fixed",
      "text/plain",
    );
    expect(mocks.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ status: "draft", error: null }),
    );
    // Both turns are billed: 3 cents for the generation + 3 for the repair.
    expect(mocks.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "artifact", cents: 6 }),
    );
  });

  it("freeform unsafe script: a repaired document is accepted", async () => {
    mocks.readOutput.mockResolvedValue("<html><script>bad</script></html>");
    mocks.generateText.mockResolvedValueOnce(genReply("<html>clean</html>"));
    mocks.hasUnsafeScript.mockReturnValueOnce(true).mockReturnValueOnce(false);

    await processArtifactGenerateJob({ ...base, kind: "freeform" });

    expect(mocks.putObject).toHaveBeenCalledWith(
      "workspaces/ws-1/artifactes/artifact-1.html",
      expect.stringContaining("clean"),
      "text/html",
    );
    expect(mocks.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ status: "draft" }),
    );
  });

  it("gives up rather than repairing when the model returns nothing", async () => {
    mocks.readOutput.mockResolvedValue("export default broken");
    mocks.generateText.mockResolvedValueOnce(genReply("   "));
    mocks.buildArtifactHtml.mockImplementation(() => {
      throw new Error("Unexpected token");
    });

    await expect(
      processArtifactGenerateJob({ ...base, kind: "fixed" }),
    ).rejects.toThrow("transpile_failed");

    // An empty repair ends the loop immediately — retrying on nothing would
    // just burn the remaining attempt on the same empty prompt.
    expect(mocks.generateText).toHaveBeenCalledTimes(1);
  });

  it("fixed success: uploads html and tsx source", async () => {
    mocks.readOutput.mockResolvedValue("export default fn");
    mocks.buildArtifactHtml.mockReturnValue("<html>built</html>");

    await processArtifactGenerateJob({ ...base, kind: "fixed" });

    expect(mocks.putObject).toHaveBeenCalledWith(
      "workspaces/ws-1/artifactes/artifact-1.tsx",
      "export default fn",
      "text/plain",
    );
    expect(mocks.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "draft",
        s3KeySource: "workspaces/ws-1/artifactes/artifact-1.tsx",
      }),
    );
  });
});

describe("processArtifactGenerateJob harness contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateSet.mockReturnValue({ where: vi.fn().mockResolvedValue([]) });
    mocks.insertValues.mockResolvedValue([]);
    mocks.putObject.mockResolvedValue(undefined);
    mocks.runHarnessAgent.mockResolvedValue({
      text: "fallback text",
      usage: { inputTokens: 1000, outputTokens: 2000 },
    });
  });

  it("fixed: reads the artifact from /output/artifact.tsx and never calls generateText", async () => {
    mocks.readOutput.mockResolvedValue("export default fn");
    mocks.buildArtifactHtml.mockReturnValue("<html>built</html>");

    await processArtifactGenerateJob({ ...base, kind: "fixed" });

    expect(mocks.generateText).not.toHaveBeenCalled();
    expect(mocks.prime).toHaveBeenCalled();
    expect(mocks.readOutput).toHaveBeenCalledWith("/output/artifact.tsx");
    const call = mocks.runHarnessAgent.mock.calls[0]?.[0] as {
      agent: string;
      prompt: string;
    };
    expect(call.agent).toBe("artifact");
    expect(call.prompt).toContain("/output/artifact.tsx");
    expect(mocks.putObject).toHaveBeenCalledWith(
      "workspaces/ws-1/artifactes/artifact-1.tsx",
      "export default fn",
      "text/plain",
    );
    expect(mocks.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ status: "draft" }),
    );
    // Usage comes from the harness run: same 1000/2000 → 3 cents.
    expect(mocks.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "artifact", cents: 3 }),
    );
  });

  it("freeform: falls back to the final message text when no output file exists", async () => {
    mocks.readOutput.mockResolvedValue(null);
    mocks.runHarnessAgent.mockResolvedValue({
      text: "<html>from message</html>",
      usage: { inputTokens: 10, outputTokens: 10 },
    });
    mocks.hasUnsafeScript.mockReturnValue(false);

    await processArtifactGenerateJob({ ...base, kind: "freeform" });

    expect(mocks.readOutput).toHaveBeenCalledWith("/output/artifact.html");
    expect(mocks.putObject).toHaveBeenCalledWith(
      "workspaces/ws-1/artifactes/artifact-1.html",
      expect.stringContaining("from message"),
      "text/html",
    );
  });

  it("harness failure marks the artifact failed and rethrows", async () => {
    mocks.runHarnessAgent.mockRejectedValue(new Error("session timed out"));

    await expect(
      processArtifactGenerateJob({ ...base, kind: "fixed" }),
    ).rejects.toThrow("session timed out");

    expect(mocks.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
        error: expect.stringContaining("timed out") as unknown,
      }),
    );
  });
});
