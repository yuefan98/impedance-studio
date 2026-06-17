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
  return (
    <header aria-label="Workspace context" className="control-bar">
      <div className="context-summary">
        <span>Project</span>
        <strong>{activeProject?.name ?? "Local workspace"}</strong>
        <small>{health?.mode ?? "analysis adapter"} / {selectedCount} fit datasets selected</small>
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
        <label>
          <span>New project name</span>
          <input value={newProjectName} onChange={(event) => onProjectNameChange(event.target.value)} />
        </label>
        <div className="project-actions">
          <StatusBadge tone={health?.ok ? "good" : "neutral"}>{health?.ok ? "API ready" : "Checking"}</StatusBadge>
          <button disabled={busy} onClick={onCreateProject}>Add project</button>
          <button className="danger" disabled={!activeProject || busy || projects.length <= 1} onClick={() => activeProject && onDeleteProject(activeProject)}>
            Delete project
          </button>
        </div>
      </div>
    </header>
  );
}
