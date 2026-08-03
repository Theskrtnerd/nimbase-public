import "server-only";

/**
 * A side channel carrying files from a tool call out to the platform post.
 *
 * The agent turn is otherwise string-in/string-out: a tool returns text, that
 * text lands in the model's context as a tool result, and the model re-narrates
 * it into the reply. That contract is fine for a link but cannot carry bytes —
 * and widening every tool's return type to `string | Buffer` would force each
 * one to think about attachments it does not produce.
 *
 * So the tool keeps returning its string (the model still needs to *say*
 * something about the file), and separately deposits the rendered bytes here.
 * `process-turn` drains the sink after the run and passes whatever it finds to
 * `thread.post`. A turn with no attachment posts exactly as it did before.
 */
export interface PendingAttachment {
  data: Buffer;
  filename: string;
  mimeType: string;
}

export interface AttachmentSink {
  add(attachment: PendingAttachment): void;
  /** Drain. Returns the collected attachments and empties the sink. */
  take(): PendingAttachment[];
}

/**
 * Cap on what one turn may post. A runaway loop calling create_artifact
 * repeatedly should not turn into a dozen multi-megabyte uploads.
 */
const MAX_ATTACHMENTS = 3;

export function createAttachmentSink(max = MAX_ATTACHMENTS): AttachmentSink {
  const items: PendingAttachment[] = [];
  return {
    add(attachment) {
      if (items.length >= max) return;
      items.push(attachment);
    },
    take() {
      return items.splice(0, items.length);
    },
  };
}
