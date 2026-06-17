import type { Run } from "@/lib/types";
import { PanelHeader, Progress, StatusBadge } from "./common";

export function RunHistory({
  activeRunId,
  runs,
  onRunSelect,
}: {
  activeRunId: string;
  runs: Run[];
  onRunSelect: (runId: string, itemId?: string) => void;
}) {
  return (
    <section className="panel activity-panel">
      <PanelHeader title="Run history" meta={`${runs.length} runs`} />
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Status</th>
              <th>Run name</th>
              <th>Mode</th>
              <th>Datasets</th>
              <th>Progress</th>
              <th>Started</th>
            </tr>
          </thead>
          <tbody>
            {runs.slice(0, 8).map((run) => (
              <tr key={run.id} className={run.id === activeRunId ? "selected" : ""}>
                <td><StatusBadge tone={run.status === "completed" ? "good" : "neutral"}>{run.status}</StatusBadge></td>
                <td>
                  <button className="table-link" onClick={() => onRunSelect(run.id, run.items[0]?.id)}>
                    {String(run.summary?.run_name ?? "Joint fit")}
                  </button>
                </td>
                <td>{run.mode}</td>
                <td>{run.items.length}</td>
                <td><Progress value={run.progress} /></td>
                <td>{run.started_at}</td>
              </tr>
            ))}
            {!runs.length && (
              <tr>
                <td colSpan={6}>No runs yet. Select datasets and run a joint fit.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
