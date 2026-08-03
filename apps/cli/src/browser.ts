import { spawn } from "node:child_process";

/**
 * Best-effort: open a URL in the user's default browser. Never throws — the
 * caller always also prints the URL so login works on headless machines.
 */
export function openBrowser(url: string): void {
  const platform = process.platform;
  const [cmd, args] =
    platform === "darwin"
      ? (["open", [url]] as const)
      : platform === "win32"
        ? (["cmd", ["/c", "start", "", url]] as const)
        : (["xdg-open", [url]] as const);
  try {
    const child = spawn(cmd, [...args], { stdio: "ignore", detached: true });
    child.on("error", () => {
      // Browser launch failed; the printed URL is the fallback.
    });
    child.unref();
  } catch {
    // Spawn itself threw; ignore — the printed URL is the fallback.
  }
}
