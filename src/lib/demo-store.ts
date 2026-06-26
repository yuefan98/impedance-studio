import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { validateCircuitPair } from "./circuit-utils";
import { DOCUMENTED_JOINT_TDS_TEMPLATE } from "./nleis-model-defaults";
import { getSupabaseConfigStatus } from "./supabase-config";
import type { Dataset, DatasetRow, ModelTemplate, Project, Run } from "./types";

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
  eis_dataset_id?: string;
  second_dataset_id?: string;
  max_f?: number;
  run_name?: string;
};

type FitResult = {
  fit_mode: string;
  adapter: string;
  circuit_1: string;
  circuit_2: string;
  parameters: number[];
  confidence: number[];
  validation: {
    method: string;
    chi_square: number;
    status: string;
    message: string;
  };
  plot_series: { data: DatasetRow[]; fit: DatasetRow[] };
};

type JointPreprocessing = {
  max_f: number;
  method: string;
  inductance_points_removed: number;
  second_points_removed: number;
  eis: Dataset;
  second: Dataset;
};

export type JointFitInput = {
  eis_dataset: Dataset;
  second_dataset: Dataset;
  model: ModelTemplate;
  max_f: number;
};

export type EisFitInput = {
  eis_dataset: Dataset;
  model: ModelTemplate;
};

export type JointFitAnalysis = {
  preprocessing: JointPreprocessing;
  eis: { dataset: Dataset; result: FitResult };
  second: { dataset: Dataset; result: FitResult };
};

