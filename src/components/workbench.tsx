"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { analysisClient } from "@/lib/analysis-client";
import type { CircuitValidation, Dataset, DatasetRow, Health, ModelTemplate, Project, Run } from "@/lib/types";

type Status = "idle" | "loading" | "ready" | "error";

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
  const [activeTab, setActiveTab] = useState<"plots" | "residuals" | "second">("plots");
  const [circuit1, setCircuit1] = useState("RC0");
  const [circuit2, setCircuit2] = useState("RCn0");
  const [initialGuess, setInitialGuess] = useState("0.84, 15.2, 0.001, 0.84");
  const [importText, setImportText] = useState("frequency,z_real,z_imag\n1000,0.84,-0.02\n100,1.8,-1.1\n10,7.1,-4.8\n1,14.7,-12.2");
  const [validation, setValidation] = useState<CircuitValidation | null>(null);

  const activeProject = projects.find((project) => project.id === activeProjectId);
  const activeDataset = datasets.find((dataset) => dataset.id === activeDatasetId) ?? datasets[0];
  const activeModel = models.find((model) => model.id === activeModelId) ?? models[0];
  const latestRun = runs[0];
  const selectedDatasets = datasets.filter((dataset) => selectedDatasetIds.includes(dataset.id));
  const activeResult = latestRun?.items?.find((item) => item.dataset_id === activeDataset?.id)?.result;

  const refresh = useCallback(async () => {
    setStatus("loading");
    setError(null);
    try {
      const healthResult = await analysisClient.health();
      const projectResult = await analysisClient.projects();
      const nextProjectId = activeProjectId || projectResult.projects[0]?.id || "";
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
      setActiveDatasetId((current) => current || datasetResult.datasets[0]?.id || "");
      setSelectedDatasetIds((current) => current.length ? current : datasetResult.datasets.slice(0, 3).map((dataset) => dataset.id));
      setActiveModelId((current) => current || modelResult.models[0]?.id || "");
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

  async function validateCircuit() {
    const result = await analysisClient.validateCircuit({
      circuit_1: circuit1,
      circuit_2: circuit2,
      initial_guess: guessValues,
      constants: {},
    });
    setValidation(result.validation);
  }

  async function saveTemplate() {
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
  }

  async function loadSnapshotAsInitial(modelId: string) {
    await analysisClient.loadAsInitial(modelId);
    await refresh();
  }

  async function importSynthetic(kind: "EIS" | "2nd-NLEIS") {
    await analysisClient.importDataset({
      project_id: activeProjectId,
      mode: "synthetic",
      name: `${kind === "EIS" ? "Cell_A" : "Cell_A_2nd"}_import_${datasets.length + 1}`,
      kind,
    });
    await refresh();
  }

  async function importTable(kind: "EIS" | "2nd-NLEIS") {
    await analysisClient.importDataset({
      project_id: activeProjectId,
      mode: "table",
      name: `Manual_${kind}_${datasets.length + 1}`,
      kind,
      source_name: `manual_${kind}.csv`,
      text: importText,
    });
    await refresh();
  }

  async function runJointFit(batch: boolean) {
    const ids = batch ? selectedDatasetIds : [activeDatasetId || selectedDatasetIds[0]].filter(Boolean);
    if (!activeProjectId || !activeModelId || ids.length === 0) return;
    if (batch) {
      await analysisClient.runBatchJointFit({ project_id: activeProjectId, model_id: activeModelId, dataset_ids: ids });
    } else {
      await analysisClient.runJointFit({ project_id: activeProjectId, model_id: activeModelId, dataset_ids: ids });
    }
    await refresh();
  }

  function toggleDataset(datasetId: string) {
    setSelectedDatasetIds((current) =>
      current.includes(datasetId) ? current.filter((id) => id !== datasetId) : [...current, datasetId],
    );
    setActiveDatasetId(datasetId);
  }

  if (status === "error") {
    return (
      <main className="app-shell offline">
        <section className="offline-panel">
          <div className="brand-mark">IS</div>
          <h1>Start the local analysis service</h1>
          <p>{error}</p>
          <code>PYTHONPATH=service python -m impedance_studio.server</code>
          <button onClick={() => void refresh()}>Retry connection</button>
          <span>Expected API: {analysisClient.apiBase}</span>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">IS</div>
          <div>
            <strong>Impedance Studio</strong>
            <span>v0.1.0</span>
          </div>
        </div>
        <nav className="command-bar" aria-label="Workbench actions">
          <button onClick={() => void importSynthetic("EIS")}>Import EIS</button>
          <button onClick={() => void importSynthetic("2nd-NLEIS")}>Import 2nd</button>
          <button onClick={() => void runJointFit(false)}>Run Fit</button>
          <button onClick={() => void validateCircuit()}>Validate</button>
          <button onClick={() => void runJointFit(true)}>Batch Fit</button>
          <button onClick={() => void saveTemplate()}>Save Model</button>
        </nav>
        <div className="mode-pill">
          <span className="status-dot" />
          <div>
            <strong>Local mode</strong>
            <span>{health?.optional_libraries?.nleis ? "nleis.py detected" : "SQLite worker"}</span>
          </div>
        </div>
      </header>

      <section className="workspace">
        <aside className="left-rail">
          <PanelTitle label="Projects" action="+" />
          <div className="project-tree">
            {projects.map((project) => (
              <button
                className={project.id === activeProjectId ? "tree-item active" : "tree-item"}
                key={project.id}
                onClick={() => setActiveProjectId(project.id)}
              >
                <span className="folder-icon" />
                {project.name}
              </button>
            ))}
          </div>

          <PanelTitle label="Datasets" action={`${selectedDatasetIds.length} selected`} />
          <div className="search-box">Search datasets...</div>
          <div className="dataset-list">
            {datasets.map((dataset) => (
              <button
                key={dataset.id}
                className={dataset.id === activeDataset?.id ? "dataset-row active" : "dataset-row"}
                onClick={() => toggleDataset(dataset.id)}
              >
                <input checked={selectedDatasetIds.includes(dataset.id)} readOnly type="checkbox" />
                <span>{dataset.name}</span>
                <small>{dataset.kind}</small>
              </button>
            ))}
          </div>

          <div className="import-box">
            <h3>Import table</h3>
            <textarea
              value={importText}
              onChange={(event) => setImportText(event.target.value)}
              spellCheck={false}
            />
            <div className="button-pair">
              <button onClick={() => void importTable("EIS")}>CSV/TSV EIS</button>
              <button onClick={() => void importTable("2nd-NLEIS")}>Autolab/2nd</button>
            </div>
          </div>
        </aside>

        <section className="center-stage">
          <div className="tabs">
            <button className="active">EIS</button>
            <button>2nd-NLEIS</button>
            <span>{activeDataset ? `Active dataset: ${activeDataset.name}` : "No dataset selected"}</span>
          </div>

          <section className="data-preview">
            <div className="section-heading">
              <h2>Batch dataset preview</h2>
              <span>{selectedDatasets.length} files ready for joint fitting</span>
            </div>
            <table>
              <thead>
                <tr>
                  <th />
                  <th>Name</th>
                  <th>Type</th>
                  <th>Points</th>
                  <th>Frequency range</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                {datasets.slice(0, 7).map((dataset) => (
                  <tr key={dataset.id} className={dataset.id === activeDataset?.id ? "selected" : ""}>
                    <td>
                      <input checked={selectedDatasetIds.includes(dataset.id)} readOnly type="checkbox" />
                    </td>
                    <td>{dataset.name}</td>
                    <td>{dataset.kind}</td>
                    <td>{dataset.point_count}</td>
                    <td>
                      {formatFrequency(dataset.freq_min)} - {formatFrequency(dataset.freq_max)}
                    </td>
                    <td>{dataset.source_name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="plot-zone">
            <div className="plot-toolbar">
              <div>
                <button className={activeTab === "plots" ? "active" : ""} onClick={() => setActiveTab("plots")}>
                  Plots
                </button>
                <button className={activeTab === "residuals" ? "active" : ""} onClick={() => setActiveTab("residuals")}>
                  Residuals
                </button>
                <button className={activeTab === "second" ? "active" : ""} onClick={() => setActiveTab("second")}>
                  2nd harmonic
                </button>
              </div>
              <span>Auto scale enabled</span>
            </div>
            <div className="plots">
              <PlotCard title="Nyquist" rows={activeDataset?.rows ?? []} fitRows={activeResult?.plot_series.fit} xKey="z_real" yKey="z_imag" invertY />
              <PlotCard title="Bode magnitude" rows={activeDataset?.rows ?? []} fitRows={activeResult?.plot_series.fit} xKey="frequency" yKey="z_abs" logX />
              <PlotCard title={activeTab === "second" ? "2nd harmonic" : "Phase"} rows={activeDataset?.rows ?? []} fitRows={activeResult?.plot_series.fit} xKey="frequency" yKey={activeTab === "second" ? "z_imag" : "phase"} logX />
            </div>
          </section>

          <section className="run-strip">
            <div className="section-heading">
              <h2>Run queue</h2>
              <span>{runs.length} runs</span>
            </div>
            <table>
              <thead>
                <tr>
                  <th>Mode</th>
                  <th>Status</th>
                  <th>Progress</th>
                  <th>Datasets</th>
                  <th>Started</th>
                </tr>
              </thead>
              <tbody>
                {runs.slice(0, 4).map((run) => (
                  <tr key={run.id}>
                    <td>{run.mode}</td>
                    <td>
                      <span className="pass">{run.status}</span>
                    </td>
                    <td>
                      <Progress value={run.progress} />
                    </td>
                    <td>{run.items.length}</td>
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
          </section>
        </section>

        <aside className="right-inspector">
          <div className="inspector-tabs">
            <button className="active">Inspector</button>
            <button>Model library ({models.length})</button>
          </div>

          <section className="inspector-section">
            <h3>Dataset</h3>
            <dl>
              <dt>Name</dt>
              <dd>{activeDataset?.name ?? "-"}</dd>
              <dt>Type</dt>
              <dd>{activeDataset?.kind ?? "-"}</dd>
              <dt>Points</dt>
              <dd>{activeDataset?.point_count ?? "-"}</dd>
              <dt>Project</dt>
              <dd>{activeProject?.name ?? "-"}</dd>
            </dl>
          </section>

          <section className="inspector-section">
            <h3>Joint model</h3>
            <label>
              EIS circuit_1
              <input value={circuit1} onChange={(event) => setCircuit1(event.target.value)} />
            </label>
            <label>
              2nd-NLEIS circuit_2
              <input value={circuit2} onChange={(event) => setCircuit2(event.target.value)} />
            </label>
            <label>
              Initial guesses
              <textarea value={initialGuess} onChange={(event) => setInitialGuess(event.target.value)} />
            </label>
            <div className="button-pair">
              <button onClick={() => void validateCircuit()}>Validate DSL</button>
              <button onClick={() => void saveTemplate()}>Save template</button>
            </div>
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

          <section className="inspector-section">
            <h3>Model library</h3>
            <div className="model-list">
              {models.slice(0, 6).map((model) => (
                <button
                  key={model.id}
                  className={model.id === activeModelId ? "model-row active" : "model-row"}
                  onClick={() => setActiveModelId(model.id)}
                >
                  <span>
                    <strong>{model.name}</strong>
                    <small>
                      {model.kind} | {model.circuit_1} / {model.circuit_2}
                    </small>
                  </span>
                  {model.kind === "snapshot" ? (
                    <em onClick={(event) => {
                      event.stopPropagation();
                      void loadSnapshotAsInitial(model.id);
                    }}>
                      load as initial
                    </em>
                  ) : (
                    <em>{model.pinned ? "preset" : "template"}</em>
                  )}
                </button>
              ))}
            </div>
          </section>

          <section className="inspector-section">
            <h3>Latest fit</h3>
            {activeResult ? (
              <>
                <dl>
                  <dt>Mode</dt>
                  <dd>{activeResult.fit_mode}</dd>
                  <dt>Adapter</dt>
                  <dd>{activeResult.adapter}</dd>
                  <dt>Chi-square</dt>
                  <dd>{activeResult.validation.chi_square}</dd>
                  <dt>Status</dt>
                  <dd className="pass">{activeResult.validation.status}</dd>
                </dl>
                <ParameterTable values={activeResult.parameters} confidence={activeResult.confidence} />
              </>
            ) : (
              <p className="muted">Run a joint fit to save a fitted model snapshot.</p>
            )}
          </section>
        </aside>
      </section>
    </main>
  );
}

function PanelTitle({ label, action }: { label: string; action: string }) {
  return (
    <div className="panel-title">
      <span>{label}</span>
      <button>{action}</button>
    </div>
  );
}

function Progress({ value }: { value: number }) {
  return (
    <div className="progress">
      <span style={{ width: `${value}%` }} />
    </div>
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
  const width = 280;
  const height = 210;
  const padding = 30;
  const points = toPoints(rows, xKey, yKey, width, height, padding, Boolean(invertY), Boolean(logX));
  const fitPoints = toPoints(fitRows ?? [], xKey, yKey, width, height, padding, Boolean(invertY), Boolean(logX));
  const line = points.map((point) => `${point.x},${point.y}`).join(" ");
  const fitLine = fitPoints.map((point) => `${point.x},${point.y}`).join(" ");

  return (
    <article className="plot-card">
      <div className="plot-card-title">
        <strong>{title}</strong>
        <span>Data + fit</span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${title} plot`}>
        <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} />
        <line x1={padding} y1={padding} x2={padding} y2={height - padding} />
        {[0, 1, 2, 3].map((tick) => (
          <g key={tick}>
            <line className="grid" x1={padding} x2={width - padding} y1={padding + tick * 45} y2={padding + tick * 45} />
            <line className="grid" x1={padding + tick * 58} x2={padding + tick * 58} y1={padding} y2={height - padding} />
          </g>
        ))}
        {line && <polyline className="data-line" points={line} />}
        {fitLine && <polyline className="fit-line" points={fitLine} />}
        {points.filter((_, index) => index % 7 === 0).map((point) => (
          <circle key={`${point.x}-${point.y}`} cx={point.x} cy={point.y} r="2.8" />
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
