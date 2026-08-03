---
version: "1.0"
name: Nimbase
description: >
  Unified design system for Nimbase — memory infrastructure for AI-native
  companies. One ocean-blue palette (Slack "Ochin", hue 248) driven by a single
  hue knob; status is monochrome (intensity + iconography, never colour); dark
  mode is a global invert filter, not a second palette.
colorModel: oklch
sourcesOfTruth:
  tokens: tooling/tailwind/theme.css      # OKLCH tokens — the engine. Hex below is reference only.
  doctrine: this file                     # where copy and tokens conflict, the implemented tokens win
principles:
  - one-ocean: One hue (248), one accent (--primary ≈ #0C5AA0) that doubles as the chrome rail.
  - monochrome-status: Status = intensity + icon + label. Never green/amber/red/purple.
  - light-first: Light is the design target; dark mode is a single global invert filter.
  - no-emoji: Iconography is line-based (Lucide). No emoji anywhere in the product.
  - tokens-cascade: Every surface/accent derives from --accent-hue; nothing is hand-tuned per accent.
---

# Nimbase Design System

> **Memory infrastructure for AI-native companies.**
>
> Nimbase should feel like the secure control plane for company memory: calm, trustworthy, structured, and quietly futuristic. Not a wiki, not a docs site, not a chatbot wrapper.

This is the design system for the **product app** (`apps/nextjs`). The OKLCH tokens in `tooling/tailwind/theme.css` are the engine; this document is the doctrine. Where documentation and the implemented tokens disagree, **the tokens win.**

---

## 0. The unifying idea — read this first

Three rules make the whole system cohere. Everything else is detail.

1. **One ocean.** A single deep ocean blue (`--primary` ≈ `#0C5AA0`, hue 248) is the only accent. It is the action colour *and* the chrome rail — one token, no separate "brand" colour. Most surfaces are neutral (near-white → white → soft blue-grey `#E7EEF4`); saturated blue is reserved for action and emphasis.

2. **Monochrome status.** Status is expressed by **intensity + iconography + label**, never by hue. There is no green "verified", amber "stale", red "danger", or purple "agent". A redacted memory is a muted slate fill with an `EyeOff` icon; an at-risk promise is deeper ink with a label. The only chromatic exception is `--destructive` (Slack mention red, `#E01E5A`), reserved strictly for irreversible/dangerous actions — never a generic highlight.

3. **One palette, inverted.** There is no second dark palette. `html.dark` runs the light palette through `invert(1) hue-rotate(180deg) contrast(var(--dark-contrast))`. The hue-rotate cancels invert's hue flip so the ocean accent survives. Brand art/media opt out with `[data-keep-color]`.

> This supersedes the earlier brand draft's purple "agent accent" and green/amber/red semantic palette. Nimbase owns **blue memory infrastructure** — monochrome, not a rainbow dashboard.

---

## 1. Brand thesis

Nimbase exists for the next era of companies, where employees, customers, applications, and AI agents all need different slices of shared company knowledge. It is not a knowledge base — it is a **permissioned memory layer** that captures, structures, governs, and serves organizational memory.

- **Core belief:** The defining challenge of AI-native companies is not intelligence. It is memory.
- **Promise:** Give every human and AI actor the right company context at the right time — with trust, permissions, and source grounding built in.
- **Category:** Memory infrastructure for AI-native companies.
- **One-liner:** Nimbase is the secure memory layer that lets employees, customers, applications, and AI agents access the right company context.

### Logo-derived metaphor

The mark is a circular shell of three ocean segments around a deep inner field, with a four-point star at the center. Read it as the product:

- **Outer ring** → capture / ingestion.
- **Inner field** → the governed memory layer.
- **Center star** → trusted, agent-ready answer.
- **Three segments** → employees, customers, and agents accessing different memory slices.

Nimbase should feel like a **secure shell around living company memory.**

---

## 2. Personality

**Feel:** Ambitious (infrastructure for the future of companies) · Calm (no chaotic AI magic, no noisy gradients) · Secure (every answer feels permissioned and source-grounded) · Intelligent (the UI understands relationships) · Developer-friendly (APIs, MCP, logs, context packs are first-class) · Enterprise-grade (polished tables, permissions, audit trails) · Alive (memory shows freshness, history, and change).

**Avoid:** Looking like Mintlify/docs nav, Notion/wiki pages, or a chatbot wrapper. No neon, glassmorphism, or sci-fi visuals. Never playful — this is serious company memory.

**Inspiration blend:** Airwallex-grade infrastructure + Harvey-grade trust + Mintlify-grade clarity + ReadMe-grade developer friendliness + SEEK-grade usability — without looking like any one of them.

---

## 3. Colour system

### One hue knob

Every surface and accent token derives from `--accent-hue` (default `248`). Accent presets (`data-accent="cyan|green|purple|rose|orange"`) change only that one number and let every token cascade through it — nothing is hand-tuned per accent. **Blue (248) is the product default and the brand;** presets exist as a theming capability, not a status vocabulary. Do not use a second accent hue to mean "agent" or "success."

### Core tokens (OKLCH — engine in `theme.css`)

| Token | OKLCH | ≈ Hex | Role |
|---|---|---|---|
| `--background` | `oklch(0.995 0 0)` | `#FEFEFE` | Main content, near-white |
| `--foreground` | `oklch(0.18 0.04 248)` | `#1B1D24` | Blue-ink text |
| `--card` | `oklch(1 0 0)` | `#FFFFFF` | Card surface |
| `--primary` | `oklch(50% 28% 248)` | `#0C5AA0` | **The ocean blue** — action + chrome rail |
| `--primary-foreground` | `oklch(0.98 0.01 248)` | `#FAFBFD` | On-primary; rail hover/active are opacity tints of this |
| `--secondary` / `--muted` / `--accent` | `oklch(0.946 0.011 248)` | `#E7EEF4` | Soft blue-grey fills |
| `--accent-foreground` | `oklch(0.52 0.13 248)` | `#3F73A8` | Accent text / icon emphasis |
| `--muted-foreground` | `oklch(0.4 0 0)` | `#666666` | Secondary text |
| `--destructive` | `oklch(0.56 0.21 9)` | `#E01E5A` | Irreversible/dangerous **only** |
| `--border` | `oklch(0.8 0 0)` | `#C7C7C7` | Structure |
| `--ring` | `oklch(0.52 0.13 248)` | `#3F73A8` | Focus |
| `--sidebar` | `oklch(0.95 0.03 248)` | `#E7EEF4` | Filetree / chat panels |
| `--chart-1…5` | hue offsets of 248 | — | Ocean-blue chart family (no rainbow) |

### Brand ocean ramp (hex reference)

Use these named values when authoring marketing surfaces and brand art that need explicit hex. They are the human-readable form of the same ocean system.

```css
/* Sky — light/mid ocean accents (icons, glows, live dots) */
--brand-sky-300: #6BA4D2;   --brand-sky-400: #3E84C3;
/* Blue — the deep ocean accent ramp */
--brand-blue-50:  #F1F6FC;  --brand-blue-100: #DCEAF8;
--brand-blue-500: #3F73A8;  /* emphasis text */
--brand-blue-600: #0C5AA0;  /* PRIMARY — deep ocean blue */
--brand-blue-700: #0B4775;  /* hover / press */
/* Deep ocean ramp (hue 248) — ink text + deep surfaces, NOT cold navy */
--brand-navy-700: #1C496E;  --brand-navy-800: #123E63;
--brand-navy-900: #0D3457;  --brand-navy-950: #0A2A45;  /* deepest surface + blue-ink */
/* Neutral ocean-greys — the ONE muted family for neutral/stale/redacted/request */
--brand-slate-400: #8AA0B4; --brand-slate-500: #5E7A95;
--brand-bg: #EDF2F8;        --brand-star: #F4FBFF;
```

> The deep surface in headers/footers is **deep ocean blue**, never a cold near-black navy. "Navy" tokens are repurposed as the dark end of the ocean ramp.

### Dark mode is a filter, not a palette

`html.dark { filter: invert(1) hue-rotate(180deg) contrast(var(--dark-contrast)) }`. `--dark-contrast` (default `0.72`) is the single dial — lower = softer/brighter dark UI, →1 = harder near-black. Full `invert(1)` is deliberate (only a full invert is self-inverse, which lets opted-out art restore exactly). **Do not** add `*-dark` tokens or `dark:` utilities — the `dark:` variant is intentionally neutralized. Brand logos, the nimbus mascot, photos, screenshots, and canvas/video carry `[data-keep-color]` to keep true colour.

---

## 4. Typography

One geometric sans for everything, one mono for technical strings.

- **`--font-sans` / display — Plus Jakarta Sans.** A single geometric humanist sans (a Circular/Airwallex-style substitute) used for *both* body and display. No separate serif display face. Vietnamese support required.
- **`--font-mono` — IBM Plex Mono.** Reserved for technical strings: paths, code, API/MCP payloads, logs, context-pack JSON, tabular metadata, and micro-labels.
- **Fallbacks:** `ui-sans-serif, system-ui, sans-serif` and `ui-monospace, SFMono-Regular, monospace`. The product app may resolve through CSS-var stacks to avoid web-font fetches; the brand face is Plus Jakarta Sans.

> This unifies the system on one type pairing and supersedes the apps' earlier Noto Sans + Asul-serif setup (and the brand draft's Geist/Fraunces proposal). There is no serif display face anywhere — `--font-display` resolves to the same geometric sans, so display headings get their weight from `font-semibold` + tight tracking, not a serif.

