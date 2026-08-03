/** "just now" / "5 min ago" / "3h ago" / "2d ago" / "4mo ago" / "1y ago". */
export function formatRelativeTime(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${String(minutes)} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${String(hours)}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${String(days)}d ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${String(months)}mo ago`;
  const years = Math.round(months / 12);
  return `${String(years)}y ago`;
}
