import type { ReactNode } from "react";
import type { ModelTemplate } from "@/lib/types";
import { formatNumber, getParameterNames } from "./utils";

export type ConfirmRequest = {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void | Promise<void>;
};

export function SidebarGroup({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  return (
    <section className="sidebar-group">
      <div className="sidebar-group-title">
        <span>{title}</span>
        <small>{count}</small>
      </div>
      <div className="sidebar-group-body">{children}</div>
    </section>
  );
}

export function PanelHeader({ title, meta, actions }: { title: string; meta?: string; actions?: ReactNode }) {
  return (
    <div className="panel-header">
      <div>
        <h2>{title}</h2>
        {meta && <span>{meta}</span>}
      </div>
      {actions && <div className="panel-header-actions">{actions}</div>}
    </div>
  );
}

export function MetricCard({ label, value, tone }: { label: string; value: string; tone?: "good" | "warn" }) {
  return (
    <div className={tone ? `metric-card ${tone}` : "metric-card"}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function StatusBadge({ children, tone = "neutral" }: { children: ReactNode; tone?: "good" | "neutral" | "warn" }) {
  return <span className={`status-badge ${tone}`}>{children}</span>;
}

export function ParameterSummary({ model }: { model?: ModelTemplate }) {
  const values = model?.initial_guess ?? [];
  const names = getParameterNames(model?.circuit_1, model?.circuit_2);
  return (
    <div className="parameter-summary">
      <span>Initial guesses</span>
      {values.length ? (
        values.map((value, index) => (
          <code key={`${names[index]}-${index}`}>{names[index] ?? `p${index}`} = {formatNumber(value)}</code>
        ))
      ) : (
        <small>No initial guesses saved.</small>
      )}
    </div>
  );
}

export function ParameterTable({ values, confidence }: { values: number[]; confidence: number[] }) {
  return (
    <table className="parameter-table">
      <thead>
        <tr>
          <th>Parameter</th>
          <th>Value</th>
          <th>Error</th>
        </tr>
      </thead>
      <tbody>
        {values.map((value, index) => (
          <tr key={`${value}-${index}`}>
            <td>p{index}</td>
            <td>{formatNumber(value)}</td>
            <td>{formatNumber(confidence[index] ?? 0)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function Progress({ value }: { value: number }) {
  return (
    <div aria-label={`${value}% complete`} className="progress" role="progressbar" aria-valuemax={100} aria-valuemin={0} aria-valuenow={value}>
      <span style={{ width: `${value}%` }} />
    </div>
  );
}

export function ConfirmDialog({
  request,
  onCancel,
}: {
  request: ConfirmRequest | null;
  onCancel: () => void;
}) {
  if (!request) return null;
  return (
    <div className="confirm-backdrop" role="presentation">
      <section aria-modal="true" className="confirm-dialog" role="dialog" aria-labelledby="confirm-title">
        <div>
          <h2 id="confirm-title">{request.title}</h2>
          <p>{request.message}</p>
        </div>
        <div className="confirm-actions">
          <button onClick={onCancel}>Cancel</button>
          <button
            className={request.danger ? "danger" : "primary"}
            onClick={() => {
              void request.onConfirm();
              onCancel();
            }}
          >
            {request.confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}
