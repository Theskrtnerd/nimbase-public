---
description: Use when theming a artifact to match the Nimbase app (the default unless a custom theme is provided) — the app's design tokens.
---

# Nimbase app theme

Match the Nimbase app using its Tailwind design tokens — do NOT hardcode hex
colors or inline color styles. These tokens are already available as Tailwind
utility classes and CSS variables. Use:

- Page background & text: `bg-background text-foreground`
- Cards / panels: `bg-card text-card-foreground`, with `border border-border`
  and `rounded-lg`
- Secondary / muted surfaces: `bg-secondary` or `bg-muted`; secondary/muted
  text: `text-muted-foreground`
- Primary / brand actions (buttons, links, highlights, active states):
  `bg-primary text-primary-foreground`
- Subtle accents / badges: `bg-accent text-accent-foreground`
- Errors / destructive: `bg-destructive text-destructive-foreground`
- Inputs: `border-input`; focus rings: `ring-ring`
- Radius: `rounded-lg` (~10px); prefer subtle shadows (`shadow-sm`), avoid
  heavy borders
- Typography: `font-sans` for text, `font-mono` for code/numbers (the app
  fonts are preloaded)

For chart series colors (recharts fill/stroke, SVG, etc.) use the CSS
variables `var(--chart-1)` … `var(--chart-5)` — not hex.

Keep it light, clean, minimal, with generous whitespace.
