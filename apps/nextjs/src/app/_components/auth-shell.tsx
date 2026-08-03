import type { StaticImageData } from "next/image";
import type { ReactNode } from "react";
import Image from "next/image";

import nimbaseLogoSrc from "@acme/ui/assets/logo.svg";

const nimbaseLogo = nimbaseLogoSrc as StaticImageData;

interface AuthShellProps {
  step?: { current: number; total: number; label: string };
  eyebrow?: string;
  title: string;
  subtitle?: string;
  children: ReactNode;
}

export function AuthShell({
  step,
  eyebrow = "nimbase",
  title,
  subtitle,
  children,
}: AuthShellProps) {
  return (
    <main className="bg-background grid min-h-screen lg:grid-cols-[minmax(0,_460px)_minmax(0,_1fr)]">
      <aside className="bg-primary text-primary-foreground relative flex flex-col overflow-hidden px-8 py-10 lg:px-12 lg:py-14">
        <div className="flex items-center gap-2.5 select-none">
          <div className="cosmos-logo-shell">
            <Image
              src={nimbaseLogo}
              alt="Nimbase"
              data-keep-color
              priority
              className="cosmos-logo-mark size-[34px]"
            />
          </div>
          <span className="-translate-y-px text-xl leading-none font-bold tracking-tight">
            {eyebrow}
          </span>
        </div>

        <div className="flex flex-1 flex-col justify-center gap-7 py-10">
          <div className="relative mx-auto flex h-44 w-44 items-center justify-center sm:h-52 sm:w-52">
            <div aria-hidden className="cosmos-nimbus-halo" />
            <Image
              src="/nimbus.png"
              alt="Nimbus, the Nimbase agent"
              data-keep-color
              priority
              width={224}
              height={224}
              className="cosmos-nimbus-mark animate-float relative z-10 size-40 object-contain sm:size-48"
            />
          </div>

          {step ? (
            <div className="text-primary-foreground/70 flex items-center gap-3 text-[11px] font-semibold">
              <span>
                Step {step.current} of {step.total}
              </span>
              <span className="bg-primary-foreground/25 h-px flex-1" />
              <span>{step.label}</span>
            </div>
          ) : null}

          <h1 className="max-w-sm text-3xl leading-[1.15] font-semibold tracking-tight lg:text-[34px]">
            {title}
          </h1>

          {subtitle ? (
            <p className="text-primary-foreground/75 max-w-sm text-sm leading-6">
              {subtitle}
            </p>
          ) : null}
        </div>
      </aside>

      <section className="relative flex items-center justify-center overflow-hidden px-6 py-12 sm:px-10">
        <div
          aria-hidden
          className="cosmos-star-map pointer-events-none absolute inset-0 opacity-90"
        />
        <div
          aria-hidden
          className="cosmos-atmosphere pointer-events-none absolute inset-0"
        />
        <div className="relative z-10 flex w-full max-w-[420px] flex-col gap-6">
          {children}
        </div>
      </section>
    </main>
  );
}
