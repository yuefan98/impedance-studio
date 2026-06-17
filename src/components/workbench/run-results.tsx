import type { Dataset, ModelTemplate, Run } from "@/lib/types";
import { ARTIFACT_KINDS, downloadRunArtifact, formatNumber } from "./utils";
import { MetricCard, PanelHeader, ParameterTable, StatusBadge } from "./common";
import { PlotCard } from "./plot-card";

export function RunResults({
  activeDataset,
  activeModel,
  activeRun,
  activeRunItem,
  datasets,
  eisDatasetId,
  includedDatasets,
  secondDatasetId,
  onRunItemSelect,
}: {
  activeDataset?: Dataset;
  activeModel?: ModelTemplate;
  activeRun?: Run;
  activeRunItem?: Run["items"][number];
  datasets: Dataset[];
  eisDatasetId: string;
  includedDatasets: Dataset[];
  secondDatasetId: string;
  onRunItemSelect: (itemId: string) => void;
}) {
  const activeResult = activeRunItem?.result;
  const activeRunDataset = datasets.find((dataset) => dataset.id === activeRunItem?.dataset_id);
  const eisDataset = datasets.find((dataset) => dataset.id === eisDatasetId);
  const secondDataset = datasets.find((dataset) => dataset.id === secondDatasetId);
  const selectedEisDatasets = includedDatasets.filter((dataset) => dataset.kind === "EIS");
  const selectedSecondDatasets = includedDatasets.filter((dataset) => dataset.kind === "2nd-NLEIS");
  const fitRows = activeRunDataset?.kind === "EIS" ? activeResult?.plot_series.fit : undefined;
  const secondFitRows = activeRunDataset?.kind === "2nd-NLEIS" ? activeResult?.plot_series.fit : undefined;
  const metricCards = [
    { label: "Final chi-square", value: activeResult ? formatNumber(activeResult.validation.chi_square) : "-" },
    { label: "Run datasets", value: activeRun ? String(activeRun.items.length) : "0" },
    { label: "Snapshots", value: String(activeRun?.snapshots?.length ?? 0) },
  ];

  return (
    <>
      <section className="panel results-panel">
        <PanelHeader title="Results" meta={activeRun?.id ?? "waiting for run"} />
        <div className="plot-canvas plot-stack">
          <PlotCard
            title="EIS Nyquist: Z'' versus Z'"
            rows={eisDataset?.rows ?? []}
            comparisonDatasets={selectedEisDatasets.length ? selectedEisDatasets : eisDataset ? [eisDataset] : []}
            fitRows={fitRows}
            xKey="z_real"
            yKey="z_imag"
            invertY
          />
          <PlotCard
            title="2nd-NLEIS Nyquist: Z2'' versus Z2'"
            rows={secondDataset?.rows ?? []}
            comparisonDatasets={selectedSecondDatasets.length ? selectedSecondDatasets : secondDataset ? [secondDataset] : []}
            fitRows={secondFitRows}
            xKey="z_real"
            yKey="z_imag"
            invertY
          />
        </div>
        <div className="metric-grid">
          {metricCards.map((card) => (
            <MetricCard key={card.label} label={card.label} value={card.value} />
          ))}
        </div>
      </section>

      <section className="panel inspector-panel">
        <PanelHeader title="Run inspector" meta={activeRun?.status ?? "idle"} />
        <dl>
          <dt>Run ID</dt>
          <dd>{activeRun?.id ?? "-"}</dd>
          <dt>Mode</dt>
          <dd>{activeRun?.mode ?? "-"}</dd>
          <dt>Model</dt>
          <dd>{activeModel?.name ?? "-"}</dd>
          <dt>Dataset</dt>
          <dd>{activeRunDataset?.name ?? activeDataset?.name ?? "-"}</dd>
          <dt>Adapter</dt>
          <dd>{activeResult?.adapter ?? "-"}</dd>
          <dt>Status</dt>
          <dd>{activeRun ? <StatusBadge tone={activeRun.status === "completed" ? "good" : "neutral"}>{activeRun.status}</StatusBadge> : "not run"}</dd>
        </dl>
        {activeRun?.items.length ? (
          <label className="field-readout">
            <span>Run dataset item</span>
            <select value={activeRunItem?.id ?? ""} onChange={(event) => onRunItemSelect(event.target.value)}>
              {activeRun.items.map((item) => {
                const dataset = datasets.find((candidate) => candidate.id === item.dataset_id);
                return (
                  <option key={item.id} value={item.id}>{dataset?.name ?? item.dataset_id}</option>
                );
              })}
            </select>
          </label>
        ) : null}
        <div className="download-list">
          {ARTIFACT_KINDS.map((item) => (
            <button
              disabled={!activeRun}
              key={item}
              onClick={() => activeRun && downloadRunArtifact(item, activeRun, activeModel, activeRunDataset ?? activeDataset, activeResult)}
            >
              Export {item}
            </button>
          ))}
        </div>
        {activeResult ? (
          <ParameterTable values={activeResult.parameters} confidence={activeResult.confidence} />
        ) : (
          <p className="empty-state">Run a fit or pick a run item to populate fitted parameters and validation.</p>
        )}
      </section>
    </>
  );
}
