import type * as React from "react";

// ---------------------------------------------------------------------------
// Note-link aware <a> component (module-scoped to avoid remounting)
// ---------------------------------------------------------------------------

export function createNoteLinkComponent(
  onNavigate: (pageName: string) => void,
) {
  function NoteLink({
    href,
    children,
  }: {
    href?: string;
    children?: React.ReactNode;
  }) {
    const hrefStr = typeof href === "string" ? href : "";
    if (hrefStr.startsWith("note:")) {
      const pageName = hrefStr.slice(5);
      return (
        <button
          type="button"
          onClick={() => onNavigate(pageName)}
          className="text-primary decoration-primary/40 hover:decoration-primary cursor-pointer underline underline-offset-2 transition-colors"
        >
          {children}
        </button>
      );
    }
    return (
      <a className="text-primary underline hover:opacity-80" href={hrefStr}>
        {children}
      </a>
    );
  }
  NoteLink.displayName = "NoteLink";
  return NoteLink;
}
