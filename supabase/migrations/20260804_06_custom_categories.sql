-- Migration: Eigene Punktekategorien
-- Datum: 2026-08-04

alter table point_categories
  add column if not exists created_by uuid references auth.users(id);

create policy "Nutzer koennen eigene Kategorien erstellen"
  on point_categories for insert
  with check (auth.uid() = created_by and is_global = false);
