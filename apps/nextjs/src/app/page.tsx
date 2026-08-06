import type { StaticImageData } from "next/image";
import Image from "next/image";

import nimbaseLogoSrc from "@acme/ui/assets/logo.svg";

const nimbaseLogo = nimbaseLogoSrc as StaticImageData;

export default function HomePage() {
  return (
    <main className="relative isolate min-h-screen overflow-hidden bg-[#f6f9ff] text-[#12233f]">
      <div
        aria-hidden
        className="cosmos-star-map pointer-events-none absolute inset-0 opacity-55"
      />
      <div
        aria-hidden
        className="absolute top-[-16rem] right-[-12rem] -z-10 size-[38rem] rounded-full bg-[#d8e9ff] opacity-70 blur-3xl"
      />

      <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-6 py-8 sm:px-10 lg:px-16 lg:py-12">
        <header className="flex items-center gap-2.5">
          <Image src={nimbaseLogo} alt="" priority className="size-9" />
          <span className="text-xl font-bold tracking-tight">nimbase</span>
        </header>

        <section className="grid flex-1 items-center gap-14 py-16 lg:grid-cols-[minmax(0,1.15fr)_minmax(22rem,0.85fr)] lg:py-24">
          <div className="max-w-3xl">
            <p className="font-mono text-xs font-semibold tracking-[0.18em] text-[#316ca8] uppercase">
              CLI-first · Web UI archived
            </p>
            <h1 className="mt-6 text-5xl leading-[0.98] font-semibold tracking-[-0.05em] text-balance sm:text-6xl lg:text-7xl">
              Company memory,
              <br />
              from your terminal.
            </h1>
            <p className="mt-7 max-w-2xl text-base leading-7 text-[#52637c] sm:text-lg sm:leading-8">
              The Nimbase dashboard is paused while we focus on the capture,
              compile, and share systems underneath it. The CLI is the primary
              interface for Nimbase Cloud and Community Edition.
            </p>
          </div>

          <div className="border-l border-[#bfd1e7] pl-6 sm:pl-8">
            <p className="text-sm font-semibold text-[#273c5b]">
              Start in your terminal
            </p>
            <pre className="mt-4 overflow-x-auto rounded-2xl bg-[#10233e] px-5 py-5 font-mono text-sm leading-7 text-[#e7f1ff] shadow-[0_24px_70px_-36px_rgba(28,68,112,0.6)]">
              <code>{`npm install --global nimbase
nimbase auth login
nimbase workspace create https://example.com`}</code>
            </pre>

            <p className="mt-7 text-sm leading-6 text-[#63748c]">
              Self-hosting Community Edition? Point the same CLI at your
              installation with{" "}
              <code className="font-mono text-[#274b74]">NIMBASE_API_URL</code>.
            </p>

            <div className="mt-8 flex flex-wrap gap-x-6 gap-y-3 text-sm font-semibold">
              <a
                href="https://github.com/Theskrtnerd/nimbase-public/tree/main/apps/cli"
                className="text-[#245f9c] underline decoration-[#9bb9d8] underline-offset-4 transition-colors hover:text-[#163f6a]"
              >
                CLI reference
              </a>
              <a
                href="https://github.com/Theskrtnerd/nimbase-public/blob/main/docs/self-hosting.md"
                className="text-[#245f9c] underline decoration-[#9bb9d8] underline-offset-4 transition-colors hover:text-[#163f6a]"
              >
                Self-hosting guide
              </a>
            </div>
          </div>
        </section>

        <footer className="border-t border-[#d6e1ef] pt-6 text-sm text-[#73839a]">
          Authentication, REST, MCP, workers, widgets, artifacts, and shares
          remain available.
        </footer>
      </div>
    </main>
  );
}
