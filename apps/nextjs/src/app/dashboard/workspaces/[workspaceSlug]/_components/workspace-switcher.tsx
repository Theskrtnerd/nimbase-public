"use client";

import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  CheckIcon,
  ChevronsUpDownIcon,
  PlusIcon,
  SettingsIcon,
} from "lucide-react";

import { cn } from "@acme/ui";
import { Avatar, AvatarFallback, AvatarImage } from "@acme/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@acme/ui/dropdown-menu";

import { monogramOf, paletteFor } from "~/lib/workspace-monogram";
import { useTRPC } from "~/trpc/react";

interface WorkspaceSwitcherProps {
  workspace: { id: string; name: string };
  onSettings?: () => void;
}

function WorkspaceMark({
  name,
  logoUrl,
  size,
}: {
  name: string;
  logoUrl?: string | null;
  size: "current" | "menu";
}) {
  const palette = paletteFor(name);

  return (
    <Avatar
      size="sm"
      className={cn("rounded-md", size === "menu" && "size-5 rounded")}
    >
      {logoUrl ? (
        <AvatarImage src={logoUrl} alt="" className="object-cover" />
      ) : null}
      <AvatarFallback
        delayMs={logoUrl ? 150 : undefined}
        className={cn(
          palette.bg,
          palette.fg,
          "rounded-md text-[11px] font-semibold tracking-tight",
          size === "menu" && "rounded text-[10px]",
        )}
      >
        {monogramOf(name)}
      </AvatarFallback>
    </Avatar>
  );
}

export function WorkspaceSwitcher({
  workspace,
  onSettings,
}: WorkspaceSwitcherProps) {
  const router = useRouter();
  const trpc = useTRPC();
  const { data: workspaces } = useQuery(trpc.workspace.all.queryOptions());
  const { data: logoUrls } = useQuery(
    trpc.workspace.logoUrls.queryOptions(undefined, {
      staleTime: 5 * 60 * 1000,
      retry: false,
    }),
  );

  // Prefer the live query entry, falling back to the server-rendered prop
  // before the list query resolves.
  const liveName =
    workspaces?.find((w) => w.id === workspace.id)?.name ?? workspace.name;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Switch workspace"
          className="hover:bg-primary-foreground/10 data-[state=open]:bg-primary-foreground/10 flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-lg py-1 pr-1 pl-1.5 transition-colors"
        >
          <span aria-hidden="true">
            <WorkspaceMark
              name={liveName}
              logoUrl={logoUrls?.[workspace.id]}
              size="current"
            />
          </span>
          <span className="text-primary-foreground min-w-0 flex-1 truncate text-left text-sm font-semibold tracking-tight">
            {liveName}
          </span>
          <ChevronsUpDownIcon className="text-primary-foreground/60 size-3.5 shrink-0" />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        side="bottom"
        align="start"
        sideOffset={6}
        className="w-64"
      >
        <DropdownMenuLabel className="text-muted-foreground text-[11px] font-medium">
          Workspaces
        </DropdownMenuLabel>
        {(workspaces ?? []).map((w) => {
          const isCurrent = w.id === workspace.id;
          return (
            <DropdownMenuItem
              key={w.id}
              className="cursor-pointer gap-2"
              onSelect={() => {
                if (!isCurrent) router.push(`/dashboard/workspaces/${w.slug}`);
              }}
            >
              <WorkspaceMark
                name={w.name}
                logoUrl={logoUrls?.[w.id]}
                size="menu"
              />
              <span className="min-w-0 flex-1 truncate">{w.name}</span>
              {isCurrent ? <CheckIcon className="size-3.5 shrink-0" /> : null}
            </DropdownMenuItem>
          );
        })}

        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="cursor-pointer"
          onSelect={() => router.push("/onboarding/workspace/new")}
        >
          <PlusIcon className="size-3.5" />
          New workspace
        </DropdownMenuItem>
        {onSettings ? (
          <DropdownMenuItem
            className="cursor-pointer"
            onSelect={() => onSettings()}
          >
            <SettingsIcon className="size-3.5" />
            Workspace settings
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
