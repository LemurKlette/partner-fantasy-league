-- Migration: Gruppen-spezifische Kategorien
-- Datum: 2026-08-04
-- Eigene Kategorien gehoeren zur Gruppe, nicht zum Nutzer

alter table point_categories
  add column if not exists group_id uuid references groups(id);

drop policy if exists "Nutzer koennen eigene Kategorien erstellen" on point_categories;

create policy "Gruppenmitglieder koennen Gruppenkategorien erstellen"
  on point_categories for insert
  with check (
    auth.uid() = created_by
    and is_global = false
    and group_id = any(array(select get_my_group_ids()))
  );
