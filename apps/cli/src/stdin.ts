/** Read piped stdin to a string. Returns "" when attached to a TTY. */
export function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return Promise.resolve("");
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    process.stdin.on("data", (chunk: Buffer) => chunks.push(chunk));
    process.stdin.on("end", () =>
      resolve(Buffer.concat(chunks).toString("utf8")),
    );
    process.stdin.on("error", reject);
  });
}
