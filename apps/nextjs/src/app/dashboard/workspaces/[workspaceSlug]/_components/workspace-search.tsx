"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@acme/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@acme/ui/dialog";

import { useAnalytics } from "~/app/_components/analytics";
import { useTRPC } from "~/trpc/react";

const DEBOUNCE_MS = 200;

// Centered command-palette search over the workspace's notes. Opened by the
// activity-bar search icon or ⌘K / Ctrl-K; selecting a result opens it in the
// reader. Hybrid (keyword + vector) search via kb.search.
export function WorkspaceSearch({
  workspaceId,
  open,
  onOpenChange,
  onOpenNote,
}: {
  workspaceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenNote: (nodeId: string) => void;
}) {
  const trpc = useTRPC();
  const analytics = useAnalytics();
  const [value, setValue] = useState("");
  const [debounced, setDebounced] = useState("");
  // Debounce via a ref'd timeout rather than an effect (CLAUDE.md: avoid
  // useEffect). Cleared on every keystroke and on select.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // App-wide ⌘K / Ctrl-K opens the palette. A document-level keydown listener
  // is the right primitive for a global shortcut — nothing render-derived can
  // observe key events fired outside this component's own DOM. Skip while the
  // user is typing elsewhere so we don't hijack an editor's own ⌘K (links).
  useEffect(() => {
    function onShortcut(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "k") return;
      const el = document.activeElement;
      const typing =
        el instanceof HTMLElement &&
        (el.isContentEditable ||
          el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA");
      if (typing) return;
      e.preventDefault();
      onOpenChange(true);
    }
    window.addEventListener("keydown", onShortcut);
    return () => window.removeEventListener("keydown", onShortcut);
  }, [onOpenChange]);

  const search = useQuery(
    trpc.kb.search.queryOptions(
      { workspaceId, query: debounced },
      { enabled: debounced.trim().length > 0 },
    ),
  );

  function handleChange(next: string) {
    setValue(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setDebounced(next);
      if (next.trim().length > 0) {
        analytics.capture("memory_searched", {
          query_length: next.trim().length,
          workspace_id: workspaceId,
        });
      }
    }, DEBOUNCE_MS);
  }

  function handleOpenChange(next: boolean) {
    if (!next) {
      if (timer.current) clearTimeout(timer.current);
      setValue("");
      setDebounced("");
    }
    onOpenChange(next);
  }

  function select(nodeId: string) {
    analytics.capture("search_result_selected", {
      workspace_id: workspaceId,
    });
    if (timer.current) clearTimeout(timer.current);
    setValue("");
    setDebounced("");
    onOpenChange(false);
    onOpenNote(nodeId);
  }

  const results = search.data ?? [];
  const hasQuery = debounced.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="top-[20%] translate-y-0 overflow-hidden p-0 sm:max-w-xl"
      >
        <DialogHeader className="sr-only">
          <DialogTitle>Search memory</DialogTitle>
          <DialogDescription>
            Search this workspace&apos;s memory by keyword or meaning.
          </DialogDescription>
        </DialogHeader>
        {/* Server already ranks results — disable cmdk's own filtering. */}
        <Command shouldFilter={false} className="bg-transparent">
          <CommandInput
            value={value}
            onValueChange={handleChange}
            placeholder="Search company memory…"
          />
          <CommandList>
            {!hasQuery ? (
              <p className="text-muted-foreground px-4 py-6 text-center text-sm">
                Ask what this workspace knows.
              </p>
            ) : search.isLoading ? (
              <p className="text-muted-foreground px-4 py-6 text-center text-sm">
                Searching…
              </p>
            ) : results.length === 0 ? (
              <CommandEmpty>No matches.</CommandEmpty>
            ) : (
              results.map((hit) => (
                <CommandItem
                  key={hit.nodeId}
                  value={hit.nodeId}
                  onSelect={() => select(hit.nodeId)}
                  className="flex flex-col items-start gap-0.5 px-3 py-2"
                >
                  <span className="text-foreground text-[13px] font-medium">
                    {hit.title}
                  </span>
                  {hit.snippet ? (
                    <span className="text-muted-foreground line-clamp-2 text-[12px] leading-5">
                      {hit.snippet}
                    </span>
                  ) : null}
                </CommandItem>
              ))
            )}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
