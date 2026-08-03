"use client";

import { useRef, useState } from "react";

import { cn } from "@acme/ui";
import { Button } from "@acme/ui/button";
import { toast } from "@acme/ui/toast";

import { ingestFile } from "~/lib/capture-client";

type UploadState = "pending" | "uploading" | "done" | "failed";

const STATE_LABEL: Record<UploadState, string> = {
  pending: "",
  uploading: "Uploading…",
  done: "Imported",
  failed: "Failed",
};

// Both "not started" and "retryable" — the two states the Import button acts on
// and the only ones a row can be removed in.
const QUEUED_STATES = new Set<UploadState>(["pending", "failed"]);

interface Upload {
  id: string;
  file: File;
  state: UploadState;
  error: string | null;
}

// Onboarding's import step: the fastest path from "we already have docs" to a
// brain with something in it. A .zip fans out server-side into one Source per
// entry (see server/ingest/expand-zip.ts), so dragging in an export of an
// existing wiki is a single upload.
const ACCEPT = ".zip,.md,.markdown,.txt,.csv,.json,.pdf";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ImportStep({
  workspaceId,
  onDone,
}: {
  workspaceId: string;
  onDone: () => void;
}) {
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const addFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const added: Upload[] = Array.from(files).map((file) => ({
      id: crypto.randomUUID(),
      file,
      state: "pending",
      error: null,
    }));
    setUploads((prev) => [...prev, ...added]);
  };

  const patch = (id: string, next: Partial<Upload>) => {
    setUploads((prev) =>
      prev.map((u) => (u.id === id ? { ...u, ...next } : u)),
    );
  };

  const remove = (id: string) => {
    setUploads((prev) => prev.filter((u) => u.id !== id));
  };

  const submit = async () => {
    const queued = uploads.filter((u) => QUEUED_STATES.has(u.state));
    if (queued.length === 0) {
      onDone();
      return;
    }

    setBusy(true);
    let uploaded = 0;
    let failed = 0;
    // Sequential: each upload is a presign → PUT → finalize round trip, and a
    // parallel burst would race the workspace's capture/storage limit checks.
    for (const upload of queued) {
      patch(upload.id, { state: "uploading", error: null });
      try {
        await ingestFile({ workspaceId, file: upload.file });
        patch(upload.id, { state: "done" });
        uploaded += 1;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        patch(upload.id, { state: "failed", error: message });
        failed += 1;
      }
    }
    setBusy(false);

    if (uploaded > 0) {
      toast.success(
        `Importing ${uploaded} file${uploaded === 1 ? "" : "s"} — they'll appear in Sources as they compile`,
      );
    }
    if (failed > 0) {
      toast.error(
        `${failed} file${failed === 1 ? "" : "s"} could not be imported`,
      );
      // Leave the user on the step so they can retry just the failures.
      return;
    }
    onDone();
  };

  const hasQueued = uploads.some((u) => QUEUED_STATES.has(u.state));

  return (
    <div className="flex flex-col gap-5">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragging(false);
          addFiles(e.dataTransfer.files);
        }}
        className={cn(
          "border-border/70 flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-6 py-10 text-center transition-colors",
          isDragging && "border-primary bg-primary/5",
        )}
      >
        <p className="text-foreground text-[14px] font-medium">
          Drop files here to seed your memory
        </p>
        <p className="text-muted-foreground text-[13px] leading-5">
          Markdown, text, CSV, JSON, or PDF. Drop a{" "}
          <span className="text-foreground font-medium">.zip</span> of an
          existing wiki and we&apos;ll unpack every file inside it.
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-2"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
        >
          Choose files
        </Button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => {
            addFiles(e.target.files);
            // Reset so re-picking the same file still fires onChange.
            e.target.value = "";
          }}
        />
      </div>

      {uploads.length > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {uploads.map((upload) => (
            <li
              key={upload.id}
              className="border-border/60 flex items-center gap-3 rounded-lg border px-3 py-2"
            >
              <div className="flex min-w-0 flex-col">
                <span className="text-foreground truncate text-[13px]">
                  {upload.file.name}
                </span>
                <span className="text-muted-foreground text-[12px]">
                  {upload.error ?? formatSize(upload.file.size)}
                </span>
              </div>
              <span
                className={cn(
                  "text-muted-foreground ml-auto shrink-0 text-[12px]",
                  upload.state === "failed" && "text-destructive",
                )}
              >
                {STATE_LABEL[upload.state]}
              </span>
              {QUEUED_STATES.has(upload.state) ? (
                <button
                  type="button"
                  onClick={() => remove(upload.id)}
                  disabled={busy}
                  className="text-muted-foreground hover:text-foreground shrink-0 text-[12px] disabled:opacity-50"
                >
                  Remove
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onDone}
          disabled={busy}
          className="text-muted-foreground text-[13px] underline-offset-4 hover:underline disabled:no-underline disabled:opacity-50"
        >
          Skip for now
        </button>
        <Button onClick={submit} disabled={busy}>
          {busy ? "Importing…" : hasQueued ? "Import" : "Continue"}
        </Button>
      </div>
    </div>
  );
}