export type EisFitAnalysis = {
  eis: { dataset: Dataset; result: FitResult };
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
    const realEngineEnabled = Boolean(process.env.VERCEL || process.env.ANALYSIS_ENGINE_URL);
    return {
      ok: true,
      mode: realEngineEnabled ? "hosted-vercel-nleis" : "preview-no-fit",
      database: "ephemeral Vercel demo store",
      supabase: getSupabaseConfigStatus(),
      optional_libraries: { impedance: realEngineEnabled, nleis: realEngineEnabled },
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

  validateTemplate(payload: { circuit_1?: string; circuit_2?: string; initial_guess?: number[]; constants?: Record<string, number> }) {
    return validateCircuitPair(
      payload.circuit_1 || "",
      payload.circuit_2 || "",
      payload.initial_guess || [],
      payload.constants || {},
    );
  }

  listModels(projectId?: string) {
    return this.models
      .filter((model) => !projectId || model.project_id === projectId || model.pinned)
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updated_at.localeCompare(a.updated_at));
  }

  createModel(payload: ModelPayload) {
    const now = this.now();
    const model: ModelTemplate = {
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
    };
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

  jointFitInput(payload: RunPayload): JointFitInput {
    const projectId = payload.project_id || this.defaultProjectId();
    const model = this.requireModel(payload.model_id || this.defaultModelId(projectId));
    const { eis, second } = this.jointDatasets(payload, projectId);
    return {
      eis_dataset: eis,
      second_dataset: second,
      model,
      max_f: payload.max_f ?? 10,
    };
  }

  jointFitInputs(payload: RunPayload): JointFitInput[] {
    const projectId = payload.project_id || this.defaultProjectId();
    const model = this.requireModel(payload.model_id || this.defaultModelId(projectId));
    return this.jointDatasetPairs(payload, projectId).map(({ eis, second }) => ({
      eis_dataset: eis,
      second_dataset: second,
      model,
      max_f: payload.max_f ?? 10,
    }));
  }

  eisFitInput(payload: RunPayload): EisFitInput {
    const projectId = payload.project_id || this.defaultProjectId();
    const model = this.requireModel(payload.model_id || this.defaultModelId(projectId));
    return {
      eis_dataset: this.eisDataset(payload, projectId),
      model,
    };
  }

  runJointFit(payload: RunPayload, batch = false, analysis?: JointFitAnalysis | JointFitAnalysis[]) {
    if (!analysis || (Array.isArray(analysis) && !analysis.length)) {
      throw new Error("A joint fit requires an nleis.EISandNLEIS analysis result from the selected execution engine.");
    }
    const analyses = Array.isArray(analysis) ? analysis : [analysis];
    const projectId = payload.project_id || this.defaultProjectId();
    const model = this.requireModel(payload.model_id || this.defaultModelId(projectId));
    const preprocessing = analyses[0].preprocessing;
    const fittedDatasets = analyses.flatMap((item) => [item.eis, item.second]);
    const now = this.now();
    const runId = this.id("run");
    const snapshots: ModelTemplate[] = [];
    const items = fittedDatasets.map(({ dataset, result }) => {
      const item = {
        id: this.id("item"),
        run_id: runId,
        dataset_id: dataset.id,
        status: "completed",
        progress: 100,
        message: "Joint fit completed with nleis.EISandNLEIS",
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
      summary: {
        dataset_count: fittedDatasets.length,
        pair_count: analyses.length,
        fit_mode: "joint",
        max_f: preprocessing.max_f,
        preprocessing_method: preprocessing.method,
        run_name: payload.run_name || (batch ? "Batch joint fit" : "Joint fit"),
      },
      items,
      snapshots,
    };
    this.runs.unshift(run);
    return run;
  }

  runEisFit(payload: RunPayload, analysis?: EisFitAnalysis) {
    if (!analysis) {
      throw new Error("An EIS-only fit requires an impedance.py analysis result from the selected execution engine.");
    }
    const projectId = payload.project_id || this.defaultProjectId();
    const model = this.requireModel(payload.model_id || this.defaultModelId(projectId));
    const { dataset, result } = analysis.eis;
    const now = this.now();
    const runId = this.id("run");
    const item = {
      id: this.id("item"),
      run_id: runId,
      dataset_id: dataset.id,
      status: "completed",
      progress: 100,
      message: "EIS-only fit completed with impedance.py",
      result,
    };
    const snapshot = this.createModel({
      project_id: projectId,
      name: `${model.name} EIS fit to ${dataset.name}`,
      kind: "snapshot",
      circuit_1: model.circuit_1,
      circuit_2: "",
      initial_guess: model.initial_guess,
      bounds: model.bounds,
      constants: model.constants,
      shared_parameters: [],
      fitted_parameters: result.parameters,
      validation_summary: result.validation,
      plot_series: result.plot_series,
      source_run_id: runId,
    });
    const run: Run = {
      id: runId,
      project_id: projectId,
      model_id: model.id,
      mode: "eis-fit",
      status: "completed",
      progress: 100,
      started_at: now,
      completed_at: now,
      summary: {
        dataset_count: 1,
        fit_mode: "eis",
        run_name: payload.run_name || "EIS-only fit",
      },
      items: [item],
      snapshots: [snapshot],
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
      name: DOCUMENTED_JOINT_TDS_TEMPLATE.name,
      scope: "project",
      pinned: true,
      circuit_1: DOCUMENTED_JOINT_TDS_TEMPLATE.circuit1,
      circuit_2: DOCUMENTED_JOINT_TDS_TEMPLATE.circuit2,
      initial_guess: [...DOCUMENTED_JOINT_TDS_TEMPLATE.initialGuess],
      bounds: {},
      constants: {},
      shared_parameters: [
        "TDS0_0 -> TDSn0_0",
        "TDS0_1 -> TDSn0_1",
        "TDS0_2 -> TDSn0_2",
        "TDS0_3 -> TDSn0_3",
        "TDS0_4 -> TDSn0_4",
        "TDS1_0 -> TDSn1_0",
        "TDS1_1 -> TDSn1_1",
        "TDS1_2 -> TDSn1_2",
        "TDS1_3 -> TDSn1_3",
        "TDS1_4 -> TDSn1_4",
      ],
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
    return this.listModels(projectId)[0]?.id || this.createModel({
      project_id: projectId,
      name: DOCUMENTED_JOINT_TDS_TEMPLATE.name,
      circuit_1: DOCUMENTED_JOINT_TDS_TEMPLATE.circuit1,
      circuit_2: DOCUMENTED_JOINT_TDS_TEMPLATE.circuit2,
      initial_guess: [...DOCUMENTED_JOINT_TDS_TEMPLATE.initialGuess],
    }).id;
  }

  private defaultDatasetId(projectId: string) {
    return this.listDatasets(projectId)[0]?.id || this.insertDataset(projectId, syntheticDataset("EIS", "Synthetic EIS")).id;
  }

  preprocessJointData(payload: RunPayload) {
    const projectId = payload.project_id || this.defaultProjectId();
    const { eis, second } = this.jointDatasets(payload, projectId);
    return preprocessJointDatasets(eis, second, payload.max_f ?? 10);
  }

  private jointDatasets(payload: RunPayload, projectId: string) {
    const requested = (payload.dataset_ids || []).map((datasetId) => this.requireDataset(datasetId));
    const projectDatasets = this.listDatasets(projectId);
    const eis = payload.eis_dataset_id
      ? this.requireDataset(payload.eis_dataset_id)
      : requested.find((dataset) => dataset.kind === "EIS") ?? projectDatasets.find((dataset) => dataset.kind === "EIS");
    const second = payload.second_dataset_id
      ? this.requireDataset(payload.second_dataset_id)
      : requested.find((dataset) => dataset.kind === "2nd-NLEIS") ?? projectDatasets.find((dataset) => dataset.kind === "2nd-NLEIS");
    if (!eis || !second) throw new Error("Joint preprocessing requires one EIS and one 2nd-NLEIS dataset.");
    if (eis.project_id !== projectId || second.project_id !== projectId) {
      throw new Error("Selected datasets must belong to the active project.");
    }
    return { eis, second };
  }

  private jointDatasetPairs(payload: RunPayload, projectId: string) {
    const requestedIds = payload.dataset_ids || [];
    const candidates = requestedIds.length ? requestedIds.map((datasetId) => this.requireDataset(datasetId)) : this.listDatasets(projectId);
    for (const dataset of candidates) {
      if (dataset.project_id !== projectId) throw new Error("Selected datasets must belong to the active project.");
    }
    const eisDatasets = candidates.filter((dataset) => dataset.kind === "EIS");
    const secondsByKey = new Map(
      candidates
        .filter((dataset) => dataset.kind === "2nd-NLEIS")
        .map((dataset) => [datasetPairKey(dataset), dataset]),
    );
    if (eisDatasets.length === 1 && secondsByKey.size === 1) {
      return [{ eis: eisDatasets[0], second: [...secondsByKey.values()][0] }];
    }
    const pairs = eisDatasets.flatMap((eis) => {
      const second = secondsByKey.get(datasetPairKey(eis));
      return second ? [{ eis, second }] : [];
    });
    if (!pairs.length) throw new Error("Batch joint fitting requires at least one matched EIS and 2nd-NLEIS pair.");
    return pairs;
  }

  private eisDataset(payload: RunPayload, projectId: string) {
    const requested = (payload.dataset_ids || []).map((datasetId) => this.requireDataset(datasetId));
    const dataset = payload.eis_dataset_id
      ? this.requireDataset(payload.eis_dataset_id)
      : requested.find((candidate) => candidate.kind === "EIS") ?? this.listDatasets(projectId).find((candidate) => candidate.kind === "EIS");
    if (!dataset || dataset.kind !== "EIS") throw new Error("EIS-only fitting requires one EIS dataset.");
    if (dataset.project_id !== projectId) throw new Error("Selected datasets must belong to the active project.");
    return dataset;
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

function preprocessJointDatasets(eis: Dataset, second: Dataset, maxF: number) {
  if (!Number.isFinite(maxF) || maxF <= 0) throw new Error("max_f must be a finite positive frequency in Hz.");
  const secondByFrequency = new Map(second.rows.map((item) => [item.frequency, item]));
  if (secondByFrequency.size !== second.rows.length) throw new Error("2nd-NLEIS contains duplicate frequencies.");
  const paired = eis.rows.flatMap((first) => {
    const secondRow = secondByFrequency.get(first.frequency);
    return secondRow ? [{ first, second: secondRow }] : [];
  });
  if (!paired.length) throw new Error("EIS and 2nd-NLEIS must share at least one frequency for joint preprocessing.");
  const inductanceRemoved = paired.filter(({ first }) => first.z_imag < 0);
  const secondTruncated = inductanceRemoved.filter(({ first }) => first.frequency < maxF);
  if (!inductanceRemoved.length) throw new Error("Preprocessing removed every EIS point because Z1'' must be negative.");
  if (!secondTruncated.length) throw new Error(`max_f=${maxF} Hz retains no 2nd-NLEIS points; choose a larger maximum frequency.`);
  return {
    max_f: maxF,
    method: "nleis.data_processing.data_truncation-compatible",
    inductance_points_removed: paired.length - inductanceRemoved.length,
    second_points_removed: inductanceRemoved.length - secondTruncated.length,
    eis: datasetWithRows(eis, inductanceRemoved.map(({ first }) => first)),
    second: datasetWithRows(second, secondTruncated.map(({ second: secondRow }) => secondRow)),
  };
}

function datasetWithRows(dataset: Dataset, rows: DatasetRow[]): Dataset {
  return {
    ...dataset,
    point_count: rows.length,
    freq_min: Math.min(...rows.map((row) => row.frequency)),
    freq_max: Math.max(...rows.map((row) => row.frequency)),
    rows,
  };
}

function findHeader(headers: string[], candidates: string[]) {
  return candidates.reduce((found, candidate) => (found >= 0 ? found : headers.indexOf(candidate)), -1);
}

function average(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function datasetPairKey(dataset: Dataset) {
  const name = (dataset.name || dataset.source_name).trim().toLowerCase();
  for (const suffix of ["_2nd-nleis", "-2nd-nleis", " 2nd-nleis", "_eis", "-eis", " eis"]) {
    if (name.endsWith(suffix)) return name.slice(0, -suffix.length);
  }
  return name;
}
