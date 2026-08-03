import type { LucideIcon } from "lucide-react";
import {
  BotIcon,
  CheckIcon,
  ClockIcon,
  EyeIcon,
  EyeOffIcon,
  Loader2Icon,
  LockIcon,
  TriangleAlertIcon,
  UploadCloudIcon,
  UsersIcon,
} from "lucide-react";

import { cn } from "@acme/ui";

/**
 * The monochrome status + access vocabulary (DESIGN.md §0 rule 2 / §6 / §7).
 *
 * State is read by intensity + icon + label — never by hue. The one chromatic
 * exception, `--destructive`, is reserved for irreversible *actions* (delete),
 * so it is intentionally absent here: even "Failed" and "Restricted" stay
 * monochrome ocean. Higher intensity = more attention warranted.
 */

type Tone = "ocean" | "ocean-soft" | "muted" | "ink" | "ink-dashed";

const TONE_CLASS: Record<Tone, string> = {
  // Action / positive — the calm saturated ocean accent.
  ocean: "bg-primary/10 text-primary border-primary/20",
  // Secondary ocean emphasis — softer than `ocean`, for agent/customer reach.
  "ocean-soft":
    "bg-accent-foreground/10 text-accent-foreground border-accent-foreground/25",
  // Neutral resting / in-progress / redacted.
  muted: "bg-muted text-muted-foreground border-border",
  // Deep ink — demands attention (failed, restricted).
  ink: "bg-foreground/5 text-foreground/75 border-foreground/20",
  // Deep ink, awaiting an action.
  "ink-dashed": "bg-muted/50 text-muted-foreground border-dashed border-border",
};

function StatusPill({
  icon: Icon,
  label,
  tone,
  spin = false,
  className,
}: {
  icon: LucideIcon;
  label: string;
  tone: Tone;
  spin?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[10px] font-semibold",
        TONE_CLASS[tone],
        className,
      )}
    >
      <Icon
        className={cn("size-3 shrink-0", spin && "animate-spin")}
        strokeWidth={2}
      />
      {label}
    </span>
  );
}

/* ---------------------------------------------------------------- access --- */

export type AccessState =
  | "allowed"
  | "agent-safe"
  | "customer-visible"
  | "internal-only"
  | "restricted"
  | "redacted"
  | "request-access";

const ACCESS: Record<
  AccessState,
  { icon: LucideIcon; label: string; tone: Tone }
> = {
  allowed: { icon: CheckIcon, label: "Allowed", tone: "ocean" },
  "agent-safe": { icon: BotIcon, label: "Agent-safe", tone: "ocean-soft" },
  "customer-visible": {
    icon: EyeIcon,
    label: "Customer-visible",
    tone: "ocean-soft",
  },
  "internal-only": { icon: UsersIcon, label: "Internal-only", tone: "muted" },
  restricted: { icon: LockIcon, label: "Restricted", tone: "ink" },
  redacted: { icon: EyeOffIcon, label: "Redacted", tone: "muted" },
  "request-access": {
    icon: ClockIcon,
    label: "Request access",
    tone: "ink-dashed",
  },
};

export function AccessBadge({
  state,
  className,
}: {
  state: AccessState;
  className?: string;
}) {
  const { icon, label, tone } = ACCESS[state];
  return (
    <StatusPill icon={icon} label={label} tone={tone} className={className} />
  );
}

/* -------------------------------------------------------------- compile --- */

export type CompileState =
  | "compiled"
  | "processing"
  | "extracting"
  | "uploading"
  | "pending"
  | "held"
  | "failed";

const COMPILE: Record<
  CompileState,
  { icon: LucideIcon; label: string; tone: Tone; spin?: boolean }
> = {
  compiled: { icon: CheckIcon, label: "Compiled", tone: "ocean" },
  processing: {
    icon: Loader2Icon,
    label: "Compiling",
    tone: "muted",
    spin: true,
  },
  extracting: {
    icon: Loader2Icon,
    label: "Extracting",
    tone: "muted",
    spin: true,
  },
  uploading: { icon: UploadCloudIcon, label: "Uploading", tone: "muted" },
  pending: { icon: ClockIcon, label: "Queued", tone: "muted" },
  held: { icon: ClockIcon, label: "Permission held", tone: "ink" },
  failed: { icon: TriangleAlertIcon, label: "Failed", tone: "ink" },
};

export function CompileStatusBadge({
  state,
  className,
}: {
  state: CompileState;
  className?: string;
}) {
  const { icon, label, tone, spin } = COMPILE[state];
  return (
    <StatusPill
      icon={icon}
      label={label}
      tone={tone}
      spin={spin}
      className={className}
    />
  );
}