### Scale (compact, pragmatic)

| Token | Size / Line | Weight | Use |
|---|---|---|---|
| `display-lg` | 30 / 36, -0.02em | 700 | Hero / onboarding moments |
| `headline-md` | 18 / 24, -0.01em | 600 | Section headers |
| `title-sm` | 14 / 20 | 600 | Card titles, row leads |
| `body-md` | 14 / 22 | 400 | Default body |
| `body-sm` | 12 / 18 | 400 | Metadata, dense UI |
| `label-md` | 12 / 16 | 500 | Buttons, controls |
| `label-xs` | 11 / 14, 0.02em | 600 | Sentence-case categorical micro-labels |
| `code-md` | 12 / 18, mono | 400 | Code, paths, payloads |

**No all-caps text.** Never render text in uppercase (no `uppercase` /
`text-transform: uppercase`, no hand-typed ALL-CAPS strings). Micro-labels,
badges, breadcrumbs, and section headers use sentence case; hierarchy comes
from size, weight, color, and the mono face — not capitalization.

Headlines are crisp and ambitious. Product UI is compact but not dense. AI-generated content must always look **sourced and inspectable**, never mysterious.

---

## 5. Layout, elevation, shape, motion

- **Spacing** — 4px base unit. Dense controls 8–12px internal; standard cards/rows 12–16px; section grouping 24–40px. Panels and overlays are modular blocks that stack and resize with sidebars + inspector open at once.
- **Shape** — `--radius: 0.625rem`. Controls use `md` (≈0.5rem), cards/containers `lg`–`xl`, pills/status-dots/circular affordances `full`. Avoid sharp corners except for intentionally technical tabular/report treatments.
- **Elevation** — borders establish structure first; shadows are secondary and **tinted with the accent hue**. Standard cards ≈ `md`; overlays/floating UI climb to `lg`/`xl`. Frosted/blur is sparing — overlays and contextual chrome only.
- **Motion** — subtle and intelligent. Use for memory sync, source connection, context-pack generation, permission previews, trace expansion, relationship reveal. Signature motions: a soft **radial pulse** for a live memory update (`@keyframes radial-pulse`), and a **shimmer** travelling along diagram connectors for memory flow. Durations 150/200/400ms; easing `cubic-bezier(0.2,0,0,1)`; press scale `0.98`. Avoid constant glow, magical AI loaders, and spinning orbs. All ambient/decorative motion is gated by `prefers-reduced-motion: reduce`.

