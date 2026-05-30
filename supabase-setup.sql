create table if not exists public.safety_observations (
  id text primary key,
  group_id text not null default 'main',
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.safety_observations enable row level security;

drop policy if exists "Allow public read for prototype" on public.safety_observations;
create policy "Allow public read for prototype"
on public.safety_observations
for select
to anon
using (true);

drop policy if exists "Allow public insert for prototype" on public.safety_observations;
create policy "Allow public insert for prototype"
on public.safety_observations
for insert
to anon
with check (true);

drop policy if exists "Allow public update for prototype" on public.safety_observations;
create policy "Allow public update for prototype"
on public.safety_observations
for update
to anon
using (true)
with check (true);

drop policy if exists "Allow public delete for prototype" on public.safety_observations;
create policy "Allow public delete for prototype"
on public.safety_observations
for delete
to anon
using (true);
