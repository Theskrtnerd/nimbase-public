/**
 * Explicit locale + timeZone so date/time text renders identically on the
 * server and after client hydration — leaving these to the ambient
 * locale/timezone produces a hydration mismatch (react-doctor
 * no-locale-format-in-render), since the server and the browser can differ.
 */
export function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", { timeZone: "UTC" });
}

export function formatDateTime(date: Date): string {
  return date.toLocaleString("en-US", { timeZone: "UTC" });
}
