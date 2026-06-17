import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { CircuitValidation, Dataset, DatasetRow, ModelTemplate, Project, Run } from "./types";

type ImportPayload = {
  project_id?: string;
  mode?: "table" | "autolab" | "synthetic" | "manuscript";
  name?: string;
  kind?: "EIS" | "2nd-NLEIS";
  sample_index?: number;
  source_name?: string;
  text?: string;
};

type ModelPayload = Partial<ModelTemplate> & {
  project_id?: string;
};

type RunPayload = {
  project_id?: string;
  model_id?: string;
  dataset_ids?: string[];
  run_name?: string;
};

const CONDITIONS = ["10a", "10f", "30a", "30f", "40a", "40f", "50a", "50f", "60a", "60f"];
const SAMPLE_SOURCE = "Part II/data";

class DemoStore {
  private projects: Project[] = [];
  private datasets: Dataset[] = [];
  private models: ModelTemplate[] = [];
  private runs: Run[] = [];
  private sequence = 0;

  constructor() {
    this.seed();
  }

  health() {
    return {
      ok: true,
      mode: "hosted-demo",
      database: "ephemeral Vercel demo store",
      optional_libraries: { impedance: false, nleis: false },
    };
  }

  listProjects() {
    return [...this.projects].sort((a, b) => a.name.localeCompare(b.name));
  }

  createProject(name: string) {
    const project = { id: this.id("project"), name, created_at: this.now() };
    this.projects.push(project);
    return project;
  }

  deleteProject(projectId: string) {
    this.requireProject(projectId);
    this.projects = this.projects.filter((project) => project.id !== projectId);
    const runIds = new Set(this.runs.filter((run) => run.project_id === projectId).map((run) => run.id));
    this.datasets = this.datasets.filter((dataset) => dataset.project_id !== projectId);
    this.models = this.models.filter((model) => model.project_id !== projectId);
    this.runs = this.runs.filter((run) => !runIds.has(run.id));
    if (!this.projects.length) {
      this.createProject("Untitled Project");
    }
    return { ok: true, deleted_id: projectId, next_project: this.listProjects()[0] };
  }

