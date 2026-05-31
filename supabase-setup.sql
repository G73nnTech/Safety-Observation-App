create table if not exists public.safety_observations (
  id text primary key,
  group_id text not null default 'main',
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.safety_observations enable row level security;

grant usage on schema public to anon;
grant usage on schema public to authenticated;
grant select, insert, update, delete on public.safety_observations to authenticated;
revoke all on public.safety_observations from anon;

drop policy if exists "Allow public read for prototype" on public.safety_observations;
drop policy if exists "Allow public insert for prototype" on public.safety_observations;
drop policy if exists "Allow public update for prototype" on public.safety_observations;
drop policy if exists "Allow public delete for prototype" on public.safety_observations;

drop policy if exists "Allow signed-in read for prototype" on public.safety_observations;
create policy "Allow signed-in read for prototype"
on public.safety_observations
for select
to authenticated
using (true);

drop policy if exists "Allow signed-in insert for prototype" on public.safety_observations;
create policy "Allow signed-in insert for prototype"
on public.safety_observations
for insert
to authenticated
with check (true);

drop policy if exists "Allow signed-in update for prototype" on public.safety_observations;
create policy "Allow signed-in update for prototype"
on public.safety_observations
for update
to authenticated
using (true)
with check (true);

drop policy if exists "Allow signed-in delete for prototype" on public.safety_observations;
create policy "Allow signed-in delete for prototype"
on public.safety_observations
for delete
to authenticated
using (true);
