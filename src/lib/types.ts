export type Project = {
  id: string;
  name: string;
  created_at: string;
};

export type DatasetRow = {
  frequency: number;
  z_real: number;
  z_imag: number;
  z_abs: number;
  phase: number;
};

export type Dataset = {
  id: string;
  project_id: string;
  name: string;
  kind: "EIS" | "2nd-NLEIS" | string;
  source_name: string;
  point_count: number;
  freq_min: number;
  freq_max: number;
  temperature_c: number | null;
  rows: DatasetRow[];
  created_at: string;
};

export type ModelTemplate = {
  id: string;
  project_id: string | null;
  name: string;
  kind: "template" | "snapshot" | string;
  scope: string;
  circuit_1: string;
  circuit_2: string;
  initial_guess: number[];
  bounds: Record<string, unknown>;
  constants: Record<string, number>;
  shared_parameters: string[];
  fitted_parameters: number[] | null;
  validation_summary: Record<string, unknown> | null;
  plot_series: PlotSeries | null;
  source_run_id: string | null;
  pinned: boolean;
  created_at: string;
  updated_at: string;
};

export type CircuitValidation = {
  valid: boolean;
  errors: string[];
  warnings: string[];
  elements_1: string[];
  elements_2: string[];
  estimated_parameters: number;
  parameter_names: string[];
};

export type PlotSeries = {
  data: DatasetRow[];
  fit: DatasetRow[];
};

export type RunItem = {
  id: string;
  run_id: string;
  dataset_id: string;
  status: string;
  progress: number;
  message: string;
  result?: {
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
    plot_series: PlotSeries;
  };
};

export type Run = {
  id: string;
  project_id: string;
  model_id: string;
  mode: string;
  status: string;
  progress: number;
  started_at: string;
  completed_at: string | null;
  summary: Record<string, unknown>;
  items: RunItem[];
  snapshots?: ModelTemplate[];
};

export type Health = {
  ok: boolean;
  mode: string;
  database: string;
  optional_libraries: Record<string, boolean>;
};
