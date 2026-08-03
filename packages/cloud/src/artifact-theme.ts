/**
 * App design tokens for "match app theme" artifactes. Mirrors the light palette
 * in tooling/tailwind/theme.css (oklch, accent-hue 248) so a generated artifact
 * matches the Nimbase app.
 *
 * Used two ways:
 *  - the fixed-mode sandbox shell (artifact-build.ts) injects this verbatim, and
 *  - the freeform prompt embeds it so the model can paste it into its own <head>.
 *
 * The artifact sandbox loads the Tailwind v3 Play CDN, so custom colors are
 * registered through the global `tailwind.config` and resolve to the CSS
 * variables below. This makes utilities like `bg-primary`, `text-foreground`,
 * `bg-card`, `border-border`, `bg-accent`, and `rounded-lg` resolve, and chart
 * series can reference `var(--chart-1)` … `var(--chart-5)` directly.
 *
 * IMPORTANT: place this AFTER the `cdn.tailwindcss.com` <script> — the Play CDN
 * reads `tailwind.config` after it loads.
 */
export const ARTIFACT_THEME_HEAD = `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans:wght@400;500;600;700&family=Noto+Sans+Mono&display=swap" />
<style>
:root {
  --accent-hue: 248;
  --background: oklch(0.995 0 0);
  --foreground: oklch(0.18 0.04 var(--accent-hue));
  --card: oklch(1 0 0);
  --card-foreground: oklch(0.18 0.04 var(--accent-hue));
  --primary: oklch(50% 28% var(--accent-hue));
  --primary-foreground: oklch(0.98 0.01 var(--accent-hue));
  --secondary: oklch(0.946 0.011 var(--accent-hue));
  --secondary-foreground: oklch(0.26 0.05 var(--accent-hue));
  --muted: oklch(0.946 0.011 var(--accent-hue));
  --muted-foreground: oklch(0.4 0 0);
  --accent: oklch(0.946 0.011 var(--accent-hue));
  --accent-foreground: oklch(0.52 0.13 var(--accent-hue));
  --destructive: oklch(0.56 0.21 9);
  --destructive-foreground: oklch(1 0 0);
  --border: oklch(0.8 0 0);
  --input: oklch(0.88 0 0);
  --ring: oklch(0.52 0.13 var(--accent-hue));
  --chart-1: oklch(0.52 0.13 var(--accent-hue));
  --chart-2: oklch(0.7 0.16 calc(var(--accent-hue) - 21));
  --chart-3: oklch(0.78 0.11 calc(var(--accent-hue) + 15));
  --chart-4: oklch(0.55 0.19 calc(var(--accent-hue) - 31));
  --chart-5: oklch(0.5 0.16 calc(var(--accent-hue) + 29));
  --radius: 0.625rem;
}
body { font-family: "Noto Sans", ui-sans-serif, system-ui, sans-serif; }
</style>
<script>
tailwind.config = {
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        card: { DEFAULT: "var(--card)", foreground: "var(--card-foreground)" },
        primary: { DEFAULT: "var(--primary)", foreground: "var(--primary-foreground)" },
        secondary: { DEFAULT: "var(--secondary)", foreground: "var(--secondary-foreground)" },
        muted: { DEFAULT: "var(--muted)", foreground: "var(--muted-foreground)" },
        accent: { DEFAULT: "var(--accent)", foreground: "var(--accent-foreground)" },
        destructive: { DEFAULT: "var(--destructive)", foreground: "var(--destructive-foreground)" },
        border: "var(--border)",
        input: "var(--input)",
        ring: "var(--ring)",
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      fontFamily: {
        sans: ['"Noto Sans"', "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ['"Noto Sans Mono"', "ui-monospace", "monospace"],
      },
    },
  },
};
</script>`;
