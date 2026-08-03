"use client";

import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import {
  ArrowLeftIcon,
  BookOpenIcon,
  GithubIcon,
  HomeIcon,
  InboxIcon,
  LayersIcon,
  LayoutTemplateIcon,
  LifeBuoyIcon,
  MessageSquarePlusIcon,
  PanelLeftIcon,
  PlugZapIcon,
  SettingsIcon,
} from "lucide-react";
import { domAnimation, LazyMotion, m } from "motion/react";

import { cn } from "@acme/ui";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@acme/ui/tooltip";

import type { SettingsSection, SettingsSectionId } from "./settings-sections";
import { env } from "~/env";
import { WorkspaceSwitcher } from "./workspace-switcher";

// Canonical list of workspace views. Keep this union in sync with
// PRIMARY_VIEWS/SECONDARY_VIEWS below and the routing branches in
// workspace-view.tsx.
export type ActiveView =
  | "home"
  | "chat"
  | "notes"
  | "sources"
  | "artifacts"
  | "consumers";

const COLLAPSED_WIDTH = 48;
const EXPANDED_WIDTH = 248;
const BAR_TRANSITION = {
  duration: 0.22,
  ease: [0.16, 1, 0.3, 1],
} as const;

const ACTIVITY_ICON_SLOT = "flex size-5 shrink-0 items-center justify-center";
const ACTIVITY_ICON_CLASS = "size-[18px] shrink-0";
const ACTIVITY_ICON_STROKE = 1.75;
const COLLAPSED_BUTTON =
  "relative flex h-10 w-full cursor-pointer items-center justify-center rounded-lg transition-colors duration-150";
const EXPANDED_BUTTON =
  "relative flex h-10 w-full cursor-pointer items-center justify-start gap-2.5 rounded-lg px-3 transition-colors duration-150";
const HOVER_BG_BASE =
  "bg-primary-foreground/10 pointer-events-none absolute rounded-lg opacity-0 transition-opacity duration-150 group-hover:opacity-100";
// Collapsed: a centered square behind the icon. Expanded: a full-width pill.
const hoverBgShape = (expanded: boolean) =>
  expanded
    ? "inset-y-0.5 inset-x-0.5"
    : "inset-y-0.5 left-1/2 aspect-square -translate-x-1/2";

interface ViewDef {
  id: ActiveView;
  icon: LucideIcon;
  title: string;
  description: string;
}

const PRIMARY_VIEWS: ViewDef[] = [
  {
    id: "home",
    icon: HomeIcon,
    title: "Home",
    description: "What changed, what's stale, what agents accessed",
  },
  {
    id: "notes",
    icon: LayersIcon,
    title: "Memory",
    description: "Browse compiled memory & how it connects",
  },
  {
    id: "chat",
    icon: MessageSquarePlusIcon,
    title: "Capture",
    description: "Chat-style quick capture — text, files, images, video",
  },
];

const SECONDARY_VIEWS: ViewDef[] = [
  {
    id: "sources",
    icon: InboxIcon,
    title: "Sources",
    description: "Captured pages, threads & highlights",
  },
  {
    id: "artifacts",
    icon: LayoutTemplateIcon,
    title: "Artifacts",
    description: "Generate & share AI artifacts",
  },
  {
    id: "consumers",
    icon: PlugZapIcon,
    title: "Consumers",
    description: "Agents, MCPs, widgets & tokens — and what each can read",
  },
];

interface ActivityBarProps {
  workspace: { id: string; name: string };
  activeView: ActiveView;
  onChangeView: (view: ActiveView) => void;
  onSettings?: () => void;
  settingsOpen?: boolean;
  /** Settings sub-sections, shown in place of the views while settings is open. */
  settingsSections?: SettingsSection[];
  activeSettingsSection?: SettingsSectionId;
  onChangeSettingsSection?: (id: SettingsSectionId) => void;
  /** Leaves settings and restores the view nav (the "Back" row). */
  onExitSettings?: () => void;
  expanded?: boolean;
  onToggleExpanded?: () => void;
}

