"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { analysisClient } from "@/lib/analysis-client";
import type { CircuitValidation, Dataset, Health, JointPreprocessing, ModelTemplate, Project, Run } from "@/lib/types";
import { ConfirmDialog, type ConfirmRequest } from "./workbench/common";
import { DatasetLibrary } from "./workbench/dataset-library";
import { FitSetup } from "./workbench/fit-setup";
import { ModelEditor } from "./workbench/model-editor";
import { ModelLibrary } from "./workbench/model-library";
import { ProjectSwitcher } from "./workbench/project-switcher";
import { RunHistory } from "./workbench/run-history";
import { RunResults } from "./workbench/run-results";
import { useWorkbenchState } from "./workbench/use-workbench-state";
import { WorkspaceSidebar } from "./workbench/workspace-sidebar";
import type { BusyAction, ModelDraftUpdate } from "./workbench/types";
import { filterDatasets, filterModels, getParameterNames, inferSharedParameters, syncInitialGuessText } from "./workbench/utils";

export function Workbench() {
  const { dispatch, guessEntries, guessValues, state } = useWorkbenchState();
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [models, setModels] = useState<ModelTemplate[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [newProjectName, setNewProjectName] = useState("New project");
  const [busyAction, setBusyAction] = useState<BusyAction | null>(null);
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(null);
  const [preprocessing, setPreprocessing] = useState<JointPreprocessing | null>(null);
  const [preprocessingError, setPreprocessingError] = useState<string | null>(null);
  const activeProjectIdRef = useRef(state.activeProjectId);
  const healthRef = useRef<Health | null>(null);
  const hasStartedInitialRefresh = useRef(false);

  const activeProject = projects.find((project) => project.id === state.activeProjectId);
  const activeDataset = datasets.find((dataset) => dataset.id === state.activeDatasetId) ?? datasets[0];
  const activeModel = models.find((model) => model.id === state.activeModelId) ?? models[0];
  const activeRun = runs.find((run) => run.id === state.activeRunId) ?? runs[0];
  const activeRunItem =
    activeRun?.items.find((item) => item.id === state.activeRunItemId) ??
    activeRun?.items.find((item) => item.dataset_id === activeDataset?.id) ??
    activeRun?.items[0];
  const templates = models.filter((model) => model.kind !== "snapshot");
  const snapshots = models.filter((model) => model.kind === "snapshot");
  const filteredDatasets = useMemo(() => filterDatasets(datasets, state.search), [datasets, state.search]);
  const filteredModels = useMemo(() => filterModels(models, state.search), [models, state.search]);

  useEffect(() => {
    activeProjectIdRef.current = state.activeProjectId;
  }, [state.activeProjectId]);

  const refresh = useCallback(async (projectIdOverride?: string) => {
    setStatus("loading");
    setError(null);
    try {
      const [healthResult, projectResult] = await Promise.all([
        healthRef.current ? Promise.resolve(healthRef.current) : analysisClient.health(),
        analysisClient.projects(),
      ]);
      const nextProjectId = projectIdOverride || activeProjectIdRef.current || projectResult.projects[0]?.id || "";
      const [datasetResult, modelResult, runResult] = await Promise.all([
        analysisClient.datasets(nextProjectId),
        analysisClient.models(nextProjectId),
        analysisClient.runs(nextProjectId),
      ]);
      setHealth(healthResult);
      setProjects(projectResult.projects);
      setDatasets(datasetResult.datasets);
      setModels(modelResult.models);
      setRuns(runResult.runs);
      dispatch({
        type: "hydrate",
        payload: {
          projects: projectResult.projects,
          datasets: datasetResult.datasets,
          models: modelResult.models,
          runs: runResult.runs,
          projectId: nextProjectId,
        },
      });
      healthRef.current = healthResult;
      setStatus("ready");
    } catch (caught) {
      setStatus("error");
      setError(caught instanceof Error ? caught.message : "Unable to reach local analysis service.");
    }
  }, [dispatch]);

  useEffect(() => {
    if (hasStartedInitialRefresh.current) return;
    hasStartedInitialRefresh.current = true;
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!state.activeProjectId || !state.eisDatasetId || !state.secondDatasetId || state.maxFrequency <= 0) {
      setPreprocessing(null);
      setPreprocessingError(state.maxFrequency <= 0 ? "2nd-NLEIS max f must be greater than zero." : null);
      return;
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => {
      void analysisClient
        .preprocessJointData(
          {
            project_id: state.activeProjectId,
            eis_dataset_id: state.eisDatasetId,
            second_dataset_id: state.secondDatasetId,
            max_f: state.maxFrequency,
          },
          controller.signal,
        )
        .then((result) => {
          if (!controller.signal.aborted) setPreprocessing(result.preprocessing);
        })
        .catch((caught) => {
          if (!controller.signal.aborted) {
            setPreprocessingError(caught instanceof Error ? caught.message : "Unable to preprocess the selected joint dataset.");
          }
        });
    }, 180);

    setPreprocessing(null);
    setPreprocessingError(null);
    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [state.activeProjectId, state.eisDatasetId, state.maxFrequency, state.secondDatasetId]);

  async function runAction(label: BusyAction, action: () => Promise<void>) {
    setBusyAction(label);
    setInlineError(null);
    try {
      await action();
    } catch (caught) {
      setInlineError(caught instanceof Error ? caught.message : "Action failed.");
    } finally {
      setBusyAction(null);
    }
  }

  function requestConfirm(request: ConfirmRequest) {
    setConfirmRequest(request);
  }

  async function createProject() {
    const name = newProjectName.trim();
    if (!name) return;
    await runAction("project", async () => {
      const result = await analysisClient.createProject({ name });
      dispatch({ type: "selectProject", projectId: result.project.id });
      setNewProjectName("New project");
      await refresh(result.project.id);
      dispatch({ type: "setView", view: "database" });
    });
  }

  function confirmDeleteProject(project: Project) {
    requestConfirm({
      title: "Delete project?",
      message: `Delete "${project.name}" and all local data inside it. This cannot be undone.`,
      confirmLabel: "Delete project",
      danger: true,
      onConfirm: async () => {
        await runAction("project", async () => {
          const result = await analysisClient.deleteProject(project.id);
          dispatch({ type: "selectProject", projectId: result.next_project.id });
          await refresh(result.next_project.id);
        });
      },
    });
  }

  async function switchProject(projectId: string) {
    dispatch({ type: "selectProject", projectId });
    await refresh(projectId);
  }

  function confirmDeleteDataset(dataset: Dataset) {
    requestConfirm({
      title: "Delete dataset?",
      message: `Delete "${dataset.name}" from this project. Runs that reference it will lose that item.`,
      confirmLabel: "Delete dataset",
      danger: true,
      onConfirm: async () => {
        await runAction("dataset", async () => {
          await analysisClient.deleteDataset(dataset.id);
          await refresh();
        });
      },
    });
  }

  async function importManuscriptSample(kind: "EIS" | "2nd-NLEIS") {
    await runAction("import", async () => {
      await analysisClient.importDataset({
        project_id: state.activeProjectId,
        mode: "manuscript",
        name: `${kind === "EIS" ? "PartII_EIS" : "PartII_2nd"}_sample_${datasets.length + 1}`,
        kind,
      });
      await refresh();
      dispatch({ type: "setView", view: "database" });
    });
  }

  async function importTable(kind: "EIS" | "2nd-NLEIS") {
    await runAction("import", async () => {
      await analysisClient.importDataset({
        project_id: state.activeProjectId,
        mode: "table",
        name: `Manual_${kind}_${datasets.length + 1}`,
        kind,
        source_name: `manual_${kind}.csv`,
        text: state.importText,
      });
      await refresh();
      dispatch({ type: "setView", view: "database" });
    });
  }

  function selectModel(model: ModelTemplate) {
    if (!state.modelDraft.dirty) {
      dispatch({ type: "selectModel", model });
      return;
    }
    requestConfirm({
      title: "Discard model draft?",
      message: "Switching models will replace the unsaved circuit draft in the editor.",
      confirmLabel: "Discard draft",
      danger: true,
      onConfirm: () => dispatch({ type: "selectModel", model }),
    });
  }

  function confirmDeleteActiveModel() {
    if (!activeModel) return;
    requestConfirm({
      title: "Delete model?",
      message: `Delete "${activeModel.name}" from the model library.`,
      confirmLabel: "Delete model",
      danger: true,
      onConfirm: async () => {
        await runAction("model", async () => {
          await analysisClient.deleteModel(activeModel.id);
          await refresh();
        });
      },
    });
  }

  function updateModelDraft(update: ModelDraftUpdate) {
    if ("circuit1" in update || "circuit2" in update) {
      const circuit1 = update.circuit1 ?? state.modelDraft.circuit1;
      const circuit2 = update.circuit2 ?? state.modelDraft.circuit2;
      dispatch({
        type: "updateModelDraft",
        update: {
          ...update,
          initialGuess: syncInitialGuessText(
            state.modelDraft.circuit1,
            state.modelDraft.circuit2,
            circuit1,
            circuit2,
            state.modelDraft.initialGuess,
          ),
        },
      });
      return;
    }
    dispatch({ type: "updateModelDraft", update });
  }

  async function validateCircuit() {
    await runAction("validate", async () => {
      const parameterNames = getParameterNames(state.modelDraft.circuit1, state.modelDraft.circuit2);
      const guessIssue = getInitialGuessIssue(guessEntries, parameterNames.length);
      if (guessIssue) {
        dispatch({ type: "setValidation", validation: invalidCircuitValidation(guessIssue, parameterNames) });
        return;
      }
      const result = await analysisClient.validateCircuit({
        circuit_1: state.modelDraft.circuit1,
        circuit_2: state.modelDraft.circuit2,
        initial_guess: guessValues,
        constants: {},
      });
      dispatch({ type: "setValidation", validation: result.validation });
    });
  }

  async function saveTemplate() {
    await runAction("save", async () => {
      const parameterNames = getParameterNames(state.modelDraft.circuit1, state.modelDraft.circuit2);
      const guessIssue = getInitialGuessIssue(guessEntries, parameterNames.length);
      if (guessIssue) {
        dispatch({ type: "setValidation", validation: invalidCircuitValidation(guessIssue, parameterNames) });
        throw new Error(guessIssue);
      }
      const validationResult = await analysisClient.validateCircuit({
        circuit_1: state.modelDraft.circuit1,
        circuit_2: state.modelDraft.circuit2,
        initial_guess: guessValues,
        constants: {},
      });
      dispatch({ type: "setValidation", validation: validationResult.validation });
      if (!validationResult.validation.valid) {
        throw new Error(validationResult.validation.errors[0] ?? "Circuit pair needs attention.");
      }
      const result = await analysisClient.saveModel({
        project_id: state.activeProjectId,
        name: state.modelDraft.name.trim() || `${state.modelDraft.circuit1} / ${state.modelDraft.circuit2} template`,
        kind: "template",
        scope: "project",
        circuit_1: state.modelDraft.circuit1,
        circuit_2: state.modelDraft.circuit2,
        initial_guess: guessValues,
        constants: {},
        bounds: { lower: guessValues.map(() => 0), upper: guessValues.map(() => "inf") },
        shared_parameters: inferSharedParameters(state.modelDraft.circuit1, state.modelDraft.circuit2),
      });
      await refresh();
      dispatch({ type: "selectModel", model: result.model });
    });
  }

  async function loadSnapshotAsInitial(modelId: string) {
    await runAction("load", async () => {
      const result = await analysisClient.loadAsInitial(modelId);
      await refresh();
      dispatch({ type: "selectModel", model: result.model });
      dispatch({ type: "setView", view: "models" });
    });
  }

  function updateInitialGuess(index: number, value: string) {
    const entries = [...guessEntries];
    while (entries.length <= index) entries.push("");
    entries[index] = value;
    dispatch({ type: "updateModelDraft", update: { initialGuess: entries.join(", ") } });
  }

  async function runJointFit(batch: boolean) {
    const ids = [state.eisDatasetId, state.secondDatasetId].filter(Boolean);
    if (
      !state.activeProjectId ||
      !state.activeModelId ||
      ids.length !== 2 ||
      state.maxFrequency <= 0 ||
      !ids.every((id) => state.includedDatasetIds.includes(id))
    ) {
      return;
    }
    await runAction(batch ? "batch" : "run", async () => {
      const result = batch
        ? await analysisClient.runBatchJointFit({
            project_id: state.activeProjectId,
            model_id: state.activeModelId,
            dataset_ids: ids,
            eis_dataset_id: state.eisDatasetId,
            second_dataset_id: state.secondDatasetId,
            max_f: state.maxFrequency,
            run_name: state.runName,
          })
        : await analysisClient.runJointFit({
            project_id: state.activeProjectId,
            model_id: state.activeModelId,
            dataset_ids: ids,
            eis_dataset_id: state.eisDatasetId,
            second_dataset_id: state.secondDatasetId,
            max_f: state.maxFrequency,
            run_name: state.runName,
          });
      await refresh();
      dispatch({ type: "selectRun", runId: result.run.id, itemId: result.run.items[0]?.id });
      dispatch({ type: "setView", view: "runs" });
    });
  }

  if (status === "error") {
    return (
      <main className="app-shell offline">
        <section className="offline-panel">
          <div className="brand-mark">IS</div>
          <h1>Start the local analysis service</h1>
          <p>{error}</p>
          <code>PYTHONPATH=service python3 -m impedance_studio.server</code>
          <button onClick={() => void refresh()}>Retry connection</button>
          <span>Expected API: {analysisClient.apiBase}</span>
        </section>
      </main>
    );
  }

  return (
    <main className="studio-shell">
      <WorkspaceSidebar
        activeDatasetId={state.activeDatasetId}
        activeModelId={state.activeModelId}
        activeRunId={state.activeRunId}
        activeView={state.activeView}
        datasets={filteredDatasets}
        includedDatasetIds={state.includedDatasetIds}
        models={filteredModels}
        runs={runs}
        search={state.search}
        onDatasetPreview={(datasetId) => dispatch({ type: "selectDataset", datasetId })}
        onModelSelect={selectModel}
        onRunSelect={(runId, itemId) => {
          dispatch({ type: "selectRun", runId, itemId });
          dispatch({ type: "setView", view: "runs" });
        }}
        onSearchChange={(search) => dispatch({ type: "setSearch", search })}
        onViewChange={(view) => dispatch({ type: "setView", view })}
      />

      <section className="studio-main">
        <ProjectSwitcher
          activeProject={activeProject}
          busy={busyAction === "project"}
          health={health}
          newProjectName={newProjectName}
          projects={projects}
          selectedCount={state.includedDatasetIds.length}
          onCreateProject={() => void createProject()}
          onDeleteProject={confirmDeleteProject}
          onProjectNameChange={setNewProjectName}
          onProjectSelect={(projectId) => void switchProject(projectId)}
        />

        {(inlineError || preprocessingError) && <div className="app-error" role="alert">{inlineError ?? preprocessingError}</div>}

        {state.activeView === "runs" && (
          <div className="run-layout">
            <FitSetup
              activeModel={activeModel}
              busyAction={busyAction}
              datasets={datasets}
              eisDatasetId={state.eisDatasetId}
              includedDatasetIds={state.includedDatasetIds}
              maxFrequency={state.maxFrequency}
              models={models}
              runName={state.runName}
              secondDatasetId={state.secondDatasetId}
              onBatch={() => void runJointFit(true)}
              onEisDatasetChange={(datasetId) => dispatch({ type: "selectEisDataset", datasetId })}
              onIncludeDataset={(datasetId) => dispatch({ type: "toggleIncludedDataset", datasetId })}
              onMaxFrequencyChange={(maxFrequency) => dispatch({ type: "setMaxFrequency", maxFrequency })}
              onModelChange={(modelId) => {
                const model = models.find((candidate) => candidate.id === modelId);
                if (model) selectModel(model);
              }}
              onRun={() => void runJointFit(false)}
              onRunNameChange={(runName) => dispatch({ type: "setRunName", runName })}
              onSecondDatasetChange={(datasetId) => dispatch({ type: "selectSecondDataset", datasetId })}
            />
            <RunResults
              activeDataset={activeDataset}
              activeModel={activeModel}
              activeRun={activeRun}
              activeRunItem={activeRunItem}
              datasets={datasets}
              eisDatasetId={state.eisDatasetId}
              preprocessing={preprocessing}
              secondDatasetId={state.secondDatasetId}
              onRunItemSelect={(itemId) => dispatch({ type: "selectRunItem", itemId })}
            />
            <RunHistory
              activeRunId={state.activeRunId}
              runs={runs}
              onRunSelect={(runId, itemId) => dispatch({ type: "selectRun", runId, itemId })}
            />
          </div>
        )}

        {state.activeView === "database" && (
          <DatasetLibrary
            activeDataset={activeDataset}
            activeModel={activeModel}
            datasets={filteredDatasets}
            importText={state.importText}
            includedDatasetIds={state.includedDatasetIds}
            models={filteredModels}
            runs={runs}
            onDeleteDataset={confirmDeleteDataset}
            onImportEis={() => void importTable("EIS")}
            onImportSecond={() => void importTable("2nd-NLEIS")}
            onImportTextChange={(importText) => dispatch({ type: "setImportText", importText })}
            onPreviewDataset={(datasetId) => dispatch({ type: "selectDataset", datasetId })}
            onToggleIncluded={(datasetId) => dispatch({ type: "toggleIncludedDataset", datasetId })}
          />
        )}

        {state.activeView === "models" && (
          <div className="models-layout">
            <section className="database-hero">
              <div>
                <span>Model library</span>
                <h1>Joint circuit definitions and reusable fitting templates</h1>
              </div>
            </section>
            <ModelEditor
              activeModel={activeModel}
              busyAction={busyAction}
              draft={state.modelDraft}
              guessEntries={guessEntries}
              guessValues={guessValues}
              validation={state.validation}
              onDelete={confirmDeleteActiveModel}
              onDraftChange={updateModelDraft}
              onDuplicateSnapshot={() => activeModel && void loadSnapshotAsInitial(activeModel.id)}
              onGuessItemChange={updateInitialGuess}
              onResetDraft={() => dispatch({ type: "resetModelDraft", model: activeModel })}
              onSave={() => void saveTemplate()}
              onValidate={() => void validateCircuit()}
            />
            <ModelLibrary
              activeModelId={state.activeModelId}
              models={filteredModels}
              snapshots={snapshots}
              templates={templates}
              onLoadSnapshot={(modelId) => void loadSnapshotAsInitial(modelId)}
              onModelSelect={selectModel}
            />
          </div>
        )}
      </section>

      <ConfirmDialog request={confirmRequest} onCancel={() => setConfirmRequest(null)} />
    </main>
  );
}

function getInitialGuessIssue(entries: string[], expectedCount: number) {
  const normalized = entries.map((entry) => entry.trim());
  if (expectedCount > 0 && normalized.length !== expectedCount) {
    return `Initial guess count must match the circuit parameter count (${expectedCount}).`;
  }
  const filled = normalized.filter(Boolean);
  if (!filled.length) return "At least one numeric initial guess is required.";
  if (normalized.some((entry) => !entry) && filled.length) return "Initial guesses contain an empty entry. Remove extra commas or fill the value.";
  const invalid = normalized.filter((entry) => entry && !Number.isFinite(Number(entry)));
  if (invalid.length) return `Initial guesses must be finite numbers. Check: ${invalid.slice(0, 4).join(", ")}.`;
  return null;
}

function invalidCircuitValidation(message: string, parameterNames: string[]): CircuitValidation {
  return {
    valid: false,
    errors: [message],
    warnings: [],
    elements_1: [],
    elements_2: [],
    estimated_parameters: parameterNames.length,
    parameter_names: parameterNames,
  };
}
