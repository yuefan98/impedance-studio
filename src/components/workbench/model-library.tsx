import type { ModelTemplate } from "@/lib/types";
import { PanelHeader } from "./common";

export function ModelLibrary({
  activeModelId,
  models,
  snapshots,
  templates,
  onLoadSnapshot,
  onModelSelect,
}: {
  activeModelId: string;
  models: ModelTemplate[];
  snapshots: ModelTemplate[];
  templates: ModelTemplate[];
  onLoadSnapshot: (id: string) => void;
  onModelSelect: (model: ModelTemplate) => void;
}) {
  return (
    <>
      <section className="panel model-library-panel">
        <PanelHeader title="Saved models" meta={`${templates.length} templates / ${snapshots.length} snapshots`} />
        <div className="library-list">
          {models.map((model) => (
            <button
              key={model.id}
              className={model.id === activeModelId ? "library-row active" : "library-row"}
              onClick={() => onModelSelect(model)}
            >
              <span>
                <strong>{model.name}</strong>
                <small>{model.circuit_1} / {model.circuit_2}</small>
              </span>
              <em>{model.kind}</em>
            </button>
          ))}
          {!models.length && <p className="empty-state">No saved models match the current search.</p>}
        </div>
      </section>

      <section className="panel snapshot-panel">
        <PanelHeader title="Fitted snapshots" meta="load as initial" />
        {snapshots.length ? (
          <div className="library-list">
            {snapshots.map((snapshot) => (
              <button key={snapshot.id} className="library-row" onClick={() => onLoadSnapshot(snapshot.id)}>
                <span>
                  <strong>{snapshot.name}</strong>
                  <small>{snapshot.source_run_id ?? "stored fit"}</small>
                </span>
                <em>load</em>
              </button>
            ))}
          </div>
        ) : (
          <p className="empty-state">Run a fit to create fitted snapshots.</p>
        )}
      </section>
    </>
  );
}
