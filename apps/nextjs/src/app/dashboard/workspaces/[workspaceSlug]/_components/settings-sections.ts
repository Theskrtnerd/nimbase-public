"use client";

import type { LucideIcon } from "lucide-react";
import { BuildingIcon, PlugIcon, SparklesIcon, UsersIcon } from "lucide-react";

// Canonical list of settings sub-sections. The activity bar renders these as
// its nav while settings is open; settings-panel.tsx renders one pane per id.
// Keep this union, SECTIONS, and the pane map in sync.
export type SettingsSectionId = "general" | "people" | "integrations" | "ai";

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
];

/** The sections this user may see, in nav order. */
export function useSettingsSections(): SettingsSection[] {
  return SECTIONS;
}
