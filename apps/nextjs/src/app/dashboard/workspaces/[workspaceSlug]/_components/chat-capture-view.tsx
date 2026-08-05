"use client";

import type { ChangeEvent, DragEvent, KeyboardEvent } from "react";
import { useRef, useState } from "react";
import {
  CheckIcon,
  FileIcon,
  ImageIcon,
  Loader2Icon,
  MessageSquarePlusIcon,
  MicIcon,
  PaperclipIcon,
  SendIcon,
  TriangleAlertIcon,
  VideoIcon,
  XIcon,
} from "lucide-react";

import { cn } from "@acme/ui";
import { Button } from "@acme/ui/button";
import { Textarea } from "@acme/ui/textarea";

import { useAnalytics } from "~/app/_components/analytics";
import { ingestFile, ingestText } from "~/lib/capture-client";

interface CaptureItem {
  id: string;
  label: string;
  detail: string;
  icon: typeof FileIcon;
  status: "pending" | "done" | "error";
  error?: string;
  retry: () => void;
}

let nextId = 0;
function newId(): string {
  nextId += 1;
  return `capture-${nextId}`;
}

function iconForFile(file: File): typeof FileIcon {
  if (file.type.startsWith("image/")) return ImageIcon;
  if (file.type.startsWith("audio/")) return MicIcon;
  if (file.type.startsWith("video/")) return VideoIcon;
  return FileIcon;
}

export function ChatCaptureView({ workspaceId }: { workspaceId: string }) {
  const [text, setText] = useState("");
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [items, setItems] = useState<CaptureItem[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const analytics = useAnalytics();

  function updateItem(id: string, patch: Partial<CaptureItem>) {
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );
  }

  function runTextCapture(value: string) {
    const id = newId();
    analytics.capture("capture_submitted", {
      workspace_id: workspaceId,
      text_length: value.length,
    });
    const attempt = () => {
      updateItem(id, { status: "pending", error: undefined });
      ingestText({ workspaceId, text: value })
        .then(() => updateItem(id, { status: "done" }))
        .catch((err: unknown) =>
          updateItem(id, {
            status: "error",
            error: err instanceof Error ? err.message : "Capture failed.",
          }),
        );
    };
    setItems((prev) => [
      ...prev,
      {
        id,
        label: value.length > 80 ? `${value.slice(0, 80)}…` : value,
        detail: "Note",
        icon: MessageSquarePlusIcon,
        status: "pending",
        retry: attempt,
      },
    ]);
    attempt();
  }

  function runFileCapture(file: File) {
    const id = newId();
    analytics.capture("file_captured", {
      workspace_id: workspaceId,
      file_type: file.type || "unknown",
      file_size_bytes: file.size,
    });
    const attempt = () => {
      updateItem(id, { status: "pending", error: undefined });
      ingestFile({ workspaceId, file })
        .then(() => updateItem(id, { status: "done" }))
        .catch((err: unknown) =>
          updateItem(id, {
            status: "error",
            error: err instanceof Error ? err.message : "Capture failed.",
          }),
        );
    };
    setItems((prev) => [
      ...prev,
      {
        id,
        label: file.name,
        detail: formatBytes(file.size),
        icon: iconForFile(file),
        status: "pending",
        retry: attempt,
      },
    ]);
    attempt();
  }

  function handleSend() {
    const value = text.trim();
    const files = pendingFiles;
    if (!value && files.length === 0) return;
    if (value) runTextCapture(value);
    for (const file of files) runFileCapture(file);
    setText("");
    setPendingFiles([]);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function addFiles(files: FileList | File[]) {
    setPendingFiles((prev) => [...prev, ...Array.from(files)]);
  }

  function handleFileInputChange(e: ChangeEvent<HTMLInputElement>) {
    if (e.target.files) addFiles(e.target.files);
    e.target.value = "";
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files);
  }

  return (
    <div
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
    >
      <header className="border-sidebar-border flex shrink-0 items-center gap-3 border-b px-5 py-3">
        <MessageSquarePlusIcon className="text-sidebar-accent-foreground size-4" />
        <div className="flex flex-col">
          <h1 className="text-foreground text-[15px] font-semibold tracking-tight">
            Capture
          </h1>
          <p className="text-muted-foreground text-[12px] leading-none">
            Drop in text, files, images, or video — each one becomes a Source.
          </p>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-2">
          {items.length === 0 ? (
            <div className="text-muted-foreground flex flex-1 flex-col items-center justify-center gap-2 py-16 text-center">
              <MessageSquarePlusIcon className="size-8 opacity-40" />
              <p className="text-[13px]">
                Type a note or attach anything — it's captured straight into
                this workspace.
              </p>
            </div>
          ) : (
            items.map((item) => <CaptureRow key={item.id} item={item} />)
          )}
        </div>
      </div>

      <div className="border-sidebar-border shrink-0 border-t px-5 py-4">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-2">
          {pendingFiles.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {pendingFiles.map((file) => (
                <span
                  key={`${file.name}-${String(file.size)}-${String(file.lastModified)}`}
                  className="bg-muted text-foreground flex items-center gap-1.5 rounded-full py-1 pr-1.5 pl-2.5 text-[12px]"
                >
                  {file.name}
                  <button
                    type="button"
                    aria-label={`Remove ${file.name}`}
                    className="hover:bg-background/60 flex size-4 items-center justify-center rounded-full"
                    onClick={() =>
                      setPendingFiles((prev) => prev.filter((f) => f !== file))
                    }
                  >
                    <XIcon className="size-3" />
                  </button>
                </span>
              ))}
            </div>
          ) : null}

          <div
            className={cn(
              "border-border bg-card flex items-end gap-2 rounded-xl border p-2 transition-colors",
              isDragging && "border-primary bg-primary/5",
            )}
          >
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0"
              onClick={() => fileInputRef.current?.click()}
            >
              <PaperclipIcon className="size-4" />
              <span className="sr-only">Attach files</span>
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={handleFileInputChange}
            />
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Capture a note, or attach a file, image, or video…"
              rows={1}
              className="max-h-40 min-h-9 flex-1 resize-none border-0 bg-transparent px-1 py-1.5 shadow-none focus-visible:ring-0"
            />
            <Button
              size="icon"
              className="shrink-0"
              onClick={handleSend}
              disabled={!text.trim() && pendingFiles.length === 0}
            >
              <SendIcon className="size-4" />
              <span className="sr-only">Capture</span>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function CaptureRow({ item }: { item: CaptureItem }) {
  const Icon = item.icon;
  return (
    <div className="bg-card border-border flex items-center gap-3 rounded-xl border px-4 py-3">
      <Icon className="text-muted-foreground size-4 shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col">
        <p className="text-foreground truncate text-[13px] font-medium">
          {item.label}
        </p>
        <p className="text-muted-foreground text-[11px]">
          {item.status === "error"
            ? (item.error ?? "Capture failed.")
            : item.detail}
        </p>
      </div>
      {item.status === "pending" ? (
        <Loader2Icon className="text-muted-foreground size-4 shrink-0 animate-spin" />
      ) : item.status === "done" ? (
        <CheckIcon className="size-4 shrink-0 text-emerald-600" />
      ) : (
        <div className="flex shrink-0 items-center gap-2">
          <TriangleAlertIcon className="text-destructive size-4" />
          <Button variant="ghost" size="sm" onClick={item.retry}>
            Retry
          </Button>
        </div>
      )}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
