import { NextResponse } from "next/server";
import { demoStore } from "@/lib/demo-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ path?: string[] }>;
};

export async function GET(request: Request, context: RouteContext) {
  return handleRequest("GET", request, context);
}

export async function POST(request: Request, context: RouteContext) {
  return handleRequest("POST", request, context);
}

export async function DELETE(request: Request, context: RouteContext) {
  return handleRequest("DELETE", request, context);
}

async function handleRequest(method: "GET" | "POST" | "DELETE", request: Request, context: RouteContext) {
  try {
    const path = `/${((await context.params).path || []).join("/")}`;
    const url = new URL(request.url);
    const body = method === "POST" ? await request.json() : {};
    const store = demoStore();

    if (method === "GET") {
      if (path === "/health") return json(store.health());
      if (path === "/projects") return json({ projects: store.listProjects() });
      if (path === "/datasets") return json({ datasets: store.listDatasets(url.searchParams.get("project_id") || undefined) });
      if (path === "/models") return json({ models: store.listModels(url.searchParams.get("project_id") || undefined) });
      if (path === "/runs") return json({ runs: store.listRuns(url.searchParams.get("project_id") || undefined) });
      if (path.startsWith("/models/") && path.endsWith("/export-json")) {
        return json({ model_json: store.exportModel(path.split("/")[2]) });
      }
    }

    if (method === "POST") {
      if (path === "/projects") return json({ project: store.createProject(body.name || "Untitled Project") });
      if (path === "/imports") return json({ dataset: store.importDataset(body) });
      if (path === "/circuit-templates/validate") return json({ validation: store.validateTemplate(body) });
      if (path === "/preprocess/joint") return json({ preprocessing: store.preprocessJointData(body) });
      if (path === "/models") return json({ model: store.createModel(body) });
      if (path.startsWith("/models/") && path.endsWith("/load-as-initial")) {
        return json({ model: store.loadModelAsInitial(path.split("/")[2]) });
      }
      if (path === "/runs/joint-fit") return json({ run: store.runJointFit(body, false) });
      if (path === "/runs/batch-joint-fit") return json({ run: store.runJointFit(body, true) });
    }

    if (method === "DELETE") {
      if (path.startsWith("/projects/")) return json(store.deleteProject(path.split("/")[2]));
      if (path.startsWith("/datasets/")) return json(store.deleteDataset(path.split("/")[2]));
      if (path.startsWith("/models/")) return json(store.deleteModel(path.split("/")[2]));
    }

    return json({ error: `not found: ${path}` }, 404);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Request failed" }, 400);
  }
}

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, { status });
}
