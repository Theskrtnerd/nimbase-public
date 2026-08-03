"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { SignOutButton } from "@clerk/nextjs";

import { Button } from "@acme/ui/button";

import { AuthShell } from "~/app/_components/auth-shell";
import { CreateWorkspaceForm } from "./create-workspace-form";
import { ImportStep } from "./import-step";
import { InvitesStep } from "./invites-step";

type WizardStep = "company" | "import" | "invites";

const TOTAL_STEPS = 3;

const STEPS: Record<
  WizardStep,
  {
    current: number;
    label: string;
    title: string;
    subtitle: string;
    cardSubtitle: string;
  }
> = {
  company: {
    current: 1,
    label: "Your company",
    title: "Set up your workspace",
    subtitle: "Add your company details to get started.",
    cardSubtitle: "",
  },
  import: {
    current: 2,
    label: "Import",
    title: "Bring in what you already have",
    subtitle:
      "Existing docs are the fastest way to fill the brain. Everything you import compiles into company memory.",
    cardSubtitle:
      "Upload files or a .zip export — or skip and capture as you go.",
  },
  invites: {
    current: 3,
    label: "Your team",
    title: "Invite your team",
    subtitle: "Company memory grows from every teammate's captures.",
    cardSubtitle:
      "Invite teammates now, or skip and do it later from Settings.",
  },
};

export function OnboardingWizard({
  firstName,
  initialWorkspace,
}: {
  firstName: string | null;
  initialWorkspace?: { id: string; slug: string };
}) {
  const router = useRouter();
  const [step, setStep] = useState<WizardStep>("company");
  const [workspaceId, setWorkspaceId] = useState<string | null>(
    () => initialWorkspace?.id ?? null,
  );
  const workspaceSlugRef = useRef(initialWorkspace?.slug ?? null);

  const meta = STEPS[step];
  const finish = () => {
    if (workspaceSlugRef.current) {
      router.replace(`/dashboard/workspaces/${workspaceSlugRef.current}`);
    }
  };

  const cardTitle = step === "company" ? "Your company" : meta.label;

  return (
    <AuthShell
      step={{ current: meta.current, total: TOTAL_STEPS, label: meta.label }}
      title={
        step === "company" && firstName ? `Welcome, ${firstName}` : meta.title
      }
      subtitle={meta.subtitle}
    >
      <div className="bg-card/80 ring-border/60 flex flex-col gap-6 rounded-2xl p-6 shadow-xl ring-1 backdrop-blur-sm sm:p-8">
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col">
            <h2 className="text-foreground text-[22px] font-semibold tracking-tight">
              {cardTitle}
            </h2>
            {meta.cardSubtitle ? (
              <p className="text-muted-foreground text-[13.5px] leading-5">
                {meta.cardSubtitle}
              </p>
            ) : null}
          </div>
          <SignOutButton redirectUrl="/login">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-foreground -mt-1 h-8 px-2 text-[12.5px]"
            >
              Sign out
            </Button>
          </SignOutButton>
        </div>

        {step === "company" ? (
          <CreateWorkspaceForm
            onCreated={({ id, slug }) => {
              setWorkspaceId(id);
              workspaceSlugRef.current = slug;
              setStep("import");
            }}
          />
        ) : null}
        {step === "import" && workspaceId ? (
          <ImportStep
            workspaceId={workspaceId}
            onDone={() => setStep("invites")}
          />
        ) : null}
        {step === "invites" && workspaceId ? (
          <InvitesStep workspaceId={workspaceId} onDone={finish} />
        ) : null}
      </div>
    </AuthShell>
  );
}
