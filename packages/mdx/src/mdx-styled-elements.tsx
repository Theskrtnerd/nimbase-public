import type { JSX } from "react";
import { createElement, isValidElement } from "react";

import { cn } from "@acme/ui";

import { useCodeBlockComponent } from "./code-block-context";

export type MDXComponent = (props: Record<string, unknown>) => JSX.Element;

const MDX_FENCE_LANGUAGES = new Set([
  "mdx-frontmatter",
  "mdx-component",
  "mdx-meta",
]);

interface CodeChildProps {
  className?: unknown;
  children?: unknown;
}

/**
 * MDX renders a fenced ```python``` block as
 * `<pre><code class="language-python">…</code></pre>`. Pull the language and
 * the raw text out so the registered code block component can highlight it.
 */
function extractFenceInfo(
  child: React.ReactNode,
): { lang: string; code: string } | null {
  if (!isValidElement(child)) return null;
  const props = (child as React.ReactElement<CodeChildProps>).props;
  const className = typeof props.className === "string" ? props.className : "";
  const langMatch = /language-([\w-]+)/.exec(className);
  const lang = langMatch?.[1] ?? "";
  const raw = props.children;
  const code = typeof raw === "string" ? raw.replace(/\n$/, "") : "";
  return { lang, code };
}

function PreElement(props: Record<string, unknown>) {
  const codeBlockComponent = useCodeBlockComponent();
  const children = (props as { children?: React.ReactNode }).children;
  const fence = extractFenceInfo(children);

  if (codeBlockComponent && fence && !MDX_FENCE_LANGUAGES.has(fence.lang)) {
    return createElement(codeBlockComponent, {
      code: fence.code,
      lang: fence.lang,
    });
  }

  return (
    <pre
      className="bg-card border-border app-scrollbar my-4 overflow-x-auto rounded-lg border p-4 font-mono text-sm leading-relaxed"
      {...props}
    />
  );
}

export const mdxStyledElements: Record<
  string,
  MDXComponent | React.ComponentType<never>
> = {
  h1: (props: Record<string, unknown>) => (
    <h1
      className="text-foreground mt-10 mb-4 text-3xl font-semibold tracking-tight"
      {...props}
    />
  ),
  h2: (props: Record<string, unknown>) => (
    <h2
      className="text-foreground mt-8 mb-3 text-2xl font-semibold tracking-tight"
      {...props}
    />
  ),
  h3: (props: Record<string, unknown>) => (
    <h3
      className="text-foreground mt-6 mb-2 text-xl font-semibold tracking-tight"
      {...props}
    />
  ),
  h4: (props: Record<string, unknown>) => (
    <h4
      className="text-foreground/90 mt-5 mb-2 text-base font-semibold tracking-tight"
      {...props}
    />
  ),
  p: (props: Record<string, unknown>) => (
    <p className="text-foreground/90 mb-4 leading-7" {...props} />
  ),
  a: (props: Record<string, unknown>) => (
    <a
      className="text-primary decoration-primary/40 hover:decoration-primary underline underline-offset-2 transition-colors"
      {...props}
    />
  ),
  ul: (props: Record<string, unknown>) => (
    <ul
      className="text-foreground marker:text-muted-foreground mb-4 ml-6 list-disc"
      {...props}
    />
  ),
  ol: (props: Record<string, unknown>) => (
    <ol
      className="text-foreground marker:text-muted-foreground mb-4 ml-6 list-decimal"
      {...props}
    />
  ),
  li: (props: Record<string, unknown>) => (
    <li className="mb-1 leading-7 [&>p]:mb-0" {...props} />
  ),
  blockquote: (props: Record<string, unknown>) => (
    <blockquote
      className="text-foreground/80 border-border my-4 border-l-2 pl-4"
      {...props}
    />
  ),
  code: ({ className, children, ...rest }: Record<string, unknown>) => {
    const isInline = typeof className !== "string";
    if (isInline) {
      return (
        <code
          className="bg-muted text-foreground border-border/60 rounded-md border px-1.5 py-0.5 font-mono text-[0.875em]"
          {...rest}
        >
          {children as React.ReactNode}
        </code>
      );
    }
    return (
      <code className={cn("font-mono text-sm", String(className))} {...rest}>
        {children as React.ReactNode}
      </code>
    );
  },
  pre: PreElement,
  table: (props: Record<string, unknown>) => (
    <div className="border-border app-scrollbar my-4 overflow-x-auto rounded-md border">
      <table
        className="text-foreground min-w-full border-collapse text-sm"
        {...props}
      />
    </div>
  ),
  thead: (props: Record<string, unknown>) => (
    <thead className="bg-muted/40 border-border border-b" {...props} />
  ),
  th: (props: Record<string, unknown>) => (
    <th
      className="text-muted-foreground px-4 py-2.5 text-left text-xs font-medium tracking-wide uppercase"
      {...props}
    />
  ),
  td: (props: Record<string, unknown>) => (
    <td className="border-border border-t px-4 py-2.5" {...props} />
  ),
  hr: (props: Record<string, unknown>) => (
    <hr className="border-border/60 my-8" {...props} />
  ),
  img: (props: Record<string, unknown>) => (
    <img
      className="border-border my-4 block h-auto max-h-[60vh] w-auto max-w-full rounded-md border object-contain"
      {...(props as React.ImgHTMLAttributes<HTMLImageElement>)}
    />
  ),
};
