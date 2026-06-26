import type { Dataset, DatasetRow, ModelTemplate, Run } from "@/lib/types";
import { getCircuitParameterNames, getLegacyCircuitParameterNames, inferCircuitSharedParameters } from "@/lib/circuit-utils";

export const DEFAULT_IMPORT =
  "frequency,z_real,z_imag\n1000,0.84,-0.02\n100,1.8,-1.1\n10,7.1,-4.8\n1,14.7,-12.2";

export const ARTIFACT_KINDS = ["config", "metadata", "series", "snapshot", "summary_csv"] as const;

export function parseGuessEntries(initialGuess: string) {
  return initialGuess.split(",").map((value) => value.trim());
}

export function parseGuessValues(initialGuess: string) {
  return parseGuessEntries(initialGuess)
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));
}

export function getParameterNames(circuit1 = "", circuit2 = "") {
  return getCircuitParameterNames(circuit1, circuit2);
}

export function syncInitialGuessText(
  previousCircuit1: string,
  previousCircuit2: string,
  circuit1: string,
  circuit2: string,
  initialGuess: string,
) {
  const nextNames = getParameterNames(circuit1, circuit2);
  if (!nextNames.length) return initialGuess;

  const entries = parseGuessEntries(initialGuess);
  const valuesByParameter = new Map<string, string>();
  const previousNames = getParameterNames(previousCircuit1, previousCircuit2);
  const namesToMap = previousNames.length === entries.length
    ? previousNames
    : getLegacyCircuitParameterNames(previousCircuit1, previousCircuit2);
  namesToMap.forEach((name, index) => {
    const value = entries[index] ?? "";
    for (const alias of parameterAliases(name)) valuesByParameter.set(alias, value);
  });

  return nextNames
    .map((name) => parameterAliases(name).map((alias) => valuesByParameter.get(alias)).find((value) => value !== undefined) ?? "")
    .join(", ");
}

export function inferSharedParameters(circuit1: string, circuit2: string) {
  return inferCircuitSharedParameters(circuit1, circuit2);
}

function parameterAliases(name: string) {
  return name.split("/").map((part) => part.trim()).filter(Boolean);
}

export function filterDatasets(datasets: Dataset[], search: string) {
  const query = search.trim().toLowerCase();
  if (!query) return datasets;
  return datasets.filter((dataset) =>
    [dataset.name, dataset.kind, dataset.source_name].some((value) => value.toLowerCase().includes(query)),
  );
}

export function filterModels(models: ModelTemplate[], search: string) {
  const query = search.trim().toLowerCase();
  if (!query) return models;
  return models.filter((model) =>
    [model.name, model.kind, model.circuit_1, model.circuit_2].some((value) => value.toLowerCase().includes(query)),
  );
}

export function datasetPairKey(dataset: Dataset) {
  const name = (dataset.name || dataset.source_name).trim().toLowerCase();
  for (const suffix of ["_2nd-nleis", "-2nd-nleis", " 2nd-nleis", "_eis", "-eis", " eis"]) {
    if (name.endsWith(suffix)) return name.slice(0, -suffix.length);
  }
  return name;
}

export function matchedDatasetPairs(datasets: Dataset[]) {
  const secondByKey = new Map(
    datasets
      .filter((dataset) => dataset.kind === "2nd-NLEIS")
      .map((dataset) => [datasetPairKey(dataset), dataset]),
  );
  return datasets
    .filter((dataset) => dataset.kind === "EIS")
    .flatMap((eis) => {
      const second = secondByKey.get(datasetPairKey(eis));
      return second ? [{ eis, second }] : [];
    });
}

export function summarizeImport(text: string) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const header = lines[0] ?? "";
  const dataRows = Math.max(lines.length - 1, 0);
  const columns = header ? header.split(/[,\t;]/).map((column) => column.trim()).filter(Boolean) : [];
  const hasRequiredColumns = ["frequency", "z_real", "z_imag"].every((name) =>
    columns.some((column) => column.toLowerCase() === name),
  );
  return {
    columns,
    dataRows,
    hasRequiredColumns,
    label: `${dataRows} data rows / ${columns.length || 0} columns`,
  };
}

export function formatFrequency(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)} MHz`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(2)} kHz`;
  if (value < 1) return `${(value * 1000).toFixed(1)} mHz`;
  return `${value.toFixed(2)} Hz`;
}

export function formatAxisValue(value: number, key: keyof DatasetRow) {
  return key === "frequency" ? formatFrequency(value) : formatNumber(value);
}

export function formatNumber(value: number) {
  if (!Number.isFinite(value)) return "-";
  if (Math.abs(value) >= 1000 || Math.abs(value) < 0.01) return value.toExponential(2);
  return value.toFixed(4);
}

export function downloadRunArtifact(
  kind: string,
  run: Run,
  model?: ModelTemplate,
  dataset?: Dataset,
  result?: Run["items"][number]["result"],
) {
  const baseName = `${String(run.summary?.run_name ?? run.mode)
    .replace(/[^a-z0-9]+/gi, "_")
    .replace(/^_|_$/g, "")}_${run.id.slice(0, 8)}`;
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
