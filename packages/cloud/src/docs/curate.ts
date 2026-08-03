// The one generative step in docs generation.
//
// `projectDocsContent` already produced a correct, buildable site. Curation
// only makes it read like documentation instead of a wiki dump: it orders the
// sidebar and writes real landing pages for the stub indexes the projection
// left behind.
//
// Three deliberate limits:
//
//  - **It cannot add pages.** The model reorders and writes overviews; it never
//    introduces content. Everything a reader sees still came through the fence.
//  - **It cannot rewrite page bodies.** Memory is the source of truth, and a
//    per-page rewrite would make the site drift from what the company actually
//    knows — with no way to tell which version is current.
//  - **It degrades to the projection.** Any failure — bad JSON, model outage,
//    unknown paths — returns the input unchanged. A docs build never fails
//    because curation failed; it just ships the plainer site.

import { generateText } from "ai";
import { z } from "zod";

import type { DocPage } from "./project";
import { costFor, resolveModels, traceGeneration } from "../ai";

export interface CurateInput {
  workspaceId: string;
  siteTitle: string;
  /** Operator guidance from the site's config (voice, emphasis). */
  guidance?: string | null;
  pages: DocPage[];
}

export interface CurateResult {
  pages: DocPage[];
  /** Null when curation ran; a reason string when it degraded. */
  degraded: string | null;
  costCents: number;
}

/** Landing-page bodies are overviews, not essays. */
const OVERVIEW_CAP = 1200;

const planSchema = z.object({
  // path (relative, as given) -> 1-based sidebar position
  order: z.record(z.string(), z.number().int().min(1).max(999)).default({}),
  // index path -> markdown body for that section's landing page
  overviews: z.record(z.string(), z.string()).default({}),
});

const SYSTEM = `You are organizing a company's documentation site.

You are given the list of pages that already exist. You may do exactly two things:

1. Assign each page a sidebar position, so a newcomer reads them in a sensible
   order. Overviews and getting-started material first; reference and edge cases
   last.
2. Write a short overview body (markdown, no frontmatter, no H1 — the title is
   already set) for each index page listed as needing one. Describe what the
   section covers and link to its pages with relative markdown links.

You must NOT invent pages, features, products, or facts. If you do not know what
a section contains beyond its page titles, describe it in one plain sentence and
link the pages. An accurate thin overview is correct; a padded one is not.

Reply with JSON only: {"order": {"path": 1, ...}, "overviews": {"path": "..."}}`;

/**
 * Order the sidebar and fill in section landing pages.
 *
 * Returns files in the same shape it received them, so the caller can hand the
 * result straight to the build runner without knowing whether curation ran.
 */
export async function curateDocsContent(
  input: CurateInput,
): Promise<CurateResult> {
  const unchanged = (reason: string): CurateResult => ({
    pages: input.pages,
    degraded: reason,
    costCents: 0,
  });

  // An empty body is exactly the projection's "synthesized index" signal.
  const needsOverview = input.pages
    .filter((p) => p.body.trim() === "")
    .map((p) => p.path);
  const authored = input.pages.filter((p) => p.body.trim() !== "");

  if (authored.length === 0) return unchanged("no pages to curate");

  try {
    const { chat } = await resolveModels(input.workspaceId);
    const prompt = [
      `Site: ${input.siteTitle}`,
      input.guidance?.trim() ? `Guidance: ${input.guidance.trim()}` : null,
      `Pages:\n${authored.map((p) => `- ${p.path} — ${p.title}`).join("\n")}`,
      needsOverview.length
        ? `Index pages needing an overview:\n${needsOverview
            .map((p) => `- ${p}`)
            .join("\n")}`
        : null,
    ]
      .filter(Boolean)
      .join("\n\n");

    const result = await traceGeneration(
      {
        name: "docsite-curate",
        workspaceId: input.workspaceId,
        role: "chat",
        modelId: chat.id,
        input: prompt,
      },
      () => generateText({ model: chat.model, instructions: SYSTEM, prompt }),
    );

    const parsed = planSchema.safeParse(parseJsonBlock(result.text));
    if (!parsed.success) return unchanged("model returned unusable JSON");

    const costCents = costFor(chat.id, {
      inputTokens: result.usage.inputTokens ?? 0,
      outputTokens: result.usage.outputTokens ?? 0,
    });

    return {
      pages: applyPlan(input.pages, parsed.data),
      degraded: null,
      costCents,
    };
  } catch (err) {
    console.error("[docsite] curation failed, publishing the plain site", err);
    return unchanged("curation errored");
  }
}

/** Tolerate a fenced code block around the JSON. */
function parseJsonBlock(text: string): unknown {
  const body = /```(?:json)?\s*([\s\S]*?)```/.exec(text)?.[1] ?? text;
  try {
    return JSON.parse(body.trim());
  } catch {
    return null;
  }
}

/**
 * Apply the plan. Paths the model invented are ignored rather than created —
 * the page set is fixed by the fence, not by the model.
 *
 * Only two fields are writable: `sidebarOrder`, and the body of a page that
 * has none. Curation can reorder and introduce sections, never rewrite what
 * memory actually says.
 */
function applyPlan(
  pages: DocPage[],
  plan: z.infer<typeof planSchema>,
): DocPage[] {
  return pages.map((page) => {
    const sidebarOrder = plan.order[page.path] ?? page.sidebarOrder;
    const overview = plan.overviews[page.path];
    const body =
      overview !== undefined && page.body.trim() === ""
        ? overview.trim().slice(0, OVERVIEW_CAP)
        : page.body;
    return { ...page, sidebarOrder, body };
  });
}
