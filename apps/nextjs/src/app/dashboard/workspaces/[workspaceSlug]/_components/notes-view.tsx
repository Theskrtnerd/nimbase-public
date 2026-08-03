"use client";

import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Fragment, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronRightIcon,
  CodeIcon,
  EllipsisIcon,
  FileTextIcon,
  Loader2Icon,
  LockIcon,
  NotebookIcon,
  PanelRightIcon,
  TagIcon,
  TriangleAlertIcon,
  WaypointsIcon,
} from "lucide-react";

import { MdxRenderer } from "@acme/mdx";
import { cn } from "@acme/ui";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@acme/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@acme/ui/tooltip";

import { formatRelativeTime } from "~/lib/format-relative-time";
import { useTRPC } from "~/trpc/react";
import { FolderAccessSheet } from "./folder-access-sheet";
import { GraphView } from "./graph-view";
import { MemoryInspector } from "./memory-inspector";
import { RawSource } from "./raw-source";

/**
 * How the main pane presents the memory the tree selects: as a document
 * ("read") or as the connection graph across all of it ("graph"). Two lenses on
 * one body of memory — not two separate destinations in the activity bar.
 */
export type MemoryMode = "read" | "graph";

interface TreeNote {
  type: "note";
  id: string;
  name: string;
  path: string;
  title: string;
}

interface TreeFolder {
  type: "folder";
  name: string;
  path: string;
  children: TreeItem[];
  locked?: boolean;
}

type TreeItem = TreeFolder | TreeNote;

/** Build a nested folder tree from flat node paths like "docs/project-x/my-note". */
function buildTree(
  nodes: { id: string; path: string; title: string }[],
  locked: { path: string }[] = [],
): TreeItem[] {
  const root: TreeItem[] = [];
  const folders = new Map<string, TreeFolder>();

  for (const node of nodes) {
    const segments = node.path.split("/").filter(Boolean);
    if (segments.length === 0) continue;

    const noteName = segments[segments.length - 1] ?? node.path;
    const folderSegments = segments.slice(0, -1);

    let children = root;
    let prefix = "";
    for (const segment of folderSegments) {
      prefix = prefix ? `${prefix}/${segment}` : segment;
      let folder = folders.get(prefix);
      if (!folder) {
        folder = { type: "folder", name: segment, path: prefix, children: [] };
        folders.set(prefix, folder);
        children.push(folder);
      }
      children = folder.children;
    }

    children.push({
      type: "note",
      id: node.id,
      name: noteName,
      path: node.path,
      title: node.title,
    });
  }

  // Append locked (restricted) folder stubs. Skip if a normal folder with that
  // path already exists (e.g., the viewer has partial access to a sibling note
  // that caused the parent to be created). Server filters out content so there
  // should be no collision in practice, but guard anyway.
  for (const { path } of locked) {
    if (folders.has(path)) continue;
    const segments = path.split("/").filter(Boolean);
    if (segments.length === 0) continue;
    const name = segments[segments.length - 1] ?? path;
    const folderSegments = segments.slice(0, -1);

    let children = root;
    let prefix = "";
    for (const segment of folderSegments) {
      prefix = prefix ? `${prefix}/${segment}` : segment;
      let folder = folders.get(prefix);
      if (!folder) {
        folder = { type: "folder", name: segment, path: prefix, children: [] };
        folders.set(prefix, folder);
        children.push(folder);
      }
      children = folder.children;
    }

    const lockedFolder: TreeFolder = {
      type: "folder",
      name,
      path,
      children: [],
      locked: true,
    };
    folders.set(path, lockedFolder);
    children.push(lockedFolder);
  }

  sortTree(root);
  return root;
}

/**
 * Folders before notes, each alphabetical by display name; recurses into
 * folders. One exception: company.md — the root overview tended by the
 * Biographer — pins to the very top of the tree.
 */
