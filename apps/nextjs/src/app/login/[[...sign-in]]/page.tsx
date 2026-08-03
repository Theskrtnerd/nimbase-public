import { SignIn } from "@clerk/nextjs";

import { AuthShell } from "~/app/_components/auth-shell";
import { clerkAppearance } from "~/app/_components/clerk-appearance";

export default function LoginPage() {
  return (
    <AuthShell
      title="Sign in to your workspaces."
      subtitle="Pick up your company memory, sources, and agents right where you left them."
    >
      <SignIn
        path="/login"
        routing="path"
        signUpUrl="/sign-up"
        fallbackRedirectUrl="/dashboard"
        appearance={clerkAppearance}
      />

      <p className="text-muted-foreground text-[12px] leading-5">
        By continuing you agree to the{" "}
        <a
          href="https://nimbase.ai/terms"
          target="_blank"
          rel="noreferrer"
          className="text-foreground underline-offset-4 hover:underline"
        >
          Terms
        </a>{" "}
        and{" "}
        <a
          href="https://nimbase.ai/privacy"
          target="_blank"
          rel="noreferrer"
          className="text-foreground underline-offset-4 hover:underline"
        >
          Privacy Policy
        </a>
        .
      </p>
    </AuthShell>
  );
}
