// The Biographer — the agent that understands the company as a whole and
// writes company.md, the root note of the workspace's memory. Its definition
// (system prompt + skills) lives in @acme/agents (definitions/biographer/);
// this module is the runner: gather inputs (name, description, website text),
// draft the note with the workspace's chat model, and fail soft to a
// deterministic template so onboarding never breaks on an AI error.
import { generateText } from "ai";

import { agentDefinition } from "@acme/agents";
import { db } from "@acme/db/client";
import { SpendLedger } from "@acme/db/schema";

import { costFor, resolveModels, traceGeneration } from "./ai";
import { htmlMarkupToText, removeHtmlElementContents } from "./html";
import { readResponseText, safeFetch } from "./safe-http";

// The canonical root path (VFS paths are lowercase kebab; "COMPANY.md" is the
// display title, never the path).
export const COMPANY_MD_PATH = "company.md";

const SITE_TEXT_CAP = 8_000;
const CONTENT_CAP = 6_000;
const SITE_FETCH_TIMEOUT_MS = 6_000;
const SITE_RESPONSE_MAX_BYTES = 512 * 1024;

export interface CompanyWebsiteEnrichment {
  title: string | null;
  description: string | null;
  logoUrl: string | null;
  siteText: string | null;
}

export interface BiographerInput {
  workspaceId: string;
  name: string;
  description?: string | null;
  websiteUrl?: string | null;
  /** Pre-fetched site text; when set (even null), skips the internal fetch. */
  siteText?: string | null;
}

// Reduce an HTML document to visible text for the prompt. Deliberately crude —
// this is prompt fodder, not a parser. Exported for tests.
export function stripHtml(html: string): string {
  return htmlMarkupToText(removeHtmlElementContents(html, ["script", "style"]))
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, SITE_TEXT_CAP);
}

// The deterministic seed used when the AI draft fails (or produces nothing):
// onboarding must always yield a company.md. Exported for tests.
export function companyMdFallback(input: {
  name: string;
  description?: string | null;
  websiteUrl?: string | null;
}): string {
  const intro = input.description?.trim()
    ? input.description.trim()
    : "_What this company does — fill me in as knowledge arrives._";
  return [
    `# ${input.name}`,
    "",
    input.websiteUrl ? `${intro} ([website](${input.websiteUrl}))` : intro,
    "",
    "## How this memory is organized",
    "",
    "Knowledge is captured into this workspace; an AI gardener files each capture into folders and keeps notes coherent. Folders are the permission boundaries — they decide who can see what.",
  ].join("\n");
}

export async function fetchSiteText(url: string): Promise<string | null> {
  try {
    const res = await safeFetch(url, {
      timeoutMs: SITE_FETCH_TIMEOUT_MS,
      redirect: "follow",
      headers: { accept: "text/html" },
    });
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("text/html")) return null;
    const text = stripHtml(
      await readResponseText(res, SITE_RESPONSE_MAX_BYTES),
    );
    return text.length > 0 ? text : null;
  } catch {
    return null;
  }
}

/**
 * Reads a public website for the Biographer. Community does not call a managed
 * brand or parsing vendor; hosted distributions can enrich the identity before
 * dispatching this job.
 */
export async function enrichCompanyWebsite(
  websiteUrl: string,
): Promise<CompanyWebsiteEnrichment> {
  return {
    title: null,
    description: null,
    logoUrl: null,
    siteText: await fetchSiteText(websiteUrl),
  };
}

/**
 * Draft the company.md body. Best-effort website fetch → chat-model draft
 * (traced, spend-ledgered) → template fallback on any failure. Never throws.
 */
export async function draftCompanyMd(input: BiographerInput): Promise<string> {
  const fallback = companyMdFallback(input);
  try {
    const site =
      input.siteText !== undefined
        ? input.siteText
        : input.websiteUrl
          ? await fetchSiteText(input.websiteUrl)
          : null;
    const { chat } = await resolveModels(input.workspaceId);
    const prompt = [
      `Company name: ${input.name}`,
      input.description?.trim()
        ? `Description (from the founder): ${input.description.trim()}`
        : null,
      input.websiteUrl ? `Website: ${input.websiteUrl}` : null,
      site ? `<website-text>\n${site}\n</website-text>` : null,
      "Write company.md now.",
    ]
      .filter(Boolean)
      .join("\n\n");

    const result = await traceGeneration(
      {
        name: "biographer-company-md",
        workspaceId: input.workspaceId,
        role: "chat",
        modelId: chat.id,
        input: prompt,
      },
      () =>
        generateText({
          model: chat.model,
          instructions: agentDefinition("biographer").instructions,
          prompt,
        }),
    );

    const cents = costFor(chat.id, {
      inputTokens: result.usage.inputTokens ?? 0,
      outputTokens: result.usage.outputTokens ?? 0,
    });
    if (cents > 0) {
      await db.insert(SpendLedger).values({
        workspaceId: input.workspaceId,
        kind: "biographer",
        cents,
      });
    }

    const text = result.text.trim();
    return text.length > 0 ? text.slice(0, CONTENT_CAP) : fallback;
  } catch (err) {
    console.error("[biographer] draft failed, using fallback", err);
    return fallback;
  }
}
