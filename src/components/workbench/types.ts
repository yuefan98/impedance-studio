import type { CircuitValidation, ModelTemplate } from "@/lib/types";

export type Status = "idle" | "loading" | "ready" | "error";

export type WorkbenchView = "runs" | "database" | "models";

export type BusyAction =
  | "batch"
  | "dataset"
  | "import"
  | "load"
  | "model"
  | "project"
  | "run"
  | "save"
  | "validate";

export type ModelDraft = {
  sourceModelId: string;
  name: string;
  circuit1: string;
  circuit2: string;
  initialGuess: string;
  dirty: boolean;
};

export type WorkbenchState = {
  activeProjectId: string;
  activeDatasetId: string;
  includedDatasetIds: string[];
  eisDatasetId: string;
  secondDatasetId: string;
  activeModelId: string;
  activeRunId: string;
  activeRunItemId: string;
  activeView: WorkbenchView;
  search: string;
  runName: string;
  importText: string;
  modelDraft: ModelDraft;
  validation: CircuitValidation | null;
};

export type ModelDraftUpdate = Partial<Omit<ModelDraft, "sourceModelId" | "dirty">>;

export function modelToDraft(model?: ModelTemplate): ModelDraft {
  return {
    sourceModelId: model?.id ?? "",
    name: model?.name ?? "New joint template",
    circuit1: model?.circuit_1 ?? "RC0",
    circuit2: model?.circuit_2 ?? "RCn0",
    initialGuess: model?.initial_guess?.length ? model.initial_guess.join(", ") : "0.84, 15.2, 0.001",
    dirty: false,
  };
}
