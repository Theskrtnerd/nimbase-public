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
import { cloudEnv } from "./env";
import { htmlMarkupToText, removeHtmlElementContents } from "./html";

// The canonical root path (VFS paths are lowercase kebab; "COMPANY.md" is the
// display title, never the path).
export const COMPANY_MD_PATH = "company.md";

const SITE_TEXT_CAP = 8_000;
const CONTENT_CAP = 6_000;
const SITE_FETCH_TIMEOUT_MS = 6_000;
const CONTEXT_API_BASE = "https://api.context.dev/v1";

interface ContextBrandResponse {
  brand?: {
    title?: string | null;
    name?: string | null;
    description?: string | null;
    slogan?: string | null;
    logos?: { url?: string | null; type?: string | null }[];
  };
}

interface ContextMarkdownResponse {
  markdown?: string | null;
}

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

function cleanBrandText(value: string | null | undefined): string | null {
  const text = value?.trim();
  return text?.length ? text : null;
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
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SITE_FETCH_TIMEOUT_MS);
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: { accept: "text/html" },
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const text = stripHtml(await res.text());
    return text.length > 0 ? text : null;
  } catch {
    return null;
  }
}

/**
 * Enriches a new workspace from its public website. Context.dev gives us a
 * brand profile (the product one-liner + ranked logos) and rendered markdown
 * in parallel; a missing optional key simply falls back to the lightweight
 * fetch used by the Biographer today.
 */
export async function enrichCompanyWebsite(
  websiteUrl: string,
): Promise<CompanyWebsiteEnrichment> {
  const apiKey = cloudEnv().CONTEXT_DEV_API_KEY;
  if (!apiKey) {
    return {
      title: null,
      description: null,
      logoUrl: null,
      siteText: await fetchSiteText(websiteUrl),
    };
  }

  try {
    const domain = new URL(websiteUrl).hostname.replace(/^www\./, "");
    const headers = { Authorization: `Bearer ${apiKey}` };
    const [brandResult, markdownResult] = await Promise.allSettled([
      fetch(`${CONTEXT_API_BASE}/brand/retrieve`, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ type: "by_domain", domain }),
      }),
      fetch(
        `${CONTEXT_API_BASE}/web/scrape/markdown?${new URLSearchParams({ url: websiteUrl }).toString()}`,
        { headers },
      ),
    ]);

    const brand =
      brandResult.status === "fulfilled" && brandResult.value.ok
        ? ((await brandResult.value.json()) as ContextBrandResponse).brand
        : undefined;
    const markdown =
      markdownResult.status === "fulfilled" && markdownResult.value.ok
        ? ((await markdownResult.value.json()) as ContextMarkdownResponse)
            .markdown
        : null;
    const logo =
      brand?.logos?.find((candidate) => candidate.type === "logo") ??
      brand?.logos?.[0];

    const title = cleanBrandText(brand?.title) ?? cleanBrandText(brand?.name);
    const description =
      cleanBrandText(brand?.description) ?? cleanBrandText(brand?.slogan);

    return {
      title: title?.slice(0, 120) ?? null,
      description: description?.slice(0, 280) ?? null,
      logoUrl: logo?.url ?? null,
      siteText: markdown?.trim().slice(0, SITE_TEXT_CAP) ?? null,
    };
  } catch {
    return {
      title: null,
      description: null,
      logoUrl: null,
      siteText: await fetchSiteText(websiteUrl),
    };
  }
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