  listDatasets(projectId?: string) {
    return this.datasets
      .filter((dataset) => !projectId || dataset.project_id === projectId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  importDataset(payload: ImportPayload) {
    const projectId = payload.project_id || this.defaultProjectId();
    const kind = payload.kind || "EIS";
    const name = payload.name || "Imported dataset";
    const mode = payload.mode || "table";
    let parsed: Omit<Dataset, "id" | "project_id" | "created_at">;
    if (mode === "manuscript") {
      const sampleIndex = payload.sample_index ?? this.listDatasets(projectId).filter((dataset) => dataset.kind === kind).length;
      parsed = manuscriptDataset(kind, sampleIndex);
      if (payload.name) parsed = { ...parsed, name };
    } else if (mode === "synthetic") {
      parsed = syntheticDataset(kind, name);
    } else {
      parsed = parseTable(payload.text || "", kind, name, payload.source_name || `${name}.csv`);
    }
    return this.insertDataset(projectId, parsed);
  }

  deleteDataset(datasetId: string) {
    this.requireDataset(datasetId);
    this.datasets = this.datasets.filter((dataset) => dataset.id !== datasetId);
    this.runs = this.runs.map((run) => ({ ...run, items: run.items.filter((item) => item.dataset_id !== datasetId) }));
    return { ok: true, deleted_id: datasetId };
  }

  validateTemplate(payload: { circuit_1?: string; circuit_2?: string; initial_guess?: number[] }) {
    const circuit1 = payload.circuit_1 || "";
    const circuit2 = payload.circuit_2 || "";
    const names = parameterNames(circuit1, circuit2, payload.initial_guess || []);
    const validation: CircuitValidation = {
      valid: Boolean(circuit1 && circuit2 && names.length),
      errors: circuit1 && circuit2 ? [] : ["Both EIS and 2nd-NLEIS circuit strings are required."],
      warnings: [],
      elements_1: circuit1 ? [circuit1] : [],
      elements_2: circuit2 ? [circuit2] : [],
      estimated_parameters: names.length,
      parameter_names: names,
    };
    return validation;
  }

  listModels(projectId?: string) {
    return this.models
      .filter((model) => !projectId || model.project_id === projectId || model.pinned)
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updated_at.localeCompare(a.updated_at));
  }

  createModel(payload: ModelPayload) {
    const now = this.now();
    const model: ModelTemplate = normalizeModel({
      id: this.id("model"),
      project_id: payload.project_id || this.defaultProjectId(),
      name: payload.name || "Untitled model",
      kind: payload.kind || "template",
      scope: payload.scope || "project",
      circuit_1: payload.circuit_1 || "",
      circuit_2: payload.circuit_2 || "",
      initial_guess: payload.initial_guess || [],
      bounds: payload.bounds || {},
      constants: payload.constants || {},
      shared_parameters: payload.shared_parameters || [],
      fitted_parameters: payload.fitted_parameters || null,
      validation_summary: payload.validation_summary || null,
      plot_series: payload.plot_series || null,
      source_run_id: payload.source_run_id || null,
      pinned: Boolean(payload.pinned),
      created_at: now,
      updated_at: now,
    });
    this.models.push(model);
    return model;
  }

  deleteModel(modelId: string) {
    this.requireModel(modelId);
    this.models = this.models.filter((model) => model.id !== modelId);
    return { ok: true, deleted_id: modelId };
  }

  exportModel(modelId: string) {
    const model = this.requireModel(modelId);
    return {
      Name: model.name,
      "Circuit String 1": model.circuit_1,
      "Circuit String 2": model.circuit_2,
      "Initial Guess": model.initial_guess,
      Constants: model.constants,
      Bounds: model.bounds,
      "Shared Parameters": model.shared_parameters,
      Fit: model.kind === "snapshot",
      Parameters: model.fitted_parameters,
      Validation: model.validation_summary,
      "Source Run ID": model.source_run_id,
    };
  }

  loadModelAsInitial(modelId: string) {
    const model = this.requireModel(modelId);
    return this.createModel({
      project_id: model.project_id || this.defaultProjectId(),
      name: `${model.name} as initial`,
      kind: "template",
      scope: model.scope,
      circuit_1: model.circuit_1,
      circuit_2: model.circuit_2,
      initial_guess: model.fitted_parameters || model.initial_guess,
      bounds: model.bounds,
      constants: model.constants,
      shared_parameters: model.shared_parameters,
      fitted_parameters: null,
      validation_summary: model.fitted_parameters ? { loaded_from: model.id, fitted_as_initial: true } : model.validation_summary,
      plot_series: model.plot_series,
      source_run_id: null,
      pinned: false,
    });
  }

  listRuns(projectId?: string) {
    return this.runs
      .filter((run) => !projectId || run.project_id === projectId)
      .sort((a, b) => b.started_at.localeCompare(a.started_at));
  }

  runJointFit(payload: RunPayload, batch = false) {
    const projectId = payload.project_id || this.defaultProjectId();
    const model = this.requireModel(payload.model_id || this.defaultModelId(projectId));
    const datasetIds = payload.dataset_ids?.length ? payload.dataset_ids : [this.defaultDatasetId(projectId)];
    const now = this.now();
    const runId = this.id("run");
    const snapshots: ModelTemplate[] = [];
    const items = datasetIds.map((datasetId) => {
      const dataset = this.requireDataset(datasetId);
      const result = fitResult(dataset, model);
      const item = {
        id: this.id("item"),
        run_id: runId,
        dataset_id: dataset.id,
        status: "completed",
        progress: 100,
        message: "Joint fit completed in hosted demo adapter",
        result,
      };
      snapshots.push(
        this.createModel({
          project_id: projectId,
          name: `${model.name} fitted to ${dataset.name}`,
          kind: "snapshot",
          circuit_1: model.circuit_1,
          circuit_2: model.circuit_2,
          initial_guess: model.initial_guess,
          bounds: model.bounds,
          constants: model.constants,
          shared_parameters: model.shared_parameters,
          fitted_parameters: result.parameters,
          validation_summary: result.validation,
          plot_series: result.plot_series,
          source_run_id: runId,
        }),
      );
      return item;
    });
    const run: Run = {
      id: runId,
      project_id: projectId,
      model_id: model.id,
      mode: batch ? "batch-joint-fit" : "joint-fit",
      status: "completed",
      progress: 100,
      started_at: now,
      completed_at: now,
      summary: { dataset_count: datasetIds.length, fit_mode: "joint", run_name: payload.run_name || "Joint fit" },
      items,
      snapshots,
    };
    this.runs.unshift(run);
    return run;
  }

  private seed() {
    const project = this.createProject("2nd-NLEIS Manuscript Part II");
    for (const condition of CONDITIONS) {
      this.insertDataset(project.id, loadManuscriptCondition(condition, "EIS"));
      this.insertDataset(project.id, loadManuscriptCondition(condition, "2nd-NLEIS"));
    }
    this.createModel({
      project_id: project.id,
      name: "Joint RC0 / RCn0 template",
      scope: "project",
      pinned: true,
      circuit_1: "RC0",
      circuit_2: "RCn0",
      initial_guess: [0.84, 15.2, 0.001],
      bounds: { lower: [0, 0, -0.5], upper: ["inf", "inf", 0.5] },
      constants: {},
      shared_parameters: ["RC0_0 -> RCn0_0", "RC0_1 -> RCn0_1"],
    });
  }

  private insertDataset(projectId: string, parsed: Omit<Dataset, "id" | "project_id" | "created_at">) {
    const dataset: Dataset = {
      ...parsed,
      id: this.id("dataset"),
      project_id: projectId,
      created_at: this.now(),
    };
    this.datasets.push(dataset);
    return dataset;
  }

  private defaultProjectId() {
    return this.projects[0]?.id || this.createProject("Default Project").id;
  }

  private defaultModelId(projectId: string) {
    return this.listModels(projectId)[0]?.id || this.createModel({ project_id: projectId, name: "Default RC pair", circuit_1: "RC0", circuit_2: "RCn0" }).id;
  }

  private defaultDatasetId(projectId: string) {
    return this.listDatasets(projectId)[0]?.id || this.insertDataset(projectId, syntheticDataset("EIS", "Synthetic EIS")).id;
  }

  private requireProject(projectId: string) {
    const project = this.projects.find((item) => item.id === projectId);
    if (!project) throw new Error(`project not found: ${projectId}`);
    return project;
  }

  private requireDataset(datasetId: string) {
    const dataset = this.datasets.find((item) => item.id === datasetId);
    if (!dataset) throw new Error(`dataset not found: ${datasetId}`);
    return dataset;
  }

  private requireModel(modelId: string) {
    const model = this.models.find((item) => item.id === modelId);
    if (!model) throw new Error(`model not found: ${modelId}`);
    return model;
  }

  private id(prefix: string) {
    this.sequence += 1;
    return `${prefix}_${this.sequence.toString(16).padStart(6, "0")}`;
  }

  private now() {
    return new Date().toISOString();
  }
}

const globalStore = globalThis as typeof globalThis & { __impedanceStudioDemoStore?: DemoStore };

export function demoStore() {
  globalStore.__impedanceStudioDemoStore ??= new DemoStore();
  return globalStore.__impedanceStudioDemoStore;
}

function manuscriptDataset(kind: "EIS" | "2nd-NLEIS", index: number) {
  return loadManuscriptCondition(CONDITIONS[index % CONDITIONS.length], kind);
}

function loadManuscriptCondition(condition: string, kind: "EIS" | "2nd-NLEIS"): Omit<Dataset, "id" | "project_id" | "created_at"> {
  const frequencyText = readSampleFile(`freq_${condition}.txt`);
  const impedanceText = readSampleFile(`${kind === "EIS" ? "Z1s" : "Z2s"}_${condition}.txt`);
  return parseManuscriptPair(
    frequencyText,
    impedanceText,
    `PartII_${condition}_${kind === "EIS" ? "EIS" : "2nd-NLEIS"}`,
    kind,
    `${SAMPLE_SOURCE}/freq_${condition}.txt + ${kind === "EIS" ? "Z1s" : "Z2s"}_${condition}.txt`,
  );
}

function readSampleFile(filename: string) {
  const path = join(process.cwd(), "service", "sample_data", "manuscript_part_ii", filename);
  if (!existsSync(path)) return "";
  return readFileSync(path, "utf-8");
}

function parseManuscriptPair(
  frequencyText: string,
  impedanceText: string,
  name: string,
  kind: "EIS" | "2nd-NLEIS",
  sourceName: string,
) {
  const frequencies = frequencyText.split(/\s+/).filter(Boolean).map(Number);
  if (!frequencies.length) return syntheticDataset(kind, name);
  const replicateRows = impedanceText
    .split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/).filter(Boolean).map(Number))
    .filter((values) => values.length === frequencies.length * 2);
  if (!replicateRows.length) return syntheticDataset(kind, name);
  const rows = frequencies.map((frequency, index) => {
    const zReal = average(replicateRows.map((row) => row[index * 2]));
    const zImag = average(replicateRows.map((row) => row[index * 2 + 1]));
    return row(frequency, zReal, zImag);
  });
  return summarizeDataset(kind, name, rows, sourceName);
}

