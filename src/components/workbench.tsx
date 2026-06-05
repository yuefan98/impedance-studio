"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { analysisClient } from "@/lib/analysis-client";
import type { CircuitValidation, Dataset, DatasetRow, Health, ModelTemplate, Project, Run } from "@/lib/types";

type Status = "idle" | "loading" | "ready" | "error";
type WorkbenchView = "runs" | "database" | "models";
type PlotView = "nyquist" | "bode" | "second";

const DEFAULT_IMPORT =
  "frequency,z_real,z_imag\n1000,0.84,-0.02\n100,1.8,-1.1\n10,7.1,-4.8\n1,14.7,-12.2";

export function Workbench() {
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [models, setModels] = useState<ModelTemplate[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string>("");
  const [selectedDatasetIds, setSelectedDatasetIds] = useState<string[]>([]);
  const [activeDatasetId, setActiveDatasetId] = useState<string>("");
  const [activeModelId, setActiveModelId] = useState<string>("");
  const [activeView, setActiveView] = useState<WorkbenchView>("runs");
  const [plotView, setPlotView] = useState<PlotView>("nyquist");
  const [circuit1, setCircuit1] = useState("RC0");
  const [circuit2, setCircuit2] = useState("RCn0");
  const [initialGuess, setInitialGuess] = useState("0.84, 15.2, 0.001, 0.84");
  const [importText, setImportText] = useState(DEFAULT_IMPORT);
  const [validation, setValidation] = useState<CircuitValidation | null>(null);
  const [search, setSearch] = useState("");
  const [projectName, setProjectName] = useState("New project");
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const activeProject = projects.find((project) => project.id === activeProjectId);
  const activeDataset = datasets.find((dataset) => dataset.id === activeDatasetId) ?? datasets[0];
  const activeModel = models.find((model) => model.id === activeModelId) ?? models[0];
  const latestRun = runs[0];
  const latestItem = latestRun?.items?.find((item) => item.dataset_id === activeDataset?.id) ?? latestRun?.items?.[0];
  const activeResult = latestItem?.result;
  const selectedDatasets = datasets.filter((dataset) => selectedDatasetIds.includes(dataset.id));
  const templates = models.filter((model) => model.kind !== "snapshot");
  const snapshots = models.filter((model) => model.kind === "snapshot");
  const filteredDatasets = filterDatasets(datasets, search);
  const filteredModels = filterModels(models, search);
  const fitReady = Boolean(activeProjectId && activeModelId && (activeDatasetId || selectedDatasetIds.length));

  const refresh = useCallback(async (projectIdOverride?: string) => {
    setStatus("loading");
    setError(null);
    try {
      const healthResult = await analysisClient.health();
      const projectResult = await analysisClient.projects();
      const nextProjectId = projectIdOverride || activeProjectId || projectResult.projects[0]?.id || "";
      const [datasetResult, modelResult, runResult] = await Promise.all([
        analysisClient.datasets(nextProjectId),
        analysisClient.models(nextProjectId),
        analysisClient.runs(nextProjectId),
      ]);
      setHealth(healthResult);
      setProjects(projectResult.projects);
      setDatasets(datasetResult.datasets);
      setModels(modelResult.models);
      setRuns(runResult.runs);
      setActiveProjectId(nextProjectId);
      setActiveDatasetId((current) =>
        datasetResult.datasets.some((dataset) => dataset.id === current) ? current : datasetResult.datasets[0]?.id || "",
      );
      setSelectedDatasetIds((current) =>
        current.filter((id) => datasetResult.datasets.some((dataset) => dataset.id === id)).length
          ? current.filter((id) => datasetResult.datasets.some((dataset) => dataset.id === id))
          : datasetResult.datasets.slice(0, 3).map((dataset) => dataset.id),
      );
      setActiveModelId((current) =>
        modelResult.models.some((model) => model.id === current) ? current : modelResult.models[0]?.id || "",
      );
      if (modelResult.models[0]) {
        setCircuit1((current) => current || modelResult.models[0].circuit_1);
        setCircuit2((current) => current || modelResult.models[0].circuit_2);
      }
      setStatus("ready");
    } catch (caught) {
      setStatus("error");
      setError(caught instanceof Error ? caught.message : "Unable to reach local analysis service.");
    }
  }, [activeProjectId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!activeModel) return;
    setCircuit1(activeModel.circuit_1);
    setCircuit2(activeModel.circuit_2);
    if (activeModel.initial_guess?.length) {
      setInitialGuess(activeModel.initial_guess.join(", "));
    }
  }, [activeModel?.id]);

  const guessValues = useMemo(
    () =>
      initialGuess
        .split(",")
        .map((value) => Number(value.trim()))
        .filter((value) => Number.isFinite(value)),
    [initialGuess],
  );

  async function runAction(label: string, action: () => Promise<void>) {
    setBusyAction(label);
    try {
      await action();
    } finally {
      setBusyAction(null);
    }
  }

  async function validateCircuit() {
    await runAction("validate", async () => {
      const result = await analysisClient.validateCircuit({
        circuit_1: circuit1,
        circuit_2: circuit2,
        initial_guess: guessValues,
        constants: {},
      });
      setValidation(result.validation);
    });
  }

  async function saveTemplate() {
    await runAction("save", async () => {
      await analysisClient.saveModel({
        project_id: activeProjectId,
        name: `${circuit1} / ${circuit2} template`,
        kind: "template",
        scope: "project",
        circuit_1: circuit1,
        circuit_2: circuit2,
        initial_guess: guessValues,
        constants: {},
        bounds: { lower: guessValues.map(() => 0), upper: guessValues.map(() => "inf") },
        shared_parameters: [`${circuit1}_0 -> ${circuit2}_0`],
      });
      await refresh();
    });
  }

  async function createProject() {
    const name = projectName.trim();
    if (!name) return;
    await runAction("project", async () => {
      const result = await analysisClient.createProject({ name });
      setActiveProjectId(result.project.id);
      setActiveDatasetId("");
      setSelectedDatasetIds([]);
      setActiveModelId("");
      setProjectName("New project");
      await refresh(result.project.id);
      setActiveView("database");
    });
  }

  async function deleteActiveProject() {
    if (!activeProjectId || !activeProject) return;
    if (!window.confirm(`Delete project "${activeProject.name}" and all local data inside it?`)) return;
    await runAction("project", async () => {
      const result = await analysisClient.deleteProject(activeProjectId);
      setActiveProjectId(result.next_project.id);
      setActiveDatasetId("");
      setSelectedDatasetIds([]);
      setActiveModelId("");
      await refresh(result.next_project.id);
    });
  }

  async function deleteActiveDataset() {
    if (!activeDataset) return;
    if (!window.confirm(`Delete dataset "${activeDataset.name}" from this project?`)) return;
    await runAction("dataset", async () => {
      await analysisClient.deleteDataset(activeDataset.id);
      setActiveDatasetId("");
      setSelectedDatasetIds((current) => current.filter((id) => id !== activeDataset.id));
      await refresh();
    });
  }

  async function deleteActiveModel() {
    if (!activeModel) return;
    if (!window.confirm(`Delete model "${activeModel.name}" from the library?`)) return;
    await runAction("model", async () => {
      await analysisClient.deleteModel(activeModel.id);
      setActiveModelId("");
      await refresh();
    });
  }

  async function loadSnapshotAsInitial(modelId: string) {
    await runAction("load", async () => {
      await analysisClient.loadAsInitial(modelId);
      await refresh();
      setActiveView("models");
    });
  }

  async function importManuscriptSample(kind: "EIS" | "2nd-NLEIS") {
    await runAction("import", async () => {
      await analysisClient.importDataset({
        project_id: activeProjectId,
        mode: "manuscript",
        name: `${kind === "EIS" ? "PartII_EIS" : "PartII_2nd"}_sample_${datasets.length + 1}`,
        kind,
      });
      await refresh();
      setActiveView("database");
    });
  }

  async function importTable(kind: "EIS" | "2nd-NLEIS") {
    await runAction("import", async () => {
      await analysisClient.importDataset({
        project_id: activeProjectId,
        mode: "table",
        name: `Manual_${kind}_${datasets.length + 1}`,
        kind,
        source_name: `manual_${kind}.csv`,
        text: importText,
      });
      await refresh();
      setActiveView("database");
    });
  }

  async function runJointFit(batch: boolean) {
    const ids = batch ? selectedDatasetIds : [activeDatasetId || selectedDatasetIds[0]].filter(Boolean);
    if (!activeProjectId || !activeModelId || ids.length === 0) return;
    await runAction(batch ? "batch" : "run", async () => {
      if (batch) {
        await analysisClient.runBatchJointFit({ project_id: activeProjectId, model_id: activeModelId, dataset_ids: ids });
      } else {
        await analysisClient.runJointFit({ project_id: activeProjectId, model_id: activeModelId, dataset_ids: ids });
      }
      await refresh();
      setActiveView("runs");
    });
  }

  function toggleDataset(datasetId: string) {
    setSelectedDatasetIds((current) =>
      current.includes(datasetId) ? current.filter((id) => id !== datasetId) : [...current, datasetId],
    );
    setActiveDatasetId(datasetId);
  }

  function switchProject(projectId: string) {
    setActiveProjectId(projectId);
    setActiveDatasetId("");
    setSelectedDatasetIds([]);
    setActiveModelId("");
  }

  if (status === "error") {
    return (
      <main className="app-shell offline">
        <section className="offline-panel">
          <div className="brand-mark">IS</div>
          <h1>Start the local analysis service</h1>
          <p>{error}</p>
          <code>PYTHONPATH=service python3 -m impedance_studio.server</code>
          <button onClick={() => void refresh()}>Retry connection</button>
          <span>Expected API: {analysisClient.apiBase}</span>
        </section>
      </main>
    );
  }

  return (
    <main className="studio-shell">
      <aside className="studio-sidebar">
        <div className="sidebar-brand">
          <img className="app-logo" src="/logo.svg" alt="" />
          <div>
            <strong>Impedance Studio</strong>
            <span>{activeProject?.name ?? "Local workspace"}</span>
          </div>
        </div>

        <label className="sidebar-search">
          <span>Search</span>
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search datasets, runs, models" />
        </label>

        <nav className="view-switcher" aria-label="Workspace views">
          <button className={activeView === "runs" ? "active" : ""} onClick={() => setActiveView("runs")}>
            Runs
          </button>
          <button className={activeView === "database" ? "active" : ""} onClick={() => setActiveView("database")}>
            Database
          </button>
          <button className={activeView === "models" ? "active" : ""} onClick={() => setActiveView("models")}>
            Models
          </button>
        </nav>

        <SidebarGroup title="Projects" count={projects.length}>
          {projects.map((project) => (
            <button
              className={project.id === activeProjectId ? "sidebar-row active" : "sidebar-row"}
              key={project.id}
              onClick={() => switchProject(project.id)}
            >
              <span>{project.name}</span>
              <small>local</small>
            </button>
          ))}
          <div className="sidebar-tools">
            <input value={projectName} onChange={(event) => setProjectName(event.target.value)} />
            <div className="mini-actions">
              <button onClick={() => void createProject()}>Add</button>
              <button className="danger" onClick={() => void deleteActiveProject()}>Delete</button>
            </div>
          </div>
        </SidebarGroup>

        <SidebarGroup title="Datasets" count={datasets.length}>
          {filteredDatasets.slice(0, 8).map((dataset) => (
            <button
              key={dataset.id}
              className={dataset.id === activeDataset?.id ? "sidebar-row active" : "sidebar-row"}
              onClick={() => toggleDataset(dataset.id)}
            >
              <input checked={selectedDatasetIds.includes(dataset.id)} readOnly type="checkbox" />
              <span>{dataset.name}</span>
              <small>{dataset.kind}</small>
            </button>
          ))}
          {!datasets.length && <p className="empty-state">No datasets yet.</p>}
          <div className="mini-actions">
            <button onClick={() => void importManuscriptSample("EIS")}>Sample EIS</button>
            <button onClick={() => void importManuscriptSample("2nd-NLEIS")}>Sample 2nd</button>
            <button className="danger" onClick={() => void deleteActiveDataset()}>Delete</button>
          </div>
        </SidebarGroup>

        <SidebarGroup title="Model library" count={models.length}>
          {filteredModels.slice(0, 5).map((model) => (
            <button
              key={model.id}
              className={model.id === activeModelId ? "sidebar-row active" : "sidebar-row"}
              onClick={() => {
                setActiveModelId(model.id);
                setActiveView("models");
              }}
            >
              <span>{model.name}</span>
              <small>{model.kind}</small>
            </button>
          ))}
          {!models.length && <p className="empty-state">No saved models yet.</p>}
          <div className="mini-actions">
            <button onClick={() => {
              setActiveView("models");
              void saveTemplate();
            }}>Add</button>
            <button className="danger" onClick={() => void deleteActiveModel()}>Delete</button>
          </div>
        </SidebarGroup>
      </aside>

      <section className="studio-main">
        <TopControls
          activeModelId={activeModelId}
          activeDatasetId={activeDataset?.id ?? ""}
          activeProject={activeProject}
          busyAction={busyAction}
          datasets={datasets}
          fitReady={fitReady}
          models={models}
          onDatasetChange={setActiveDatasetId}
          onModelChange={setActiveModelId}
          onRun={() => void runJointFit(false)}
          onBatch={() => void runJointFit(true)}
          selectedCount={selectedDatasetIds.length}
        />

        {activeView === "runs" && (
          <RunsView
            activeDataset={activeDataset}
            activeModel={activeModel}
            activeResult={activeResult}
            busyAction={busyAction}
            latestRun={latestRun}
            plotView={plotView}
            runs={runs}
            selectedCount={selectedDatasetIds.length}
            setPlotView={setPlotView}
            onBatch={() => void runJointFit(true)}
            onRun={() => void runJointFit(false)}
          />
        )}

        {activeView === "database" && (
          <DatabaseView
            activeDataset={activeDataset}
            activeModel={activeModel}
            datasets={filteredDatasets}
            importText={importText}
            models={filteredModels}
            runs={runs}
            selectedDatasetIds={selectedDatasetIds}
            setImportText={setImportText}
            toggleDataset={toggleDataset}
            onDeleteDataset={deleteActiveDataset}
            onImportEis={() => void importTable("EIS")}
            onImportSecond={() => void importTable("2nd-NLEIS")}
          />
        )}

        {activeView === "models" && (
          <ModelsView
            activeModel={activeModel}
            activeModelId={activeModelId}
            busyAction={busyAction}
            circuit1={circuit1}
            circuit2={circuit2}
            guessValues={guessValues}
            initialGuess={initialGuess}
            models={filteredModels}
            snapshots={snapshots}
            templates={templates}
            validation={validation}
            onCircuit1Change={setCircuit1}
            onCircuit2Change={setCircuit2}
            onInitialGuessChange={setInitialGuess}
            onLoadSnapshot={loadSnapshotAsInitial}
            onModelSelect={setActiveModelId}
            onDelete={deleteActiveModel}
            onSave={saveTemplate}
            onValidate={validateCircuit}
          />
        )}
      </section>
    </main>
  );
}

