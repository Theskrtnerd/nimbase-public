// Map Clerk to Nimbase tokens. Color tokens go through `variables` so Clerk
// generates focus/hover shades correctly; structural slots use `elements` with
// Tailwind classes against our tokens.
export const clerkAppearance = {
  variables: {
    colorPrimary: "oklch(50% 28% var(--accent-hue))",
    colorBackground: "var(--card)",
    colorText: "var(--foreground)",
    colorTextSecondary: "var(--muted-foreground)",
    colorInputBackground: "var(--card)",
    colorInputText: "var(--foreground)",
    colorDanger: "var(--destructive)",
    colorNeutral: "var(--foreground)",
    borderRadius: "0.5rem",
    fontFamily: "var(--font-app-sans)",
    fontSize: "14px",
  },
  elements: {
    rootBox: "w-full",
    cardBox: "w-full shadow-none border-0",
    card: "bg-card/90 supports-[backdrop-filter]:backdrop-blur-md border border-border rounded-xl shadow-sm p-6",
    logoBox: "hidden",
    logoImage: "hidden",
    headerTitle: "text-foreground text-[22px] font-semibold tracking-tight",
    headerSubtitle: "text-muted-foreground text-[13.5px] leading-5",
    main: "gap-4",
    socialButtonsBlockButton:
      "bg-card border border-border text-foreground hover:bg-secondary rounded-md h-10 text-sm font-medium transition-colors",
    socialButtonsBlockButtonText: "text-sm font-medium",
    dividerLine: "bg-border",
    dividerText:
      "text-muted-foreground text-[11px] font-semibold tracking-[0.08em] uppercase",
    formFieldLabel: "text-foreground text-[13px] font-medium",
    formFieldInput:
      "bg-card border border-input text-foreground rounded-md h-10 px-3 text-sm focus:border-ring focus:ring-ring/40 focus:ring-2 outline-none transition-colors",
    formFieldInputShowPasswordButton:
      "text-muted-foreground hover:text-foreground",
    formButtonPrimary:
      "bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/95 rounded-md h-10 text-sm font-medium tracking-tight normal-case shadow-xs transition-colors",
    formFieldAction: "text-primary hover:text-primary/80 text-[13px]",
    footer: "bg-transparent",
    footerAction: "text-muted-foreground text-[13px]",
    footerActionLink: "text-primary hover:text-primary/80 font-medium",
    identityPreview: "bg-secondary border border-border rounded-md",
    identityPreviewText: "text-foreground text-sm",
    identityPreviewEditButton: "text-primary hover:text-primary/80",
    otpCodeFieldInput:
      "bg-card border border-input rounded-md text-foreground focus:border-ring focus:ring-ring/40 focus:ring-2",
    alert: "bg-secondary border border-border text-foreground rounded-md",
    alertText: "text-foreground text-sm",
    formResendCodeLink: "text-primary hover:text-primary/80",
    formFieldSuccessText: "text-[13px]",
    formFieldErrorText: "text-destructive text-[12.5px]",
    badge: "bg-secondary text-secondary-foreground",
  },
  layout: {
    socialButtonsPlacement: "top" as const,
    socialButtonsVariant: "blockButton" as const,
    showOptionalFields: false,
  },
};