function parseTable(text: string, kind: "EIS" | "2nd-NLEIS", name: string, sourceName: string) {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return syntheticDataset(kind, name);
  const headers = lines[0].split(/[,\t; ]+/).map((item) => item.toLowerCase().trim());
  const frequencyIndex = findHeader(headers, ["frequency", "freq", "f", "freq_hz", "frequency_hz"]);
  const realIndex = findHeader(headers, ["z_real", "zreal", "z'", "real", "re", "z_re"]);
  const imagIndex = findHeader(headers, ["z_imag", "zimag", "z''", "imag", "im", "z_im"]);
  if (frequencyIndex < 0 || realIndex < 0 || imagIndex < 0) return syntheticDataset(kind, name);
  const rows = lines.slice(1).map((line) => {
    const cells = line.split(/[,\t; ]+/);
    return row(Number(cells[frequencyIndex]), Number(cells[realIndex]), Number(cells[imagIndex]));
  }).filter((item) => Number.isFinite(item.frequency) && Number.isFinite(item.z_real) && Number.isFinite(item.z_imag));
  return rows.length ? summarizeDataset(kind, name, rows, sourceName) : syntheticDataset(kind, name);
}

function syntheticDataset(kind: "EIS" | "2nd-NLEIS", name: string): Omit<Dataset, "id" | "project_id" | "created_at"> {
  const rows = Array.from({ length: 64 }, (_, index) => {
    const ratio = index / 63;
    const frequency = 10 ** (6 - 7 * ratio);
    if (kind === "2nd-NLEIS") {
      return row(frequency, 0.02 + 0.18 * ratio + 0.018 * Math.sin(ratio * Math.PI * 3), -0.015 - 0.14 * ratio + 0.01 * Math.cos(ratio * Math.PI * 2));
    }
    const arc = Math.sin(ratio * Math.PI);
    const tail = Math.max(ratio - 0.62, 0) * 18;
    return row(frequency, 0.82 + 15.5 * ratio + tail, -0.2 - 7.2 * arc - 13.5 * ratio ** 2);
  });
  return summarizeDataset(kind, name, rows, `${name}.csv`);
}

