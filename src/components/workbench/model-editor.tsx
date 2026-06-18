import type { CircuitValidation, ModelTemplate } from "@/lib/types";
import type { ModelDraft } from "./types";
import { MetricCard, PanelHeader, StatusBadge } from "./common";
import { getParameterNames } from "./utils";

export function ModelEditor({
  activeModel,
  busyAction,
  draft,
  guessEntries,
  guessValues,
  validation,
  onDelete,
  onDraftChange,
  onDuplicateSnapshot,
  onGuessItemChange,
  onResetDraft,
  onSave,
  onValidate,
}: {
  activeModel?: ModelTemplate;
  busyAction: string | null;
  draft: ModelDraft;
  guessEntries: string[];
  guessValues: number[];
  validation: CircuitValidation | null;
  onDelete: () => void;
  onDraftChange: (update: Partial<Pick<ModelDraft, "name" | "circuit1" | "circuit2" | "initialGuess">>) => void;
  onDuplicateSnapshot: () => void;
  onGuessItemChange: (index: number, value: string) => void;
  onResetDraft: () => void;
  onSave: () => void;
  onValidate: () => void;
}) {
  const names = getParameterNames(draft.circuit1, draft.circuit2, guessValues);
  const canDuplicateSnapshot = activeModel?.kind === "snapshot";
  const hasValidationWarnings = Boolean(validation?.warnings.length);
  const validationClass = validation?.valid ? (hasValidationWarnings ? "validation warning" : "validation valid") : "validation invalid";
  const validationLabel = validation?.valid
    ? hasValidationWarnings
      ? "Circuit pair has warnings"
      : "Circuit pair valid"
    : "Circuit pair needs attention";

  return (
    <section className="panel model-editor-panel">
      <PanelHeader
        title="Circuit editor"
        meta={`${guessValues.length} initial guesses`}
        actions={<StatusBadge tone={draft.dirty ? "warn" : "good"}>{draft.dirty ? "Unsaved draft" : "Saved source"}</StatusBadge>}
      />
      <div className="editor-toolbar">
        <button disabled={busyAction === "validate"} onClick={onValidate}>Validate</button>
        <button disabled={!draft.dirty} onClick={onResetDraft}>Reset draft</button>
        <button disabled={!canDuplicateSnapshot || busyAction === "load"} onClick={onDuplicateSnapshot}>Duplicate from snapshot</button>
        <button className="danger" disabled={!activeModel || busyAction === "model"} onClick={onDelete}>Delete</button>
        <button className="primary" disabled={busyAction === "save"} onClick={onSave}>Save as new template</button>
      </div>
      <div className="editor-grid">
        <label>
          <span>Template name</span>
          <input value={draft.name} onChange={(event) => onDraftChange({ name: event.target.value })} />
        </label>
        <label>
          <span>Source model</span>
          <input value={activeModel?.name ?? "New template"} readOnly />
        </label>
        <label>
          <span>EIS circuit_1</span>
          <input value={draft.circuit1} onChange={(event) => onDraftChange({ circuit1: event.target.value })} />
        </label>
        <label>
          <span>2nd-NLEIS circuit_2</span>
          <input value={draft.circuit2} onChange={(event) => onDraftChange({ circuit2: event.target.value })} />
        </label>
      </div>
      <label>
        <span>Initial guesses</span>
        <textarea value={draft.initialGuess} onChange={(event) => onDraftChange({ initialGuess: event.target.value })} spellCheck={false} />
      </label>
      <ParameterEditor names={names} values={guessEntries} onChange={onGuessItemChange} />
      {validation && (
        <div className={validationClass}>
          <strong>{validationLabel}</strong>
          <span>{validation.estimated_parameters} estimated parameters</span>
          {validation.errors.map((message) => (
            <small key={`error-${message}`}>Error: {message}</small>
          ))}
          {validation.warnings.map((message) => (
            <small key={`warning-${message}`}>Warning: {message}</small>
          ))}
        </div>
      )}
      <div className="model-summary-grid">
        <MetricCard label="Active kind" value={activeModel?.kind ?? "-"} />
        <MetricCard label="Scope" value={activeModel?.scope ?? "-"} />
        <MetricCard label="Shared params" value={String(activeModel?.shared_parameters?.length ?? 0)} />
      </div>
    </section>
  );
}

function ParameterEditor({
  names,
  onChange,
  values,
}: {
  names: string[];
  onChange: (index: number, value: string) => void;
  values: string[];
}) {
  return (
    <table className="parameter-table">
      <thead>
        <tr>
          <th>Parameter</th>
          <th>Initial guess</th>
          <th>Type</th>
        </tr>
      </thead>
      <tbody>
        {values.map((value, index) => (
          <tr key={`${index}-${names[index]}`}>
            <td>{names[index] ?? `p${index}`}</td>
            <td>
              <input
                aria-label={`Initial guess for ${names[index] ?? `p${index}`}`}
                value={value}
                onChange={(event) => onChange(index, event.target.value)}
              />
            </td>
            <td>number</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
