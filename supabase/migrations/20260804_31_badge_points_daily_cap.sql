-- Migration: Tagesgrenze auch fuer das Badge-Konto
-- Datum: 2026-08-07
--
-- Ausgangslage: Seit Migration 30 gilt das Tageslimit von 80 Punkten pro
-- Gruppe. Badges und Meilensteine zaehlen aber ueber alle Gruppen zusammen --
-- ein Partner in drei Gruppen konnte an einem Tag 240 Punkte auf sein
-- globales Badge-Konto bekommen, einer mit einer Gruppe nur 80.
--
-- Fix: Fuer die Badge-Auswertung wird pro Kalendertag hoechstens 80 Punkte
-- gezaehlt, quer ueber alle Gruppen. Die Rangliste bleibt unberuehrt: dort
-- zaehlen weiterhin die tatsaechlich gespeicherten Punkte je Gruppe.
--
-- Verteilt wird das Tagesbudget chronologisch: Eintraege zaehlen in der
-- Reihenfolge ihres Entstehens, bis die 80 aufgebraucht sind. Das entspricht
-- der Arbeitsweise des Triggers und ist nachvollziehbarer als eine
-- anteilige Verteilung ueber die Kategorien.

-- ── Eintraege eines Partners mit gedeckelten Punkten ────────────
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
  with ordered as (
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
    where pe.partner_id = p_partner_id
  )
  select
    -- running - pts = an diesem Tag bereits verbrauchtes Budget
    greatest(0, least(o.pts, 80 - (o.running - o.pts)))::integer,
    o.ts, o.wr, o.cname, o.ctag, o.ctier, o.cglobal
  from ordered o;
end;
$$;

grant execute on function partner_capped_entries(uuid) to authenticated;

-- ── Fortschrittsbalken auf dieselbe Quelle stellen ──────────────
create or replace function partner_point_totals(p_partner_id uuid)
returns table (category_tag text, total integer)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  select e.cat_tag, coalesce(sum(e.counted_points), 0)::integer
  from partner_capped_entries(p_partner_id) e
  group by e.cat_tag;
end;
$$;

grant execute on function partner_point_totals(uuid) to authenticated;

-- Kontrolle: gedeckelte Tagessummen duerfen nie ueber 80 liegen
-- select entry_at::date, sum(counted_points)
-- from partner_capped_entries('<partner-uuid>')
-- group by 1 having sum(counted_points) > 80;
