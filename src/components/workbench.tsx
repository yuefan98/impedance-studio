"use client";

import { useCallback, useEffect, useMemo, useState, type MouseEvent, type ReactNode } from "react";
import { analysisClient } from "@/lib/analysis-client";
import type { CircuitValidation, Dataset, DatasetRow, Health, ModelTemplate, Project, Run } from "@/lib/types";

type Status = "idle" | "loading" | "ready" | "error";
type WorkbenchView = "runs" | "database" | "models";

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
  const [eisDatasetId, setEisDatasetId] = useState<string>("");
  const [secondDatasetId, setSecondDatasetId] = useState<string>("");
  const [activeModelId, setActiveModelId] = useState<string>("");
  const [activeView, setActiveView] = useState<WorkbenchView>("runs");
  const [circuit1, setCircuit1] = useState("RC0");
  const [circuit2, setCircuit2] = useState("RCn0");
  const [initialGuess, setInitialGuess] = useState("0.84, 15.2, 0.001");
  const [runName, setRunName] = useState("Joint RC0 / RCn0 fit");
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
      const firstEis = datasetResult.datasets.find((dataset) => dataset.kind === "EIS");
      const firstSecond = datasetResult.datasets.find((dataset) => dataset.kind === "2nd-NLEIS");
      setActiveDatasetId((current) =>
        datasetResult.datasets.some((dataset) => dataset.id === current) ? current : firstEis?.id || datasetResult.datasets[0]?.id || "",
      );
      setEisDatasetId((current) =>
        datasetResult.datasets.some((dataset) => dataset.id === current && dataset.kind === "EIS") ? current : firstEis?.id || "",
      );
      setSecondDatasetId((current) =>
        datasetResult.datasets.some((dataset) => dataset.id === current && dataset.kind === "2nd-NLEIS")
          ? current
          : firstSecond?.id || "",
      );
      setSelectedDatasetIds((current) =>
        current.filter((id) => datasetResult.datasets.some((dataset) => dataset.id === id)).length
          ? current.filter((id) => datasetResult.datasets.some((dataset) => dataset.id === id))
          : [firstEis?.id, firstSecond?.id].filter(Boolean) as string[],
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

  const guessEntries = useMemo(() => initialGuess.split(",").map((value) => value.trim()), [initialGuess]);
  const guessValues = useMemo(
    () => guessEntries.map((value) => Number(value)).filter((value) => Number.isFinite(value)),
    [guessEntries],
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
        shared_parameters: inferSharedParameters(circuit1, circuit2),
      });
      await refresh();
    });
  }

  function updateInitialGuess(index: number, value: string) {
    const entries = [...guessEntries];
    while (entries.length <= index) entries.push("");
    entries[index] = value;
    setInitialGuess(entries.join(", "));
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

  async function deleteProject(project: Project) {
    if (!window.confirm(`Delete project "${project.name}" and all local data inside it?`)) return;
    await runAction("project", async () => {
      const result = await analysisClient.deleteProject(project.id);
      setActiveProjectId(result.next_project.id);
      setActiveDatasetId("");
      setSelectedDatasetIds([]);
      setActiveModelId("");
      await refresh(result.next_project.id);
    });
  }

  async function deleteDataset(dataset: Dataset) {
    if (!window.confirm(`Delete dataset "${dataset.name}" from this project?`)) return;
    await runAction("dataset", async () => {
      await analysisClient.deleteDataset(dataset.id);
      setActiveDatasetId("");
      setSelectedDatasetIds((current) => current.filter((id) => id !== dataset.id));
      await refresh();
    });
  }

  async function deleteActiveDataset() {
    if (!activeDataset) return;
    await deleteDataset(activeDataset);
  }

  async function deleteModel(model: ModelTemplate) {
    if (!window.confirm(`Delete model "${model.name}" from the library?`)) return;
    await runAction("model", async () => {
      await analysisClient.deleteModel(model.id);
      setActiveModelId("");
      await refresh();
    });
  }

  async function deleteActiveModel() {
    if (!activeModel) return;
    await deleteModel(activeModel);
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
    const ids = selectedDatasetIds.length ? selectedDatasetIds : [activeDatasetId || eisDatasetId || secondDatasetId].filter(Boolean);
    if (!activeProjectId || !activeModelId || ids.length === 0) return;
    await runAction(batch ? "batch" : "run", async () => {
      if (batch) {
        await analysisClient.runBatchJointFit({ project_id: activeProjectId, model_id: activeModelId, dataset_ids: ids, run_name: runName });
      } else {
        await analysisClient.runJointFit({ project_id: activeProjectId, model_id: activeModelId, dataset_ids: ids, run_name: runName });
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

  function chooseEisDataset(datasetId: string) {
    setEisDatasetId(datasetId);
    setActiveDatasetId(datasetId);
  }

  function chooseSecondDataset(datasetId: string) {
    setSecondDatasetId(datasetId);
    setActiveDatasetId(datasetId);
  }

  function toggleFitDataset(datasetId: string) {
    setSelectedDatasetIds((current) =>
      current.includes(datasetId) ? current.filter((id) => id !== datasetId) : [...current, datasetId],
    );
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

        {activeView === "database" && (
          <>
            <SidebarGroup title="Projects" count={projects.length}>
              {projects.map((project) => (
                <div className={project.id === activeProjectId ? "sidebar-row active" : "sidebar-row"} key={project.id}>
                  <button className="sidebar-row-main text-row" onClick={() => switchProject(project.id)}>
                    <span>{project.name}</span>
                    <small>local</small>
                  </button>
                  <button className="row-delete" aria-label={`Delete ${project.name}`} onClick={() => void deleteProject(project)}>
                    Delete
                  </button>
                </div>
              ))}
              <div className="sidebar-tools">
                <input value={projectName} onChange={(event) => setProjectName(event.target.value)} />
                <div className="mini-actions">
                  <button onClick={() => void createProject()}>Add project</button>
                </div>
              </div>
            </SidebarGroup>

            <SidebarGroup title="Datasets" count={datasets.length}>
              {filteredDatasets.slice(0, 8).map((dataset) => (
                <div key={dataset.id} className={dataset.id === activeDataset?.id ? "sidebar-row active" : "sidebar-row"}>
                  <button className="sidebar-row-main" onClick={() => toggleDataset(dataset.id)}>
                    <input checked={selectedDatasetIds.includes(dataset.id)} readOnly type="checkbox" />
                    <span>{dataset.name}</span>
                    <small>{dataset.kind}</small>
                  </button>
                  <button className="row-delete" aria-label={`Delete ${dataset.name}`} onClick={() => void deleteDataset(dataset)}>
                    Delete
                  </button>
                </div>
              ))}
              {!datasets.length && <p className="empty-state">No datasets yet.</p>}
              <div className="mini-actions">
                <button onClick={() => void importManuscriptSample("EIS")}>Sample EIS</button>
                <button onClick={() => void importManuscriptSample("2nd-NLEIS")}>Sample 2nd</button>
              </div>
            </SidebarGroup>
          </>
        )}

        {activeView === "runs" && (
          <SidebarGroup title="Fitting runs" count={runs.length}>
            {runs.slice(0, 8).map((run) => (
              <div className="sidebar-run-row" key={run.id}>
                <span>{String(run.summary?.run_name ?? run.mode)}</span>
                <small>{run.status} · {run.items.length} datasets</small>
              </div>
            ))}
            {!runs.length && <p className="empty-state">No fitting runs yet.</p>}
          </SidebarGroup>
        )}

        {activeView === "models" && (
          <SidebarGroup title="Model library" count={models.length}>
            {filteredModels.slice(0, 8).map((model) => (
              <div key={model.id} className={model.id === activeModelId ? "sidebar-row active" : "sidebar-row"}>
                <button
                  className="sidebar-row-main text-row"
                  onClick={() => {
                    setActiveModelId(model.id);
                    setActiveView("models");
                  }}
                >
                  <span>{model.name}</span>
                  <small>{model.kind}</small>
                </button>
                <button className="row-delete" aria-label={`Delete ${model.name}`} onClick={() => void deleteModel(model)}>
                  Delete
                </button>
              </div>
            ))}
            {!models.length && <p className="empty-state">No saved models yet.</p>}
            <div className="mini-actions">
              <button onClick={() => {
                setActiveView("models");
                void saveTemplate();
              }}>Add model</button>
            </div>
          </SidebarGroup>
        )}
      </aside>

      <section className="studio-main">
        <TopControls
          activeProject={activeProject}
          selectedCount={selectedDatasetIds.length}
        />

        {activeView === "runs" && (
          <RunsView
            activeDataset={activeDataset}
            activeModel={activeModel}
            activeResult={activeResult}
            busyAction={busyAction}
            datasets={datasets}
            eisDatasetId={eisDatasetId}
            latestRun={latestRun}
            models={models}
            runs={runs}
            runName={runName}
            secondDatasetId={secondDatasetId}
            selectedDatasets={selectedDatasets}
            selectedDatasetIds={selectedDatasetIds}
            selectedCount={selectedDatasetIds.length}
            onEisDatasetChange={chooseEisDataset}
            onIncludeDataset={toggleFitDataset}
            onModelChange={setActiveModelId}
            onRunNameChange={setRunName}
            onSecondDatasetChange={chooseSecondDataset}
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
            guessEntries={guessEntries}
            guessValues={guessValues}
            initialGuess={initialGuess}
            models={filteredModels}
            snapshots={snapshots}
            templates={templates}
            validation={validation}
            onCircuit1Change={setCircuit1}
            onCircuit2Change={setCircuit2}
            onInitialGuessChange={setInitialGuess}
            onInitialGuessItemChange={updateInitialGuess}
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
  activeProject,
  selectedCount,
}: {
  activeProject?: Project;
  selectedCount: number;
}) {
  return (
    <header aria-label="Run context" className="control-bar">
      <div className="context-summary">
        <span>Project</span>
        <strong>{activeProject?.name ?? "Local workspace"}</strong>
      </div>
      <div aria-label="Selected data" className="top-actions">
        <span className={selectedCount ? "selection-pill active" : "selection-pill"}>{selectedCount} selected</span>
      </div>
    </header>
  );
}

function RunsView({
  activeDataset,
  activeModel,
  activeResult,
  busyAction,
  datasets,
  eisDatasetId,
  latestRun,
  models,
  runs,
  runName,
  secondDatasetId,
  selectedDatasets,
  selectedDatasetIds,
  selectedCount,
  onEisDatasetChange,
  onIncludeDataset,
  onModelChange,
  onRunNameChange,
  onSecondDatasetChange,
  onBatch,
  onRun,
}: {
  activeDataset?: Dataset;
  activeModel?: ModelTemplate;
  activeResult?: Run["items"][number]["result"];
  busyAction: string | null;
  datasets: Dataset[];
  eisDatasetId: string;
  latestRun?: Run;
  models: ModelTemplate[];
  runs: Run[];
  runName: string;
  secondDatasetId: string;
  selectedDatasets: Dataset[];
  selectedDatasetIds: string[];
  selectedCount: number;
  onEisDatasetChange: (id: string) => void;
  onIncludeDataset: (id: string) => void;
  onModelChange: (id: string) => void;
  onRunNameChange: (name: string) => void;
  onSecondDatasetChange: (id: string) => void;
  onBatch: () => void;
  onRun: () => void;
}) {
  const eisDatasets = datasets.filter((dataset) => dataset.kind === "EIS");
  const secondDatasets = datasets.filter((dataset) => dataset.kind === "2nd-NLEIS");
  const eisDataset = datasets.find((dataset) => dataset.id === eisDatasetId);
  const secondDataset = datasets.find((dataset) => dataset.id === secondDatasetId);
  const selectedEisDatasets = selectedDatasets.filter((dataset) => dataset.kind === "EIS");
  const selectedSecondDatasets = selectedDatasets.filter((dataset) => dataset.kind === "2nd-NLEIS");
  const fitRows = activeDataset?.kind === "EIS" ? activeResult?.plot_series.fit : undefined;
  const secondFitRows = activeDataset?.kind === "2nd-NLEIS" ? activeResult?.plot_series.fit : undefined;
  const metricCards = [
    { label: "Final chi-square", value: activeResult ? formatNumber(activeResult.validation.chi_square) : "-" },
    { label: "Datasets", value: latestRun ? String(latestRun.items.length) : String(selectedCount) },
    { label: "Snapshots", value: String(latestRun?.snapshots?.length ?? 0) },
  ];

  return (
    <div className="run-layout">
      <section className="panel config-panel">
        <PanelHeader title="Configuration" meta="joint EIS + 2nd-NLEIS" />
        <label className="field-readout">
          <span>Run name</span>
          <input value={runName} onChange={(event) => onRunNameChange(event.target.value)} />
        </label>
        <label className="field-readout">
          <span>Model template</span>
          <select value={activeModel?.id ?? ""} onChange={(event) => onModelChange(event.target.value)}>
            {models.map((model) => (
              <option key={model.id} value={model.id}>{model.name}</option>
            ))}
          </select>
        </label>
        <DatasetFitPicker
          dataset={eisDataset}
          datasets={eisDatasets}
          included={Boolean(eisDataset && selectedDatasetIds.includes(eisDataset.id))}
          label="EIS data"
          onChange={onEisDatasetChange}
          onInclude={onIncludeDataset}
        />
        <DatasetFitPicker
          dataset={secondDataset}
          datasets={secondDatasets}
          included={Boolean(secondDataset && selectedDatasetIds.includes(secondDataset.id))}
          label="2nd-NLEIS data"
          onChange={onSecondDatasetChange}
          onInclude={onIncludeDataset}
        />
        <div className="circuit-readout">
          <span>EIS</span>
          <code>{activeModel?.circuit_1 ?? "-"}</code>
          <span>2nd-NLEIS</span>
          <code>{activeModel?.circuit_2 ?? "-"}</code>
        </div>
        <ParameterSummary values={activeModel?.initial_guess ?? []} names={getParameterNames(activeModel?.circuit_1, activeModel?.circuit_2, activeModel?.initial_guess ?? [])} />
        <div className="stacked-actions">
          <button disabled={!selectedDatasetIds.length || busyAction === "run"} onClick={onRun}>Run selected fit</button>
          <button className="primary" disabled={!selectedDatasetIds.length || busyAction === "batch"} onClick={onBatch}>Run batch joint fit</button>
        </div>
      </section>

      <section className="panel results-panel">
        <PanelHeader title="Results" meta={latestRun?.id ?? "waiting for run"} />
        <div className="plot-canvas plot-stack">
          <PlotCard
            title="EIS Nyquist: Z'' versus Z'"
            rows={eisDataset?.rows ?? []}
            comparisonDatasets={selectedEisDatasets.length ? selectedEisDatasets : eisDataset ? [eisDataset] : []}
            fitRows={fitRows}
            xKey="z_real"
            yKey="z_imag"
            invertY
          />
          <PlotCard
            title="2nd-NLEIS Nyquist: Z2'' versus Z2'"
            rows={secondDataset?.rows ?? []}
            comparisonDatasets={selectedSecondDatasets.length ? selectedSecondDatasets : secondDataset ? [secondDataset] : []}
            fitRows={secondFitRows}
            xKey="z_real"
            yKey="z_imag"
            invertY
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
            <button
              disabled={!latestRun}
              key={item}
              onClick={() => latestRun && downloadRunArtifact(item, latestRun, activeModel, activeDataset, activeResult)}
            >
              {item}
            </button>
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
  guessEntries,
  guessValues,
  initialGuess,
  models,
  snapshots,
  templates,
  validation,
  onCircuit1Change,
  onCircuit2Change,
  onInitialGuessChange,
  onInitialGuessItemChange,
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
  guessEntries: string[];
  guessValues: number[];
  initialGuess: string;
  models: ModelTemplate[];
  snapshots: ModelTemplate[];
  templates: ModelTemplate[];
  validation: CircuitValidation | null;
  onCircuit1Change: (value: string) => void;
  onCircuit2Change: (value: string) => void;
  onInitialGuessChange: (value: string) => void;
  onInitialGuessItemChange: (index: number, value: string) => void;
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
        <ParameterEditor
          names={getParameterNames(circuit1, circuit2, guessValues)}
          values={guessEntries}
          onChange={onInitialGuessItemChange}
        />
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

function DatasetFitPicker({
  dataset,
  datasets,
  included,
  label,
  onChange,
  onInclude,
}: {
  dataset?: Dataset;
  datasets: Dataset[];
  included: boolean;
  label: string;
  onChange: (id: string) => void;
  onInclude: (id: string) => void;
}) {
  return (
    <div className="fit-picker">
      <label>
        <span>{label}</span>
        <select value={dataset?.id ?? ""} onChange={(event) => onChange(event.target.value)}>
          {datasets.map((item) => (
            <option key={item.id} value={item.id}>{item.name}</option>
          ))}
        </select>
      </label>
      <button
        className={included ? "include-toggle active" : "include-toggle"}
        disabled={!dataset}
        onClick={() => dataset && onInclude(dataset.id)}
      >
        {included ? "Included in fit" : "Include in fit"}
      </button>
    </div>
  );
}

function ParameterSummary({ names, values }: { names: string[]; values: number[] }) {
  return (
    <div className="parameter-summary">
      <span>Initial guesses</span>
      {values.map((value, index) => (
        <code key={`${names[index]}-${index}`}>{names[index] ?? `p${index}`} = {formatNumber(value)}</code>
      ))}
    </div>
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
          <th>Run name</th>
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
            <td>{String(run.summary?.run_name ?? "Joint fit")}</td>
            <td>{run.mode}</td>
            <td>{run.items.length}</td>
            <td><Progress value={run.progress} /></td>
            <td>{run.started_at}</td>
          </tr>
        ))}
        {!runs.length && (
          <tr>
            <td colSpan={6}>No runs yet. Select datasets and run a joint fit.</td>
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

function ParameterEditor({
  names,
  onChange,
  values,
}: {
  names: string[];
  onChange: (index: number, value: string) => void;
  values: string[];
}) {
  return (
    <table className="parameter-table">
      <thead>
        <tr>
          <th>Override</th>
          <th>Parameter</th>
          <th>Initial guess</th>
          <th>Type</th>
        </tr>
      </thead>
      <tbody>
        {values.map((value, index) => (
          <tr key={`${value}-${index}`}>
            <td><input type="checkbox" defaultChecked /></td>
            <td>{names[index] ?? `p${index}`}</td>
            <td>
              <input
                aria-label={`Initial guess for ${names[index] ?? `p${index}`}`}
                value={value}
                onChange={(event) => onChange(index, event.target.value)}
              />
            </td>
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
  comparisonDatasets,
  fitRows,
  xKey,
  yKey,
  invertY,
  logX,
}: {
  title: string;
  rows: DatasetRow[];
  comparisonDatasets: Dataset[];
  fitRows?: DatasetRow[];
  xKey: keyof DatasetRow;
  yKey: keyof DatasetRow;
  invertY?: boolean;
  logX?: boolean;
}) {
  const width = 760;
  const height = 420;
  const padding = { top: 34, right: 26, bottom: 58, left: 72 };
  const plotArea = {
    x: padding.left,
    y: padding.top,
    width: width - padding.left - padding.right,
    height: height - padding.top - padding.bottom,
  };
  const [hoveredPoint, setHoveredPoint] = useState<PlottedPoint | null>(null);
  const rawSeries = comparisonDatasets.length
    ? comparisonDatasets.map((dataset, index) => ({
        id: dataset.id,
        name: dataset.name,
        kind: dataset.kind,
        rows: dataset.rows,
        color: PLOT_COLORS[index % PLOT_COLORS.length],
      }))
    : [{ id: "active", name: "Active dataset", kind: "EIS", rows, color: PLOT_COLORS[0] }];
  const scaleRows = [...rawSeries.flatMap((series) => series.rows), ...(fitRows ?? [])];
  const domain = getPlotDomain(scaleRows, xKey, yKey, Boolean(logX));
  const series = rawSeries.map((item) => ({
    ...item,
    points: toPoints(item.rows, xKey, yKey, plotArea, domain, Boolean(invertY), Boolean(logX), item.name, item.color),
  }));
  const fitPoints = toPoints(
    fitRows ?? [],
    xKey,
    yKey,
    plotArea,
    domain,
    Boolean(invertY),
    Boolean(logX),
    "fit",
    "#d9572a",
  );
  const allPoints = [...series.flatMap((item) => item.points), ...fitPoints];
  const xTicks = createTicks(domain.minX, domain.maxX, 5);
  const yTicks = createTicks(domain.minY, domain.maxY, 5);
  const xLabel = xKey === "frequency" ? "Frequency" : "Z' / Ohm";
  const yLabel = yKey === "z_abs" ? "|Z| / Ohm" : "Z'' / Ohm";

  function handlePointerMove(event: MouseEvent<SVGSVGElement>) {
    if (!allPoints.length) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * width;
    const y = ((event.clientY - rect.top) / rect.height) * height;
    const nearest = allPoints.reduce((best, point) => {
      const distance = Math.hypot(point.x - x, point.y - y);
      return distance < best.distance ? { point, distance } : best;
    }, { point: allPoints[0], distance: Number.POSITIVE_INFINITY });
    setHoveredPoint(nearest.distance < 42 ? nearest.point : null);
  }

  return (
    <article className="plot-card">
      <div className="plot-card-title">
        <strong>{title}</strong>
        <span>{series.length > 1 ? `${series.length} datasets` : "data + fit"}</span>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`${title} plot`}
        onMouseLeave={() => setHoveredPoint(null)}
        onMouseMove={handlePointerMove}
      >
        <rect className="plot-frame" x={plotArea.x} y={plotArea.y} width={plotArea.width} height={plotArea.height} />
        {xTicks.map((tick) => {
          const x = scaleValue(tick, domain.minX, domain.maxX, plotArea.x, plotArea.x + plotArea.width);
          return (
            <g key={`x-${tick}`}>
              <line className="grid" x1={x} x2={x} y1={plotArea.y} y2={plotArea.y + plotArea.height} />
              <line className="tick" x1={x} x2={x} y1={plotArea.y + plotArea.height} y2={plotArea.y + plotArea.height + 5} />
              <text className="axis-text" textAnchor="middle" x={x} y={plotArea.y + plotArea.height + 20}>
                {logX ? formatFrequency(10 ** tick) : formatNumber(tick)}
              </text>
            </g>
          );
        })}
        {yTicks.map((tick) => {
          const y = scaleY(tick, domain.minY, domain.maxY, plotArea.y, plotArea.height, Boolean(invertY));
          return (
            <g key={`y-${tick}`}>
              <line className="grid" x1={plotArea.x} x2={plotArea.x + plotArea.width} y1={y} y2={y} />
              <line className="tick" x1={plotArea.x - 5} x2={plotArea.x} y1={y} y2={y} />
              <text className="axis-text" textAnchor="end" x={plotArea.x - 10} y={y + 4}>
                {formatNumber(tick)}
              </text>
            </g>
          );
        })}
        <line className="axis-line" x1={plotArea.x} y1={plotArea.y + plotArea.height} x2={plotArea.x + plotArea.width} y2={plotArea.y + plotArea.height} />
        <line className="axis-line" x1={plotArea.x} y1={plotArea.y} x2={plotArea.x} y2={plotArea.y + plotArea.height} />
        <text className="axis-label" textAnchor="middle" x={plotArea.x + plotArea.width / 2} y={height - 14}>
          {xLabel}
        </text>
        <text
          className="axis-label"
          textAnchor="middle"
          transform={`translate(18 ${plotArea.y + plotArea.height / 2}) rotate(-90)`}
        >
          {yLabel}
        </text>
        {series.map((item) => (
          <g key={item.id}>
            <polyline className="data-line" points={toLine(item.points)} style={{ stroke: item.color }} />
            {item.points.filter((_, index) => index % 10 === 0).map((point) => (
              <circle
                key={`${item.id}-${point.x}-${point.y}`}
                cx={point.x}
                cy={point.y}
                r="3"
                style={{ stroke: item.color }}
              />
            ))}
          </g>
        ))}
        {fitPoints.length > 0 && <polyline className="fit-line" points={toLine(fitPoints)} />}
        {hoveredPoint && (
          <g className="hover-layer">
            <line className="hover-line" x1={hoveredPoint.x} x2={hoveredPoint.x} y1={plotArea.y} y2={plotArea.y + plotArea.height} />
            <line className="hover-line" x1={plotArea.x} x2={plotArea.x + plotArea.width} y1={hoveredPoint.y} y2={hoveredPoint.y} />
            <circle className="hover-point" cx={hoveredPoint.x} cy={hoveredPoint.y} r="5" style={{ stroke: hoveredPoint.color }} />
          </g>
        )}
      </svg>
      <div className="plot-footer">
        <div className="plot-legend">
          {series.slice(0, 4).map((item) => (
            <span key={item.id}>
              <i style={{ background: item.color }} />
              {item.name}
            </span>
          ))}
          {series.length > 4 && <span>+{series.length - 4} more</span>}
          {fitPoints.length > 0 && (
            <span>
              <i className="fit-swatch" />
              fit
            </span>
          )}
        </div>
        <output className="plot-tooltip">
          {hoveredPoint
            ? `${hoveredPoint.series}: ${xLabel} ${formatAxisValue(hoveredPoint.xValue, xKey)}, ${yLabel} ${formatNumber(hoveredPoint.yValue)}`
            : "Hover the plot to inspect nearest data point"}
        </output>
      </div>
    </article>
  );
}

type PlotArea = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type PlotDomain = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

type PlottedPoint = {
  x: number;
  y: number;
  xValue: number;
  yValue: number;
  series: string;
  color: string;
};

const PLOT_COLORS = ["#0f8f89", "#d9572a", "#4d70b8", "#8a5fbf", "#557c38", "#b44f82"];

function getPlotDomain(rows: DatasetRow[], xKey: keyof DatasetRow, yKey: keyof DatasetRow, logX: boolean): PlotDomain {
  const usableRows = rows.length ? rows : [{ frequency: 1, z_real: 0, z_imag: 0, z_abs: 0, phase: 0 }];
  const xs = usableRows.map((row) => transformX(Number(row[xKey]), logX));
  const ys = usableRows.map((row) => Number(row[yKey]));
  return padDomain({
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  });
}

function padDomain(domain: PlotDomain): PlotDomain {
  const xSpan = Math.max(domain.maxX - domain.minX, 1e-9);
  const ySpan = Math.max(domain.maxY - domain.minY, 1e-9);
  return {
    minX: domain.minX - xSpan * 0.05,
    maxX: domain.maxX + xSpan * 0.05,
    minY: domain.minY - ySpan * 0.08,
    maxY: domain.maxY + ySpan * 0.08,
  };
}

function toPoints(
  rows: DatasetRow[],
  xKey: keyof DatasetRow,
  yKey: keyof DatasetRow,
  plotArea: PlotArea,
  domain: PlotDomain,
  invertY: boolean,
  logX: boolean,
  series: string,
  color: string,
): PlottedPoint[] {
  return rows.map((row) => {
    const xValue = Number(row[xKey]);
    const yValue = Number(row[yKey]);
    const x = scaleValue(transformX(xValue, logX), domain.minX, domain.maxX, plotArea.x, plotArea.x + plotArea.width);
    const y = scaleY(yValue, domain.minY, domain.maxY, plotArea.y, plotArea.height, invertY);
    return {
      x: Number(x.toFixed(2)),
      y: Number(y.toFixed(2)),
      xValue,
      yValue,
      series,
      color,
    };
  });
}

function transformX(value: number, logX: boolean) {
  return logX ? Math.log10(Math.max(value, 1e-12)) : value;
}

function scaleValue(value: number, min: number, max: number, start: number, end: number) {
  return start + ((value - min) / Math.max(max - min, 1e-9)) * (end - start);
}

function scaleY(value: number, min: number, max: number, start: number, height: number, invert: boolean) {
  const ratio = (value - min) / Math.max(max - min, 1e-9);
  return invert ? start + ratio * height : start + height - ratio * height;
}

function createTicks(min: number, max: number, count: number) {
  if (count <= 1) return [min];
  const step = (max - min) / (count - 1);
  return Array.from({ length: count }, (_, index) => min + step * index);
}

function toLine(points: PlottedPoint[]) {
  return points.map((point) => `${point.x},${point.y}`).join(" ");
}

function downloadRunArtifact(
  kind: string,
  run: Run,
  model?: ModelTemplate,
  dataset?: Dataset,
  result?: Run["items"][number]["result"],
) {
  const baseName = `${String(run.summary?.run_name ?? run.mode).replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "")}_${run.id.slice(0, 8)}`;
  if (kind === "summary_csv") {
    const rows = [
      ["parameter", "value", "confidence", "chi_square"],
      ...(result?.parameters ?? []).map((value, index) => [
        `p${index}`,
        String(value),
        String(result?.confidence[index] ?? ""),
        String(result?.validation.chi_square ?? ""),
      ]),
    ];
    downloadText(`${baseName}_summary.csv`, rows.map((row) => row.join(",")).join("\n"), "text/csv");
    return;
  }

  const payloads: Record<string, unknown> = {
    config: {
      run_name: run.summary?.run_name,
      mode: run.mode,
      model: model
        ? {
            name: model.name,
            circuit_1: model.circuit_1,
            circuit_2: model.circuit_2,
            initial_guess: model.initial_guess,
            shared_parameters: model.shared_parameters,
          }
        : null,
      dataset_ids: run.items.map((item) => item.dataset_id),
    },
    metadata: {
      id: run.id,
      status: run.status,
      progress: run.progress,
      started_at: run.started_at,
      completed_at: run.completed_at,
      summary: run.summary,
    },
    series: result?.plot_series ?? dataset?.rows ?? [],
    snapshot: run.snapshots?.[0] ?? model ?? null,
  };
  downloadText(`${baseName}_${kind}.json`, JSON.stringify(payloads[kind] ?? {}, null, 2), "application/json");
}

function downloadText(filename: string, text: string, type: string) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function getParameterNames(circuit1 = "", circuit2 = "", values: number[]) {
  const pair = `${circuit1.trim()}/${circuit2.trim()}`;
  if (pair === "RC0/RCn0") {
    return ["RC0_0 / RCn0_0", "RC0_1 / RCn0_1", "RCn0_2"];
  }
  return values.map((_, index) => `p${index}`);
}

function inferSharedParameters(circuit1: string, circuit2: string) {
  if (`${circuit1.trim()}/${circuit2.trim()}` === "RC0/RCn0") {
    return ["RC0_0 -> RCn0_0", "RC0_1 -> RCn0_1"];
  }
  return [`${circuit1}_0 -> ${circuit2}_0`];
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

function formatAxisValue(value: number, key: keyof DatasetRow) {
  return key === "frequency" ? formatFrequency(value) : formatNumber(value);
}

function formatNumber(value: number) {
  if (Math.abs(value) >= 1000 || Math.abs(value) < 0.01) return value.toExponential(2);
  return value.toFixed(4);
}
