// Per-surface rollout switch for the Pi-harness AI runtime. Unset/empty means
// every surface stays on its legacy generateText loop. Read from process.env
// on every call (not a cached env schema) so tests and runtime flips need no
// rebuild.
export type HarnessSurface = "artifact" | "chat" | "gardener";

export function harnessEnabledFor(surface: HarnessSurface): boolean {
  const raw = process.env.NIMBASE_HARNESS_SURFACES ?? "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .includes(surface);
}
