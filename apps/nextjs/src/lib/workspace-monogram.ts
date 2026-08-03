// Deterministic palette assignment — same workspace always gets the same color
// stripe & monogram tint, so users can recognize their projects at a glance.
export const MONOGRAM_PALETTE = [
  {
    bg: "bg-sky-100 dark:bg-sky-950/60",
    fg: "text-sky-900 dark:text-sky-200",
    bar: "bg-sky-500",
  },
  {
    bg: "bg-violet-100 dark:bg-violet-950/60",
    fg: "text-violet-900 dark:text-violet-200",
    bar: "bg-violet-500",
  },
  {
    bg: "bg-emerald-100 dark:bg-emerald-950/60",
    fg: "text-emerald-900 dark:text-emerald-200",
    bar: "bg-emerald-500",
  },
  {
    bg: "bg-amber-100 dark:bg-amber-950/60",
    fg: "text-amber-900 dark:text-amber-200",
    bar: "bg-amber-500",
  },
  {
    bg: "bg-rose-100 dark:bg-rose-950/60",
    fg: "text-rose-900 dark:text-rose-200",
    bar: "bg-rose-500",
  },
  {
    bg: "bg-cyan-100 dark:bg-cyan-950/60",
    fg: "text-cyan-900 dark:text-cyan-200",
    bar: "bg-cyan-500",
  },
] as const;

export function paletteFor(name: string): (typeof MONOGRAM_PALETTE)[number] {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  const idx = hash % MONOGRAM_PALETTE.length;
  return MONOGRAM_PALETTE[idx] ?? MONOGRAM_PALETTE[0];
}

export function monogramOf(name: string): string {
  const cleaned = name.trim();
  if (!cleaned) return "·";
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    const a = parts[0]?.[0] ?? "";
    const b = parts[1]?.[0] ?? "";
    return `${a}${b}`.toUpperCase();
  }
  return cleaned.slice(0, 2).toUpperCase();
}
