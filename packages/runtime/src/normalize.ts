import { generateText } from "ai";

import { resolveModels } from "./ai/resolve";

// Extraction of binary captures (voice/screenshot/video) into the markdown
// body that becomes raw.md. The model is resolved through the central AI
// layer (workspace override → global config → default Gemini Flash, which
// accepts audio, image, and video file parts natively).

export type BinarySourceKind = "screenshot" | "voice" | "video";

export interface ExtractBinaryResult {
  markdown: string;
  modelId: string;
  usage: { inputTokens: number; outputTokens: number };
}

const PROMPTS: Record<BinarySourceKind, string> = {
  voice: `Transcribe this audio recording verbatim into markdown.
Use plain paragraphs; add "## " section headings only where the speaker clearly changes topic.
Mark unintelligible words as [inaudible]. Output only the transcript — no preamble.`,
  screenshot: `Convert this screenshot into markdown.
First transcribe ALL visible text faithfully, preserving structure (headings, lists, tables, code blocks).
Then add a final "## Description" section with 1-3 sentences on what the screenshot shows.
Output only the markdown — no preamble.`,
  video: `Describe this video as markdown notes.
Transcribe any spoken audio verbatim under a "## Transcript" heading.
Add a "## Description" section summarizing what happens visually, in chronological order.
Output only the markdown — no preamble.`,
};

export async function extractBinaryText(args: {
  kind: BinarySourceKind;
  mimeType: string;
  data: Uint8Array;
  workspaceId: string;
}): Promise<ExtractBinaryResult> {
  const { normalize } = await resolveModels(args.workspaceId);
  const result = await generateText({
    model: normalize.model,
    messages: [
      {
        role: "user",
        content: [
          { type: "file", data: args.data, mediaType: args.mimeType },
          { type: "text", text: PROMPTS[args.kind] },
        ],
      },
    ],
  });
  return {
    markdown: result.text,
    modelId: normalize.id,
    usage: {
      inputTokens: result.totalUsage.inputTokens ?? 0,
      outputTokens: result.totalUsage.outputTokens ?? 0,
    },
  };
}
