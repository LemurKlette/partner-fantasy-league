-- Migration: Badge-Konto zaehlt pro Tag nur die beste Gruppe
-- Datum: 2026-08-07
--
-- Ersetzt die Regel aus Migration 31 (80 Punkte pro Tag ueber alle Gruppen).
-- Die reichte nicht: traegt eine Nutzerin dieselbe erledigte Aufgabe in
-- mehrere Gruppen ein, zaehlte sie mehrfach aufs Badge-Konto -- "Muell
-- rausbringen" in drei Gruppen ergab 3 x 2 = 6 Punkte fuer eine einzige
-- echte Handlung, weit unterhalb jedes 80er-Deckels.
--
-- Neue Regel: Fuer die Badge-Auswertung zaehlt pro Kalendertag nur die
-- Gruppe, in der der Partner an dem Tag am meisten gesammelt hat. Damit
-- zaehlt eine Handlung genau einmal, und wer in vielen Gruppen mitspielt,
-- hat keinen Vorteil gegenueber jemandem mit nur einer Gruppe.
--
-- Die Ranglisten bleiben unberuehrt: dort zaehlen weiterhin die tatsaechlich
-- gespeicherten Punkte je Gruppe.

create or replace function partner_capped_entries(p_partner_id uuid)
returns table (
  counted_points integer,
  entry_at timestamptz,
  unprompted boolean,
  category_name text,
  cat_tag text,
  cat_tier integer,
  cat_is_global boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tz text;
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

  -- Tagesgrenze in der Zeitzone der Partner-Eigentuemerin, damit sie mit
  -- der Trigger-Logik uebereinstimmt.
  select p2.timezone into v_tz
  from partners pa
  left join profiles p2 on p2.user_id = pa.owner_user_id
  where pa.id = p_partner_id;
  if v_tz is null or not exists (select 1 from pg_timezone_names where name = v_tz) then
    v_tz := 'Europe/Berlin';
  end if;

  return query
  with daily as (
    select
      pe.group_id as gid,
      (pe.created_at at time zone v_tz)::date as lday,
      sum(pe.points) as day_points
    from point_entries pe
    where pe.partner_id = p_partner_id
    group by 1, 2
  ),
  best as (
    -- Pro Tag die Gruppe mit der hoechsten Summe. Bei Gleichstand
    -- entscheidet die group_id, damit das Ergebnis stabil bleibt und
    -- nicht bei jedem Aufruf wechselt.
    select distinct on (d.lday) d.lday, d.gid
    from daily d
    order by d.lday, d.day_points desc, d.gid
  ),
  ordered as (
    select
      pe.points as pts,
      pe.created_at as ts,
      pe.without_request as wr,
      pc.name as cname,
      pc.category_tag as ctag,
      pc.tier as ctier,
      pc.is_global as cglobal,
      sum(pe.points) over (
        partition by (pe.created_at at time zone v_tz)::date
        order by pe.created_at, pe.id
        rows between unbounded preceding and current row
      ) as running
    from point_entries pe
    join point_categories pc on pc.id = pe.category_id
    join best b
      on b.lday = (pe.created_at at time zone v_tz)::date
     and b.gid = pe.group_id
    where pe.partner_id = p_partner_id
  )
  select
    -- Der 80er-Deckel greift hier normalerweise nicht mehr, weil eine
    -- einzelne Gruppe pro Tag ohnehin nicht darueber kommt. Er bleibt als
    -- Sicherheitsnetz fuer Alt-Eintraege aus der Zeit vor Migration 17,
    -- als es noch gar kein Tageslimit gab.
    greatest(0, least(o.pts, 80 - (o.running - o.pts)))::integer,
    o.ts, o.wr, o.cname, o.ctag, o.ctier, o.cglobal
  from ordered o;
end;
$$;

grant execute on function partner_capped_entries(uuid) to authenticated;

-- partner_point_totals() baut unveraendert auf dieser Funktion auf und
-- uebernimmt die neue Regel damit automatisch.

-- Kontrolle: pro Tag darf nur eine group_id beitragen
-- select entry_at::date, count(*), sum(counted_points)
-- from partner_capped_entries('<partner-uuid>') group by 1 order by 1;
