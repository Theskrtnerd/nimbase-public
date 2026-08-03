"use client";

import { ThemeToggle } from "@acme/ui/theme";

export function AppearanceSettings() {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 className="text-foreground text-[13px] font-medium">Appearance</h2>
        <p className="text-muted-foreground text-[12px] leading-5">
          Choose how Nimbase looks on this device.
        </p>
      </div>

      <div className="bg-card border-border flex items-center justify-between gap-3 rounded-xl border p-4">
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-foreground text-[13px] font-medium">Theme</p>
          <p className="text-muted-foreground text-[12px] leading-5">
            Light, dark, or match your system setting.
          </p>
        </div>
        <ThemeToggle />
      </div>
    </section>
  );
}
