import type { Dataset, Health, ModelTemplate } from "@/lib/types";
import type { ReactNode } from "react";
import { PanelHeader, ParameterSummary, StatusBadge } from "./common";

export function FitSetup({
  activeModel,
  busyAction,
  datasets,
  execution,
  health,
  eisDatasetId,
  includedDatasetIds,
  maxFrequency,
  models,
  runName,
  secondDatasetId,
  onBatch,
  onEisDatasetChange,
  onIncludeDataset,
  onMaxFrequencyChange,
  onModelChange,
  onRun,
  onRunNameChange,
  onSecondDatasetChange,
}: {
  activeModel?: ModelTemplate;
  busyAction: string | null;
  datasets: Dataset[];
  execution: ReactNode;
  health: Health | null;
  eisDatasetId: string;
  includedDatasetIds: string[];
  maxFrequency: number;
  models: ModelTemplate[];
  runName: string;
  secondDatasetId: string;
  onBatch: () => void;
  onEisDatasetChange: (id: string) => void;
  onIncludeDataset: (id: string) => void;
  onMaxFrequencyChange: (frequency: number) => void;
  onModelChange: (id: string) => void;
  onRun: () => void;
  onRunNameChange: (name: string) => void;
  onSecondDatasetChange: (id: string) => void;
}) {
  const eisDatasets = datasets.filter((dataset) => dataset.kind === "EIS");
  const secondDatasets = datasets.filter((dataset) => dataset.kind === "2nd-NLEIS");
  const eisDataset = datasets.find((dataset) => dataset.id === eisDatasetId);
  const secondDataset = datasets.find((dataset) => dataset.id === secondDatasetId);
  const selectedPairIncluded = Boolean(
    eisDataset &&
      secondDataset &&
      includedDatasetIds.includes(eisDataset.id) &&
      includedDatasetIds.includes(secondDataset.id),
  );
  const canRun = Boolean(selectedPairIncluded && activeModel && maxFrequency > 0 && health?.optional_libraries.nleis);

  return (
    <section className="panel config-panel">
      <PanelHeader title="Fit setup" meta="joint EIS + 2nd-NLEIS" actions={<StatusBadge tone={canRun ? "good" : "neutral"}>{includedDatasetIds.length} selected</StatusBadge>} />
      <label className="field-readout">
        <span>Run name</span>
        <input value={runName} onChange={(event) => onRunNameChange(event.target.value)} />
      </label>
      {execution}
      <label className="field-readout">
        <span>2nd-NLEIS max f (Hz)</span>
        <input
          aria-describedby="second-nleis-truncation-note"
          min="0"
          onChange={(event) => {
            const value = Number.parseFloat(event.target.value);
            if (Number.isFinite(value)) onMaxFrequencyChange(value);
          }}
          step="any"
          type="number"
          value={maxFrequency}
        />
        <small id="second-nleis-truncation-note" className="field-note">
          Applies nleis.py truncation: inductive EIS rows are removed and 2nd-NLEIS retains f &lt; max f.
        </small>
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
        <button disabled={!canRun || busyAction !== null} onClick={onRun}>Run selected fit</button>
        <button className="primary" disabled={!canRun || busyAction !== null} onClick={onBatch}>Run batch joint fit</button>
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
