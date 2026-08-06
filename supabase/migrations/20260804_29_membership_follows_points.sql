-- Migration: Gruppenzugehoerigkeit folgt den Punkten
-- Datum: 2026-08-07
--
-- Bisher wurden beim Oeffnen einer Gruppe automatisch Mitgliedschaften fuer
-- alle Partner der Nutzerin angelegt -- eine frisch erstellte Gruppe zeigte
-- deshalb sofort alle Partner mit 0 Punkten im Ranking.
--
-- Neues Verhalten: group_partner_memberships ist die alleinige Quelle dafuer,
-- wer in einer Gruppe steht. Der Eintrag entsteht bei der ersten Punktevergabe
-- und verschwindet, sobald die Punktsumme in dieser Gruppe auf 0 faellt.

-- ── 1. Fehlende DELETE-Policy ───────────────────────────────────
-- Bisher gab es nur select/insert/update. Ohne diese Policy koennte der
-- Eintrag nach dem Loeschen des letzten Punkts nicht entfernt werden.
drop policy if exists "Partner-Eigentuemerin entfernt Mitgliedschaft" on group_partner_memberships;
create policy "Partner-Eigentuemerin entfernt Mitgliedschaft"
  on group_partner_memberships for delete
  using (partner_id = any(array(select get_my_partner_ids())));

-- ── 2. Punkte vergeben: Mitgliedschaft mitanlegen ───────────────
-- Beides in einer Funktion, damit es atomar ist: entweder Eintrag und
-- Mitgliedschaft entstehen zusammen, oder gar nichts.
--
-- Bewusst SECURITY INVOKER (Standard): so greifen die bestehenden
-- RLS-Policies weiter (eigener Partner, eigene Gruppe, created_by).
-- Die Pruefungen muessen hier also nicht dupliziert werden.
create or replace function add_point_entry(
  p_partner_id uuid,
  p_group_id uuid,
  p_category_id uuid,
  p_points integer,
  p_note text,
  p_without_request boolean
)
returns table (awarded_points integer, cap_reason text)
language plpgsql
set search_path = public
as $$
declare
  v_points integer;
  v_reason text;
begin
  insert into group_partner_memberships (group_id, partner_id, active)
  values (p_group_id, p_partner_id, true)
  on conflict (group_id, partner_id) do nothing;

  insert into point_entries (partner_id, group_id, category_id, points, note, created_by, without_request)
  values (
    p_partner_id, p_group_id, p_category_id, p_points,
    nullif(btrim(coalesce(p_note, '')), ''),
    auth.uid(), coalesce(p_without_request, false)
  )
  -- Der Trigger apply_point_entry_rules kann die Punkte noch kappen,
  -- deshalb den tatsaechlich gespeicherten Wert zurueckgeben.
  returning point_entries.points, point_entries.capped_reason
  into v_points, v_reason;

  awarded_points := v_points;
  cap_reason := v_reason;
  return next;
end;
$$;

grant execute on function add_point_entry(uuid, uuid, uuid, integer, text, boolean) to authenticated;

-- ── 3. Punkt loeschen: Mitgliedschaft ggf. entfernen ────────────
create or replace function delete_point_entry(p_entry_id uuid)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_partner uuid;
  v_group uuid;
  v_total integer;
begin
  delete from point_entries where id = p_entry_id
  returning partner_id, group_id into v_partner, v_group;

  -- Die DELETE-Policy laesst nur eigene Eintraege zu; ohne Treffer war
  -- der Eintrag entweder fremd oder existiert nicht mehr.
  if v_partner is null then
    raise exception 'Eintrag nicht gefunden oder keine Berechtigung.';
  end if;

  select coalesce(sum(points), 0) into v_total
  from point_entries
  where partner_id = v_partner and group_id = v_group;

  if v_total <= 0 then
    delete from group_partner_memberships
     where partner_id = v_partner and group_id = v_group;
  end if;
end;
$$;

grant execute on function delete_point_entry(uuid) to authenticated;

-- ── 4. Bestandsdaten angleichen ─────────────────────────────────
-- Migration 15 hatte fuer jede bestehende Gruppen-/Partner-Kombination eine
-- Mitgliedschaft angelegt. Alle ohne Punkte werden jetzt entfernt, damit
-- Bestandsgruppen sich genauso verhalten wie neue.
delete from group_partner_memberships gpm
where coalesce((
  select sum(pe.points)
  from point_entries pe
  where pe.partner_id = gpm.partner_id and pe.group_id = gpm.group_id
), 0) <= 0;

-- Kontrolle: sollte 0 Zeilen liefern
-- select count(*) from group_partner_memberships gpm
-- where coalesce((select sum(pe.points) from point_entries pe
--   where pe.partner_id = gpm.partner_id and pe.group_id = gpm.group_id), 0) <= 0;
