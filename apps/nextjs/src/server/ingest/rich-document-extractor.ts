import "server-only";

export interface RichDocumentExtractionInput {
  data: Uint8Array;
  mimeType: string;
  extension?: string;
}

export interface RichDocumentExtraction {
  markdown: string;
  extractedBy: string;
}

export interface RichDocumentExtractor {
  supports(mimeType: string | null): boolean;
  extract(input: RichDocumentExtractionInput): Promise<RichDocumentExtraction>;
}

let registeredExtractor: RichDocumentExtractor | null = null;

/**
 * Hosted distributions register their document parser during server startup.
 * Community leaves this unset and safely keeps unsupported originals with a
 * metadata-only note.
 */
export function registerRichDocumentExtractor(
  extractor: RichDocumentExtractor,
): void {
  registeredExtractor = extractor;
}

export function getRichDocumentExtractor(): RichDocumentExtractor | null {
  return registeredExtractor;
}

export function resetRichDocumentExtractorForTesting(): void {
  registeredExtractor = null;
}
