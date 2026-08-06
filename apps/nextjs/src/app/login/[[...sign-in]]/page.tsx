import { ClerkProvider, SignIn } from "@clerk/nextjs";

import { AuthShell } from "~/app/_components/auth-shell";
import { clerkAppearance } from "~/app/_components/clerk-appearance";

export default function LoginPage() {
  return (
    <ClerkProvider>
      <AuthShell
        title="Sign in from the Nimbase CLI."
        subtitle="This browser step securely returns you to the terminal that started the login."
      >
        <SignIn
          path="/login"
          routing="path"
          signUpUrl="/sign-up"
          fallbackRedirectUrl="/"
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
    </ClerkProvider>
  );
}
