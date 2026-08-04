-- Migration: Gruppen-spezifische Punktwert-Overrides
-- Datum: 2026-08-04

create table if not exists group_category_overrides (
  id uuid primary key default gen_random_uuid(),
  group_id uuid references groups(id) not null,
  category_id uuid references point_categories(id) not null,
  points integer not null,
  created_at timestamptz default now(),
  unique(group_id, category_id)
);

alter table group_category_overrides enable row level security;

create policy "Mitglieder sehen Overrides ihrer Gruppe"
  on group_category_overrides for select
  using (group_id = any(array(select get_my_group_ids())));

create policy "Mitglieder koennen Overrides erstellen"
  on group_category_overrides for insert
  with check (group_id = any(array(select get_my_group_ids())));

create policy "Mitglieder koennen Overrides aktualisieren"
  on group_category_overrides for update
  using (group_id = any(array(select get_my_group_ids())));

-- DELETE-Policy fuer eigene Gruppenkategorien
create policy "Gruppenmitglieder koennen eigene Kategorien loeschen"
  on point_categories for delete
  using (is_global = false and group_id = any(array(select get_my_group_ids())));
