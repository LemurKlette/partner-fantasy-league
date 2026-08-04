-- Migration: delete_partner RPC
-- Datum: 2026-08-04

create or replace function delete_partner(p_partner_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from partners where id = p_partner_id and owner_user_id = auth.uid()) then
    raise exception 'Kein Zugriff auf diesen Partner.';
  end if;
  delete from point_entries where partner_id = p_partner_id;
  delete from partner_badges where partner_id = p_partner_id;
  delete from partner_connections where partner_id = p_partner_id;
  delete from partners where id = p_partner_id;
end;
$$;

grant execute on function delete_partner(uuid) to authenticated;
