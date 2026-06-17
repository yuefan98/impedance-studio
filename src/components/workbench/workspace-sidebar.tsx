import type { Dataset, ModelTemplate, Run } from "@/lib/types";
import type { WorkbenchView } from "./types";
import { SidebarGroup, StatusBadge } from "./common";

export function WorkspaceSidebar({
  activeDatasetId,
  activeModelId,
  activeRunId,
  activeView,
  datasets,
  includedDatasetIds,
  models,
  runs,
  search,
  onDatasetPreview,
  onModelSelect,
  onRunSelect,
  onSearchChange,
  onViewChange,
}: {
  activeDatasetId: string;
  activeModelId: string;
  activeRunId: string;
  activeView: WorkbenchView;
  datasets: Dataset[];
  includedDatasetIds: string[];
  models: ModelTemplate[];
  runs: Run[];
  search: string;
  onDatasetPreview: (id: string) => void;
  onModelSelect: (model: ModelTemplate) => void;
  onRunSelect: (runId: string, itemId?: string) => void;
  onSearchChange: (value: string) => void;
  onViewChange: (view: WorkbenchView) => void;
}) {
  return (
    <aside className="studio-sidebar">
      <div className="sidebar-brand">
        <img className="app-logo" src="/logo.svg" alt="" />
        <div>
          <strong>Impedance Studio</strong>
          <span>Scientific workbench</span>
        </div>
      </div>

      <label className="sidebar-search">
        <span>Search</span>
        <input value={search} onChange={(event) => onSearchChange(event.target.value)} placeholder="Search datasets, runs, models" />
      </label>

      <nav className="view-switcher" aria-label="Workspace views">
        <button className={activeView === "runs" ? "active" : ""} onClick={() => onViewChange("runs")}>Runs</button>
        <button className={activeView === "database" ? "active" : ""} onClick={() => onViewChange("database")}>Data</button>
        <button className={activeView === "models" ? "active" : ""} onClick={() => onViewChange("models")}>Models</button>
      </nav>

      <SidebarGroup title="Fit selection" count={includedDatasetIds.length}>
        {datasets.filter((dataset) => includedDatasetIds.includes(dataset.id)).slice(0, 6).map((dataset) => (
          <button
            className={dataset.id === activeDatasetId ? "sidebar-run-row active" : "sidebar-run-row"}
            key={dataset.id}
            onClick={() => onDatasetPreview(dataset.id)}
          >
            <span>{dataset.name}</span>
            <small>{dataset.kind}</small>
          </button>
        ))}
        {!includedDatasetIds.length && <p className="empty-state">No datasets included in the next fit.</p>}
      </SidebarGroup>

      <SidebarGroup title="Recent runs" count={runs.length}>
        {runs.slice(0, 5).map((run) => (
          <button
            className={run.id === activeRunId ? "sidebar-run-row active" : "sidebar-run-row"}
            key={run.id}
            onClick={() => onRunSelect(run.id, run.items[0]?.id)}
          >
            <span>{String(run.summary?.run_name ?? run.mode)}</span>
            <small>{run.status} / {run.items.length} datasets</small>
          </button>
        ))}
        {!runs.length && <p className="empty-state">No fitting runs yet.</p>}
      </SidebarGroup>

      <SidebarGroup title="Models" count={models.length}>
        {models.slice(0, 5).map((model) => (
          <button
            className={model.id === activeModelId ? "sidebar-run-row active" : "sidebar-run-row"}
            key={model.id}
            onClick={() => onModelSelect(model)}
          >
            <span>{model.name}</span>
            <small>{model.kind}</small>
          </button>
        ))}
        {!models.length && <p className="empty-state">No saved models yet.</p>}
      </SidebarGroup>

      <div className="sidebar-footer">
        <StatusBadge tone="neutral">Local-first ready</StatusBadge>
      </div>
    </aside>
  );
}
