import * as React from "react";
import {
  Component as ReactComponent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { evaluate } from "@mdx-js/mdx";
import { Calendar, Pencil, Tag } from "lucide-react";
import rehypeKatex from "rehype-katex";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

import type { CodeBlockComponent } from "./code-block-context";
// NOTE: KaTeX CSS is loaded by the consuming renderer bundle. Do NOT import
// the .css here — this file is reachable from non-browser bundles via
// `parseFrontmatter` re-exports, which may have no CSS loader.

import type { Frontmatter } from "./frontmatter";
import type { MDXComponent } from "./mdx-styled-elements";
import { CodeBlockContext } from "./code-block-context";
import {
  Accordion,
  AccordionSection,
  Callout,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "./components";
import { parseFrontmatter } from "./frontmatter";
import { mdxStyledElements } from "./mdx-styled-elements";
import { createNoteLinkComponent } from "./note-link-component";
import { remarkNoteLink } from "./remark-note-link";

// Make React hooks available as globals for user-authored MDX content that
// uses useState/useEffect without explicit imports. This is standard practice
// for MDX live evaluation (same approach as MDX Playground, Storybook, etc.).
if (typeof window !== "undefined") {
  const w = window as unknown as Record<string, unknown>;
  w.React = React;
  w.useState = React.useState;
  w.useEffect = React.useEffect;
  w.useRef = React.useRef;
  w.useMemo = React.useMemo;
  w.useCallback = React.useCallback;
}

function relativeTime(ms: number): string {
  const diff = Math.max(0, Date.now() - ms);
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${String(min)} minute${min === 1 ? "" : "s"} ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${String(hr)} hour${hr === 1 ? "" : "s"} ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${String(day)} day${day === 1 ? "" : "s"} ago`;
  const wk = Math.floor(day / 7);
  if (wk < 5) return `${String(wk)} week${wk === 1 ? "" : "s"} ago`;
  const mo = Math.floor(day / 30);
  return `${String(mo)} month${mo === 1 ? "" : "s"} ago`;
}

const RESERVED_KEYS = new Set([
  "title",
  "tags",
  "date",
  "template",
  "description",
  "summary",
  "source",
]);

function deriveFallbackTitle(filePath: string | undefined): string | null {
  if (!filePath) return null;
  const name = filePath.split(/[\\/]/).pop() ?? "";
  return name.replace(/\.(mdx?|markdown)$/i, "") || null;
}

function EditableTitle({
  value,
  onCommit,
  autoFocus,
  onAutoFocused,
}: {
  value: string;
  onCommit: (next: string) => void;
  /**
   * If true, focus the title and select all its text on mount. Used by the
   * "new note" flow so the user can immediately type over "Untitled".
   */
  autoFocus?: boolean;
  /** Called after autoFocus has been honored so the parent can clear the flag. */
  onAutoFocused?: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(value);
  // Effect justified: imperatively focus + select-all on mount for the
  // new-note flow. autoFocus on a native input only places the cursor.
  useEffect(() => {
    if (!autoFocus) return;
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.select();
    onAutoFocused?.();
  }, [autoFocus, onAutoFocused]);
  function commit() {
    const next = draft.trim();
    if (!next) {
      setDraft(value);
      return;
    }
    if (next === value) return;
    onCommit(next);
  }
  return (
    <input
      ref={ref}
      type="text"
      value={draft}
      spellCheck={false}
      aria-label="Note title"
      className="text-foreground focus:ring-ring/30 w-full rounded-sm bg-transparent text-3xl font-bold tracking-tight outline-none focus:ring-2"
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.blur();
        } else if (e.key === "Escape") {
          e.preventDefault();
          setDraft(value);
          e.currentTarget.blur();
        }
      }}
      onBlur={commit}
    />
  );
}

export function FrontmatterHeader({
  data,
  filePath,
  mtimeMs,
  showFrontmatter,
  onTitleChange,
  yaml,
  onYamlChange,
  autoFocusTitle,
  onTitleAutoFocused,
  hideTitle,
}: {
  data: Frontmatter;
  filePath?: string;
  mtimeMs?: number | null;
  showFrontmatter?: boolean;
  /**
   * If provided, the title becomes inline-editable. Called with the trimmed
   * new title on commit (Enter or blur).
   */
  onTitleChange?: (next: string) => void;
  /** Suppress the inline title (e.g. a page header above this component already shows it). Tags/date/extras still render. */
  hideTitle?: boolean;
  /** Current YAML body of the frontmatter (without the surrounding `---`). */
  yaml?: string;
  /**
   * If provided, an edit button appears next to the tags. Clicking swaps the
   * rendered header for a textarea; on blur the next YAML body is committed
   * and the rendered header is restored.
   */
  onYamlChange?: (next: string) => void;
  /** Focus + select-all the title on mount (new-note flow). */
  autoFocusTitle?: boolean;
  /** Called after autoFocusTitle is honored so the parent can clear it. */
  onTitleAutoFocused?: () => void;
}) {
  const [editingYaml, setEditingYaml] = useState(false);
  const title =
    (typeof data.title === "string" && data.title.trim()) ||
    deriveFallbackTitle(filePath);

  const tags = Array.isArray(data.tags)
    ? [
        ...new Set(
          (data.tags as unknown[]).flatMap((tag) => {
            const str = String(tag);
            return str ? [str] : [];
          }),
        ),
      ]
    : [];

  const description =
    (typeof data.description === "string" && data.description.trim()) ||
    (typeof data.summary === "string" && data.summary.trim()) ||
    null;

  const dateStr = typeof data.date === "string" ? data.date : null;
  const source = typeof data.source === "string" ? data.source : null;

  const extras = Object.entries(data).filter(
    ([k, v]) =>
      !RESERVED_KEYS.has(k) &&
      v !== undefined &&
      v !== "" &&
      !(Array.isArray(v) && v.length === 0),
  );

  const hasMeta = mtimeMs != null || dateStr !== null || tags.length > 0;
  const canEditYaml = Boolean(onYamlChange) && Boolean(yaml?.trim());

  if (editingYaml && onYamlChange) {
    return (
      <header className="mt-4 mb-14">
        <textarea
          autoFocus
          aria-label="Frontmatter YAML"
          defaultValue={yaml ?? ""}
          spellCheck={false}
          className="border-border bg-muted/30 text-foreground focus:ring-ring/30 w-full resize-y rounded-md border p-3 font-mono text-xs leading-relaxed outline-none focus:ring-2"
          rows={Math.max(4, (yaml ?? "").split("\n").length + 1)}
          onBlur={(e) => {
            onYamlChange(e.currentTarget.value);
            setEditingYaml(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              setEditingYaml(false);
            }
          }}
        />
      </header>
    );
  }

  return (
    <header className="mt-4 mb-14">
      {!hideTitle &&
        title &&
        (onTitleChange ? (
          <EditableTitle
            key={title}
            value={title}
            onCommit={onTitleChange}
            autoFocus={autoFocusTitle}
            onAutoFocused={onTitleAutoFocused}
          />
        ) : (
          <h1 className="text-foreground text-3xl font-bold tracking-tight">
            {title}
          </h1>
        ))}

      {hasMeta && (
        <div className="text-muted-foreground mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs">
          {mtimeMs != null && (
            <span className="inline-flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5" aria-hidden="true" />
              Last edited {relativeTime(mtimeMs)}
            </span>
          )}
          {dateStr && mtimeMs == null && (
            <span className="inline-flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5" aria-hidden="true" />
              {dateStr}
            </span>
          )}
          {tags.length > 0 && (
            <>
              <span className="opacity-40" aria-hidden="true">
                ·
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Tag className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="flex flex-wrap items-center gap-1">
                  {tags.map((tag, i) => (
                    <React.Fragment key={tag}>
                      {i > 0 && (
                        <span className="opacity-50" aria-hidden="true">
                          ·
                        </span>
                      )}
                      <span className="text-foreground/80">{tag}</span>
                    </React.Fragment>
                  ))}
                </span>
              </span>
            </>
          )}
          {canEditYaml && (
            <button
              type="button"
              aria-label="Edit frontmatter"
              title="Edit frontmatter"
              onClick={() => setEditingYaml(true)}
              className="text-muted-foreground hover:text-foreground hover:bg-muted/60 focus:ring-ring/30 ml-1 inline-flex h-5 w-5 items-center justify-center rounded-sm transition-colors outline-none focus:ring-2"
            >
              <Pencil className="h-3 w-3" aria-hidden="true" />
            </button>
          )}
        </div>
      )}

      {description && (
        <p className="text-muted-foreground mt-4 text-sm leading-relaxed">
          {description}
        </p>
      )}

      {showFrontmatter && (source !== null || extras.length > 0) && (
        <dl className="text-muted-foreground mt-4 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          {source && (
            <>
              <dt className="font-medium capitalize">Source</dt>
              <dd className="text-foreground/80 font-mono">{source}</dd>
            </>
          )}
          {extras.map(([key, value]) => (
            <React.Fragment key={key}>
              <dt className="font-medium capitalize">{key}</dt>
              <dd className="text-foreground/80">
                {Array.isArray(value)
                  ? (value as unknown[]).map(String).join(" · ")
                  : String(value)}
              </dd>
            </React.Fragment>
          ))}
        </dl>
      )}
    </header>
  );
}

function UnknownComponent({
  name,
  children,
}: {
  name: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="border-destructive/30 bg-destructive/[0.03] text-destructive/80 my-4 rounded-md border border-dashed p-3 text-sm">
      <div className="mb-1 font-mono text-xs font-medium">
        Unknown component: &lt;{name} /&gt;
      </div>
      {children && <div className="text-foreground/85">{children}</div>}
    </div>
  );
}

// Code-block context (CodeBlockContext / CodeBlockComponent / useCodeBlockComponent)
// lives in ./code-block-context — re-exported here to keep the public API
// (@acme/mdx's index.ts imports these from this module) unchanged, while
// letting mdx-styled-elements.tsx depend on it without importing this file
// (which would otherwise be a circular dependency).
export type { CodeBlockComponent } from "./code-block-context";
export { useCodeBlockComponent } from "./code-block-context";

const mdxComponents: Record<string, MDXComponent | React.ComponentType<never>> =
  {
    ...mdxStyledElements,
    Callout,
    Accordion,
    AccordionSection,
    Card,
    CardContent,
    CardDescription,
    CardFooter,
    CardHeader,
    CardTitle,
  };

/** Scan MDX source for PascalCase JSX tags not already in the components map */
function buildComponentsWithFallbacks(
  source: string,
  userComponents: Record<string, React.ComponentType<Record<string, unknown>>>,
) {
  const allKnown = { ...mdxComponents, ...userComponents };

  const tagPattern = /<([A-Z][A-Za-z0-9]*)[\s/>]/g;
  let match: RegExpExecArray | null;
  const unknown = new Set<string>();

  while ((match = tagPattern.exec(source))) {
    const name = match[1] ?? "";
    if (!(name in allKnown)) {
      unknown.add(name);
    }
  }

  if (unknown.size === 0) return allKnown;

  const fallbacks: Record<string, MDXComponent> = {};
  for (const name of unknown) {
    fallbacks[name] = ({ children }: Record<string, unknown>) => (
      <UnknownComponent name={name}>
        {children as React.ReactNode}
      </UnknownComponent>
    );
  }

  return { ...allKnown, ...fallbacks };
}

// createNoteLinkComponent (note-link-aware <a> override) lives in
// ./note-link-component and is re-exported below to keep the public API
// (@acme/mdx's index.ts imports it from this module) unchanged.
export { createNoteLinkComponent } from "./note-link-component";

export interface MdxRendererProps {
  content: string;
  userComponents?: Record<string, React.ComponentType<Record<string, unknown>>>;
  showFrontmatter?: boolean;
  /** Called when a [[note-link]] is clicked. Receives the page name (e.g. "my-page"). */
  onNavigate?: (pageName: string) => void;
  /**
   * Optional component that renders fenced code blocks. When provided, the
   * MDX `<pre>` override delegates to this with the raw code + language. When
   * absent, falls back to the default plain `<pre>` styling. This is how
   * host apps plug Shiki in without making @acme/mdx depend on it.
   */
  codeBlockComponent?: CodeBlockComponent;
  /**
   * Resolve a template name (from frontmatter `template:` field) to raw MDX.
   * If the note's frontmatter specifies a template, that template is compiled
   * and the note's body is injected wherever the template renders `<Content />`.
   * Return null when the template cannot be found.
   */
  templateResolver?: (name: string) => Promise<string | null>;
  /** Absolute path of the note being rendered — used for breadcrumb and fallback title. */
  filePath?: string;
  /** Workspace root path — breadcrumb segments are derived relative to this. */
  folderPath?: string;
  /** Last modified time in ms — drives the "Last edited X ago" label. */
  mtimeMs?: number | null;
  /**
   * Overrides the outer container classes. Defaults to the standalone chrome
   * (`app-scrollbar h-full w-full overflow-auto px-10 py-8`). Callers that
   * supply their own scroll container + padding (e.g. the web notes view) pass
   * a bare wrapper here to avoid nested scrolling and double padding.
   */
  containerClassName?: string;
  /** Suppress the inline frontmatter title — use when a page header above this component already shows it. Tags/date/extras still render. */
  hideTitle?: boolean;
  /**
   * Suppress the frontmatter header entirely (title, date, tags, description).
   * Use when the caller renders its own header from the same metadata — the
   * web notes view does, so leaving this off duplicates the description.
   */
  hideHeader?: boolean;
}

const DEFAULT_CONTAINER_CLASSNAME =
  "app-scrollbar h-full w-full overflow-auto px-10 py-8";

type CompiledMDX =
  | { status: "idle" }
  | { status: "compiling" }
  | {
      status: "success";
      Component: React.ComponentType<Record<string, unknown>>;
      /** Non-null when a template wraps the note: the template's compiled component. */
      TemplateComponent: React.ComponentType<Record<string, unknown>> | null;
      components: Record<
        string,
        | MDXComponent
        | React.ComponentType<never>
        | React.ComponentType<Record<string, unknown>>
      >;
      frontmatter: Frontmatter;
    }
  | { status: "error"; message: string };

export function MdxRenderer({
  content,
  userComponents,
  showFrontmatter,
  onNavigate,
  templateResolver,
  filePath,
  mtimeMs,
  codeBlockComponent,
  containerClassName = DEFAULT_CONTAINER_CLASSNAME,
  hideTitle,
  hideHeader,
}: MdxRendererProps) {
  const [state, setState] = useState<CompiledMDX>({ status: "idle" });
  const compileSeqRef = useRef(0);

  const remarkPlugins = useMemo(
    () =>
      onNavigate
        ? [remarkFrontmatter, remarkGfm, remarkMath, remarkNoteLink]
        : [remarkFrontmatter, remarkGfm, remarkMath],
    [onNavigate],
  );
  const rehypePlugins = useMemo(() => [rehypeKatex], []);

  const compile = useCallback(
    async (
      source: string,
      extraComponents: Record<
        string,
        React.ComponentType<Record<string, unknown>>
      >,
      plugins: typeof remarkPlugins,
      rehype: typeof rehypePlugins,
      resolver: MdxRendererProps["templateResolver"],
    ) => {
      const compileSeq = compileSeqRef.current + 1;
      compileSeqRef.current = compileSeq;
      await Promise.resolve();
      if (compileSeq !== compileSeqRef.current) return;
      setState({ status: "compiling" });
      try {
        const { data: frontmatter, content: mdxContent } =
          parseFrontmatter(source);

        // Resolve optional wrapping template
        let templateSource: string | null = null;
        const templateName =
          typeof frontmatter.template === "string" ? frontmatter.template : "";
        if (templateName && resolver) {
          templateSource = await resolver(templateName);
        }

        // Build components map from union of note + template sources so
        // fallbacks cover tags referenced in either.
        const scanSource = templateSource
          ? `${templateSource}\n${mdxContent}`
          : mdxContent;
        const components = buildComponentsWithFallbacks(
          scanSource,
          extraComponents,
        );

        const evaluateMdx = (src: string) =>
          evaluate(src, {
            ...jsxRuntime,
            remarkPlugins: plugins,
            rehypePlugins: rehype,
            Fragment: jsxRuntime.Fragment,
            baseUrl:
              typeof window !== "undefined" ? window.location.href : "file:///",
          });

        const { default: Component } = await evaluateMdx(mdxContent);
        let TemplateComponent: React.ComponentType<
          Record<string, unknown>
        > | null = null;
        if (templateSource) {
          const { content: templateBody } = parseFrontmatter(templateSource);
          const { default: T } = await evaluateMdx(templateBody);
          TemplateComponent = T as React.ComponentType<Record<string, unknown>>;
        }

        if (compileSeq !== compileSeqRef.current) return;
        setState({
          status: "success",
          Component: Component as React.ComponentType<Record<string, unknown>>,
          TemplateComponent,
          components,
          frontmatter,
        });
      } catch (err: unknown) {
        if (compileSeq !== compileSeqRef.current) return;
        const message =
          err instanceof Error ? err.message : "Failed to compile MDX";
        setState({ status: "error", message });
      }
    },
    [],
  );

  // Effect justified: MDX compilation is async work derived from props; keeping
  // it here prevents render-time side effects and lets stale compiles be ignored.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- compile awaits before setting state, then ignores stale runs by sequence id.
    void compile(
      content,
      userComponents ?? {},
      remarkPlugins,
      rehypePlugins,
      templateResolver,
    );
  }, [
    compile,
    content,
    rehypePlugins,
    remarkPlugins,
    templateResolver,
    userComponents,
  ]);

  if (state.status === "idle" || state.status === "compiling") {
    return (
      <div className="flex h-full w-full flex-col gap-3 p-6">
        <div className="bg-muted h-4 w-3/4 animate-pulse rounded" />
        <div className="bg-muted h-4 w-1/2 animate-pulse rounded" />
        <div className="bg-muted h-4 w-5/6 animate-pulse rounded" />
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="flex h-full w-full flex-col gap-4 p-6">
        <div className="text-destructive text-sm font-medium">
          MDX compilation error
        </div>
        <pre className="bg-muted text-destructive app-scrollbar overflow-auto rounded-lg p-4 font-mono text-xs">
          {state.message}
        </pre>
      </div>
    );
  }

  const { Component, TemplateComponent, components, frontmatter } = state;
  const hasFm =
    !hideHeader && (Object.keys(frontmatter).length > 0 || Boolean(filePath));

  // Override <a> to handle note: links when onNavigate is provided
  const baseComponents = onNavigate
    ? { ...components, a: createNoteLinkComponent(onNavigate) }
    : components;

  // `<Content />` inside a template renders the note's compiled body.
  // `frontmatter` is also exposed so the template can access metadata.
  const finalComponents = TemplateComponent
    ? {
        ...baseComponents,
        Content: () => <Component components={baseComponents} />,
      }
    : baseComponents;

  return (
    <div className={containerClassName}>
      <CodeBlockContext.Provider value={codeBlockComponent ?? null}>
        <MDXErrorBoundary>
          {hasFm && (
            <FrontmatterHeader
              data={frontmatter}
              filePath={filePath}
              mtimeMs={mtimeMs}
              showFrontmatter={showFrontmatter}
              hideTitle={hideTitle}
            />
          )}
          {TemplateComponent ? (
            <TemplateComponent
              components={finalComponents}
              frontmatter={frontmatter}
            />
          ) : (
            <Component components={finalComponents} />
          )}
        </MDXErrorBoundary>
      </CodeBlockContext.Provider>
    </div>
  );
}

class MDXErrorBoundary extends ReactComponent<
  { children: React.ReactNode },
  { error: string | null }
> {
  state = { error: null as string | null };

  static getDerivedStateFromError(err: unknown) {
    return { error: err instanceof Error ? err.message : String(err) };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex flex-col gap-4 py-6">
          <div className="text-destructive text-sm font-medium">
            MDX render error
          </div>
          <pre className="bg-muted text-destructive app-scrollbar overflow-auto rounded-lg p-4 font-mono text-xs">
            {this.state.error}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}
