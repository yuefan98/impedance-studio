# Impedance Studio

Impedance Studio is planned as a scientific workbench for electrochemical impedance analysis. The platform will help researchers and engineers batch process, fit, validate, visualize, store, and compare EIS and 2nd-NLEIS datasets using the Python ecosystems around `impedance.py` and `nleis.py`.

The project is intentionally hybrid:

- Hosted mode uses Vercel for the web app and Supabase for auth, database, storage, and project metadata.
- Local mode lets sensitive-data users clone the repository and run the workflow without uploading private measurements to a cloud service.

This repository now contains the first MVP scaffold:

- A Next.js workbench UI.
- A hosted/demo Next.js API fallback for remote Vercel testing.
- A local Python analysis service with SQLite persistence.
- A Supabase schema for hosted database and storage.
- No-cloud local mode for sensitive data workflows.
- Bundled sample data from the public `2nd-NLEIS-manuscripts` Part II dataset for UI and batch-fit validation.

## Product Goals

- Make batch impedance analysis easier to manage than ad hoc notebooks.
- Keep raw measurements, fitted models, validation outputs, plots, and exports tied to a clear project history.
- Support both first-harmonic EIS and second-harmonic NLEIS workflows.
- Let users compare datasets, fits, residuals, validation metrics, and model choices across runs.
- Preserve a credible privacy path for sensitive or unpublished data.

## Target Users

- Electrochemistry researchers comparing cells, materials, operating conditions, or cycling states.
- Battery and corrosion teams that need repeatable impedance analysis workflows.
- Users of `impedance.py` and `nleis.py` who want a managed interface rather than one-off scripts.
- Teams that need cloud collaboration for routine projects and local execution for sensitive projects.

## V1 Workflow

1. Create or select a project.
2. Import EIS and 2nd-NLEIS data from local files or batch folders.
3. Normalize, validate, and preview frequency-domain data before fitting.
4. Define impedance.py/nleis.py-style circuit strings and parameter tables.
5. Queue simultaneous EIS + 2nd-NLEIS joint fits or batch joint fits.
6. Save reusable model templates and fitted model snapshots.
7. Visualize Nyquist, Bode, residual, second-harmonic, and comparison plots.
8. Store run metadata, fitted parameters, validation summaries, and generated artifacts.
9. Compare runs across datasets, cells, model families, or processing settings.
10. Export processed data, figures, reports, and machine-readable results.

## Architecture Direction

The likely stack is:

- Frontend and app shell: Next.js App Router, TypeScript, Tailwind, and shadcn-style components.
- Hosting: Vercel for the hosted web app and preview deployments.
- Database and auth: Supabase Auth, Postgres, Storage, and Row Level Security.
- Analysis layer: Python services or workers that call `impedance.py` and `nleis.py`.
- Local mode: the same repository should run against local configuration and local data paths.

The analysis layer should stay behind a clear service or worker boundary. Python fitting and validation code should not be mixed into frontend components.

## Run Locally

Install the web dependencies:

```bash
npm install
```

Start the web app:

```bash
npm run dev
```

Open the app at `http://localhost:3000`.

The workbench now has two explicit execution modes:

- **Hosted Vercel fitting** sends the selected data and model to the deployed `/api/fit` Python Function, which runs `nleis.EISandNLEIS`.
- **Local Python fitting** sends data only to a service on your computer and runs the same code with a Python interpreter you select in the workbench.

The development `/api` preview can display bundled public sample data, but it intentionally does not generate or label simulated parameters as a fit. Use the deployed Vercel app or Local Python mode to run a fit.

For private local analysis with SQLite persistence, start the local Python service with any Python 3 interpreter:

```bash
npm run service
```

In the workbench, choose **Local Python** under **Execution**. It connects to `http://127.0.0.1:8765` by default, discovers Conda environments, and only enables fitting after you select one with `numpy` and `nleis==0.3`. The selected interpreter is stored locally in `~/.impedance-studio/execution.json`; the service starts a worker with that interpreter for each fit.

If none is available, select **Create dedicated environment**. After confirmation, it creates `impedance-studio-py311` with Conda and installs [requirements.txt](requirements.txt). This command downloads packages and can take several minutes. To use an existing environment without the UI, set `IMPEDANCE_STUDIO_PYTHON=/path/to/python` when running tests, or select it in the workbench first.

The local service accepts browser requests from `localhost` and the production workbench origin. If you use a Vercel Preview URL, allow it deliberately when starting the service, for example: `IMPEDANCE_STUDIO_ALLOWED_ORIGINS=https://your-preview.vercel.app npm run service`.

