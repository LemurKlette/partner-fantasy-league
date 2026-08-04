-- Migration: delete_account RPC-Funktion
-- Datum: 2026-08-04

create or replace function delete_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_partner_id uuid;
begin
  -- Partner-ID ermitteln
  select id into v_partner_id from partners where owner_user_id = v_user_id;

  -- Punkteeinträge des Partners löschen
  if v_partner_id is not null then
    delete from point_entries where partner_id = v_partner_id;
  end if;

  -- Gruppenmitgliedschaften löschen
  delete from group_members where user_id = v_user_id;

  -- Partner löschen
  delete from partners where owner_user_id = v_user_id;

  -- Auth-User löschen
  delete from auth.users where id = v_user_id;
end;
$$;

grant execute on function delete_account() to authenticated;
