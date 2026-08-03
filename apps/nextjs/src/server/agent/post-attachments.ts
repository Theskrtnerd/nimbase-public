import "server-only";

import type { AttachmentSink } from "./attachments";

/**
 * Post whatever a turn's tools left in the sink, as a follow-up message.
 *
 * Deliberately a *second* message rather than files riding along with the
 * answer. That ordering is what makes the failure mode safe: the answer (which
 * always contains the share link) is already delivered before the upload is
 * attempted, so a workspace whose Slack token predates the `files:write` scope
 * still gets a usable reply instead of a failed turn.
 *
 * Never throws. An attachment is a nicety layered on a link that already works.
 */
export async function postAttachments(
  thread: { post: (message: unknown) => Promise<unknown> },
  sink: AttachmentSink | undefined,
): Promise<void> {
  const files = sink?.take() ?? [];
  if (!files.length) return;

  try {
    await thread.post({
      markdown: "",
      files: files.map((f) => ({
        data: f.data,
        filename: f.filename,
        mimeType: f.mimeType,
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // The overwhelmingly likely cause: this workspace installed the Slack app
    // before `files:write` was in SLACK_SCOPES, so its sealed bot token cannot
    // upload. There is no way to widen a live token — the workspace has to
    // reconnect. Log it and move on; the link already went out.
    if (message.includes("missing_scope")) {
      console.warn(
        "[agent] attachment skipped — Slack connection predates files:write; workspace must reconnect",
      );
      return;
    }
    console.error("[agent] attachment upload failed:", message);
  }
}
