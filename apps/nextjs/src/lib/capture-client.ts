"use client";

// Client-side capture helpers for the dashboard's chat-style quick capture.
// This runs same-origin with the Clerk session cookie.

export type CaptureBinaryKind = "screenshot" | "voice" | "video" | "file";

function kindForFile(file: File): CaptureBinaryKind {
  if (file.type.startsWith("image/")) return "screenshot";
  if (file.type.startsWith("audio/")) return "voice";
  if (file.type.startsWith("video/")) return "video";
  return "file";
}

export async function ingestText(params: {
  workspaceId: string;
  text: string;
  title?: string;
  targetFolderId?: string | null;
}): Promise<{ sourceId: string }> {
  const res = await fetch("/api/ingest", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      workspaceId: params.workspaceId,
      kind: "file",
      text: params.text,
      title: params.title,
      capturedAt: new Date().toISOString(),
      ...(params.targetFolderId !== undefined
        ? { targetFolderId: params.targetFolderId ?? undefined }
        : {}),
    }),
  });
  if (!res.ok) throw new Error(`Capture failed (${res.status}).`);
  return (await res.json()) as { sourceId: string };
}

// Three-phase binary capture: presign → PUT the bytes straight to S3 →
// finalize (which enqueues the extract/compile pipeline).
export async function ingestFile(params: {
  workspaceId: string;
  file: File;
  targetFolderId?: string | null;
}): Promise<{ sourceId: string }> {
  const { workspaceId, file } = params;
  const kind = kindForFile(file);

  const presignRes = await fetch("/api/ingest/presign", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      workspaceId,
      kind,
      mimeType: file.type || "application/octet-stream",
      title: file.name,
      capturedAt: new Date().toISOString(),
      sizeBytes: file.size,
      originalFilename: file.name,
      ...(params.targetFolderId !== undefined
        ? { targetFolderId: params.targetFolderId ?? undefined }
        : {}),
    }),
  });
  if (!presignRes.ok) {
    const body = (await presignRes.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(body?.error ?? `Capture failed (${presignRes.status}).`);
  }
  const { sourceId, uploadUrl } = (await presignRes.json()) as {
    sourceId: string;
    uploadUrl: string;
  };

  const putRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "content-type": file.type || "application/octet-stream" },
    body: file,
  });
  if (!putRes.ok) throw new Error(`Upload failed (${putRes.status}).`);

  const finalizeRes = await fetch("/api/ingest/finalize", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ workspaceId, sourceId }),
  });
  if (!finalizeRes.ok) {
    throw new Error(`Capture failed (${finalizeRes.status}).`);
  }
  return { sourceId };
}
