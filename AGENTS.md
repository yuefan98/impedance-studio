# Impedance Studio Agent Guide

## Scope

Work only inside `/Users/yuefanji/Desktop/codex/impedance-studio` unless the user explicitly grants a broader scope. Do not edit sibling repositories, global configuration, or files outside this workspace.

## Project Direction

Impedance Studio is a hybrid local/cloud scientific workbench for EIS and 2nd-NLEIS analysis using `impedance.py` and `nleis.py`.

Default architecture assumptions:

- Next.js App Router, TypeScript, Tailwind, and shadcn-style components for the web interface.
- Vercel for hosted deployments.
- Supabase Auth, Postgres, Storage, and Row Level Security for hosted persistence.
- Python analysis services or workers for `impedance.py` and `nleis.py`.
- Local-first execution path for sensitive data users.

Keep the Python analysis layer behind a clear service or worker boundary. Do not mix fitting or validation logic directly into frontend components.

## Change Discipline

- Make small, focused changes that match the current repository structure.
- Read nearby files before editing.
- Prefer standard library and existing project tools before adding dependencies.
- Do not add speculative abstractions, broad configurability, or unrelated refactors.
- Do not commit secrets, raw private data, local analysis outputs, or generated artifacts.
- Protect user work. Do not revert or overwrite changes you did not make unless explicitly asked.

## Python Environment

- Use an existing project-specific conda environment if one is documented or already present.
- Do not modify a conda environment unless the user approves it.
- If a new environment is needed, prefer a clearly named project environment such as `impedance-studio-py311`.
- Do not install packages globally.
- Update dependency files when dependencies are intentionally added.

## Web And Data Rules

- Verify current official documentation before implementing Vercel or Supabase behavior.
- Initialize Supabase clients lazily in server-side code so builds do not fail when runtime environment variables are absent.
- Never expose Supabase service-role or secret keys to browser code.
- Use Row Level Security for any Supabase table in an exposed schema.
- Keep local data paths and generated analysis artifacts ignored by git.

## Verification

For each task:

1. Identify the smallest relevant code path.
2. Add or update focused tests when behavior changes.
3. Run the narrowest useful verification first.
4. Run broader checks when the change affects shared behavior or deployment.
5. Report exactly which commands passed or why verification could not be run.

Useful commands may include:

```bash
git status --short --branch
git diff --check
python -m pytest
python -m compileall .
npm run lint
npm run build
```

Use only commands that fit the files and tooling present in the repository.

## Commit Requirement

After finishing each task, create a local git commit with a detailed commit message unless the user explicitly says not to commit.

Before committing:

1. Run `git status --short --branch`.
2. Inspect the diff.
3. Run relevant verification.
4. Stage only the files that belong to the task.

Commit message format:

```text
Short imperative subject

- Explain what changed.
- Explain why it changed.
- List verification commands and outcomes.
```

Do not push unless the user explicitly asks.
