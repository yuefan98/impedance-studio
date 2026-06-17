import type { Dataset, ModelTemplate } from "@/lib/types";
import { PanelHeader, ParameterSummary, StatusBadge } from "./common";

export function FitSetup({
  activeModel,
  busyAction,
  datasets,
  eisDatasetId,
  includedDatasetIds,
  models,
  runName,
  secondDatasetId,
  onBatch,
  onEisDatasetChange,
  onIncludeDataset,
  onModelChange,
  onRun,
  onRunNameChange,
  onSecondDatasetChange,
}: {
  activeModel?: ModelTemplate;
  busyAction: string | null;
  datasets: Dataset[];
  eisDatasetId: string;
  includedDatasetIds: string[];
  models: ModelTemplate[];
  runName: string;
  secondDatasetId: string;
  onBatch: () => void;
  onEisDatasetChange: (id: string) => void;
  onIncludeDataset: (id: string) => void;
  onModelChange: (id: string) => void;
  onRun: () => void;
  onRunNameChange: (name: string) => void;
  onSecondDatasetChange: (id: string) => void;
}) {
  const eisDatasets = datasets.filter((dataset) => dataset.kind === "EIS");
  const secondDatasets = datasets.filter((dataset) => dataset.kind === "2nd-NLEIS");
  const eisDataset = datasets.find((dataset) => dataset.id === eisDatasetId);
  const secondDataset = datasets.find((dataset) => dataset.id === secondDatasetId);
  const canRun = Boolean(includedDatasetIds.length && activeModel);

  return (
    <section className="panel config-panel">
      <PanelHeader title="Fit setup" meta="joint EIS + 2nd-NLEIS" actions={<StatusBadge tone={canRun ? "good" : "neutral"}>{includedDatasetIds.length} selected</StatusBadge>} />
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
        included={Boolean(eisDataset && includedDatasetIds.includes(eisDataset.id))}
        label="EIS preview"
        onChange={onEisDatasetChange}
        onInclude={onIncludeDataset}
      />
      <DatasetFitPicker
        dataset={secondDataset}
        datasets={secondDatasets}
        included={Boolean(secondDataset && includedDatasetIds.includes(secondDataset.id))}
        label="2nd-NLEIS preview"
        onChange={onSecondDatasetChange}
        onInclude={onIncludeDataset}
      />
      <div className="circuit-readout">
        <span>EIS</span>
        <code>{activeModel?.circuit_1 ?? "-"}</code>
        <span>2nd-NLEIS</span>
        <code>{activeModel?.circuit_2 ?? "-"}</code>
      </div>
      <ParameterSummary model={activeModel} />
      <div className="stacked-actions">
        <button disabled={!canRun || busyAction === "run"} onClick={onRun}>Run selected fit</button>
        <button className="primary" disabled={!canRun || busyAction === "batch"} onClick={onBatch}>Run batch joint fit</button>
      </div>
    </section>
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