export function ActivityBar({
  workspace,
  activeView,
  onChangeView,
  onSettings,
  settingsOpen = false,
  settingsSections = [],
  activeSettingsSection,
  onChangeSettingsSection,
  onExitSettings,
  expanded = false,
  onToggleExpanded,
}: ActivityBarProps) {
  // The bar swaps its whole nav when settings opens. Both halves need the
  // handlers to be wired, or we'd render a dead-end menu with no way back.
  const inSettings =
    settingsOpen && !!onChangeSettingsSection && !!onExitSettings;

  return (
    <LazyMotion features={domAnimation}>
      <TooltipProvider delayDuration={150}>
        <m.div
          layout
          className={cn(
            "bg-primary flex h-full shrink-0 flex-col items-stretch overflow-hidden pb-4",
            expanded ? "px-2 pt-2" : "pt-1.5",
          )}
          initial={false}
          style={{ width: expanded ? EXPANDED_WIDTH : COLLAPSED_WIDTH }}
          transition={BAR_TRANSITION}
        >
          {onToggleExpanded ? (
            <ActivityBarTopSlot
              workspace={workspace}
              expanded={expanded}
              onToggleExpanded={onToggleExpanded}
              onSettings={onSettings}
            />
          ) : null}

          {inSettings ? (
            <nav className="flex flex-col gap-0.5">
              <NavButton
                icon={ArrowLeftIcon}
                title="Back"
                description="Leave settings and return to the workspace"
                isActive={false}
                onClick={onExitSettings}
                expanded={expanded}
              />

              <BarDivider expanded={expanded} />

              {settingsSections.map((section) => (
                <NavButton
                  key={section.id}
                  icon={section.icon}
                  title={section.label}
                  description={section.hint}
                  isActive={section.id === activeSettingsSection}
                  onClick={() => onChangeSettingsSection(section.id)}
                  expanded={expanded}
                />
              ))}
            </nav>
          ) : (
            <nav className="flex flex-col gap-0.5">
              {PRIMARY_VIEWS.map((view) => (
                <NavButton
                  key={view.id}
                  icon={view.icon}
                  title={view.title}
                  description={view.description}
                  isActive={!settingsOpen && view.id === activeView}
                  onClick={() => onChangeView(view.id)}
                  expanded={expanded}
                />
              ))}

              {SECONDARY_VIEWS.map((view) => (
                <NavButton
                  key={view.id}
                  icon={view.icon}
                  title={view.title}
                  description={view.description}
                  isActive={!settingsOpen && view.id === activeView}
                  onClick={() => onChangeView(view.id)}
                  expanded={expanded}
                />
              ))}

              {onSettings ? (
                <NavButton
                  icon={SettingsIcon}
                  title="Settings"
                  description="Workspace settings & members"
                  isActive={settingsOpen}
                  onClick={onSettings}
                  expanded={expanded}
                />
              ) : null}
            </nav>
          )}

          <div className="mt-auto" />
          <div className="flex flex-col gap-0.5">
            <NavLink
              icon={GithubIcon}
              title="Source"
              description="Nimbase source code"
              href={env.NEXT_PUBLIC_NIMBASE_SOURCE_URL}
              expanded={expanded}
            />
            <NavLink
              icon={BookOpenIcon}
              title="Docs"
              description="Product documentation"
              href="https://docs.nimbase.ai"
              expanded={expanded}
            />
            <NavLink
              icon={LifeBuoyIcon}
              title="Support"
              description="Email the Nimbase team"
              href="mailto:support@nimbase.ai"
              expanded={expanded}
            />
          </div>
        </m.div>
      </TooltipProvider>
    </LazyMotion>
  );
}

/** Fixed-height header slot — crossfades expand/collapse controls without layout jumps. */
function ActivityBarTopSlot({
  workspace,
  expanded,
  onToggleExpanded,
  onSettings,
}: {
  workspace: { id: string; name: string };
  expanded: boolean;
  onToggleExpanded: () => void;
  onSettings?: () => void;
}) {
  return (
    <div className="relative mb-3 h-10 shrink-0">
      <m.div
        className="absolute inset-0"
        initial={false}
        animate={{ opacity: expanded ? 1 : 0 }}
        transition={{ duration: 0.15 }}
        style={{ pointerEvents: expanded ? "auto" : "none" }}
      >
        <ActivityBarExpandedHeader
          workspace={workspace}
          onToggleExpanded={onToggleExpanded}
          onSettings={onSettings}
        />
      </m.div>

      <m.div
        className="absolute inset-0"
        initial={false}
        animate={{ opacity: expanded ? 0 : 1 }}
        transition={{ duration: 0.15 }}
        style={{ pointerEvents: expanded ? "none" : "auto" }}
      >
        <BarIconButton
          label="Expand activity bar"
          onClick={onToggleExpanded}
          isActive={false}
          expanded={false}
        >
          <PanelLeftIcon
            className={ACTIVITY_ICON_CLASS}
            strokeWidth={ACTIVITY_ICON_STROKE}
          />
        </BarIconButton>
      </m.div>
    </div>
  );
}

function ActivityBarExpandedHeader({
  workspace,
  onToggleExpanded,
  onSettings,
}: {
  workspace: { id: string; name: string };
  onToggleExpanded: () => void;
  onSettings?: () => void;
}) {
  return (
    <div className="flex h-10 items-center gap-1 px-0.5">
      <WorkspaceSwitcher workspace={workspace} onSettings={onSettings} />

      <div className="flex shrink-0 items-center gap-0.5">
        <BarIconButton
          label="Collapse activity bar"
          onClick={onToggleExpanded}
          isActive
          expanded
          compact
        >
          <PanelLeftIcon
            className={ACTIVITY_ICON_CLASS}
            strokeWidth={ACTIVITY_ICON_STROKE}
          />
        </BarIconButton>
      </div>
    </div>
  );
}

