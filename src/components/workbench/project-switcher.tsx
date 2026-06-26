"use client";

import { useState } from "react";
import type { Health, Project } from "@/lib/types";
import { StatusBadge } from "./common";

export function ProjectSwitcher({
  activeProject,
  busy,
  health,
  newProjectName,
  projects,
  selectedCount,
  onCreateProject,
  onDeleteProject,
  onProjectNameChange,
  onProjectSelect,
}: {
  activeProject?: Project;
  busy: boolean;
  health?: Health | null;
  newProjectName: string;
  projects: Project[];
  selectedCount: number;
  onCreateProject: () => void;
  onDeleteProject: (project: Project) => void;
  onProjectNameChange: (name: string) => void;
  onProjectSelect: (id: string) => void;
}) {
  const [creating, setCreating] = useState(false);

  return (
    <header aria-label="Workspace context" className="control-bar">
      <div className="project-topline">
        <div className="context-summary">
          <span>Project</span>
          <strong>{activeProject?.name ?? "Local workspace"}</strong>
          <small>{health?.mode ?? "analysis adapter"} / {selectedCount} batch datasets selected</small>
        </div>
        <div className="project-actions">
          <StatusBadge tone={health?.ok ? "good" : "neutral"}>{health?.ok ? "API ready" : "Checking"}</StatusBadge>
          <button disabled={busy} onClick={() => setCreating((value) => !value)}>{creating ? "Close" : "New project"}</button>
          <button className="danger" disabled={!activeProject || busy || projects.length <= 1} onClick={() => activeProject && onDeleteProject(activeProject)}>
            Delete
          </button>
        </div>
      </div>
      <div className="project-switcher">
        <label>
          <span>Switch project</span>
          <select value={activeProject?.id ?? ""} onChange={(event) => onProjectSelect(event.target.value)}>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>{project.name}</option>
            ))}
          </select>
        </label>
        {creating && (
          <div className="project-create-row">
            <label>
              <span>New project name</span>
              <input value={newProjectName} onChange={(event) => onProjectNameChange(event.target.value)} />
            </label>
            <button
              className="primary"
              disabled={busy || !newProjectName.trim()}
              onClick={() => {
                onCreateProject();
                setCreating(false);
              }}
            >
              Create project
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
