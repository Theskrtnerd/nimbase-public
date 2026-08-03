import "server-only";

import type { ToolSet } from "ai";
import type { Thread } from "chat";

// The phases a turn moves through, in the words the user sees.
export const TURN_STATUS = {
  thinking: "Thinking…",
  searching: "Searching your memory…",
  reading: "Reading your memory…",
  composing: "Putting it together…",
  building: "Building your artifact…",
} as const;

// Which phase a tool call represents (tree/search/grep/read from `readTools`,
// plus the harness's `search`). Unknown tools read as "searching".
function phaseForTool(name: string): string {
  if (name === "read") return TURN_STATUS.reading;
  // The one long tool — a artifact blocks for ~30s, so leaving it on "searching"
  // would read as a hang.
  if (name === "create_artifact") return TURN_STATUS.building;
  return TURN_STATUS.searching;
}

/**
 * The turn's handle on the platform indicator: `show` moves it along, `clear`
 * takes it down for good.
 *
 * `thread.startTyping` is the platform's own indicator (on Slack, an assistant
 * status). Status is cosmetic, so `show` is fire-and-forget
 * and a rejection never touches the answering path — but the calls are
 * *serialized* through one chain, and `clear` closes the handle. Without that,
 * a `show` still in flight when the answer lands re-sets the status after Slack
 * auto-cleared it, and the stale phase sits there until the next message.
 */
export interface TurnStatus {
  show: (text: string) => void;
  clear: () => Promise<void>;
}

// Slack clears an assistant status by setting it to the empty string, which
// `startTyping` can't express (a falsy status falls back to "Typing…"). The
// escape hatch is the adapter's own `setAssistantStatus`, matched structurally
// so this module stays free of an adapter import (and of `bot.ts`'s db/env
// pull-in), and so a platform without that method degrades to no clear rather
// than needing a branch here.
interface StatusCapableAdapter {
  decodeThreadId: (threadId: string) => { channel: string; threadTs: string };
  setAssistantStatus: (
    channelId: string,
    threadTs: string,
    status: string,
  ) => Promise<void>;
}

function statusCapable(adapter: unknown): StatusCapableAdapter | null {
  const a = adapter as Partial<StatusCapableAdapter> | null;
  return typeof a?.decodeThreadId === "function" &&
    typeof a.setAssistantStatus === "function"
    ? (a as StatusCapableAdapter)
    : null;
}

export function createTurnStatus(thread: Thread): TurnStatus {
  let chain: Promise<unknown> = Promise.resolve();
  let closed = false;
  const enqueue = (fn: () => Promise<unknown>) => {
    chain = chain.then(fn, fn).catch(() => undefined);
    return chain;
  };
  return {
    show: (text: string) => {
      if (closed) return;
      void enqueue(() => thread.startTyping(text));
    },
    clear: async () => {
      if (closed) return;
      closed = true;
      const adapter = statusCapable(thread.adapter);
      // Drained even with no clearable adapter, so `clear` always
      // means "no status write is still in flight".
      await enqueue(async () => {
        if (!adapter) return;
        const { channel, threadTs } = adapter.decodeThreadId(thread.id);
        if (!threadTs) return;
        await adapter.setAssistantStatus(channel, threadTs, "");
      });
    },
  };
}

/**
 * Wrap a toolset so each call reports its phase while it runs, and flips back
 * to "putting it together" once it returns. This is the only hook that fires
 * *during* a step — `onStepFinish` only sees a tool after its result is in.
 */
export function withToolStatus<T extends ToolSet>(
  tools: T,
  status: TurnStatus,
): T {
  const show = (text: string) => {
    status.show(text);
  };
  const wrapped: ToolSet = {};
  for (const [name, tool] of Object.entries(tools)) {
    const execute = tool.execute;
    if (!execute) {
      wrapped[name] = tool;
      continue;
    }
    // The AI SDK types `execute` as a union over each tool's own input shape,
    // which no generic wrapper can satisfy structurally — the pass-through is
    // type-safe in practice, so re-assert the original signature.
    const instrumented = (input: never, options: never): unknown => {
      show(phaseForTool(name));
      const result: unknown = execute(input, options);
      // Streaming tools return an async iterable, not a promise — don't wrap
      // those, just move the phase along.
      if (!(result instanceof Promise)) {
        show(TURN_STATUS.composing);
        return result;
      }
      return (result as Promise<unknown>).finally(() =>
        show(TURN_STATUS.composing),
      );
    };
    wrapped[name] = {
      ...tool,
      execute: instrumented as typeof execute,
    };
  }
  return wrapped as T;
}