function summarizeDataset(kind: "EIS" | "2nd-NLEIS", name: string, rows: DatasetRow[], sourceName: string) {
  const frequencies = rows.map((item) => item.frequency);
  return {
    name,
    kind,
    source_name: sourceName,
    point_count: rows.length,
    freq_min: Math.min(...frequencies),
    freq_max: Math.max(...frequencies),
    temperature_c: 25,
    rows,
  };
}

function row(frequency: number, zReal: number, zImag: number): DatasetRow {
  return {
    frequency,
    z_real: zReal,
    z_imag: zImag,
    z_abs: Math.hypot(zReal, zImag),
    phase: Math.atan2(zImag, zReal) * (180 / Math.PI),
  };
}

function fitResult(dataset: Dataset, model: ModelTemplate) {
  const scale = Math.max(dataset.rows.reduce((sum, item) => sum + Math.abs(item.z_real) + Math.abs(item.z_imag), 0) / dataset.rows.length, 1e-9);
  const base = model.initial_guess.length ? model.initial_guess : [scale, scale / 2, 0.001];
  const parameters = base.map((value, index) => Number((value * (0.98 + 0.01 * index)).toFixed(8)));
  const fit = dataset.rows.map((item, index) => {
    const drift = 1 + 0.015 * Math.sin((index / Math.max(dataset.rows.length - 1, 1)) * Math.PI);
    return row(item.frequency, item.z_real * drift, item.z_imag * (2 - drift));
  });
  return {
    fit_mode: "joint",
    adapter: "hosted-demo-adapter",
    circuit_1: model.circuit_1,
    circuit_2: model.circuit_2,
    parameters,
    confidence: parameters.map((value) => Number(Math.max(Math.abs(value) * 0.025, 1e-8).toFixed(8))),
    validation: {
      method: "MM",
      chi_square: Number((0.0008 + scale * 1e-5).toFixed(8)),
      status: "pass",
      message: "Completed in Vercel hosted demo mode; connect the Python worker for real fitting.",
    },
    plot_series: { data: dataset.rows, fit },
  };
}

function normalizeModel(model: ModelTemplate): ModelTemplate {
  if (model.circuit_1 === "RC0" && model.circuit_2 === "RCn0") {
    return {
      ...model,
      initial_guess: model.initial_guess.slice(0, 3),
      shared_parameters: ["RC0_0 -> RCn0_0", "RC0_1 -> RCn0_1"],
      bounds: { lower: [0, 0, -0.5], upper: ["inf", "inf", 0.5] },
    };
  }
  return model;
}

function parameterNames(circuit1: string, circuit2: string, values: number[]) {
  if (circuit1 === "RC0" && circuit2 === "RCn0") {
    return ["RC0_0 / RCn0_0", "RC0_1 / RCn0_1", "RCn0_2"];
  }
  return values.map((_, index) => `p${index}`);
}

function findHeader(headers: string[], candidates: string[]) {
  return candidates.reduce((found, candidate) => (found >= 0 ? found : headers.indexOf(candidate)), -1);
}

function average(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
