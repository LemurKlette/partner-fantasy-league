-- Migration: Punkt-Einträge löschen
-- Datum: 2026-08-04
-- Nur der Ersteller darf seinen eigenen Eintrag löschen

create policy "Ersteller kann eigene Eintraege loeschen"
  on point_entries for delete
  using (created_by = auth.uid());
