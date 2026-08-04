-- Migration: RLS-Rekursion bei partners / partner_connections beheben
-- Datum: 2026-08-04
-- Problem: partners-Policy las partner_connections, die wiederum partners las → Endlosschleife
-- Lösung: Security-Definer-Funktionen wie bei get_my_group_ids()

create or replace function get_my_partner_ids()
returns setof uuid
language sql
security definer
set search_path = public
as $$
  select id from partners where owner_user_id = auth.uid();
$$;

create or replace function get_my_connected_partner_ids()
returns setof uuid
language sql
security definer
set search_path = public
as $$
  select partner_id from partner_connections
  where man_user_id = auth.uid() and disconnected_at is null;
$$;

drop policy if exists "Sieht eigene Verbindungen" on partner_connections;
create policy "Sieht eigene Verbindungen"
  on partner_connections for select
  using (
    partner_id = any(array(select get_my_partner_ids()))
    or man_user_id = auth.uid()
  );

drop policy if exists "Frau erstellt Verbindung fuer ihren Partner" on partner_connections;
create policy "Frau erstellt Verbindung fuer ihren Partner"
  on partner_connections for insert
  with check (
    partner_id = any(array(select get_my_partner_ids()))
  );

drop policy if exists "Nutzer sieht eigene und Gruppen-Partner" on partners;
create policy "Nutzer sieht eigene und Gruppen-Partner"
  on partners for select
  using (
    owner_user_id = auth.uid()
    or owner_user_id in (
      select user_id from group_members
      where group_id = any(array(select get_my_group_ids()))
    )
    or id = any(array(select get_my_connected_partner_ids()))
  );
