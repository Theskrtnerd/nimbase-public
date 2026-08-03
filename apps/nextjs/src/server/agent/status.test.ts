import type { ToolSet } from "ai";
import type { Thread } from "chat";
import { describe, expect, it } from "vitest";

import { createTurnStatus, TURN_STATUS, withToolStatus } from "./status";

// `withToolStatus` only ever touches `startTyping`, so a stub with that one
// method is enough to stand in for a Chat SDK thread.
function fakeThread(startTyping: (text: string) => Promise<void>): Thread {
  return { startTyping, id: "slack:C1:1.0" } as unknown as Thread;
}

function fakeStatus(startTyping: (text: string) => Promise<void>) {
  return createTurnStatus(fakeThread(startTyping));
}

describe("withToolStatus", () => {
  it("reports a phase around each tool call and returns its result", async () => {
    const seen: string[] = [];
    const status = fakeStatus((text) => {
      seen.push(text);
      return Promise.resolve();
    });
    const tools = {
      search: { execute: () => Promise.resolve("hits") },
      read: { execute: () => Promise.resolve("body") },
    } as unknown as ToolSet;

    const wrapped = withToolStatus(tools, status);
    const search = wrapped.search?.execute;
    const read = wrapped.read?.execute;

    expect(await search?.(undefined as never, undefined as never)).toBe("hits");
    expect(await read?.(undefined as never, undefined as never)).toBe("body");
    await status.clear();

    expect(seen).toEqual([
      TURN_STATUS.searching,
      TURN_STATUS.composing,
      TURN_STATUS.reading,
      TURN_STATUS.composing,
    ]);
  });

  it("moves the phase along even when a tool throws", async () => {
    const seen: string[] = [];
    const status = fakeStatus((text) => {
      seen.push(text);
      return Promise.resolve();
    });
    const tools = {
      search: { execute: () => Promise.reject(new Error("boom")) },
    } as unknown as ToolSet;

    const wrapped = withToolStatus(tools, status);
    const search = wrapped.search?.execute;
    await expect(
      search?.(undefined as never, undefined as never) as Promise<unknown>,
    ).rejects.toThrow("boom");
    await status.clear();

    expect(seen.at(-1)).toBe(TURN_STATUS.composing);
  });

  it("leaves the turn alone when the platform rejects a status update", async () => {
    const status = fakeStatus(() => Promise.reject(new Error("no scope")));
    const tools = {
      search: { execute: () => Promise.resolve("hits") },
    } as unknown as ToolSet;

    const wrapped = withToolStatus(tools, status);
    // Status is cosmetic: a failing indicator must not surface as a turn error.
    await expect(
      wrapped.search?.execute?.(undefined as never, undefined as never),
    ).resolves.toBe("hits");
  });

  it("passes through tools that have no execute", () => {
    const status = fakeStatus(() => Promise.resolve());
    const provider = { description: "provider-executed" };
    const tools = { provider } as unknown as ToolSet;

    expect(withToolStatus(tools, status).provider).toBe(provider);
  });
});

describe("createTurnStatus", () => {
  // Slack clears by setting the empty string; `startTyping("")` would render
  // "Typing…" instead, so the clear has to go through the adapter directly.
  function slackThread() {
    const calls: string[] = [];
    const thread = {
      id: "slack:C1:1700.0",
      startTyping: (text: string) => {
        calls.push(text);
        return Promise.resolve();
      },
      adapter: {
        decodeThreadId: (id: string) => {
          const [, channel, threadTs] = id.split(":");
          return { channel: channel ?? "", threadTs: threadTs ?? "" };
        },
        setAssistantStatus: (_channel: string, _ts: string, status: string) => {
          calls.push(`clear:${status}`);
          return Promise.resolve();
        },
      },
    } as unknown as Thread;
    return { thread, calls };
  }

  it("clears the platform status through the adapter", async () => {
    const { thread, calls } = slackThread();
    const status = createTurnStatus(thread);
    status.show(TURN_STATUS.composing);
    await status.clear();

    expect(calls).toEqual([TURN_STATUS.composing, "clear:"]);
  });

  it("drops shows issued after the clear", async () => {
    const { thread, calls } = slackThread();
    const status = createTurnStatus(thread);
    await status.clear();
    // A tool settling after the answer posted must not resurrect the
    // indicator — that is what left "Putting it together…" stuck.
    status.show(TURN_STATUS.composing);
    await status.clear();

    expect(calls).toEqual(["clear:"]);
  });

  it("orders a show before a clear that follows it", async () => {
    const { thread, calls } = slackThread();
    const status = createTurnStatus(thread);
    status.show(TURN_STATUS.searching);
    status.show(TURN_STATUS.composing);
    await status.clear();

    expect(calls.at(-1)).toBe("clear:");
  });
});