function TopControls({
  activeDatasetId,
  activeModelId,
  activeProject,
  busyAction,
  datasets,
  fitReady,
  models,
  onBatch,
  onDatasetChange,
  onModelChange,
  onRun,
  selectedCount,
}: {
  activeDatasetId: string;
  activeModelId: string;
  activeProject?: Project;
  busyAction: string | null;
  datasets: Dataset[];
  fitReady: boolean;
  models: ModelTemplate[];
  onBatch: () => void;
  onDatasetChange: (id: string) => void;
  onModelChange: (id: string) => void;
  onRun: () => void;
  selectedCount: number;
}) {
  return (
    <header className="control-bar">
      <div className="context-summary">
        <span>Workspace</span>
        <strong>{activeProject?.name ?? "Local workspace"}</strong>
      </div>
      <div className="context-selectors">
        <label>
          <span>Dataset</span>
          <select value={activeDatasetId} onChange={(event) => onDatasetChange(event.target.value)}>
            {datasets.map((dataset) => (
              <option key={dataset.id} value={dataset.id}>
                {dataset.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Model</span>
          <select value={activeModelId} onChange={(event) => onModelChange(event.target.value)}>
            {models.map((model) => (
              <option key={model.id} value={model.id}>
                {model.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="top-actions">
        <span>{selectedCount} selected</span>
        <button disabled={!fitReady || busyAction === "run"} onClick={onRun}>
          Run
        </button>
        <button className="primary" disabled={!fitReady || busyAction === "batch"} onClick={onBatch}>
          Batch fit
        </button>
      </div>
    </header>
  );
}

function RunsView({
  activeDataset,
  activeModel,
  activeResult,
  busyAction,
  latestRun,
  plotView,
  runs,
  selectedCount,
  setPlotView,
  onBatch,
  onRun,
}: {
  activeDataset?: Dataset;
  activeModel?: ModelTemplate;
  activeResult?: Run["items"][number]["result"];
  busyAction: string | null;
  latestRun?: Run;
  plotView: PlotView;
  runs: Run[];
  selectedCount: number;
  setPlotView: (view: PlotView) => void;
  onBatch: () => void;
  onRun: () => void;
}) {
  const metricCards = [
    { label: "Final chi-square", value: activeResult ? formatNumber(activeResult.validation.chi_square) : "-" },
    { label: "Datasets", value: latestRun ? String(latestRun.items.length) : String(selectedCount) },
    { label: "Snapshots", value: String(latestRun?.snapshots?.length ?? 0) },
  ];

  return (
    <div className="run-layout">
      <section className="panel config-panel">
        <PanelHeader title="Configuration" meta="joint EIS + 2nd-NLEIS" />
        <FieldReadout label="Run label" value={activeModel?.name ?? "Select model"} />
        <FieldReadout label="Dataset" value={activeDataset?.name ?? "Select dataset"} />
        <div className="run-mode-tabs">
          <button className="active">joint</button>
          <button>batch</button>
          <button>compare</button>
        </div>
        <div className="circuit-readout">
          <span>EIS</span>
          <code>{activeModel?.circuit_1 ?? "-"}</code>
          <span>2nd-NLEIS</span>
          <code>{activeModel?.circuit_2 ?? "-"}</code>
        </div>
        <div className="stacked-actions">
          <button disabled={busyAction === "run"} onClick={onRun}>Run current dataset</button>
          <button className="primary" disabled={busyAction === "batch"} onClick={onBatch}>Run batch joint fit</button>
        </div>
      </section>

      <section className="panel results-panel">
        <PanelHeader title="Results" meta={latestRun?.id ?? "waiting for run"} />
        <div className="plot-tabs">
          <button className={plotView === "nyquist" ? "active" : ""} onClick={() => setPlotView("nyquist")}>Nyquist</button>
          <button className={plotView === "bode" ? "active" : ""} onClick={() => setPlotView("bode")}>Bode</button>
          <button className={plotView === "second" ? "active" : ""} onClick={() => setPlotView("second")}>2nd harmonic</button>
        </div>
        <div className="plot-canvas">
          <PlotCard
            title={plotView === "nyquist" ? "Z'' versus Z'" : plotView === "bode" ? "|Z| versus frequency" : "2nd harmonic response"}
            rows={activeDataset?.rows ?? []}
            fitRows={activeResult?.plot_series.fit}
            xKey={plotView === "nyquist" ? "z_real" : "frequency"}
            yKey={plotView === "nyquist" ? "z_imag" : plotView === "bode" ? "z_abs" : "z_imag"}
            invertY={plotView === "nyquist"}
            logX={plotView !== "nyquist"}
          />
        </div>
        <div className="metric-grid">
          {metricCards.map((card) => (
            <MetricCard key={card.label} label={card.label} value={card.value} />
          ))}
        </div>
      </section>

      <section className="panel inspector-panel">
        <PanelHeader title="Run inspector" meta={latestRun?.status ?? "idle"} />
        <dl>
          <dt>Run ID</dt>
          <dd>{latestRun?.id ?? "-"}</dd>
          <dt>Mode</dt>
          <dd>{latestRun?.mode ?? "-"}</dd>
          <dt>Model</dt>
          <dd>{activeModel?.name ?? "-"}</dd>
          <dt>Adapter</dt>
          <dd>{activeResult?.adapter ?? "-"}</dd>
          <dt>Status</dt>
          <dd className={latestRun ? "pass" : ""}>{latestRun?.status ?? "not run"}</dd>
        </dl>
        <div className="download-list">
          {["config", "metadata", "series", "snapshot", "summary_csv"].map((item) => (
            <button key={item}>{item}</button>
          ))}
        </div>
        {activeResult ? (
          <ParameterTable values={activeResult.parameters} confidence={activeResult.confidence} />
        ) : (
          <p className="empty-state">Run a fit to populate fitted parameters and validation.</p>
        )}
      </section>

      <section className="panel activity-panel">
        <PanelHeader title="Recent activity" meta={`${runs.length} runs`} />
        <RunTable runs={runs} />
      </section>
    </div>
  );
}

function DatabaseView({
  activeDataset,
  activeModel,
  datasets,
  importText,
  models,
  runs,
  selectedDatasetIds,
  setImportText,
  toggleDataset,
  onDeleteDataset,
  onImportEis,
  onImportSecond,
}: {
  activeDataset?: Dataset;
  activeModel?: ModelTemplate;
  datasets: Dataset[];
  importText: string;
  models: ModelTemplate[];
  runs: Run[];
  selectedDatasetIds: string[];
  setImportText: (value: string) => void;
  toggleDataset: (id: string) => void;
  onDeleteDataset: () => Promise<void>;
  onImportEis: () => void;
  onImportSecond: () => void;
}) {
  return (
    <div className="database-layout">
      <section className="database-hero">
        <div>
          <span>Private database</span>
          <h1>{activeDataset ? activeDataset.name : "Datasets, model templates, and fitted snapshots"}</h1>
        </div>
        <div className="hero-actions">
          <button className="danger" disabled={!activeDataset} onClick={() => void onDeleteDataset()}>Delete dataset</button>
        </div>
      </section>

      <section className="panel dataset-panel">
        <PanelHeader title="Dataset library" meta={`${datasets.length} rows`} />
        <table>
          <thead>
            <tr>
              <th>Batch</th>
              <th>Name</th>
              <th>Type</th>
              <th>Points</th>
              <th>Frequency range</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody>
            {datasets.map((dataset) => (
              <tr key={dataset.id} className={dataset.id === activeDataset?.id ? "selected" : ""}>
                <td>
                  <input checked={selectedDatasetIds.includes(dataset.id)} readOnly type="checkbox" onClick={() => toggleDataset(dataset.id)} />
                </td>
                <td>{dataset.name}</td>
                <td>{dataset.kind}</td>
                <td>{dataset.point_count}</td>
                <td>{formatFrequency(dataset.freq_min)} - {formatFrequency(dataset.freq_max)}</td>
                <td>{dataset.source_name}</td>
              </tr>
            ))}
            {!datasets.length && (
              <tr>
                <td colSpan={6}>No datasets match the current search.</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <section className="panel import-panel">
        <PanelHeader title="Add data" meta="CSV / TSV / Autolab style" />
        <textarea value={importText} onChange={(event) => setImportText(event.target.value)} spellCheck={false} />
        <div className="button-pair">
          <button onClick={onImportEis}>Import as EIS</button>
          <button onClick={onImportSecond}>Import as 2nd</button>
        </div>
      </section>

      <section className="panel database-side-panel">
        <PanelHeader title="Database summary" meta="local SQLite" />
        <MetricCard label="Datasets" value={String(datasets.length)} />
        <MetricCard label="Saved models" value={String(models.length)} />
        <MetricCard label="Stored runs" value={String(runs.length)} />
        <div className="selected-record">
          <h3>Selected record</h3>
          <dl>
            <dt>Dataset</dt>
            <dd>{activeDataset?.name ?? "-"}</dd>
            <dt>Model</dt>
            <dd>{activeModel?.name ?? "-"}</dd>
            <dt>Range</dt>
            <dd>{activeDataset ? `${formatFrequency(activeDataset.freq_min)} - ${formatFrequency(activeDataset.freq_max)}` : "-"}</dd>
          </dl>
        </div>
      </section>
    </div>
  );
}

function ModelsView({
  activeModel,
  activeModelId,
  busyAction,
  circuit1,
  circuit2,
  guessValues,
  initialGuess,
  models,
  snapshots,
  templates,
  validation,
  onCircuit1Change,
  onCircuit2Change,
  onInitialGuessChange,
  onLoadSnapshot,
  onModelSelect,
  onDelete,
  onSave,
  onValidate,
}: {
  activeModel?: ModelTemplate;
  activeModelId: string;
  busyAction: string | null;
  circuit1: string;
  circuit2: string;
  guessValues: number[];
  initialGuess: string;
  models: ModelTemplate[];
  snapshots: ModelTemplate[];
  templates: ModelTemplate[];
  validation: CircuitValidation | null;
  onCircuit1Change: (value: string) => void;
  onCircuit2Change: (value: string) => void;
  onInitialGuessChange: (value: string) => void;
  onLoadSnapshot: (id: string) => Promise<void>;
  onModelSelect: (id: string) => void;
  onDelete: () => Promise<void>;
  onSave: () => Promise<void>;
  onValidate: () => Promise<void>;
}) {
  return (
    <div className="models-layout">
      <section className="database-hero">
        <div>
          <span>Model library</span>
          <h1>Joint circuit definitions and reusable fitting templates</h1>
        </div>
        <div className="hero-actions">
          <button disabled={busyAction === "validate"} onClick={() => void onValidate()}>Validate</button>
          <button className="danger" disabled={!activeModel || busyAction === "model"} onClick={() => void onDelete()}>Delete</button>
          <button className="primary" disabled={busyAction === "save"} onClick={() => void onSave()}>Save as new</button>
        </div>
      </section>

      <section className="panel model-editor-panel">
        <PanelHeader title="Circuit editor" meta={`${guessValues.length} initial guesses`} />
        <div className="editor-grid">
          <label>
            <span>EIS circuit_1</span>
            <input value={circuit1} onChange={(event) => onCircuit1Change(event.target.value)} />
          </label>
          <label>
            <span>2nd-NLEIS circuit_2</span>
            <input value={circuit2} onChange={(event) => onCircuit2Change(event.target.value)} />
          </label>
        </div>
        <label>
          <span>Initial guesses</span>
          <textarea value={initialGuess} onChange={(event) => onInitialGuessChange(event.target.value)} spellCheck={false} />
        </label>
        <ParameterEditor values={guessValues} />
        {validation && (
          <div className={validation.valid ? "validation valid" : "validation invalid"}>
            <strong>{validation.valid ? "Circuit pair valid" : "Circuit pair needs attention"}</strong>
            <span>{validation.estimated_parameters} estimated parameters</span>
            {[...validation.errors, ...validation.warnings].map((message) => (
              <small key={message}>{message}</small>
            ))}
          </div>
        )}
      </section>

      <section className="panel model-library-panel">
        <PanelHeader title="Saved models" meta={`${templates.length} templates / ${snapshots.length} snapshots`} />
        <div className="library-list">
          {models.map((model) => (
            <button
              key={model.id}
              className={model.id === activeModelId ? "library-row active" : "library-row"}
              onClick={() => onModelSelect(model.id)}
            >
              <span>
                <strong>{model.name}</strong>
                <small>{model.circuit_1} / {model.circuit_2}</small>
              </span>
              <em>{model.kind}</em>
            </button>
          ))}
        </div>
      </section>

      <section className="panel snapshot-panel">
        <PanelHeader title="Fitted snapshots" meta="reload as initial" />
        {snapshots.length ? (
          <div className="library-list">
            {snapshots.map((snapshot) => (
              <button key={snapshot.id} className="library-row" onClick={() => void onLoadSnapshot(snapshot.id)}>
                <span>
                  <strong>{snapshot.name}</strong>
                  <small>{snapshot.source_run_id ?? "stored fit"}</small>
                </span>
                <em>load</em>
              </button>
            ))}
          </div>
        ) : (
          <p className="empty-state">Run a fit to create fitted snapshots.</p>
        )}
        <div className="selected-record">
          <h3>Active model</h3>
          <dl>
            <dt>Name</dt>
            <dd>{activeModel?.name ?? "-"}</dd>
            <dt>Scope</dt>
            <dd>{activeModel?.scope ?? "-"}</dd>
            <dt>Shared</dt>
            <dd>{activeModel?.shared_parameters?.join(", ") || "-"}</dd>
          </dl>
        </div>
      </section>
    </div>
  );
}

function SidebarGroup({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  return (
    <section className="sidebar-group">
      <div className="sidebar-group-title">
        <span>{title}</span>
        <small>{count}</small>
      </div>
      <div className="sidebar-group-body">{children}</div>
    </section>
  );
}

function PanelHeader({ title, meta }: { title: string; meta?: string }) {
  return (
    <div className="panel-header">
      <h2>{title}</h2>
      {meta && <span>{meta}</span>}
    </div>
  );
}

function FieldReadout({ label, value }: { label: string; value: string }) {
  return (
    <label className="field-readout">
      <span>{label}</span>
      <input value={value} readOnly />
    </label>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function RunTable({ runs }: { runs: Run[] }) {
  return (
    <table>
      <thead>
        <tr>
          <th>Status</th>
          <th>Mode</th>
          <th>Datasets</th>
          <th>Progress</th>
          <th>Started</th>
        </tr>
      </thead>
      <tbody>
        {runs.slice(0, 6).map((run) => (
          <tr key={run.id}>
            <td><span className="pass">{run.status}</span></td>
            <td>{run.mode}</td>
            <td>{run.items.length}</td>
            <td><Progress value={run.progress} /></td>
            <td>{run.started_at}</td>
          </tr>
        ))}
        {!runs.length && (
          <tr>
            <td colSpan={5}>No runs yet. Select datasets and run a joint fit.</td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

function Progress({ value }: { value: number }) {
  return (
    <div className="progress">
      <span style={{ width: `${value}%` }} />
    </div>
  );
}

function ParameterEditor({ values }: { values: number[] }) {
  return (
    <table className="parameter-table">
      <thead>
        <tr>
          <th>Override</th>
          <th>Parameter</th>
          <th>Value</th>
          <th>Type</th>
        </tr>
      </thead>
      <tbody>
        {values.map((value, index) => (
          <tr key={`${value}-${index}`}>
            <td><input type="checkbox" defaultChecked /></td>
            <td>p{index}</td>
            <td>{formatNumber(value)}</td>
            <td>number</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ParameterTable({ values, confidence }: { values: number[]; confidence: number[] }) {
  return (
    <table className="parameter-table">
      <thead>
        <tr>
          <th>Parameter</th>
          <th>Value</th>
          <th>Error</th>
        </tr>
      </thead>
      <tbody>
        {values.map((value, index) => (
          <tr key={`${value}-${index}`}>
            <td>p{index}</td>
            <td>{formatNumber(value)}</td>
            <td>{formatNumber(confidence[index] ?? 0)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function PlotCard({
  title,
  rows,
  fitRows,
  xKey,
  yKey,
  invertY,
  logX,
}: {
  title: string;
  rows: DatasetRow[];
  fitRows?: DatasetRow[];
  xKey: keyof DatasetRow;
  yKey: keyof DatasetRow;
  invertY?: boolean;
  logX?: boolean;
}) {
  const width = 760;
  const height = 420;
  const padding = 50;
  const points = toPoints(rows, xKey, yKey, width, height, padding, Boolean(invertY), Boolean(logX));
  const fitPoints = toPoints(fitRows ?? [], xKey, yKey, width, height, padding, Boolean(invertY), Boolean(logX));
  const line = points.map((point) => `${point.x},${point.y}`).join(" ");
  const fitLine = fitPoints.map((point) => `${point.x},${point.y}`).join(" ");

  return (
    <article className="plot-card">
      <div className="plot-card-title">
        <strong>{title}</strong>
        <span>data + fit</span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${title} plot`}>
        <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} />
        <line x1={padding} y1={padding} x2={padding} y2={height - padding} />
        {[0, 1, 2, 3, 4].map((tick) => (
          <g key={tick}>
            <line className="grid" x1={padding} x2={width - padding} y1={padding + tick * 75} y2={padding + tick * 75} />
            <line className="grid" x1={padding + tick * 132} x2={padding + tick * 132} y1={padding} y2={height - padding} />
          </g>
        ))}
        {line && <polyline className="data-line" points={line} />}
        {fitLine && <polyline className="fit-line" points={fitLine} />}
        {points.filter((_, index) => index % 7 === 0).map((point) => (
          <circle key={`${point.x}-${point.y}`} cx={point.x} cy={point.y} r="3.2" />
        ))}
      </svg>
    </article>
  );
}

function toPoints(
  rows: DatasetRow[],
  xKey: keyof DatasetRow,
  yKey: keyof DatasetRow,
  width: number,
  height: number,
  padding: number,
  invertY: boolean,
  logX: boolean,
) {
  if (!rows.length) return [];
  const xs = rows.map((row) => (logX ? Math.log10(Math.max(Number(row[xKey]), 1e-12)) : Number(row[xKey])));
  const ys = rows.map((row) => Number(row[yKey]));
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return rows.map((row, index) => {
    const xValue = xs[index];
    const yValue = Number(row[yKey]);
    const x = padding + ((xValue - minX) / Math.max(maxX - minX, 1e-9)) * (width - padding * 2);
    const yRatio = (yValue - minY) / Math.max(maxY - minY, 1e-9);
    const y = invertY
      ? padding + yRatio * (height - padding * 2)
      : height - padding - yRatio * (height - padding * 2);
    return { x: Number(x.toFixed(2)), y: Number(y.toFixed(2)) };
  });
}

function filterDatasets(datasets: Dataset[], search: string) {
  const query = search.trim().toLowerCase();
  if (!query) return datasets;
  return datasets.filter((dataset) =>
    [dataset.name, dataset.kind, dataset.source_name].some((value) => value.toLowerCase().includes(query)),
  );
}

function filterModels(models: ModelTemplate[], search: string) {
  const query = search.trim().toLowerCase();
  if (!query) return models;
  return models.filter((model) =>
    [model.name, model.kind, model.circuit_1, model.circuit_2].some((value) => value.toLowerCase().includes(query)),
  );
}

function formatFrequency(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)} MHz`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(2)} kHz`;
  if (value < 1) return `${(value * 1000).toFixed(1)} mHz`;
  return `${value.toFixed(2)} Hz`;
}

function formatNumber(value: number) {
  if (Math.abs(value) >= 1000 || Math.abs(value) < 0.01) return value.toExponential(2);
  return value.toFixed(4);
}
