import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";

import { isAllowedRedirect } from "~/lib/allowed-redirect";
import { issueAuthCode } from "~/lib/desktop-auth";

// PKCE authorize page for native clients, including the CLI. The /desktop/*
// route path is legacy naming kept for compatibility.
interface Props {
  searchParams: Promise<{
    challenge?: string;
    state?: string;
    redirect?: string;
  }>;
}

const DEFAULT_REDIRECT = "nimbase://auth/callback";

// JSON.stringify does not HTML-escape, so a "</script>" in the value (e.g. a
// redirect URL smuggled through the `redirect` query param) would break out
// of the inline <script> below. Escape `<` so it can never terminate the tag.
function jsonForScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

export default async function DesktopAuthorizePage({ searchParams }: Props) {
  const params = await searchParams;
  const challenge = params.challenge;
  const state = params.state;
  const redirectBase = params.redirect ?? DEFAULT_REDIRECT;

  if (!challenge || !state) {
    return (
      <ErrorPage
        title="Missing parameters"
        body="The client did not provide a valid authorization request."
      />
    );
  }

  if (!isAllowedRedirect(redirectBase)) {
    return (
      <ErrorPage
        title="Invalid redirect"
        body="Only nimbase:// and https://*.chromiumapp.org redirects are allowed."
      />
    );
  }

  const { userId } = await auth();
  if (!userId) {
    const back = `/desktop/authorize?challenge=${encodeURIComponent(
      challenge,
    )}&state=${encodeURIComponent(state)}&redirect=${encodeURIComponent(
      redirectBase,
    )}`;
    redirect(`/login?redirect_url=${encodeURIComponent(back)}`);
  }

  const code = issueAuthCode({ userId, challenge, state });
  const callback = `${redirectBase}?code=${encodeURIComponent(
    code,
  )}&state=${encodeURIComponent(state)}`;

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-6 px-6 text-center">
      <h1 className="text-xl font-semibold">Sign in complete</h1>
      <p className="text-muted-foreground text-sm">
        Return to Nimbase to finish signing in. You can close this window once
        it has reopened.
      </p>
      <a
        href={callback}
        className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-md px-4 py-2 text-sm font-medium"
      >
        Open Nimbase
      </a>
      <script
        dangerouslySetInnerHTML={{
          __html: `setTimeout(function(){window.location.replace(${jsonForScript(
            callback,
          )})},250)`,
        }}
      />
    </main>
  );
}

function ErrorPage({ title, body }: { title: string; body: string }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-3 px-6 text-center">
      <h1 className="text-lg font-semibold">{title}</h1>
      <p className="text-muted-foreground text-sm">{body}</p>
    </main>
  );
}
