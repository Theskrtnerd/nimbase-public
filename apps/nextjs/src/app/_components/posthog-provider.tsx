"use client";

import { useEffect } from "react";
import { useUser } from "@clerk/nextjs";
import posthog from "posthog-js";
import { PostHogProvider as PHProvider, usePostHog } from "posthog-js/react";

import { env } from "~/env";

// Product analytics. Stays completely dark when NEXT_PUBLIC_POSTHOG_KEY is
// unset (same "dark unless configured" pattern as Langfuse tracing), so local
// dev and unconfigured environments send nothing.
//
// Events are sent to the same-origin `/ingest` path, which next.config.js
// reverse-proxies to PostHog — keeping analytics first-party and out of
// ad-blocker reach. Pageviews (including client-side App Router navigations)
// are captured automatically by the `2025-05-24` defaults.
export function PostHogProvider({ children }: { children: React.ReactNode }) {
  // posthog.init talks to the browser SDK (an external system, not React
  // state), so initializing it in an effect is the correct use of one. It runs
  // once on mount; the library guards against double-init.
  useEffect(() => {
    if (!env.NEXT_PUBLIC_POSTHOG_KEY) return;
    posthog.init(env.NEXT_PUBLIC_POSTHOG_KEY, {
      api_host: "/ingest",
      ui_host: env.NEXT_PUBLIC_POSTHOG_HOST,
      defaults: "2025-05-24",
    });
  }, []);

  if (!env.NEXT_PUBLIC_POSTHOG_KEY) return <>{children}</>;

  return (
    <PHProvider client={posthog}>
      <PostHogIdentify />
      {children}
    </PHProvider>
  );
}

// Keeps the PostHog person in sync with Clerk auth: identify on sign-in, reset
// on sign-out. This bridges an external SDK to auth state, so an effect is the
// right tool — there's no React state to derive from.
function PostHogIdentify() {
  const { user, isLoaded } = useUser();
  const posthog = usePostHog();

  const userId = user?.id;
  const email = user?.primaryEmailAddress?.emailAddress;
  const name = user?.fullName ?? undefined;

  useEffect(() => {
    if (!isLoaded) return;
    if (userId) {
      posthog.identify(userId, { email, name });
    } else {
      posthog.reset();
    }
  }, [isLoaded, userId, email, name, posthog]);

  return null;
}
