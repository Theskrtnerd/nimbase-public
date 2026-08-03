import { cloudEnv } from "./env";

// Context.dev Parse Bytes (POST https://api.context.dev/v1/parse): raw file
// bytes in, LLM-ready markdown out. This is the extraction path for documents
// (PDF, docx, xlsx, pptx), code/data files, and images — everything the
// gardener needs as text but that isn't text on disk.
//
// It sits beside extractBinaryText (normalize.ts), which stays the path for
// voice and video: Parse has no audio or video support, so those cannot route
// here no matter how the caller is configured.

const PARSE_ENDPOINT = "https://api.context.dev/v1/parse";

// Context.dev rejects anything larger with a 413. Callers check this before
// spending a request; the ingest presign caps (15-20 MiB) already sit under it,
// so this is a backstop rather than the primary guard.
export const PARSE_MAX_BYTES = 25 * 1024 * 1024;

/**
 * Mimes we hand to Context.dev, mapped to the `extension` hint it takes as a
 * file-type disambiguator. Parse sniffs content on its own, but the hint makes
 * it deterministic for formats that share magic bytes (docx/xlsx/pptx are all
 * zip containers, which would otherwise look like archives).
 *
 * Deliberately excluded: audio and video (unsupported upstream), and the
 * TEXT_NATIVE_MIME set in extract.ts, which decodes to markdown for free.
 */
const EXTENSION_FOR_MIME: Record<string, string> = {
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-powerpoint": "ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation":
    "pptx",
  "application/rtf": "rtf",
  "application/epub+zip": "epub",
  // code + data
  "text/html": "html",
  "text/xml": "xml",
  "application/xml": "xml",
  "text/yaml": "yaml",
  "application/yaml": "yaml",
  "text/x-python": "py",
  "text/javascript": "js",
  "application/javascript": "js",
  "text/x-typescript": "ts",
  "text/x-java-source": "java",
  "text/x-ruby": "rb",
  "text/x-php": "php",
  "text/x-go": "go",
  "text/x-rust": "rs",
  "text/x-c": "c",
  "text/x-c++": "cpp",
  "text/x-sh": "sh",
  "text/x-sql": "sql",
  "application/toml": "toml",
  // images
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/bmp": "bmp",
  "image/tiff": "tiff",
  "image/svg+xml": "svg",
};

/**
 * Whether a captured file should route to Context.dev rather than the
 * decode-or-stub fallback. A missing mime means we can't say, so we don't.
 */
export function isParseableMime(mimeType: string | null): boolean {
  return mimeType !== null && mimeType in EXTENSION_FOR_MIME;
}

/**
 * Whether the Parse path is available at all. Callers use this to decide
 * between routing a capture here and falling back, so a missing key degrades
 * extraction quality instead of failing the capture.
 */
export function parseConfigured(): boolean {
  return Boolean(cloudEnv().CONTEXT_DEV_API_KEY);
}

export interface ParseBytesResult {
  markdown: string;
  /** Format Context.dev decided the bytes were, e.g. "pdf" — provenance only. */
  type: string;
  creditsConsumed: number;
  creditsRemaining: number;
}

export class ParseError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ParseError";
  }
}

interface ParseResponseBody {
  success?: boolean;
  markdown?: string;
  type?: string;
  key_metadata?: { credits_consumed?: number; credits_remaining?: number };
  error?: { code?: string; message?: string };
}

/**
 * Converts raw file bytes into markdown via Context.dev Parse Bytes.
 *
 * Links and images are both preserved (includeLinks/includeImages) so a
 * compiled note keeps the document's outbound references and figure captions;
 * base64 image payloads are shortened so an inlined asset can't blow up the
 * body the gardener has to read. OCR is on so a scanned PDF — bytes that are
 * images of text — still yields text instead of an empty note.
 *
 * Throws ParseError on a non-2xx response or a malformed body; callers decide
 * whether that fails the source or falls back.
 */
export async function parseBytes(args: {
  data: Uint8Array;
  mimeType: string;
  /** Overrides the mime-derived extension hint (e.g. from a real filename). */
  extension?: string;
  signal?: AbortSignal;
}): Promise<ParseBytesResult> {
  const apiKey = cloudEnv().CONTEXT_DEV_API_KEY;
  if (!apiKey) {
    throw new ParseError("CONTEXT_DEV_API_KEY is not set", 500);
  }
  if (args.data.byteLength > PARSE_MAX_BYTES) {
    throw new ParseError(
      `file is ${args.data.byteLength} bytes, over the ${PARSE_MAX_BYTES}-byte parse limit`,
      413,
    );
  }

  const extension = args.extension ?? EXTENSION_FOR_MIME[args.mimeType];
  const query = new URLSearchParams({
    includeLinks: "true",
    includeImages: "true",
    shortenBase64Images: "true",
    ocr: "true",
    client: "nimbase",
  });
  if (extension) query.set("extension", extension);

  const res = await fetch(`${PARSE_ENDPOINT}?${query.toString()}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": args.mimeType,
    },
    // Sending the view directly avoids copying a 20 MiB document just to
    // satisfy the body type.
    body: args.data,
    signal: args.signal,
  });

  let body: ParseResponseBody | null = null;
  try {
    body = (await res.json()) as ParseResponseBody;
  } catch {
    // fall through — an unparseable body is reported via the status below
  }

  if (!res.ok) {
    const detail = body?.error?.message ?? body?.error?.code ?? res.statusText;
    throw new ParseError(`context.dev parse failed: ${detail}`, res.status);
  }
  if (typeof body?.markdown !== "string") {
    throw new ParseError("context.dev parse returned no markdown", 502);
  }

  return {
    markdown: body.markdown,
    type: body.type ?? extension ?? "unknown",
    creditsConsumed: body.key_metadata?.credits_consumed ?? 0,
    creditsRemaining: body.key_metadata?.credits_remaining ?? 0,
  };
}
