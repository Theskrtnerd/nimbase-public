import {
  AlertCircleIcon,
  AlertTriangleIcon,
  CheckCircleIcon,
  FlameIcon,
  InfoIcon,
} from "lucide-react";

import { cn } from "@acme/ui";
import {
  AccordionContent,
  AccordionItem,
  Accordion as AccordionRoot,
  AccordionTrigger,
} from "@acme/ui/accordion";
import {
  Card as BaseCard,
  CardContent as BaseCardContent,
  CardDescription as BaseCardDescription,
  CardFooter as BaseCardFooter,
  CardHeader as BaseCardHeader,
  CardTitle as BaseCardTitle,
  CardAction,
} from "@acme/ui/card";

// ---------------------------------------------------------------------------
// Card — thin MDX-specific wrappers. The base shadcn Card has wider use across
// the app; we only adjust spacing/weight here to fit the prose context.
// ---------------------------------------------------------------------------

type CardProps = React.ComponentProps<"div">;

export function Card({ className, ...props }: CardProps) {
  return (
    <BaseCard
      className={cn("border-border/70 my-5 rounded-lg shadow-none", className)}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: CardProps) {
  return <BaseCardHeader className={cn("pb-3", className)} {...props} />;
}

export function CardTitle({ className, ...props }: CardProps) {
  return (
    <BaseCardTitle
      className={cn("text-base font-semibold tracking-tight", className)}
      {...props}
    />
  );
}

export function CardDescription({ className, ...props }: CardProps) {
  return <BaseCardDescription className={className} {...props} />;
}

export function CardContent({ className, ...props }: CardProps) {
  return <BaseCardContent className={className} {...props} />;
}

export function CardFooter({ className, ...props }: CardProps) {
  return (
    <BaseCardFooter
      className={cn(
        "border-border/60 text-muted-foreground border-t pt-3 text-xs",
        className,
      )}
      {...props}
    />
  );
}

export { CardAction };

// ---------------------------------------------------------------------------
// Callout — Notion-style left rail. Body text stays neutral; only the rail and
// icon carry the variant tone.
// ---------------------------------------------------------------------------

const CALLOUT_VARIANTS = {
  info: {
    icon: InfoIcon,
    rail: "border-l-blue-500/70",
    bg: "bg-blue-500/[0.04]",
    iconColor: "text-blue-500 dark:text-blue-400",
  },
  warning: {
    icon: AlertTriangleIcon,
    rail: "border-l-yellow-500/70",
    bg: "bg-yellow-500/[0.04]",
    iconColor: "text-yellow-600 dark:text-yellow-400",
  },
  error: {
    icon: AlertCircleIcon,
    rail: "border-l-red-500/70",
    bg: "bg-red-500/[0.04]",
    iconColor: "text-red-500 dark:text-red-400",
  },
  success: {
    icon: CheckCircleIcon,
    rail: "border-l-green-500/70",
    bg: "bg-green-500/[0.04]",
    iconColor: "text-green-600 dark:text-green-400",
  },
  tip: {
    icon: FlameIcon,
    rail: "border-l-purple-500/70",
    bg: "bg-purple-500/[0.04]",
    iconColor: "text-purple-500 dark:text-purple-400",
  },
} as const;

type CalloutVariant = keyof typeof CALLOUT_VARIANTS;

interface CalloutProps {
  type?: CalloutVariant;
  title?: string;
  children?: React.ReactNode;
}

export function Callout({ type = "info", title, children }: CalloutProps) {
  const variant = CALLOUT_VARIANTS[type];
  const Icon = variant.icon;

  return (
    <div
      className={cn(
        "border-y-border/60 border-r-border/60 text-foreground/85 my-5 flex gap-3 rounded-lg border-y border-r border-l-4 p-4",
        variant.rail,
        variant.bg,
      )}
    >
      <Icon className={cn("mt-0.5 size-4 shrink-0", variant.iconColor)} />
      <div className="min-w-0 flex-1">
        {title && (
          <div className="mb-1.5 text-sm font-semibold tracking-tight">
            {title}
          </div>
        )}
        <div className="text-sm leading-7 [&>p]:mb-0 [&>p+p]:mt-2">
          {children}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Accordion (wraps shadcn accordion for simpler MDX authoring)
// ---------------------------------------------------------------------------
// Usage in MDX:
//   <Accordion>
//     <AccordionSection title="Section 1">Content here</AccordionSection>
//     <AccordionSection title="Section 2">More content</AccordionSection>
//   </Accordion>

interface AccordionSectionProps {
  title: string;
  children?: React.ReactNode;
}

export function AccordionSection({ title, children }: AccordionSectionProps) {
  return (
    <AccordionItem
      value={title}
      className="border-border/40 border-b last:border-b-0"
    >
      <AccordionTrigger className="hover:bg-muted/30 px-4 py-3 text-sm font-medium transition-colors">
        {title}
      </AccordionTrigger>
      <AccordionContent>
        <div className="text-foreground/85 px-4 pt-1 pb-4 text-sm leading-7">
          {children}
        </div>
      </AccordionContent>
    </AccordionItem>
  );
}

interface AccordionProps {
  type?: "single" | "multiple";
  children?: React.ReactNode;
}

export function Accordion({ type = "multiple", children }: AccordionProps) {
  const className =
    "border-border/70 bg-card/30 my-4 overflow-hidden rounded-lg border";
  if (type === "single") {
    return (
      <AccordionRoot type="single" collapsible className={className}>
        {children}
      </AccordionRoot>
    );
  }
  return (
    <AccordionRoot type="multiple" className={className}>
      {children}
    </AccordionRoot>
  );
}
