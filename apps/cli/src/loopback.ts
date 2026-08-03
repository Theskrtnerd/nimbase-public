import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import { CliError } from "./errors";

export function waitForLoopbackCallback(args: {
  state: string;
  valueParam: string;
  timeoutMs: number;
  successTitle: string;
  failureTitle: string;
  invalidMessage: string;
  timeoutMessage: string;
  exitCode: number;
  onReady: (redirectUrl: string) => void;
}): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let timer: NodeJS.Timeout | undefined;
    let settled = false;
    const server = createServer((request, response) => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (url.pathname !== "/callback") {
        response.writeHead(404);
        response.end();
        return;
      }
      const value = url.searchParams.get(args.valueParam);
      const stateMatches = url.searchParams.get("state") === args.state;
      const remoteError = url.searchParams.get("error");
      const valid = stateMatches && !!value && !remoteError;
      response.writeHead(valid ? 200 : 400, { "Content-Type": "text/html" });
      response.end(
        `<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;padding:3rem;text-align:center"><h1>${
          valid ? args.successTitle : args.failureTitle
        }</h1><p>You can close this window and return to your terminal.</p></body>`,
      );
      finish(
        valid && value
          ? { value }
          : {
              error: new CliError(
                stateMatches && remoteError
                  ? `${args.failureTitle}: ${remoteError.replaceAll("_", " ")}`
                  : args.invalidMessage,
                args.exitCode,
              ),
            },
      );
    });

    function finish(result: { value: string } | { error: Error }): void {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      server.close();
      if ("value" in result) resolve(result.value);
      else reject(result.error);
    }

    server.on("error", (error) => finish({ error }));
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      timer = setTimeout(
        () =>
          finish({
            error: new CliError(args.timeoutMessage, args.exitCode),
          }),
        args.timeoutMs,
      );
      timer.unref();
      try {
        args.onReady(`http://127.0.0.1:${port}/callback`);
      } catch (error) {
        finish({
          error: error instanceof Error ? error : new Error(String(error)),
        });
      }
    });
  });
}
