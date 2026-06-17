import type { Dataset, ModelTemplate, Run } from "@/lib/types";
import { MetricCard, PanelHeader, StatusBadge } from "./common";
import { formatFrequency, summarizeImport } from "./utils";

export function DatasetLibrary({
  activeDataset,
  activeModel,
  datasets,
  importText,
  includedDatasetIds,
  models,
  runs,
  onDeleteDataset,
  onImportEis,
  onImportSecond,
  onImportTextChange,
  onPreviewDataset,
  onToggleIncluded,
}: {
  activeDataset?: Dataset;
  activeModel?: ModelTemplate;
  datasets: Dataset[];
  importText: string;
  includedDatasetIds: string[];
  models: ModelTemplate[];
  runs: Run[];
  onDeleteDataset: (dataset: Dataset) => void;
  onImportEis: () => void;
  onImportSecond: () => void;
  onImportTextChange: (value: string) => void;
  onPreviewDataset: (id: string) => void;
  onToggleIncluded: (id: string) => void;
}) {
  const preview = summarizeImport(importText);
  const includedDatasets = datasets.filter((dataset) => includedDatasetIds.includes(dataset.id));

  return (
    <div className="database-layout">
      <section className="database-hero">
        <div>
          <span>Data library</span>
          <h1>{activeDataset ? activeDataset.name : "Preview, import, and select fit datasets"}</h1>
        </div>
        <div className="hero-actions">
          <StatusBadge tone={includedDatasets.length ? "good" : "neutral"}>{includedDatasets.length} included in fit</StatusBadge>
          <button className="danger" disabled={!activeDataset} onClick={() => activeDataset && onDeleteDataset(activeDataset)}>
            Delete previewed dataset
          </button>
        </div>
      </section>

      <section className="panel dataset-panel">
        <PanelHeader title="Dataset library" meta={`${datasets.length} datasets`} />
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Fit</th>
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
                    <input
                      aria-label={`Include ${dataset.name} in fit`}
                      checked={includedDatasetIds.includes(dataset.id)}
                      type="checkbox"
                      onChange={() => onToggleIncluded(dataset.id)}
                    />
                  </td>
                  <td>
                    <button className="table-link" onClick={() => onPreviewDataset(dataset.id)}>{dataset.name}</button>
                  </td>
                  <td>{dataset.kind}</td>
                  <td>{dataset.point_count}</td>
                  <td>{formatFrequency(dataset.freq_min)} - {formatFrequency(dataset.freq_max)}</td>
                  <td>{dataset.source_name}</td>
                </tr>
              ))}
              {!datasets.length && (
                <tr>
                  <td colSpan={6}>No datasets match the current project or search.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel import-panel">
        <PanelHeader title="Add data" meta="CSV / TSV / Autolab style" />
        <textarea value={importText} onChange={(event) => onImportTextChange(event.target.value)} spellCheck={false} />
        <div className={preview.hasRequiredColumns ? "import-preview valid" : "import-preview invalid"}>
          <strong>{preview.hasRequiredColumns ? "Ready to import" : "Missing expected columns"}</strong>
          <span>{preview.label}</span>
          <small>{preview.columns.join(", ") || "Add a header row with frequency, z_real, z_imag."}</small>
        </div>
        <div className="button-pair">
          <button onClick={onImportEis}>Import as EIS</button>
          <button onClick={onImportSecond}>Import as 2nd-NLEIS</button>
        </div>
      </section>

      <section className="panel database-side-panel">
        <PanelHeader title="Project summary" meta="local / hosted adapter" />
        <MetricCard label="Datasets" value={String(datasets.length)} />
        <MetricCard label="Included in fit" value={String(includedDatasets.length)} tone={includedDatasets.length ? "good" : undefined} />
        <MetricCard label="Saved models" value={String(models.length)} />
        <MetricCard label="Stored runs" value={String(runs.length)} />
        <div className="selected-record">
          <h3>Previewed dataset</h3>
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
