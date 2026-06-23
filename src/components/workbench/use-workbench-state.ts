import { useMemo, useReducer } from "react";
import type { Dataset, ModelTemplate, Project, Run } from "@/lib/types";
import { DEFAULT_IMPORT, parseGuessEntries, parseGuessValues } from "./utils";
import { type ModelDraftUpdate, type WorkbenchState, type WorkbenchView, modelToDraft } from "./types";

type HydratePayload = {
  projects: Project[];
  datasets: Dataset[];
  models: ModelTemplate[];
  runs: Run[];
  projectId?: string;
};

type Action =
  | { type: "hydrate"; payload: HydratePayload }
  | { type: "setView"; view: WorkbenchView }
  | { type: "setSearch"; search: string }
  | { type: "setRunName"; runName: string }
  | { type: "setMaxFrequency"; maxFrequency: number }
  | { type: "setImportText"; importText: string }
  | { type: "selectProject"; projectId: string }
  | { type: "selectDataset"; datasetId: string }
  | { type: "toggleIncludedDataset"; datasetId: string }
  | { type: "setIncludedDatasets"; datasetIds: string[] }
  | { type: "selectEisDataset"; datasetId: string }
  | { type: "selectSecondDataset"; datasetId: string }
  | { type: "selectModel"; model: ModelTemplate }
  | { type: "updateModelDraft"; update: ModelDraftUpdate }
  | { type: "resetModelDraft"; model?: ModelTemplate }
  | { type: "setValidation"; validation: WorkbenchState["validation"] }
  | { type: "selectRun"; runId: string; itemId?: string }
  | { type: "selectRunItem"; itemId: string };

const initialState: WorkbenchState = {
  activeProjectId: "",
  activeDatasetId: "",
  includedDatasetIds: [],
  eisDatasetId: "",
  secondDatasetId: "",
  activeModelId: "",
  activeRunId: "",
  activeRunItemId: "",
  activeView: "runs",
  search: "",
  runName: "Joint two-electrode TDS fit",
  maxFrequency: 10,
  importText: DEFAULT_IMPORT,
  modelDraft: modelToDraft(),
  validation: null,
};

export function useWorkbenchState() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const guessEntries = useMemo(() => parseGuessEntries(state.modelDraft.initialGuess), [state.modelDraft.initialGuess]);
  const guessValues = useMemo(() => parseGuessValues(state.modelDraft.initialGuess), [state.modelDraft.initialGuess]);
  return { state, dispatch, guessEntries, guessValues };
}

function reducer(state: WorkbenchState, action: Action): WorkbenchState {
  switch (action.type) {
    case "hydrate":
      return hydrateState(state, action.payload);
    case "setView":
      return { ...state, activeView: action.view };
    case "setSearch":
      return { ...state, search: action.search };
    case "setRunName":
      return { ...state, runName: action.runName };
    case "setMaxFrequency":
      return { ...state, maxFrequency: action.maxFrequency };
    case "setImportText":
      return { ...state, importText: action.importText };
    case "selectProject":
      return {
        ...state,
        activeProjectId: action.projectId,
        activeDatasetId: "",
        includedDatasetIds: [],
        eisDatasetId: "",
        secondDatasetId: "",
        activeModelId: "",
        activeRunId: "",
        activeRunItemId: "",
        modelDraft: modelToDraft(),
        validation: null,
      };
    case "selectDataset":
      return { ...state, activeDatasetId: action.datasetId };
    case "toggleIncludedDataset":
      return {
        ...state,
        includedDatasetIds: state.includedDatasetIds.includes(action.datasetId)
          ? state.includedDatasetIds.filter((id) => id !== action.datasetId)
          : [...state.includedDatasetIds, action.datasetId],
      };
    case "setIncludedDatasets":
      return { ...state, includedDatasetIds: action.datasetIds };
    case "selectEisDataset":
      return { ...state, eisDatasetId: action.datasetId, activeDatasetId: action.datasetId };
    case "selectSecondDataset":
      return { ...state, secondDatasetId: action.datasetId, activeDatasetId: action.datasetId };
    case "selectModel":
      return { ...state, activeModelId: action.model.id, modelDraft: modelToDraft(action.model), validation: null };
    case "updateModelDraft":
      return { ...state, modelDraft: { ...state.modelDraft, ...action.update, dirty: true }, validation: null };
    case "resetModelDraft":
      return { ...state, modelDraft: modelToDraft(action.model), validation: null };
    case "setValidation":
      return { ...state, validation: action.validation };
    case "selectRun":
      return { ...state, activeRunId: action.runId, activeRunItemId: action.itemId ?? "" };
    case "selectRunItem":
      return { ...state, activeRunItemId: action.itemId };
    default:
      return state;
  }
}

function hydrateState(state: WorkbenchState, payload: HydratePayload): WorkbenchState {
  const { datasets, models, projects, runs } = payload;
  const activeProjectId = payload.projectId || state.activeProjectId || projects[0]?.id || "";
  const firstEis = datasets.find((dataset) => dataset.kind === "EIS");
  const firstSecond = datasets.find((dataset) => dataset.kind === "2nd-NLEIS");

  const activeDatasetId = datasets.some((dataset) => dataset.id === state.activeDatasetId)
    ? state.activeDatasetId
    : firstEis?.id || datasets[0]?.id || "";
  const includedDatasetIds = state.includedDatasetIds.filter((id) => datasets.some((dataset) => dataset.id === id));
  const nextIncludedDatasetIds = includedDatasetIds.length
    ? includedDatasetIds
    : ([firstEis?.id, firstSecond?.id].filter(Boolean) as string[]);
  const eisDatasetId = datasets.some((dataset) => dataset.id === state.eisDatasetId && dataset.kind === "EIS")
    ? state.eisDatasetId
    : firstEis?.id || "";
  const secondDatasetId = datasets.some((dataset) => dataset.id === state.secondDatasetId && dataset.kind === "2nd-NLEIS")
    ? state.secondDatasetId
    : firstSecond?.id || "";

  const activeModel = models.find((model) => model.id === state.activeModelId) ?? models[0];
  const activeRun = runs.find((run) => run.id === state.activeRunId) ?? runs[0];
  const activeRunItem =
    activeRun?.items.find((item) => item.id === state.activeRunItemId) ??
    activeRun?.items.find((item) => item.dataset_id === activeDatasetId) ??
    activeRun?.items[0];
  const shouldRefreshDraft = !state.modelDraft.dirty || state.modelDraft.sourceModelId !== activeModel?.id;

  return {
    ...state,
    activeProjectId,
    activeDatasetId,
    includedDatasetIds: nextIncludedDatasetIds,
    eisDatasetId,
    secondDatasetId,
    activeModelId: activeModel?.id ?? "",
    activeRunId: activeRun?.id ?? "",
    activeRunItemId: activeRunItem?.id ?? "",
    modelDraft: shouldRefreshDraft ? modelToDraft(activeModel) : state.modelDraft,
    validation: shouldRefreshDraft ? null : state.validation,
  };
}
