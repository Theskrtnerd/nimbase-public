"use client";

import { usePathname } from "next/navigation";

import { ThemeToggleButton } from "./theme-toggle-button";

// Floating top-right theme toggle for non-workspace routes. The workspace
// view renders its own toggle inside the title bar, so this one bows out
// there to avoid two togglers fighting for the same corner. Auth screens
// (login / sign-up) are theme-less for now — they stay on the default light
// look, so no toggle there either.
const HIDDEN_PREFIXES = ["/dashboard/workspaces/", "/login", "/sign-up"];

export function GlobalThemeToggle() {
  const pathname = usePathname();

  if (
    pathname === "/dashboard" ||
    HIDDEN_PREFIXES.some((prefix) => pathname.startsWith(prefix))
  ) {
    return null;
  }

  return (
    <div className="fixed top-4 right-4 z-50">
      <ThemeToggleButton />
    </div>
  );
}
