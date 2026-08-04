-- Migration: RPC-Funktion zum Beitreten per Invite-Code
-- Datum: 2026-08-04

create or replace function join_group_by_invite_code(code text)
returns json
language plpgsql
security definer
as $$
declare
  found_group groups%rowtype;
begin
  select * into found_group from groups where invite_code = upper(code);

  if found_group.id is null then
    raise exception 'Ungültiger Einladungscode.';
  end if;

  insert into group_members (group_id, user_id)
  values (found_group.id, auth.uid())
  on conflict do nothing;

  return json_build_object(
    'id', found_group.id,
    'name', found_group.name,
    'invite_code', found_group.invite_code
  );
end;
$$;
