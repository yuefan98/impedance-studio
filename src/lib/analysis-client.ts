import type { CircuitValidation, Dataset, Health, ModelTemplate, Project, Run } from "./types";

const API_BASE = process.env.NEXT_PUBLIC_ANALYSIS_API_URL ?? "http://127.0.0.1:8765";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
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
  apiBase: API_BASE,
  health: () => request<{ ok: true } & Health>("/health"),
  projects: () => request<{ projects: Project[] }>("/projects"),
  datasets: (projectId?: string) =>
    request<{ datasets: Dataset[] }>(projectId ? `/datasets?project_id=${projectId}` : "/datasets"),
  models: (projectId?: string) =>
    request<{ models: ModelTemplate[] }>(projectId ? `/models?project_id=${projectId}` : "/models"),
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
    mode: "table" | "autolab" | "synthetic";
    name: string;
    kind: "EIS" | "2nd-NLEIS";
    source_name?: string;
    text?: string;
  }) =>
    request<{ dataset: Dataset }>("/imports", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  runJointFit: (body: { project_id: string; model_id: string; dataset_ids: string[] }) =>
    request<{ run: Run }>("/runs/joint-fit", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  runBatchJointFit: (body: { project_id: string; model_id: string; dataset_ids: string[] }) =>
    request<{ run: Run }>("/runs/batch-joint-fit", {
      method: "POST",
      body: JSON.stringify(body),
    }),
};
