-- Supabase schema for Impedance Studio hosted mode.
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
  storage_path text,
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
  artifact_path text,
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

alter table public.datasets add column if not exists storage_path text;
alter table public.models add column if not exists artifact_path text;

do $$
begin
  alter table public.models
    add constraint models_source_run_id_fkey
    foreign key (source_run_id) references public.runs(id) on delete set null;
exception
  when duplicate_object then null;
end $$;

create index if not exists projects_owner_id_idx on public.projects(owner_id);
create index if not exists datasets_project_id_idx on public.datasets(project_id);
create index if not exists models_project_id_idx on public.models(project_id);
create index if not exists models_owner_id_idx on public.models(owner_id);
create index if not exists models_source_run_id_idx on public.models(source_run_id);
create index if not exists runs_project_id_idx on public.runs(project_id);
create index if not exists runs_model_id_idx on public.runs(model_id);
create index if not exists run_items_run_id_idx on public.run_items(run_id);
create index if not exists run_items_dataset_id_idx on public.run_items(dataset_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists models_set_updated_at on public.models;
create trigger models_set_updated_at
before update on public.models
for each row
execute function public.set_updated_at();

alter table public.projects enable row level security;
alter table public.datasets enable row level security;
alter table public.models enable row level security;
alter table public.runs enable row level security;
alter table public.run_items enable row level security;

drop policy if exists "projects are owned by user" on public.projects;
drop policy if exists "projects are owned by the current user" on public.projects;
create policy "projects are owned by the current user"
on public.projects
for all
using (owner_id = (select auth.uid()))
with check (owner_id = (select auth.uid()));

drop policy if exists "datasets follow project ownership" on public.datasets;
create policy "datasets follow project ownership"
on public.datasets
for all
using (
  exists (
    select 1 from public.projects
    where projects.id = datasets.project_id
      and projects.owner_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1 from public.projects
    where projects.id = datasets.project_id
      and projects.owner_id = (select auth.uid())
  )
);

drop policy if exists "models are owned by user" on public.models;
drop policy if exists "models are owned or pinned by user" on public.models;
drop policy if exists "models are owned by the current user" on public.models;
create policy "models are owned by the current user"
on public.models
for all
using (owner_id = (select auth.uid()))
with check (owner_id = (select auth.uid()));

drop policy if exists "runs follow project ownership" on public.runs;
create policy "runs follow project ownership"
on public.runs
for all
using (
  exists (
    select 1 from public.projects
    where projects.id = runs.project_id
      and projects.owner_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1 from public.projects
    where projects.id = runs.project_id
      and projects.owner_id = (select auth.uid())
  )
);

drop policy if exists "run items follow run ownership" on public.run_items;
create policy "run items follow run ownership"
on public.run_items
for all
using (
  exists (
    select 1
    from public.runs
    join public.projects on projects.id = runs.project_id
    where runs.id = run_items.run_id
      and projects.owner_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1
    from public.runs
    join public.projects on projects.id = runs.project_id
    where runs.id = run_items.run_id
      and projects.owner_id = (select auth.uid())
  )
);

insert into storage.buckets (id, name, public, file_size_limit)
values
  ('impedance-raw-data', 'impedance-raw-data', false, 104857600),
  ('impedance-analysis-artifacts', 'impedance-analysis-artifacts', false, 104857600)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit;

drop policy if exists "raw data objects follow project ownership" on storage.objects;
create policy "raw data objects follow project ownership"
on storage.objects
for all
using (
  bucket_id = 'impedance-raw-data'
  and owner = (select auth.uid())
  and exists (
    select 1 from public.projects
    where projects.id::text = (storage.foldername(name))[1]
      and projects.owner_id = (select auth.uid())
  )
)
with check (
  bucket_id = 'impedance-raw-data'
  and owner = (select auth.uid())
  and exists (
    select 1 from public.projects
    where projects.id::text = (storage.foldername(name))[1]
      and projects.owner_id = (select auth.uid())
  )
);

drop policy if exists "analysis artifacts follow project ownership" on storage.objects;
create policy "analysis artifacts follow project ownership"
on storage.objects
for all
using (
  bucket_id = 'impedance-analysis-artifacts'
  and owner = (select auth.uid())
  and exists (
    select 1 from public.projects
    where projects.id::text = (storage.foldername(name))[1]
      and projects.owner_id = (select auth.uid())
  )
)
with check (
  bucket_id = 'impedance-analysis-artifacts'
  and owner = (select auth.uid())
  and exists (
    select 1 from public.projects
    where projects.id::text = (storage.foldername(name))[1]
      and projects.owner_id = (select auth.uid())
  )
);
