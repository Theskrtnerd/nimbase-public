"use client";

import { useState } from "react";

import type { ActiveView } from "./activity-bar";
import type { MemoryMode } from "./notes-view";
import type { SettingsSectionId } from "./settings-sections";
import { ActivityBar } from "./activity-bar";
import { CommandBar } from "./command-bar";
import { GENERAL_SECTION, useSettingsSections } from "./settings-sections";
import { WorkspaceSearch } from "./workspace-search";
import { WorkspaceView } from "./workspace-view";

interface WorkspaceShellProps {
  initialSettingsSection?: SettingsSectionId;
  workspace: {
    id: string;
    name: string;
    description: string | null;
    createdAt: Date;
  };
}

export function WorkspaceShell({
  workspace,
  initialSettingsSection,
}: WorkspaceShellProps) {
  const [activeView, setActiveView] = useState<ActiveView>("home");
  const [settingsOpen, setSettingsOpen] = useState(
    () => initialSettingsSection !== undefined,
  );
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [activityBarExpanded, setActivityBarExpanded] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);
  // Which lens the Memory view is showing (reader vs. connection graph). Lives
  // here so Home's "Connections" card can deep-link straight into the graph.
  const [memoryMode, setMemoryMode] = useState<MemoryMode>("read");
  const [settingsSectionId, setSettingsSectionId] = useState<SettingsSectionId>(
    () => initialSettingsSection ?? "general",
  );

  // God-only sections can disappear mid-session (the operator query refetches
  // and fails), so resolve against the live list and fall back to General.
  const settingsSections = useSettingsSections();
  const settingsSection =
    settingsSections.find((s) => s.id === settingsSectionId) ?? GENERAL_SECTION;

  // Switch views from the rail or the Home dashboard; always leave the
  // settings panel when navigating.
  function navigate(view: ActiveView) {
    setActiveView(view);
    setSettingsOpen(false);
  }

  // Opening a memory (from the graph, search, or Home) jumps to the Memory
  // view's reader.
  function openNote(nodeId: string) {
    setSelectedNoteId(nodeId);
    setMemoryMode("read");
    navigate("notes");
  }

  /** Memory view, connections lens — how Home's Connections card lands. */
  function openConnections() {
    setMemoryMode("graph");
    navigate("notes");
  }

  return (
    <div className="flex h-screen w-full overflow-hidden">
      <ActivityBar
        workspace={{ id: workspace.id, name: workspace.name }}
        activeView={activeView}
        onChangeView={navigate}
        onSettings={() => setSettingsOpen((v) => !v)}
        settingsOpen={settingsOpen}
        settingsSections={settingsSections}
        activeSettingsSection={settingsSection.id}
        onChangeSettingsSection={setSettingsSectionId}
        onExitSettings={() => setSettingsOpen(false)}
        expanded={activityBarExpanded}
        onToggleExpanded={() =>
          setActivityBarExpanded((prevExpanded) => !prevExpanded)
        }
      />

      <div className="bg-primary flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <CommandBar onSearch={() => setSearchOpen(true)} />
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <div className="bg-sidebar relative mr-2 mb-2 flex min-h-0 flex-1 overflow-hidden rounded-2xl">
            <WorkspaceView
              workspace={workspace}
              activeView={activeView}
              settingsOpen={settingsOpen}
              settingsSection={settingsSection}
              onCloseSettings={() => setSettingsOpen(false)}
              selectedNoteId={selectedNoteId}
              onSelectNote={setSelectedNoteId}
              onOpenNote={openNote}
              onNavigate={navigate}
              memoryMode={memoryMode}
              onChangeMemoryMode={setMemoryMode}
              onOpenConnections={openConnections}
            />
          </div>
        </div>
      </div>

      <WorkspaceSearch
        workspaceId={workspace.id}
        open={searchOpen}
        onOpenChange={setSearchOpen}
        onOpenNote={openNote}
      />
    </div>
  );
}