---

## 6. Product language & objects

Nimbase introduces its own vocabulary. Use it consistently in UI and copy.

### Memory Object — the atomic unit

Types: Customer · Project · Decision · Feature · Incident · Agent · Policy · Workflow memory. Each carries: summary · source references · owner · visibility · freshness · confidence · related objects · last-updated · agent-access status · customer-visibility status · audit history.

### Memory Card

Compact card for a structured memory: title, one-line claim, a status (monochrome), source count, access indicator, last-updated.

```text
Customer Promise
"Support SSO mapping by Q3"

Status: At risk            (deeper ink + label — never a red dot)
Source: Sales call + Slack confirmation
Visible to: Account Team, Product
Agent access: Restricted   (EyeOff / Lock icon)
Last updated: 2 days ago
```

### Context Pack

A curated, permissioned bundle of memory served to an employee, customer, app, or agent. Shows: included memories · excluded/redacted memories · reason for inclusion · permission boundary · freshness · token size · destination model/agent · source trace.

### Memory Layer

The system-level view of company memory — the primary metaphor for marketing and onboarding.

### Access states (monochrome vocabulary)

`Allowed` · `Restricted` · `Redacted` · `Request access` · `Agent-safe` (a.k.a. Agent-ready) · `Customer-visible` · `Internal-only`. Each is a **fill intensity + icon + label**, not a colour: e.g. Redacted → muted slate + `EyeOff`; Restricted → border + `Lock`; Agent-safe → ocean fill + `Bot`.

