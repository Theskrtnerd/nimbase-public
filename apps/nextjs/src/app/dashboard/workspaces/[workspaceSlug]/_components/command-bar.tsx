"use client";

import { SignOutButton, useClerk, useUser } from "@clerk/nextjs";
import { LogOutIcon, SearchIcon, UserIcon } from "lucide-react";

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

/**
 * The persistent top command bar (DESIGN.md §9). It rides in the ocean chrome
 * above the content card: memory search on the left, the account avatar on the
 * right. Search itself is the ⌘K command palette (WorkspaceSearch); this bar
 * is its always-visible trigger, not a second search engine.
 */
export function CommandBar({ onSearch }: { onSearch: () => void }) {
  return (
    <div className="grid h-12 shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-3 pr-3 pl-1">
      <div />

      <button
        type="button"
        onClick={onSearch}
        className={cn(
          "group flex h-8 w-full max-w-sm min-w-0 items-center gap-2 rounded-lg px-3 transition-colors sm:w-96",
          "bg-primary-foreground/10 hover:bg-primary-foreground/[0.16]",
          "text-primary-foreground/60 hover:text-primary-foreground/85",
        )}
      >
        <SearchIcon className="size-3.5 shrink-0" strokeWidth={2} />
        <span className="text-[12.5px]">Search company memory…</span>
        <kbd className="border-primary-foreground/20 text-primary-foreground/45 ml-auto hidden rounded border px-1.5 py-px font-mono text-[10px] sm:block">
          ⌘K
        </kbd>
      </button>

      <div className="flex shrink-0 items-center justify-end gap-1">
        <ProfileButton />
      </div>
    </div>
  );
}

/** Two-letter monogram for the avatar fallback when a user has no profile image. */
function monogramOf(name: string): string {
  const cleaned = name.trim();
  if (!cleaned) return "·";
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`.toUpperCase();
  }
  return cleaned.slice(0, 2).toUpperCase();
}

/**
 * Profile avatar + account menu, riding at the top-right of the ocean chrome.
 * The dropdown is built from our @acme/ui design system (mirrors the old
 * activity-bar account menu it replaced).
 */
function ProfileButton() {
  const { user } = useUser();
  const { openUserProfile } = useClerk();

  const email = user?.primaryEmailAddress?.emailAddress ?? null;
  const userName = user?.fullName ?? user?.username ?? email ?? "Account";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Account menu"
          className="group flex size-8 cursor-pointer items-center justify-center rounded-full"
        >
          <Avatar className="ring-primary-foreground/20 group-hover:ring-primary-foreground/45 group-data-[state=open]:ring-primary-foreground/45 size-7 ring-1 transition-shadow">
            <AvatarImage src={user?.imageUrl} alt="" />
            <AvatarFallback className="text-[10px] font-medium">
              {monogramOf(userName)}
            </AvatarFallback>
          </Avatar>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="bottom"
        align="end"
        sideOffset={8}
        className="w-60"
      >
        <DropdownMenuLabel className="flex flex-col gap-0.5 py-2">
          <span className="text-foreground truncate text-sm font-medium">
            {userName}
          </span>
          {email ? (
            <span className="text-muted-foreground truncate text-xs font-normal">
              {email}
            </span>
          ) : null}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="cursor-pointer"
          onSelect={() => openUserProfile()}
        >
          <UserIcon className="size-3.5" />
          Manage account
        </DropdownMenuItem>
        <SignOutButton redirectUrl="/login">
          <DropdownMenuItem className="cursor-pointer">
            <LogOutIcon className="size-3.5" />
            Sign out
          </DropdownMenuItem>
        </SignOutButton>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
