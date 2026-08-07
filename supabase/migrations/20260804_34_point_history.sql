-- Migration: Punktehistorie eines Partners
-- Datum: 2026-08-07
--
-- Liefert die vollstaendige Historie eines Partners ueber alle Gruppen --
-- einschliesslich weich geloeschter Gruppen, deren Punkte weiterhin aufs
-- Erfolgskonto zaehlen (siehe Migration 33). Die Eintraege werden in der
-- App nach Kalenderwochen gruppiert.
--
-- Als SECURITY DEFINER noetig, weil die RLS auf point_entries an die
-- Gruppenmitgliedschaft gebunden ist: Maenner stehen nie in group_members
-- und koennten ihre eigene Historie sonst nicht sehen. Die Zugriffspruefung
-- entspricht der von partner_capped_entries().
--
-- Bewusst werden die tatsaechlich vergebenen Punkte gezeigt, nicht die fuer
-- Badges gedeckelten: die Historie protokolliert, was in der jeweiligen
-- Gruppe passiert ist.

create or replace function partner_point_history(p_partner_id uuid)
returns table (
  entry_at timestamptz,
  points integer,
  unprompted boolean,
  task_name text,
  cat_tag text,
  icon_key text,
  group_name text,
  group_deleted boolean
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (
    p_partner_id = any(array(select get_my_partner_ids()))
    or p_partner_id = any(array(select get_my_connected_partner_ids()))
    or exists (
      select 1 from group_partner_memberships gpm
      where gpm.partner_id = p_partner_id
        and gpm.group_id = any(array(select get_my_group_ids()))
    )
  ) then
    raise exception 'Kein Zugriff auf diesen Partner.';
  end if;

  return query
  select
    pe.created_at,
    pe.points,
    pe.without_request,
    pc.name,
    pc.category_tag,
    pc.icon_key,
    g.name,
    (g.deleted_at is not null)
  from point_entries pe
  join point_categories pc on pc.id = pe.category_id
  join groups g on g.id = pe.group_id
  where pe.partner_id = p_partner_id
  order by pe.created_at desc;
end;
$$;

grant execute on function partner_point_history(uuid) to authenticated;