---

## 7. Component system

### Buttons

- **Primary** — `--primary` ocean fill, `--primary-foreground` text, hover → `--brand-blue-700`. For "Create context pack", "Connect source", "Book a demo".
- **Secondary** — white/transparent, soft ocean border, ink text. For "Preview", "Open source", "View trace".
- **Ghost** — transparent, foreground text, for low-emphasis inline actions.

> There is no separate "agent action" button colour. Agent actions use the same primary/secondary system, differentiated by label + `Bot` icon. (Removes the old purple agent button.)

### Cards

12–16px radius, soft border-first, minimal tinted shadow, a clear metadata row, monochrome status, source count, access indicator.

### Badges (monochrome)

Verified · Stale · Conflicting · Restricted · Customer-visible · Agent-ready · Internal-only · Source-backed · Needs review. All rendered as neutral/ocean intensity + icon + label. No semantic hue. Use `--destructive` only for genuinely dangerous/irreversible states.

### Tables

Enterprise-grade: sticky headers, clear filters, row-density controls, inline (monochrome) status badges, fast search, bulk actions. For sources, access logs, agent events, audit history, customer/project lists.

### Search

A primary interaction. Placeholders: "Search company memory…" · "Ask what your company knows…" · "Find customers, projects, decisions, sources…". Group results by Customers · Projects · Decisions · Sources · People · Agents.

### Empty states

Constructive and infrastructure-oriented. **Good:** "Connect your first source to start building company memory." **Avoid:** "Your knowledge base is empty."

### Iconography

Simple, geometric, line-based (Lucide), 1.5–2px stroke, rounded caps, legible at 16–20px. **No emoji.** Core metaphors: shell/shield = governance · star/compass = trusted answer · orbit/loop = memory lifecycle · nodes = relationships · key = access · clock = freshness · stack = memory layer · plug = source · bot = agent · eye = visibility · lock = restricted.

### Data visualization

Visualize memory health, not vanity metrics (freshness, source coverage, stale/conflicting counts, agent-access volume, customer-visible count, top risks). Clean charts, the ocean-blue `--chart-1…5` family, minimal gridlines, clear labels. No rainbow dashboards.

