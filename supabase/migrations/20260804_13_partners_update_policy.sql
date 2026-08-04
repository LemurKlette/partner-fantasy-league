-- Migration: UPDATE-Policy fuer Partners
-- Datum: 2026-08-04

create policy "Nutzer kann eigene Partner aktualisieren"
  on partners for update
  using (owner_user_id = auth.uid())
  with check (owner_user_id = auth.uid());
