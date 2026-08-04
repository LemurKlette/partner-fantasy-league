-- Migration: Gruppe löschen (nur durch die Erstellerin)
-- Datum: 2026-08-05

create or replace function delete_group(p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from groups where id = p_group_id and created_by = auth.uid()) then
    raise exception 'Nur die Erstellerin kann diese Gruppe löschen.';
  end if;

  delete from partner_badges where group_id = p_group_id;
  delete from group_category_overrides where group_id = p_group_id;
  delete from point_entries where group_id = p_group_id;
  delete from point_categories where group_id = p_group_id;
  delete from group_partner_memberships where group_id = p_group_id;
  delete from group_members where group_id = p_group_id;
  delete from groups where id = p_group_id;
end;
$$;

grant execute on function delete_group(uuid) to authenticated;

-- join_group_by_invite_code muss jetzt auch created_by zurueckgeben,
-- damit der Client weiss, ob die beitretende Person die Erstellerin ist
-- (steuert die Sichtbarkeit des "Gruppe loeschen"-Buttons).
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
    'invite_code', found_group.invite_code,
    'created_by', found_group.created_by
  );
end;
$$;
