"use client";

import type { LucideIcon } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import {
  BuildingIcon,
  CreditCardIcon,
  PlugIcon,
  ShieldIcon,
  SparklesIcon,
  UsersIcon,
} from "lucide-react";

import { useTRPC } from "~/trpc/react";

// Canonical list of settings sub-sections. The activity bar renders these as
// its nav while settings is open; settings-panel.tsx renders one pane per id.
// Keep this union, SECTIONS/GOD_SECTION, and the pane map in sync.
export type SettingsSectionId =
  | "general"
  | "people"
  | "integrations"
  | "ai"
  | "billing"
  | "god";

export interface SettingsSection {
  id: SettingsSectionId;
  label: string;
  hint: string;
  icon: LucideIcon;
}

export const GENERAL_SECTION: SettingsSection = {
  id: "general",
  label: "General",
  hint: "Workspace identity and how Nimbase looks",
  icon: BuildingIcon,
};

const SECTIONS: SettingsSection[] = [
  GENERAL_SECTION,
  {
    id: "people",
    label: "Members",
    hint: "Who belongs to this workspace, and what they can reach",
    icon: UsersIcon,
  },
  {
    id: "integrations",
    label: "Connections",
    hint: "Keep memory current and make it available to your AI tools",
    icon: PlugIcon,
  },
  {
    id: "ai",
    label: "AI models",
    hint: "Model choices for this workspace; blank fields inherit the default",
    icon: SparklesIcon,
  },
  {
    id: "billing",
    label: "Billing",
    hint: "Plan, usage, and payment method",
    icon: CreditCardIcon,
  },
];

// Operator-only section, appended when the god gate opens.
const GOD_SECTION: SettingsSection = {
  id: "god",
  label: "God mode",
  hint: "Operator controls: global AI models, and this workspace's plan",
  icon: ShieldIcon,
};

// There is no dedicated "am I a god?" endpoint — the operator-gated
// `aiConfig.get` query IS the signal: it throws FORBIDDEN for everyone else.
// AiModelsSettings runs the same query, so this shares one cache entry.
// If a second god-only section ever lands, replace this with a real
// `operator.whoami` endpoint rather than widening the piggyback.
function useIsGod(): boolean {
  const trpc = useTRPC();
  const query = useQuery(
    trpc.aiConfig.get.queryOptions(undefined, { retry: false }),
  );
  return query.isSuccess;
}

/** The sections this user may see, in nav order. */
export function useSettingsSections(): SettingsSection[] {
  return useIsGod() ? [...SECTIONS, GOD_SECTION] : SECTIONS;
}
