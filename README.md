# Impedance Studio

Impedance Studio is planned as a scientific workbench for electrochemical impedance analysis. The platform will help researchers and engineers batch process, fit, validate, visualize, store, and compare EIS and 2nd-NLEIS datasets using the Python ecosystems around `impedance.py` and `nleis.py`.

The project is intentionally hybrid:

- Hosted mode uses Vercel for the web app and Supabase for auth, database, storage, and project metadata.
- Local mode lets sensitive-data users clone the repository and run the workflow without uploading private measurements to a cloud service.

This repository currently contains only project foundations and product direction. No application scaffold has been created yet.

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
4. Queue model fits and validation runs.
5. Visualize Nyquist, Bode, residual, second-harmonic, and comparison plots.
6. Store run metadata, fitted parameters, validation summaries, and generated artifacts.
7. Compare runs across datasets, cells, model families, or processing settings.
8. Export processed data, figures, reports, and machine-readable results.

## Architecture Direction

The likely stack is:

- Frontend and app shell: Next.js App Router, TypeScript, Tailwind, and shadcn-style components.
- Hosting: Vercel for the hosted web app and preview deployments.
- Database and auth: Supabase Auth, Postgres, Storage, and Row Level Security.
- Analysis layer: Python services or workers that call `impedance.py` and `nleis.py`.
- Local mode: the same repository should run against local configuration and local data paths.

The analysis layer should stay behind a clear service or worker boundary. Python fitting and validation code should not be mixed into frontend components.

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
