import type { ExecutionMode, Health, LocalExecution } from "@/lib/types";
import { StatusBadge } from "./common";

export function ExecutionSettings({
  busy,
  health,
  localApiBase,
  localExecution,
  mode,
  onCreateEnvironment,
  onLocalApiBaseChange,
  onModeChange,
  onRefreshEnvironments,
  onSelectEnvironment,
}: {
  busy: boolean;
  health: Health | null;
  localApiBase: string;
  localExecution: LocalExecution | null;
  mode: ExecutionMode;
  onCreateEnvironment: () => void;
  onLocalApiBaseChange: (value: string) => void;
  onModeChange: (mode: ExecutionMode) => void;
  onRefreshEnvironments: () => void;
  onSelectEnvironment: (executable: string) => void;
}) {
  const selected = localExecution?.environments.find((environment) => environment.executable === localExecution.selected_executable);
  const engineReady = mode === "hosted" ? Boolean(health?.optional_libraries.nleis) : Boolean(selected?.ready);

  return (
    <section className="execution-settings" aria-label="Fitting execution mode">
      <div className="execution-settings-heading">
        <div>
          <span>Execution</span>
          <strong>{mode === "hosted" ? "Hosted Vercel fitting" : "Local Python fitting"}</strong>
        </div>
        <StatusBadge tone={engineReady ? "good" : "warn"}>{engineReady ? "Real fitting ready" : "Setup required"}</StatusBadge>
      </div>
      <label className="field-readout">
        <span>Fitting mode</span>
        <select aria-label="Fitting mode" value={mode} onChange={(event) => onModeChange(event.target.value as ExecutionMode)}>
          <option value="hosted">Hosted Vercel — data sent to the deployed fitting function</option>
          <option value="local">Local Python — data stays on this computer</option>
        </select>
      </label>
      {mode === "hosted" ? (
        <p className="execution-note">
          The deployed Vercel Python function runs <code>nleis.EISandNLEIS</code>. The browser preview intentionally does not synthesize fit results.
        </p>
      ) : (
        <div className="execution-local-controls">
          <label className="field-readout">
            <span>Local service URL</span>
            <input aria-label="Local service URL" value={localApiBase} onChange={(event) => onLocalApiBaseChange(event.target.value)} />
          </label>
          <div className="execution-actions">
            <button disabled={busy} onClick={onRefreshEnvironments}>Refresh environments</button>
            <button className="primary" disabled={busy || !localExecution?.can_create} onClick={onCreateEnvironment}>
              Create dedicated environment
            </button>
          </div>
          {localExecution ? (
            <>
              <label className="field-readout">
                <span>Python environment</span>
                <select
                  aria-label="Python environment"
                  value={localExecution.selected_executable ?? ""}
                  onChange={(event) => event.target.value && onSelectEnvironment(event.target.value)}
                >
                  <option value="">Select a Python interpreter with nleis</option>
                  {localExecution.environments.map((environment) => (
                    <option disabled={!environment.ready} key={environment.executable} value={environment.executable}>
                      {environment.label} — {environment.ready ? `ready (${environment.nleis_version || "nleis"})` : environment.detail}
                    </option>
                  ))}
                </select>
              </label>
              <p className={selected?.ready ? "execution-note ready" : "execution-note"}>
                {selected?.detail ?? "Choose an existing ready environment, or create a project-specific Conda environment."}
              </p>
            </>
          ) : (
            <p className="execution-note">Start the local service to inspect or create Python environments.</p>
          )}
        </div>
      )}
    </section>
  );
}