---

## 8. Signature screens

1. **Company Memory Home** — show memory is alive: recently updated, stale/conflicting, new customer/project signals, agent-access events, customer-visible updates, sources needing reconnection, weekly memory health.
2. **Customer Memory** — account summary, status, key people, promises made, open risks, recent activity, support history, product requests, related decisions, agent-ready context pack, customer-visible vs internal-only memory.
3. **Project Memory** — brief, current milestone, blockers, decisions, related GitHub/Linear work, Slack discussions, owners, changed-since-last-review, context pack for coding agents.
4. **Decision Memory** — summary, alternatives considered, rationale, source threads, participants, date, confidence, related objects, superseded-by/active.
5. **Agent Context Preview** — agent identity, requested task, memory included/excluded, permission rationale, redactions, source citations, token budget, audit trail. Shows what an agent is allowed to know *before* it acts.
6. **Access Matrix** — memory objects (rows) × Employees/Teams/Customers/Apps/Agents (columns); cell states from the monochrome access vocabulary above.

---

## 9. App shell direction

Left ocean **chrome rail** (`--primary`) for primary nav · top command/search bar · main content for memory objects · **right inspector panel** for sources, access rules, related objects, freshness, confidence, agent availability, audit history. The inspector is one of the most important patterns in Nimbase.

Primary nav: Home · Memory · Customers · Projects · Decisions · Agents · Access · Sources · Insights. **Avoid** Docs/Pages/Wiki/Notes — they pull the product toward Mintlify/Notion/Guru. The first screen is never a blank editor; it shows what changed, what's stale, what agents accessed, what customers can see, what decisions were made, what context is ready, and what needs human verification.

---

## 10. Copywriting voice

Clear, ambitious, trustworthy, slightly technical, not hype-heavy.

- **Good language:** memory · context · source · governed · permissioned · trusted · shared · living · agent-ready · source-backed · model-agnostic · company layer.
- **Avoid:** second brain · magic · supercharge · AI wiki · chat with your docs · RAG platform · knowledge base · docs for agents · autonomous everything.
- **Good copy:** "Your company memory, structured and permissioned." · "Give every employee, customer, app, and agent the context they're allowed to know." · "Trace every answer back to the source." · "Preview what this agent can remember before it acts."
- **Bad copy:** "Chat with your company knowledge." · "The AI wiki for your team." · "Your company's second brain."

---

## 11. Do's & don'ts

- **Do** keep surfaces neutral and reserve saturated ocean for action/state.
- **Do** drive every new colour from `--accent-hue` / existing tokens so presets and the invert keep working.
- **Do** express status with intensity + icon + label, and preserve compact app density on the 4px scale.
- **Don't** add green/amber/red/purple status, a purple "agent" accent, a second accent hue per view, or any emoji.
- **Don't** add a dark palette, `*-dark` tokens, or `dark:` utilities — dark mode is the global filter only.
- **Don't** introduce a separate chrome colour (the rail is `--primary`) or a serif display face.
- **Don't** use oversized radii or heavy shadow unless the UI is intentionally modal or heroic.

---

## 12. Implementation

- **Tokens:** `tooling/tailwind/theme.css` (OKLCH, hue knob, invert dark mode) is the engine — edit colour there, not in components.
- **Stack:** Tailwind + shadcn/ui + Radix primitives + Lucide icons. Plus Jakarta Sans + IBM Plex Mono. Framer Motion for subtle motion. React Flow only for controlled relationship maps.
- **Build first:** app shell · command/search · memory card · memory object page · source-trace panel · monochrome access-badge system · context-pack preview · memory-health dashboard · access matrix · source-connection list.

### North star

> Nimbase makes company memory feel like infrastructure: always on, always governed, always available to the right human or AI actor — rendered in one calm ocean, where every state is legible without a single extra colour.
