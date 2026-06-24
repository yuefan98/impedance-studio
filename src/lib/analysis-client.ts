import type { CircuitValidation, Dataset, ExecutionMode, Health, JointPreprocessing, LocalExecution, ModelTemplate, Project, Run } from "./types";

const HOSTED_API_BASE = process.env.NEXT_PUBLIC_ANALYSIS_API_URL ?? "/api";
const DEFAULT_LOCAL_API_BASE = "http://127.0.0.1:8765";
const EXECUTION_MODE_KEY = "impedance-studio.execution-mode";
const LOCAL_API_BASE_KEY = "impedance-studio.local-api-base";

let apiBase = HOSTED_API_BASE;

export type ExecutionConfig = {
  mode: ExecutionMode;
  localApiBase: string;
};

export function getExecutionConfig(): ExecutionConfig {
  if (typeof window === "undefined") return { mode: "hosted", localApiBase: DEFAULT_LOCAL_API_BASE };
  const mode = window.localStorage.getItem(EXECUTION_MODE_KEY) === "local" ? "local" : "hosted";
  const localApiBase = window.localStorage.getItem(LOCAL_API_BASE_KEY) || DEFAULT_LOCAL_API_BASE;
  apiBase = mode === "local" ? localApiBase : HOSTED_API_BASE;
  return { mode, localApiBase };
}

export function configureExecution(config: ExecutionConfig) {
  const localApiBase = normaliseApiBase(config.localApiBase || DEFAULT_LOCAL_API_BASE);
  apiBase = config.mode === "local" ? localApiBase : HOSTED_API_BASE;
  if (typeof window !== "undefined") {
    window.localStorage.setItem(EXECUTION_MODE_KEY, config.mode);
    window.localStorage.setItem(LOCAL_API_BASE_KEY, localApiBase);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const payload = await response.json();
  if (!response.ok || payload.error) {
    throw new Error(payload.error ?? `Request failed: ${response.status}`);
  }
  return payload as T;
}

export const analysisClient = {
  get apiBase() {
    return apiBase;
  },
  health: () => request<{ ok: true } & Health>("/health"),
  localExecution: () => request<{ execution: LocalExecution }>("/execution"),
  selectLocalEnvironment: (executable: string) =>
    request<{ execution: LocalExecution }>("/execution/select", {
      method: "POST",
      body: JSON.stringify({ executable }),
    }),
  createLocalEnvironment: (name: string) =>
    request<{ execution: LocalExecution }>("/execution/create", {
      method: "POST",
      body: JSON.stringify({ name }),
    }),
  projects: () => request<{ projects: Project[] }>("/projects"),
  createProject: (body: { name: string }) =>
    request<{ project: Project }>("/projects", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  deleteProject: (projectId: string) =>
    request<{ ok: true; deleted_id: string; next_project: Project }>(`/projects/${projectId}`, {
      method: "DELETE",
    }),
  datasets: (projectId?: string) =>
    request<{ datasets: Dataset[] }>(projectId ? `/datasets?project_id=${projectId}` : "/datasets"),
  deleteDataset: (datasetId: string) =>
    request<{ ok: true; deleted_id: string }>(`/datasets/${datasetId}`, {
      method: "DELETE",
    }),
  models: (projectId?: string) =>
    request<{ models: ModelTemplate[] }>(projectId ? `/models?project_id=${projectId}` : "/models"),
  deleteModel: (modelId: string) =>
    request<{ ok: true; deleted_id: string }>(`/models/${modelId}`, {
      method: "DELETE",
    }),
  runs: (projectId?: string) => request<{ runs: Run[] }>(projectId ? `/runs?project_id=${projectId}` : "/runs"),
  validateCircuit: (body: {
    circuit_1: string;
    circuit_2: string;
    initial_guess: number[];
    constants: Record<string, number>;
  }) =>
    request<{ validation: CircuitValidation }>("/circuit-templates/validate", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  saveModel: (body: Partial<ModelTemplate>) =>
    request<{ model: ModelTemplate }>("/models", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  loadAsInitial: (modelId: string) =>
    request<{ model: ModelTemplate }>(`/models/${modelId}/load-as-initial`, {
      method: "POST",
      body: JSON.stringify({}),
    }),
  exportModel: (modelId: string) => request<{ model_json: Record<string, unknown> }>(`/models/${modelId}/export-json`),
  importDataset: (body: {
    project_id: string;
    mode: "table" | "autolab" | "synthetic" | "manuscript";
    name: string;
    kind: "EIS" | "2nd-NLEIS";
    sample_index?: number;
    source_name?: string;
    text?: string;
  }) =>
    request<{ dataset: Dataset }>("/imports", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  preprocessJointData: (
    body: { project_id: string; eis_dataset_id: string; second_dataset_id: string; max_f: number },
    signal?: AbortSignal,
  ) =>
    request<{ preprocessing: JointPreprocessing }>("/preprocess/joint", {
      method: "POST",
      body: JSON.stringify(body),
      signal,
    }),
  runJointFit: (body: {
    project_id: string;
    model_id: string;
    dataset_ids: string[];
    eis_dataset_id: string;
    second_dataset_id: string;
    max_f: number;
    run_name?: string;
  }) =>
    request<{ run: Run }>("/runs/joint-fit", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  runBatchJointFit: (body: {
    project_id: string;
    model_id: string;
    dataset_ids: string[];
    eis_dataset_id: string;
    second_dataset_id: string;
    max_f: number;
    run_name?: string;
  }) =>
    request<{ run: Run }>("/runs/batch-joint-fit", {
      method: "POST",
      body: JSON.stringify(body),
  }),
};

function normaliseApiBase(value: string) {
  return value.trim().replace(/\/+$/, "") || DEFAULT_LOCAL_API_BASE;
}
