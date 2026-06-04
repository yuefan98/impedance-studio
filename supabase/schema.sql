-- Supabase draft schema for Impedance Studio hosted mode.
-- Local sensitive-data mode uses SQLite and does not require these tables.

create extension if not exists pgcrypto;

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.datasets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null,
  kind text not null check (kind in ('EIS', '2nd-NLEIS')),
  source_name text not null,
  point_count integer not null,
  freq_min double precision not null,
  freq_max double precision not null,
  temperature_c double precision,
  data jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists public.models (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  kind text not null check (kind in ('template', 'snapshot')),
  scope text not null check (scope in ('project', 'global')),
  circuit_1 text not null,
  circuit_2 text not null,
  initial_guess jsonb not null default '[]'::jsonb,
  bounds jsonb not null default '{}'::jsonb,
  constants jsonb not null default '{}'::jsonb,
  shared_parameters jsonb not null default '[]'::jsonb,
  fitted_parameters jsonb,
  validation_summary jsonb,
  plot_series jsonb,
  source_run_id uuid,
  pinned boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.runs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  model_id uuid not null references public.models(id) on delete restrict,
  mode text not null check (mode in ('joint-fit', 'batch-joint-fit')),
  status text not null,
  progress integer not null default 0,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  summary jsonb not null default '{}'::jsonb
);

create table if not exists public.run_items (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.runs(id) on delete cascade,
  dataset_id uuid not null references public.datasets(id) on delete cascade,
  status text not null,
  progress integer not null default 0,
  message text,
  result jsonb not null default '{}'::jsonb
);

alter table public.projects enable row level security;
alter table public.datasets enable row level security;
alter table public.models enable row level security;
alter table public.runs enable row level security;
alter table public.run_items enable row level security;

create policy "projects are owned by user"
on public.projects
for all
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

create policy "datasets follow project ownership"
on public.datasets
for all
using (
  exists (
    select 1 from public.projects
    where projects.id = datasets.project_id
      and projects.owner_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.projects
    where projects.id = datasets.project_id
      and projects.owner_id = auth.uid()
  )
);

create policy "models are owned or pinned by user"
on public.models
for all
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

create policy "runs follow project ownership"
on public.runs
for all
using (
  exists (
    select 1 from public.projects
    where projects.id = runs.project_id
      and projects.owner_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.projects
    where projects.id = runs.project_id
      and projects.owner_id = auth.uid()
  )
);

create policy "run items follow run ownership"
on public.run_items
for all
using (
  exists (
    select 1
    from public.runs
    join public.projects on projects.id = runs.project_id
    where runs.id = run_items.run_id
      and projects.owner_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.runs
    join public.projects on projects.id = runs.project_id
    where runs.id = run_items.run_id
      and projects.owner_id = auth.uid()
  )
);