function BarIconButton({
  label,
  onClick,
  isActive,
  expanded,
  compact = false,
  children,
}: {
  label: string;
  onClick: () => void;
  isActive: boolean;
  expanded: boolean;
  compact?: boolean;
  children: ReactNode;
}) {
  return (
    <m.button
      type="button"
      aria-label={label}
      onClick={onClick}
      whileTap={{ scale: 0.94 }}
      className={cn(
        compact
          ? "text-primary-foreground/65 hover:text-primary-foreground flex size-7 cursor-pointer items-center justify-center rounded-md transition-colors"
          : expanded
            ? EXPANDED_BUTTON
            : COLLAPSED_BUTTON,
        !compact && isActive && "text-primary-foreground",
        !compact &&
          !isActive &&
          "text-primary-foreground/55 hover:text-primary-foreground",
        compact && isActive && "text-primary-foreground",
      )}
    >
      {compact ? (
        children
      ) : (
        <span className={ACTIVITY_ICON_SLOT}>{children}</span>
      )}
    </m.button>
  );
}

/** Hairline between "Back" and the settings sections; inset to match the rows. */
function BarDivider({ expanded }: { expanded: boolean }) {
  return (
    <div
      aria-hidden
      className={cn(
        "bg-primary-foreground/15 my-1.5 h-px",
        expanded ? "mx-3" : "mx-2.5",
      )}
    />
  );
}

function ActivityIcon({
  icon: Icon,
  className,
}: {
  icon: LucideIcon;
  className?: string;
}) {
  return (
    <span className={ACTIVITY_ICON_SLOT}>
      <Icon
        className={cn(ACTIVITY_ICON_CLASS, className)}
        strokeWidth={ACTIVITY_ICON_STROKE}
      />
    </span>
  );
}

function ActivityBarLabel({
  expanded,
  isActive = false,
  children,
}: {
  expanded: boolean;
  isActive?: boolean;
  children: string;
}) {
  return (
    <span
      aria-hidden={!expanded}
      className={cn(
        "relative z-10 overflow-hidden text-[13px] font-medium whitespace-nowrap transition-[opacity,max-width] duration-200 ease-out",
        isActive ? "text-primary-foreground" : "text-primary-foreground/80",
        expanded
          ? "max-w-[160px] opacity-100 delay-75"
          : "max-w-0 opacity-0 delay-0",
      )}
    >
      {children}
    </span>
  );
}

function NavButton({
  icon,
  title,
  description,
  isActive,
  onClick,
  expanded,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  isActive: boolean;
  onClick: () => void;
  expanded: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <m.button
          type="button"
          aria-label={title}
          aria-current={isActive ? "page" : undefined}
          onClick={onClick}
          whileTap={{ scale: 0.94 }}
          className={cn(
            "group",
            expanded ? EXPANDED_BUTTON : COLLAPSED_BUTTON,
            isActive
              ? "text-primary-foreground"
              : "text-primary-foreground/55 hover:text-primary-foreground",
          )}
        >
          {/* Active: a filled pill behind the row. Inactive: hover tint only. */}
          {isActive ? (
            <span
              aria-hidden
              className={cn(
                "bg-primary-foreground/15 pointer-events-none absolute rounded-lg",
                hoverBgShape(expanded),
              )}
            />
          ) : (
            <span
              aria-hidden
              className={cn(HOVER_BG_BASE, hoverBgShape(expanded))}
            />
          )}

          <ActivityIcon
            icon={icon}
            className={
              isActive
                ? "text-primary-foreground"
                : "text-primary-foreground/55 group-hover:text-primary-foreground"
            }
          />
          <ActivityBarLabel expanded={expanded} isActive={isActive}>
            {title}
          </ActivityBarLabel>
        </m.button>
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={8}>
        <TooltipBody title={title} description={description} />
      </TooltipContent>
    </Tooltip>
  );
}

/** Same look as NavButton, but an external link (Docs, Support). */
function NavLink({
  icon,
  title,
  description,
  href,
  expanded,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  href: string;
  expanded: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <m.a
          href={href}
          target="_blank"
          rel="noreferrer"
          aria-label={title}
          whileTap={{ scale: 0.94 }}
          className={cn(
            "group",
            expanded ? EXPANDED_BUTTON : COLLAPSED_BUTTON,
            "text-primary-foreground/55 hover:text-primary-foreground",
          )}
        >
          <span
            aria-hidden
            className={cn(HOVER_BG_BASE, hoverBgShape(expanded))}
          />
          <ActivityIcon
            icon={icon}
            className="text-primary-foreground/55 group-hover:text-primary-foreground"
          />
          <ActivityBarLabel expanded={expanded}>{title}</ActivityBarLabel>
        </m.a>
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={8}>
        <TooltipBody title={title} description={description} />
      </TooltipContent>
    </Tooltip>
  );
}

function TooltipBody({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs leading-none font-medium">{title}</span>
      <span className="text-background/70 text-[10px] leading-none">
        {description}
      </span>
    </div>
  );
}