function sortTree(items: TreeItem[], atRoot = true): void {
  const isCompanyMd = (item: TreeItem) =>
    atRoot && item.type === "note" && item.path === "company.md";
  items.sort((a, b) => {
    if (isCompanyMd(a)) return -1;
    if (isCompanyMd(b)) return 1;
    if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  for (const item of items) {
    if (item.type === "folder") sortTree(item.children, false);
  }
}

/**
 * Every control in the pane title bar is 28px tall with a 15px icon, so the
 * labelled lens switch and the icon-only toggles read as one row of controls
 * rather than three unrelated widgets.
 */
const HEADER_CONTROL =
  "flex h-7 cursor-pointer items-center justify-center rounded-[7px] transition-colors";

/**
 * A lens pill: icon + word. The two lenses are the pane's primary choice, so
 * they get names — an icon alone can't distinguish "read this note" from
 * "see how everything connects". The label drops on narrow panes.
 */
function LensButton({
  icon: Icon,
  label,
  hint,
  isActive,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  hint: string;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          aria-pressed={isActive}
          aria-label={label}
          className={cn(
            HEADER_CONTROL,
            "gap-1.5 px-2 md:px-2.5",
            isActive
              ? "bg-background text-foreground shadow-sm ring-1 ring-black/[0.04]"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Icon className="size-[15px] shrink-0" strokeWidth={1.9} />
          <span className="hidden text-[12.5px] font-medium md:inline">
            {label}
          </span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>
        <span className="text-xs leading-none">{hint}</span>
      </TooltipContent>
    </Tooltip>
  );
}

/** An icon-only title-bar toggle (view options) with a label/hint tooltip. */
function HeaderToggle({
  icon: Icon,
  label,
  hint,
  isActive,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  hint: string;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          aria-pressed={isActive}
          aria-label={label}
          className={cn(
            HEADER_CONTROL,
            "w-7",
            isActive
              ? "bg-foreground/[0.07] text-foreground"
              : "text-muted-foreground hover:text-foreground hover:bg-foreground/[0.05]",
          )}
        >
          <Icon className="size-[15px]" strokeWidth={1.9} />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>
        <div className="flex flex-col gap-0.5">
          <span className="text-xs leading-none font-medium">{label}</span>
          <span className="text-background/70 text-[10px] leading-none">
            {hint}
          </span>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * The full title-bar control cluster: the Read/Connections lens switch on its
 * own tray, a hairline, then the view options for whatever lens is active.
 * Grouping by function keeps "what am I looking at" separate from "how".
 */
function PaneControls({
  mode,
  onChangeMode,
  options,
}: {
  mode: MemoryMode;
  onChangeMode: (mode: MemoryMode) => void;
  options?: ReactNode;
}) {
  return (
    <TooltipProvider delayDuration={300}>
      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        <div
          role="group"
          aria-label="Memory lens"
          className="bg-foreground/[0.05] flex items-center gap-0.5 rounded-lg p-0.5"
        >
          <LensButton
            icon={FileTextIcon}
            label="Read"
            hint="Read the selected memory"
            isActive={mode === "read"}
            onClick={() => onChangeMode("read")}
          />
          <LensButton
            icon={WaypointsIcon}
            label="Connections"
            hint="See how memory connects"
            isActive={mode === "graph"}
            onClick={() => onChangeMode("graph")}
          />
        </div>

        {options ? (
          <>
            <span aria-hidden className="bg-border h-4 w-px" />
            <div className="flex items-center gap-0.5">{options}</div>
          </>
        ) : null}
      </div>
    </TooltipProvider>
  );
}

/** The main pane's h-10 title bar, shared by the reader, hints, and the graph. */
function PaneHeader({
  children,
  scrolled = false,
}: {
  children: ReactNode;
  scrolled?: boolean;
}) {
  return (
    <header
      className={cn(
        "z-10 flex h-10 shrink-0 items-center gap-1 px-4 text-sm transition-shadow",
        scrolled && "shadow-[0_4px_6px_-4px_rgba(0,0,0,0.1)]",
      )}
    >
      {children}
    </header>
  );
}

interface TreeItemRowProps {
  item: TreeItem;
  depth: number;
  collapsed: Set<string>;
  selectedId: string | null;
  onToggle: (path: string) => void;
  onSelect: (id: string) => void;
  onManageAccess: (path: string) => void;
}

function TreeItemRow({
  item,
  depth,
  collapsed,
  selectedId,
  onToggle,
  onSelect,
  onManageAccess,
}: TreeItemRowProps) {
  const indent = { paddingLeft: depth * 12 + 8 };

  if (item.type === "folder") {
    const isOpen = !collapsed.has(item.path);

    // Locked (restricted) folder: non-expandable, lock icon, no hover action.
    if (item.locked) {
      return (
        <li>
          <div
            style={indent}
            title="Restricted space"
            className="text-muted-foreground flex w-full cursor-default items-center gap-1 py-1 pr-2 text-sm"
          >
            <span className="flex size-4 shrink-0 items-center justify-center">
              <LockIcon className="text-muted-foreground/60 size-3" />
            </span>
            <span className="truncate">{item.name}</span>
          </div>
        </li>
      );
    }

    return (
      <li>
        <div
          style={indent}
          className="group text-sidebar-foreground hover:bg-sidebar-accent flex w-full items-center gap-1 py-1 pr-1 text-sm transition-colors"
        >
          <button
            type="button"
            onClick={() => onToggle(item.path)}
            className="flex min-w-0 flex-1 cursor-pointer items-center gap-1 text-left"
          >
            <span className="flex size-4 shrink-0 items-center justify-center">
              <ChevronRightIcon
                className={cn(
                  "text-sidebar-foreground/40 size-3 transition-transform duration-150",
                  isOpen && "rotate-90",
                )}
              />
            </span>
            <span className="truncate">{item.name}</span>
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={`Options for ${item.name}`}
                onClick={(e) => e.stopPropagation()}
                className="text-sidebar-foreground/50 hover:text-sidebar-foreground hover:bg-sidebar-accent flex size-5 shrink-0 cursor-pointer items-center justify-center rounded opacity-0 transition-opacity group-hover:opacity-100"
              >
                <EllipsisIcon className="size-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="right" align="start" sideOffset={4}>
              <DropdownMenuItem
                onSelect={() => onManageAccess(item.path)}
                className="cursor-pointer"
              >
                Manage access…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {isOpen ? (
          <ul>
            {item.children.map((child) => (
              <TreeItemRow
                key={child.type === "note" ? child.id : child.path}
                item={child}
                depth={depth + 1}
                collapsed={collapsed}
                selectedId={selectedId}
                onToggle={onToggle}
                onSelect={onSelect}
                onManageAccess={onManageAccess}
              />
            ))}
          </ul>
        ) : null}
      </li>
    );
  }

  const isSelected = item.id === selectedId;
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(item.id)}
        style={indent}
        className={cn(
          "flex w-full items-center gap-1 py-1 pr-2 text-left text-sm transition-colors",
          isSelected
            ? "bg-sidebar-accent text-sidebar-accent-foreground"
            : "text-sidebar-foreground hover:bg-sidebar-accent",
        )}
      >
        <span className="flex size-4 shrink-0 items-center justify-center">
          <FileTextIcon className="text-sidebar-foreground/60 size-3.5" />
        </span>
        <span className="truncate">{item.title}</span>
      </button>
    </li>
  );
}

export function NotesView({
  workspaceId,
  selectedId,
  onSelectNote,
  mode,
  onChangeMode,
}: {
  workspaceId: string;
  selectedId: string | null;
  onSelectNote: (nodeId: string) => void;
  mode: MemoryMode;
  onChangeMode: (mode: MemoryMode) => void;
}) {
  const trpc = useTRPC();

  const treeQuery = useQuery(
    trpc.kb.listCompiledNodes.queryOptions({ workspaceId }),
  );

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [accessSheetPath, setAccessSheetPath] = useState<string | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(true);

  const tree = useMemo(
    () => buildTree(treeQuery.data?.nodes ?? [], treeQuery.data?.locked ?? []),
    [treeQuery.data],
  );
  const noteQuery = useQuery(
    trpc.kb.getNode.queryOptions(
      { workspaceId, nodeId: selectedId ?? "" },
      { enabled: selectedId !== null },
    ),
  );

  function toggleFolder(path: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  const isEmpty = !treeQuery.isPending && tree.length === 0;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <aside className="border-sidebar-border flex w-64 shrink-0 flex-col border-r">
          <div className="min-h-0 flex-1 overflow-y-auto py-2">
            {treeQuery.isPending ? (
              <div className="flex flex-col gap-1 p-2">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div
                    key={i}
                    className="bg-muted h-6 animate-pulse rounded-md"
                    style={{ width: `${70 - i * 6}%` }}
                  />
                ))}
              </div>
            ) : treeQuery.isError ? (
              <p className="text-muted-foreground px-2 py-3 text-[12px]">
                Couldn&apos;t load memory.
              </p>
            ) : isEmpty ? (
              <p className="text-muted-foreground px-2 py-3 text-[12px] leading-5">
                No memory yet.
              </p>
            ) : (
              <ul>
                {tree.map((item) => (
                  <TreeItemRow
                    key={item.type === "note" ? item.id : item.path}
                    item={item}
                    depth={0}
                    collapsed={collapsed}
                    selectedId={selectedId}
                    onToggle={toggleFolder}
                    onSelect={onSelectNote}
                    onManageAccess={setAccessSheetPath}
                  />
                ))}
              </ul>
            )}
          </div>
        </aside>

        <section className="bg-background flex min-w-0 flex-1 flex-col overflow-hidden">
          {mode === "graph" ? (
            <>
              <PaneHeader>
                {/* No title here — the active lens pill already says
                    "Connections", and the graph labels its own nodes. */}
                <span className="text-muted-foreground truncate text-[12px]">
                  How this workspace&apos;s memory links together
                </span>
                <PaneControls mode={mode} onChangeMode={onChangeMode} />
              </PaneHeader>
              <div className="min-h-0 flex-1">
                {/* Opening a node from the graph drops back into the reader
                    with that memory selected. */}
                <GraphView
                  workspaceId={workspaceId}
                  onOpenNote={(nodeId) => {
                    onSelectNote(nodeId);
                    onChangeMode("read");
                  }}
                />
              </div>
            </>
          ) : (
            <NoteContent
              key={selectedId}
              isEmpty={isEmpty}
              selectedId={selectedId}
              isPending={noteQuery.isPending}
              isError={noteQuery.isError}
              data={noteQuery.data}
              inspectorOpen={inspectorOpen}
              onToggleInspector={() => setInspectorOpen((v) => !v)}
              mode={mode}
              onChangeMode={onChangeMode}
            />
          )}
        </section>

        {mode === "read" &&
        selectedId !== null &&
        inspectorOpen &&
        noteQuery.data ? (
          <MemoryInspector
            workspaceId={workspaceId}
            path={noteQuery.data.path}
            updatedAt={noteQuery.data.updatedAt}
            summary={noteQuery.data.summary}
            tags={noteQuery.data.tags}
            sources={noteQuery.data.sources}
            onSelectNote={onSelectNote}
            onClose={() => setInspectorOpen(false)}
          />
        ) : null}
      </div>

      {accessSheetPath !== null && (
        <FolderAccessSheet
          workspaceId={workspaceId}
          path={accessSheetPath}
          onClose={() => setAccessSheetPath(null)}
        />
      )}
    </div>
  );
}

interface NoteData {
  id: string;
  path: string;
  title: string;
  body: string;
  summary: string | null;
  updatedAt: Date | null;
  tags: string[];
}

interface NoteContentProps {
  isEmpty: boolean;
  selectedId: string | null;
  isPending: boolean;
  isError: boolean;
  data: NoteData | undefined;
  inspectorOpen: boolean;
  onToggleInspector: () => void;
  mode: MemoryMode;
  onChangeMode: (mode: MemoryMode) => void;
}

function NoteContent({
  isEmpty,
  selectedId,
  isPending,
  isError,
  data,
  inspectorOpen,
  onToggleInspector,
  mode,
  onChangeMode,
}: NoteContentProps) {
  // Every non-reader state still shows the title bar, so the Connections lens
  // stays reachable with nothing selected.
  const hint =
    selectedId === null
      ? {
          icon: <NotebookIcon className="size-5" />,
          title: isEmpty ? "No memory yet" : "Select a memory",
          body: isEmpty
            ? "Memory appears here once your sources are captured and compiled into this workspace."
            : "Pick an item from the tree on the left to read it, or switch to Connections to see how it all links up.",
        }
      : isPending
        ? {
            icon: <Loader2Icon className="size-5 animate-spin" />,
            title: "Loading note…",
          }
        : isError || !data
          ? {
              icon: <TriangleAlertIcon className="size-5" />,
              title: "Couldn't load this note",
              body: "The note body could not be fetched. Try selecting it again.",
            }
          : null;

  if (hint) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <PaneHeader>
          <PaneControls mode={mode} onChangeMode={onChangeMode} />
        </PaneHeader>
        <div className="min-h-0 flex-1">
          <CenteredHint icon={hint.icon} title={hint.title} body={hint.body} />
        </div>
      </div>
    );
  }

  // Unreachable — the `isError || !data` branch above covers it — but keeps
  // `data` narrowed to NoteData for the reader.
  if (!data) return null;

  return (
    <NoteReader
      note={data}
      inspectorOpen={inspectorOpen}
      onToggleInspector={onToggleInspector}
      mode={mode}
      onChangeMode={onChangeMode}
    />
  );
}

