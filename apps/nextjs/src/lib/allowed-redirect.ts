// Redirect targets we trust to hand an auth code back to a native client:
// the nimbase:// custom scheme (legacy native clients), a browser-extension
// identity redirect (https://<extension-id>.chromiumapp.org/), or an http
// loopback URL (the CLI's local server, RFC 8252).
export function isAllowedRedirect(url: string): boolean {
  if (url.startsWith("nimbase://")) return true;
  try {
    const parsed = new URL(url);
    // Loopback redirect for native CLI clients: http on a loopback host only.
    if (
      parsed.protocol === "http:" &&
      (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost")
    ) {
      return true;
    }
    return (
      parsed.protocol === "https:" &&
      (parsed.hostname === "chromiumapp.org" ||
        parsed.hostname.endsWith(".chromiumapp.org"))
    );
  } catch {
    return false;
  }
}