By default, local state is stored in:

```text
~/.impedance-studio/impedance_studio.sqlite3
```

Use `IMPEDANCE_STUDIO_DB=/path/to/private.sqlite3 npm run service` to isolate a sensitive project.

## Hosted Supabase Setup

Hosted mode uses a Supabase project for authenticated database persistence and private object storage. The schema is tracked in:

```text
supabase/schema.sql
```

The hosted project should expose only publishable browser configuration:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_your_publishable_key
```

The schema creates:

- `projects`, `datasets`, `models`, `runs`, and `run_items` tables.
- Row Level Security policies scoped to the authenticated user and project ownership.
- Private `impedance-raw-data` and `impedance-analysis-artifacts` storage buckets.
- Storage policies that use the project ID as the first object-path folder.

Never place a Supabase service-role key in browser code or checked-in files. The current Vercel build reads Supabase env vars lazily and reports whether they are configured from `/api/health`; authenticated Supabase persistence is the next adapter step after hosted auth is added.

## Sample Data

The default local database is seeded from the public Part II data files in:

https://github.com/yuefan98/2nd-NLEIS-manuscripts/tree/main/Part%20II/data

Each condition is imported as a paired EIS (`Z1s_*`) and 2nd-NLEIS (`Z2s_*`) dataset using the matching `freq_*` file. The service averages the three replicate impedance rows per file into plot-ready real/imaginary impedance series.

## Data And Privacy Model

Hosted mode should store only the data needed for the user's chosen workflow:

- User, team, and project metadata.
- Dataset metadata and optional uploaded raw files.
- Analysis run settings.
- Fitted parameters, validation metrics, summaries, and generated artifacts.

Sensitive workflows should support local-only operation:

- No cloud upload required.
- Local environment variables and ignored configuration.
- Local raw data and generated outputs ignored by git by default.
- Clear separation between reproducible code and private measurements.

Supabase tables in exposed schemas must use Row Level Security. Browser code must never receive service-role credentials.

## Model Library

The MVP supports two saved model types:

- Templates: circuit strings, initial guesses, bounds, constants, shared parameter mappings, and metadata.
- Fitted snapshots: completed fit parameters, confidence estimates, validation summaries, source run IDs, and plot-ready series.

Snapshots can be loaded as completed results or converted into a new template using fitted parameters as the next initial guesses. This follows the `fitted_as_initial` pattern supported by `impedance.py` and `nleis.py`.

### Default joint template

The initial workbench template follows the documented `nleis.EISandNLEIS` two-electrode TDS example:

```python
circuit_1 = "L0-R0-TDS0-TDS1"
circuit_2 = "d(TDSn0,TDSn1)"
```

Its 16 initial guesses are ordered as `L0`, `R0`, the seven shared and nonlinear `TDS0/TDSn0` parameters, then the seven `TDS1/TDSn1` parameters. The workbench keeps this vector order, excludes constant parameters from it, and delegates unspecified parameter bounds to `nleis.py`.

## Scientific Workbench Design Principles

- Prioritize dense, precise workflows over marketing-style presentation.
- Use tables, sidebars, plot canvases, run history, and comparison panels as primary UI surfaces.
- Make batch operations visible and auditable.
- Keep model choices, initial guesses, bounds, residuals, and validation status close to the plots they explain.
- Favor exportable, reproducible outputs over decorative dashboards.
- Treat failed fits, questionable validation, and missing metadata as first-class states.

## Early Interface Shape

The first real app design should center on a workbench layout:

- Project and dataset navigation.
- Import and batch-processing queue.
- Dataset table with status, source, frequency range, and measurement type.
- Plot canvas for EIS and 2nd-NLEIS views.
- Fit configuration and validation controls.
- Comparison panel for selected runs.
- Run history with parameters, metrics, artifacts, and notes.

## Development Notes

Do not commit raw experimental data, private analysis output, local environment files, or service credentials. Use ignored local paths for measurements and generated artifacts.

Authoritative setup details for Next.js, Vercel, and Supabase should be verified against current official documentation before implementation because those platforms change frequently.

## Verification

Useful local checks:

```bash
npm run lint
npm run build
npm run test:python
python3 -m compileall service
```

`npm run test:python` finds the selected local interpreter (or a ready Conda environment), fails if `nleis==0.3` is unavailable, and executes real synthetic `EISandNLEIS` fits. It does not use a synthetic fit adapter.