/**
 * Presentational note view: title bar with breadcrumb + source toggle, the
 * rendered markdown header, and the read-only raw source. Pure (data in, no
 * fetching) so it can be previewed/tested in isolation.
 */
function NoteReader({
  note,
  inspectorOpen,
  onToggleInspector,
  mode,
  onChangeMode,
}: {
  note: NoteData;
  inspectorOpen: boolean;
  onToggleInspector: () => void;
  mode: MemoryMode;
  onChangeMode: (mode: MemoryMode) => void;
}) {
  const [rawMode, setRawMode] = useState(false);
  // Shadow under the title bar appears once content scrolls beneath it, so the
  // bar reads as a distinct layer over the note body.
  const [scrolled, setScrolled] = useState(false);

  const segments = note.path.split("/").filter(Boolean);
  const folderSegments = segments.slice(0, -1);
  const title = note.title;
  const editedAt = note.updatedAt ?? null;

  function handleScroll(e: React.UIEvent<HTMLDivElement>) {
    setScrolled(e.currentTarget.scrollTop > 0);
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Title bar — breadcrumb + lens/source/inspector toggles */}
      <PaneHeader scrolled={scrolled}>
        <nav
          aria-label="Breadcrumb"
          className="text-muted-foreground flex min-w-0 items-center gap-1"
        >
          {folderSegments.map((segment, i) => (
            <span
              key={folderSegments.slice(0, i + 1).join("/")}
              className="flex min-w-0 items-center gap-1"
            >
              <span className="truncate">{segment}</span>
              <ChevronRightIcon className="size-3.5 shrink-0 opacity-50" />
            </span>
          ))}
          <span className="text-foreground truncate font-medium">{title}</span>
        </nav>
        <PaneControls
          mode={mode}
          onChangeMode={onChangeMode}
          options={
            <>
              <HeaderToggle
                icon={CodeIcon}
                label="Raw source"
                hint="Read the OKF markdown behind this memory"
                isActive={rawMode}
                onClick={() => setRawMode((prev) => !prev)}
              />
              <HeaderToggle
                icon={PanelRightIcon}
                label="Inspector"
                hint="Location, freshness, access & related memory"
                isActive={inspectorOpen}
                onClick={onToggleInspector}
              />
            </>
          }
        />
      </PaneHeader>

      {rawMode ? (
        <RawSource body={note.body} onScroll={handleScroll} />
      ) : (
        <div
          onScroll={handleScroll}
          className="app-scrollbar min-h-0 flex-1 overflow-y-auto"
        >
          <article className="mx-auto w-full max-w-3xl px-8 py-8">
            <header className="mb-8">
              <h1 className="text-foreground text-3xl font-bold tracking-tight">
                {title}
              </h1>
              {(editedAt !== null ||
                Boolean(note.summary) ||
                note.tags.length > 0) && (
                <div className="text-muted-foreground mt-2 space-y-1.5 text-xs">
                  {(editedAt !== null || note.tags.length > 0) && (
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      {editedAt !== null && (
                        <span>Last edited {formatRelativeTime(editedAt)}</span>
                      )}
                      {editedAt !== null && note.tags.length > 0 && (
                        <span className="opacity-40" aria-hidden="true">
                          ·
                        </span>
                      )}
                      {note.tags.length > 0 && (
                        <span className="inline-flex items-center gap-1.5">
                          <TagIcon className="size-3.5" aria-hidden="true" />
                          <span className="flex flex-wrap items-center gap-1">
                            {note.tags.map((tag, i) => (
                              <Fragment key={tag}>
                                {i > 0 && (
                                  <span
                                    className="opacity-50"
                                    aria-hidden="true"
                                  >
                                    ·
                                  </span>
                                )}
                                <span className="text-foreground/80">
                                  {tag}
                                </span>
                              </Fragment>
                            ))}
                          </span>
                        </span>
                      )}
                    </p>
                  )}
                  {note.summary ? (
                    <p className="text-muted-foreground/90 text-[13.5px] leading-6">
                      {note.summary}
                    </p>
                  ) : null}
                </div>
              )}
            </header>
            <MdxRenderer content={note.body} containerClassName="" hideHeader />
          </article>
        </div>
      )}
    </div>
  );
}

function CenteredHint({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body?: string;
}) {
  return (
    <div className="flex h-full min-h-72 flex-col items-center justify-center px-6 text-center">
      <div className="bg-secondary text-muted-foreground flex size-11 items-center justify-center rounded-xl">
        {icon}
      </div>
      <p className="text-foreground mt-3 text-[14px] font-medium">{title}</p>
      {body ? (
        <p className="text-muted-foreground mt-1 max-w-sm text-[12.5px] leading-5">
          {body}
        </p>
      ) : null}
    </div>
  );
}
