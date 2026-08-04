-- Migration: RLS-Fix für group_members und partners
-- Ermöglicht Gruppen-Mitgliedern, alle Mitglieder und deren Partner zu sehen
-- Datum: 2026-08-04

-- Hilfsfunktion zur Vermeidung von RLS-Rekursion
create or replace function get_my_group_ids()
returns setof uuid
language sql
security definer
set search_path = public
as $$
  select group_id from group_members where user_id = auth.uid();
$$;

-- group_members: alle Mitglieder einer gemeinsamen Gruppe sehen
drop policy if exists "Mitglieder sehen Gruppenmitglieder" on group_members;
drop policy if exists "Mitglieder sehen alle Mitglieder ihrer Gruppe" on group_members;
create policy "Mitglieder sehen alle Mitglieder ihrer Gruppe"
  on group_members for select
  using (group_id = any(array(select get_my_group_ids())));

-- partners: eigene Partner + Partner anderer Mitglieder in gemeinsamen Gruppen sehen
drop policy if exists "Nutzer sieht nur eigene Partner" on partners;
drop policy if exists "Nutzer sieht eigene und Gruppen-Partner" on partners;
create policy "Nutzer sieht eigene und Gruppen-Partner"
  on partners for select
  using (
    owner_user_id = auth.uid()
    or owner_user_id in (
      select user_id from group_members
      where group_id = any(array(select get_my_group_ids()))
    )
  );
