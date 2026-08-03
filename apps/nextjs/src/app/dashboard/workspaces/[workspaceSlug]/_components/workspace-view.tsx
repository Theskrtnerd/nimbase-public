"use client";

import type { ReactNode } from "react";

import type { ActiveView } from "./activity-bar";
import type { MemoryMode } from "./notes-view";
import type { SettingsSection } from "./settings-sections";
import { ArtifactView } from "./artifact-view";
import { ChatCaptureView } from "./chat-capture-view";
import { ConsumersView } from "./consumers-view";
import { HomeView } from "./home-view";
import { NotesView } from "./notes-view";
import { SettingsPanel } from "./settings-panel";
import { SourcesView } from "./sources-view";

interface WorkspaceViewProps {
  workspace: {
    id: string;
    name: string;
    description: string | null;
    createdAt: Date;
  };
  activeView: ActiveView;
  settingsOpen: boolean;
  settingsSection: SettingsSection;
  onCloseSettings: () => void;
  selectedNoteId: string | null;
  onSelectNote: (nodeId: string) => void;
  onOpenNote: (nodeId: string) => void;
  onNavigate: (view: ActiveView) => void;
  memoryMode: MemoryMode;
  onChangeMemoryMode: (mode: MemoryMode) => void;
  onOpenConnections: () => void;
}

export function WorkspaceView({
  workspace,
  activeView,
  settingsOpen,
  settingsSection,
  onCloseSettings,
  selectedNoteId,
  onSelectNote,
  onOpenNote,
  onNavigate,
  memoryMode,
  onChangeMemoryMode,
  onOpenConnections,
}: WorkspaceViewProps) {
  if (settingsOpen) {
    return (
      <SettingsPanel
        workspace={workspace}
        section={settingsSection}
        onClose={onCloseSettings}
      />
    );
  }

  // Exhaustive view map. Typed as Record<ActiveView, ReactNode>, so adding an
  // ActiveView member without a branch here is a compile error — no silent
  // fallthrough. (Unrendered elements are cheap objects; only the returned one
  // mounts.)
  const views: Record<ActiveView, ReactNode> = {
    home: (
      <HomeView
        workspaceId={workspace.id}
        workspaceName={workspace.name}
        onOpenNote={onOpenNote}
        onNavigate={onNavigate}
        onOpenConnections={onOpenConnections}
      />
    ),
    notes: (
      <NotesView
        workspaceId={workspace.id}
        selectedId={selectedNoteId}
        onSelectNote={onSelectNote}
        mode={memoryMode}
        onChangeMode={onChangeMemoryMode}
      />
    ),
    chat: <ChatCaptureView workspaceId={workspace.id} />,
    sources: <SourcesView workspaceId={workspace.id} />,
    artifacts: <ArtifactView workspaceId={workspace.id} />,
    consumers: <ConsumersView workspaceId={workspace.id} />,
  };
  return views[activeView];
}
