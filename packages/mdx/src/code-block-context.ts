import type * as React from "react";
import { createContext, useContext } from "react";

// ---------------------------------------------------------------------------
// Code-block context — lets host apps inject a Shiki-backed frame
// without making @acme/mdx depend on a syntax highlighter.
//
// Lives in its own module (rather than mdx-renderer.tsx) so both
// mdx-renderer.tsx and mdx-styled-elements.tsx can depend on it without
// creating an import cycle between those two files.
// ---------------------------------------------------------------------------

export type CodeBlockComponent = React.ComponentType<{
  code: string;
  lang: string;
}>;

export const CodeBlockContext = createContext<CodeBlockComponent | null>(null);

export function useCodeBlockComponent(): CodeBlockComponent | null {
  return useContext(CodeBlockContext);
}
