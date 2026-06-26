import { useMemo } from "react";
import type { Dataset, JointPreprocessing, ModelTemplate, Run } from "@/lib/types";
import { ARTIFACT_KINDS, downloadRunArtifact, formatFrequency, formatNumber } from "./utils";
import { MetricCard, PanelHeader, ParameterTable, StatusBadge } from "./common";
import { PlotCard } from "./plot-card";

export function RunResults({
  activeDataset,
  activeModel,
  activeRun,
  activeRunItem,
  datasets,
  eisDatasetId,
  preprocessing,
  secondDatasetId,
  onRunItemSelect,
}: {
  activeDataset?: Dataset;
  activeModel?: ModelTemplate;
  activeRun?: Run;
  activeRunItem?: Run["items"][number];
  datasets: Dataset[];
  eisDatasetId: string;
  preprocessing: JointPreprocessing | null;
  secondDatasetId: string;
  onRunItemSelect: (itemId: string) => void;
}) {
  const activeResult = activeRunItem?.result;
  const isEisOnlyRun = activeRun?.mode === "eis-fit";
  const activeRunDataset = datasets.find((dataset) => dataset.id === activeRunItem?.dataset_id);
  const eisDataset = datasets.find((dataset) => dataset.id === eisDatasetId);
  const secondDataset = datasets.find((dataset) => dataset.id === secondDatasetId);
  const activeEisResult = isEisOnlyRun ? activeResult : activeRun?.items.find((item) => item.dataset_id === eisDatasetId)?.result;
  const activeSecondResult = activeRun?.items.find((item) => item.dataset_id === secondDatasetId)?.result;
  const displayedEis = useMemo(
    () => {
      if (isEisOnlyRun) return resultDataset(activeRunDataset, activeEisResult?.plot_series.data);
      return preprocessing?.eis ?? resultDataset(eisDataset, activeEisResult?.plot_series.data);
    },
    [activeEisResult?.plot_series.data, activeRunDataset, eisDataset, isEisOnlyRun, preprocessing?.eis],
  );
  const displayedSecond = useMemo(
    () => preprocessing?.second ?? resultDataset(secondDataset, activeSecondResult?.plot_series.data),
    [activeSecondResult?.plot_series.data, preprocessing?.second, secondDataset],
  );
  const eisComparisonDatasets = useMemo(() => (displayedEis ? [displayedEis] : []), [displayedEis]);
  const secondComparisonDatasets = useMemo(() => (displayedSecond ? [displayedSecond] : []), [displayedSecond]);
  const fitRows = activeEisResult?.plot_series.fit;
  const secondFitRows = activeSecondResult?.plot_series.fit;
  const metricCards = [
    { label: "Final chi-square", value: activeResult ? formatNumber(activeResult.validation.chi_square) : "-" },
    { label: "Run datasets", value: activeRun ? String(activeRun.items.length) : "0" },
    { label: "Snapshots", value: String(activeRun?.snapshots?.length ?? 0) },
  ];

  return (
    <>
      <section className="panel results-panel">
        <PanelHeader
          title="Results"
          meta={
            isEisOnlyRun
              ? "EIS-only fit"
              : preprocessing
                ? `nleis.py preprocessing / max f ${formatFrequency(preprocessing.max_f)}`
                : activeRun?.id ?? "preprocessing data"
          }
        />
        <div className="plot-canvas plot-stack">
          <PlotCard
            title="EIS Nyquist: Z'' versus Z'"
            rows={displayedEis?.rows ?? []}
            comparisonDatasets={eisComparisonDatasets}
            fitRows={fitRows}
            xKey="z_real"
            yKey="z_imag"
            invertY
          />
          {!isEisOnlyRun && (
            <PlotCard
              title="2nd-NLEIS Nyquist: Z2'' versus Z2'"
              rows={displayedSecond?.rows ?? []}
              comparisonDatasets={secondComparisonDatasets}
              fitRows={secondFitRows}
              xKey="z_real"
              yKey="z_imag"
              invertY
            />
          )}
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
          {!isEisOnlyRun && (
            <>
              <dt>2nd-NLEIS max f</dt>
              <dd>{preprocessing ? formatFrequency(preprocessing.max_f) : "-"}</dd>
            </>
          )}
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

function resultDataset(dataset: Dataset | undefined, rows: Dataset["rows"] | undefined) {
  return dataset && rows ? { ...dataset, rows, point_count: rows.length } : dataset;
}
