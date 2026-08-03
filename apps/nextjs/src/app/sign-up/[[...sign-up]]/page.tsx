import { SignUp } from "@clerk/nextjs";

import { AuthShell } from "~/app/_components/auth-shell";
import { clerkAppearance } from "~/app/_components/clerk-appearance";

export default function SignUpPage() {
  return (
    <AuthShell
      step={{ current: 1, total: 2, label: "Create account" }}
      title="Create your Nimbase account."
      subtitle="The secure memory layer your team and agents will share."
    >
      <div className="flex flex-col gap-1.5">
        <h2 className="text-foreground text-[22px] font-semibold tracking-tight">
          Create your account
        </h2>
        <p className="text-muted-foreground text-[13.5px] leading-5">
          You'll name your first workspace next.
        </p>
      </div>

      <SignUp
        path="/sign-up"
        routing="path"
        signInUrl="/login"
        fallbackRedirectUrl="/onboarding/workspace"
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
